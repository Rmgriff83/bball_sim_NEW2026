<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Stripe\Checkout\Session as StripeSession;
use Stripe\Exception\SignatureVerificationException;
use Stripe\Stripe;
use Stripe\Webhook as StripeWebhook;

class PaymentController extends Controller
{
    /**
     * Set by applyBundle() when a webhook credits tokens; consumed by
     * verifyTokenCredit() after the surrounding transaction commits.
     *
     * @var array{user_id: int, expected: ?int}|null
     */
    private ?array $lastTokenCredit = null;

    /**
     * Create a Stripe Checkout Session for a token bundle.
     * POST /api/payments/checkout-session  (auth:sanctum)
     *
     * Request: { bundle_id: 'tokens_1000' | 'tokens_6500' }
     * Response: { url: 'https://checkout.stripe.com/…' }
     */
    public function createCheckoutSession(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'bundle_id' => 'required|string',
        ]);

        $bundles = config('services.stripe.bundles', []);
        $bundle = $bundles[$validated['bundle_id']] ?? null;

        if (!$bundle || empty($bundle['price_id'])) {
            return response()->json(['message' => 'Unknown bundle'], 422);
        }

        Stripe::setApiKey(config('services.stripe.secret'));

        $user = $request->user();

        $session = StripeSession::create([
            'mode' => 'payment',
            'line_items' => [[
                'price' => $bundle['price_id'],
                'quantity' => 1,
            ]],
            'client_reference_id' => (string) $user->id,
            'customer_email' => $user->email,
            'metadata' => [
                'user_id' => (string) $user->id,
                'bundle_id' => $validated['bundle_id'],
            ],
            'success_url' => config('services.stripe.checkout_success_url'),
            'cancel_url' => config('services.stripe.checkout_cancel_url'),
        ]);

        return response()->json(['url' => $session->url]);
    }

    /**
     * Stripe webhook receiver.
     * POST /api/webhooks/stripe  (public — authenticated only by signature)
     */
    public function webhook(Request $request): Response
    {
        $payload = $request->getContent();
        $sigHeader = $request->header('Stripe-Signature');
        $webhookSecret = config('services.stripe.webhook_secret');

        try {
            $event = StripeWebhook::constructEvent($payload, $sigHeader, $webhookSecret);
        } catch (SignatureVerificationException $e) {
            return response('Invalid signature', 400);
        } catch (\UnexpectedValueException $e) {
            return response('Invalid payload', 400);
        }

        // Idempotency claim + fulfillment run in ONE transaction so they
        // commit or vanish together. This closes both loss modes:
        //  - graceful failure → we throw → claim rolls back → 500 → Stripe
        //    retries re-attempt once the cause is fixed;
        //  - hard death mid-request (OOM, FPM kill, timeout) → the
        //    uncommitted transaction auto-rolls back server-side, so the
        //    retry is NOT met with "Already processed" — the original flaw
        //    that permanently lost purchases.
        // Concurrent duplicate deliveries: the second insertOrIgnore blocks
        // on the first's row lock, then reports 0 rows once it commits.
        try {
            $status = DB::transaction(function () use ($event) {
                $claimed = DB::table('stripe_webhook_events')->insertOrIgnore([
                    'id' => $event->id,
                    'type' => $event->type,
                ]);
                if (!$claimed) {
                    return 'already_processed';
                }
                if ($event->type !== 'checkout.session.completed') {
                    return 'ignored'; // deliberate permanent skip — claim kept
                }
                if (!$this->fulfillCheckoutSession($event->data->object)) {
                    // Specific cause already logged by the fulfiller.
                    throw new \RuntimeException('fulfillment_failed');
                }
                return 'fulfilled';
            });
        } catch (\Throwable $e) {
            if ($e->getMessage() !== 'fulfillment_failed') {
                Log::error('Stripe fulfillment threw', [
                    'event_id' => $event->id,
                    'error' => $e->getMessage(),
                ]);
            }
            return response('Fulfillment failed', 500);
        }

        if ($status === 'fulfilled') {
            $this->verifyTokenCredit(['source' => 'stripe', 'event_id' => $event->id]);
        }

        return $status === 'already_processed'
            ? response('Already processed', 200)
            : response('OK', 200);
    }

    /**
     * Credit tokens to the user identified by the completed checkout session.
     *
     * Trust model: tokens granted are looked up server-side from the price id
     * returned by Stripe, NOT from any client- or metadata-supplied amount.
     *
     * Returns true when the event needs no retry (credited, or a deliberate
     * permanent skip like unpaid sessions); false when fulfillment was
     * attempted but failed — the caller rolls back the idempotency claim and
     * 500s so Stripe retries can succeed once the cause is fixed.
     */
    private function fulfillCheckoutSession(StripeSession $session): bool
    {
        if ($session->payment_status !== 'paid') {
            // Deliberate permanent skip — an unpaid session will arrive again
            // as a new event if it ever completes.
            return true;
        }

        $userId = $session->metadata->user_id ?? $session->client_reference_id ?? null;
        if (!$userId) {
            Log::warning('Stripe checkout completed with no user reference', ['session' => $session->id]);
            return false;
        }

        // Pull the price id from the session line items (server-side, trusted)
        Stripe::setApiKey(config('services.stripe.secret'));
        $lineItems = StripeSession::allLineItems($session->id, ['limit' => 1]);
        $priceId = $lineItems->data[0]->price->id ?? null;

        if (!$priceId) {
            Log::warning('Stripe checkout completed with no line item price', ['session' => $session->id]);
            return false;
        }

        $matchedBundle = null;
        foreach (config('services.stripe.bundles', []) as $bundle) {
            if (($bundle['price_id'] ?? null) === $priceId) {
                $matchedBundle = $bundle;
                break;
            }
        }

        if (!$matchedBundle) {
            Log::warning('Stripe checkout for unrecognized price id', [
                'session' => $session->id,
                'price_id' => $priceId,
            ]);
            return false;
        }

        $user = User::find($userId);
        if (!$user || !$user->profile) {
            Log::warning('Stripe checkout for missing user/profile', [
                'session' => $session->id,
                'user_id' => $userId,
            ]);
            return false;
        }

        $this->applyBundle($user, $matchedBundle, [
            'source' => 'stripe',
            'session' => $session->id,
            'price_id' => $priceId,
        ]);
        return true;
    }

    /**
     * Credit a fulfilled bundle to the user. Bundles can grant tokens
     * (consumable), unlock features (non-consumable), or both. Both setUnlock
     * and creditTokens are idempotent enough for webhook retry safety:
     * setUnlock no-ops when the feature is already owned, creditTokens is
     * already guarded by the unique webhook-event-id insert upstream.
     */
    private function applyBundle(User $user, array $bundle, array $logContext = []): void
    {
        if (!empty($bundle['unlocks']) && is_array($bundle['unlocks'])) {
            foreach ($bundle['unlocks'] as $feature) {
                if (is_string($feature) && $feature !== '') {
                    $user->profile->setUnlock($feature);
                    Log::notice('Payment unlock granted', $logContext + [
                        'user_id' => $user->id,
                        'feature' => $feature,
                    ]);
                }
            }
        }
        if (!empty($bundle['tokens']) && (int) $bundle['tokens'] > 0) {
            $newBalance = $user->profile->creditTokens((int) $bundle['tokens']);
            // Success audit line — a fulfilled purchase must be visible in
            // the log (previously success was silent, making "no log entry"
            // ambiguous between success and never-ran).
            Log::notice('Payment tokens credited', $logContext + [
                'user_id' => $user->id,
                'tokens' => (int) $bundle['tokens'],
                'new_balance' => $newBalance,
            ]);
            // Stash for the post-commit read-back (verifyTokenCredit) so a
            // credit that silently fails to persist is caught in-line.
            $this->lastTokenCredit = [
                'user_id' => $user->id,
                'expected' => $newBalance,
            ];
        }
    }

    /**
     * Post-commit verification: re-read the credited balance with a FRESH
     * query after the webhook's transaction has committed and compare it to
     * what creditTokens reported inside the transaction.
     *
     * Added after the 2026-07-10 incident where three credits logged success
     * yet the balance the app read never reflected them — had this line
     * existed, the discrepancy would have been visible in the very next log
     * line instead of taking a week to reconstruct. A mismatch is logged at
     * error level (never thrown — the purchase itself already committed).
     */
    private function verifyTokenCredit(array $logContext): void
    {
        if ($this->lastTokenCredit === null) {
            return; // this fulfillment credited no tokens (pure unlock)
        }

        $credit = $this->lastTokenCredit;
        $this->lastTokenCredit = null;

        $rewards = DB::table('user_profiles')
            ->where('user_id', $credit['user_id'])
            ->value('rewards');
        $fresh = (int) (json_decode($rewards ?? '{}', true)['tokens'] ?? 0);

        if ($fresh === $credit['expected']) {
            Log::notice('Payment credit verified', $logContext + [
                'user_id' => $credit['user_id'],
                'balance' => $fresh,
            ]);
        } else {
            // A concurrent legitimate spend/earn in the microseconds since
            // commit can also land here — the paired values let an
            // investigator tell drift from loss at a glance.
            Log::error('Payment credit verification mismatch', $logContext + [
                'user_id' => $credit['user_id'],
                'expected' => $credit['expected'],
                'actual' => $fresh,
            ]);
        }
    }

    /**
     * RevenueCat webhook receiver for iOS In-App Purchases.
     * POST /api/webhooks/revenuecat  (public — authenticated by Authorization header)
     *
     * RevenueCat sends a custom Authorization header value configured in the
     * RC dashboard. We compare it against REVENUECAT_WEBHOOK_AUTH (env). On
     * a match we credit tokens for supported consumable purchase events.
     */
    public function revenueCatWebhook(Request $request): Response
    {
        $expected = config('services.iap.webhook_auth');
        $provided = (string) $request->header('Authorization', '');

        if (!$expected || !hash_equals((string) $expected, $provided)) {
            return response('Unauthorized', 401);
        }

        $event = $request->input('event');
        if (!is_array($event) || empty($event['id']) || empty($event['type'])) {
            return response('Invalid payload', 400);
        }

        // Idempotency claim + fulfillment run in ONE transaction so they
        // commit or vanish together (see webhook() for the full rationale).
        // The claim-then-fulfill-non-atomically shape lost real purchases:
        // a request killed mid-fulfillment (OOM/FPM kill/timeout) left the
        // committed claim behind, and RC's retry was answered with
        // "Already processed" — tokens never credited, nothing logged.
        try {
            $status = DB::transaction(function () use ($event) {
                $claimed = DB::table('revenuecat_webhook_events')->insertOrIgnore([
                    'id' => $event['id'],
                    'type' => $event['type'],
                ]);
                if (!$claimed) {
                    return 'already_processed';
                }

                // Consumables come through as NON_RENEWING_PURCHASE;
                // INITIAL_PURCHASE covered defensively in case RC
                // re-classifies them.
                $purchaseTypes = ['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE'];
                if (!in_array($event['type'], $purchaseTypes, true)) {
                    return 'ignored'; // deliberate permanent skip — claim kept
                }
                if (!$this->fulfillIapPurchase($event)) {
                    // Specific cause already logged by the fulfiller.
                    throw new \RuntimeException('fulfillment_failed');
                }
                return 'fulfilled';
            });
        } catch (\Throwable $e) {
            if ($e->getMessage() !== 'fulfillment_failed') {
                Log::error('RevenueCat fulfillment threw', [
                    'event_id' => $event['id'],
                    'error' => $e->getMessage(),
                ]);
            }
            return response('Fulfillment failed', 500);
        }

        if ($status === 'fulfilled') {
            $this->verifyTokenCredit(['source' => 'revenuecat', 'event_id' => $event['id']]);
        }

        return $status === 'already_processed'
            ? response('Already processed', 200)
            : response('OK', 200);
    }

    /**
     * Credit tokens for a RevenueCat purchase event.
     *
     * Trust model: tokens granted are looked up server-side via the product
     * id in services.iap.bundles, NOT from any client- or RC-supplied amount.
     * Mirrors fulfillCheckoutSession()'s pattern for Stripe.
     *
     * Returns true when credited; false when fulfillment failed — the caller
     * rolls back the idempotency claim and 500s so RC retries can succeed once
     * the cause (missing product mapping, unlinked identity, bug) is fixed.
     */
    private function fulfillIapPurchase(array $event): bool
    {
        $productId = $event['product_id'] ?? null;

        // Forensic context on every warning: store + country_code directly
        // test regional hypotheses (e.g. storefront-specific product ids),
        // aliases expose anonymous-identity purchases.
        $context = [
            'event_id' => $event['id'] ?? null,
            'product_id' => $productId,
            'app_user_id' => $event['app_user_id'] ?? null,
            'original_app_user_id' => $event['original_app_user_id'] ?? null,
            'aliases' => $event['aliases'] ?? null,
            'store' => $event['store'] ?? null,
            'country_code' => $event['country_code'] ?? null,
        ];

        if (!$productId) {
            Log::warning('RevenueCat event missing product_id', $context);
            return false;
        }

        $bundle = config('services.iap.bundles', [])[$productId] ?? null;
        $grantsTokens = !empty($bundle['tokens']) && (int) $bundle['tokens'] > 0;
        $grantsUnlocks = !empty($bundle['unlocks']) && is_array($bundle['unlocks']);
        if (!$bundle || (!$grantsTokens && !$grantsUnlocks)) {
            Log::warning('RevenueCat event for unrecognized product', $context);
            return false;
        }

        $user = $this->resolveRevenueCatUser($event);
        if (!$user || !$user->profile) {
            Log::warning('RevenueCat event for missing user/profile', $context);
            return false;
        }

        $this->applyBundle($user, $bundle, [
            'source' => 'revenuecat',
            'event_id' => $event['id'] ?? null,
            'product_id' => $productId,
            'store' => $event['store'] ?? null,
            'country_code' => $event['country_code'] ?? null,
        ]);
        return true;
    }

    /**
     * Resolve the purchasing user from a RevenueCat event. The primary
     * app_user_id is our backend user id (set by the app's initIAP), but a
     * purchase made under an anonymous/aliased RC identity (e.g. before the
     * identify call landed, or via restore) carries the real id in
     * original_app_user_id or the aliases array instead.
     */
    private function resolveRevenueCatUser(array $event): ?User
    {
        $candidates = [];
        foreach ([$event['app_user_id'] ?? null, $event['original_app_user_id'] ?? null] as $id) {
            if (is_string($id) && $id !== '') {
                $candidates[] = $id;
            }
        }
        foreach ((array) ($event['aliases'] ?? []) as $id) {
            if (is_string($id) && $id !== '') {
                $candidates[] = $id;
            }
        }

        foreach (array_unique($candidates) as $id) {
            // RC anonymous ids can never match a backend user id.
            if (str_starts_with($id, '$RCAnonymousID:')) {
                continue;
            }
            $user = User::find($id);
            if ($user) {
                return $user;
            }
        }

        return null;
    }
}
