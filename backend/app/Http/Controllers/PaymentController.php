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

        // Idempotency: claim the event id atomically. If another delivery already
        // processed this event, the unique pk insert throws and we return 200
        // without re-crediting tokens.
        try {
            DB::table('stripe_webhook_events')->insert([
                'id' => $event->id,
                'type' => $event->type,
            ]);
        } catch (\Illuminate\Database\QueryException $e) {
            return response('Already processed', 200);
        }

        if ($event->type === 'checkout.session.completed') {
            $this->fulfillCheckoutSession($event->data->object);
        }

        return response('OK', 200);
    }

    /**
     * Credit tokens to the user identified by the completed checkout session.
     *
     * Trust model: tokens granted are looked up server-side from the price id
     * returned by Stripe, NOT from any client- or metadata-supplied amount.
     */
    private function fulfillCheckoutSession(StripeSession $session): void
    {
        if ($session->payment_status !== 'paid') {
            return;
        }

        $userId = $session->metadata->user_id ?? $session->client_reference_id ?? null;
        if (!$userId) {
            Log::warning('Stripe checkout completed with no user reference', ['session' => $session->id]);
            return;
        }

        // Pull the price id from the session line items (server-side, trusted)
        Stripe::setApiKey(config('services.stripe.secret'));
        $lineItems = StripeSession::allLineItems($session->id, ['limit' => 1]);
        $priceId = $lineItems->data[0]->price->id ?? null;

        if (!$priceId) {
            Log::warning('Stripe checkout completed with no line item price', ['session' => $session->id]);
            return;
        }

        $tokens = null;
        foreach (config('services.stripe.bundles', []) as $bundle) {
            if (($bundle['price_id'] ?? null) === $priceId) {
                $tokens = $bundle['tokens'];
                break;
            }
        }

        if ($tokens === null) {
            Log::warning('Stripe checkout for unrecognized price id', [
                'session' => $session->id,
                'price_id' => $priceId,
            ]);
            return;
        }

        $user = User::find($userId);
        if (!$user || !$user->profile) {
            Log::warning('Stripe checkout for missing user/profile', [
                'session' => $session->id,
                'user_id' => $userId,
            ]);
            return;
        }

        $user->profile->creditTokens($tokens);
    }
}
