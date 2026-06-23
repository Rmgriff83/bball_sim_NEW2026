<?php

namespace App\Services;

use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Verifies "Sign in with Apple" / "Sign in with Google" identity tokens (JWTs)
 * obtained client-side by the one-tap flows (web GIS / Apple JS / iOS native
 * plugin). Each token is signature-verified against the provider's published
 * JWKS and its issuer/audience claims are checked against our configured client
 * ids. Returns normalized claims; throws on any failure.
 */
class SocialTokenVerifier
{
    protected const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
    protected const GOOGLE_ISS = ['accounts.google.com', 'https://accounts.google.com'];

    protected const APPLE_JWKS = 'https://appleid.apple.com/auth/keys';
    protected const APPLE_ISS = ['https://appleid.apple.com'];

    /**
     * @return array{sub:?string,email:?string,name:?string,avatar:?string}
     * @throws RuntimeException
     */
    public function verify(string $provider, string $idToken): array
    {
        return match ($provider) {
            'google' => $this->verifyGoogle($idToken),
            'apple' => $this->verifyApple($idToken),
            default => throw new RuntimeException('Unsupported provider.'),
        };
    }

    protected function verifyGoogle(string $idToken): array
    {
        $claims = $this->decode($idToken, self::GOOGLE_JWKS, 'google');
        $this->assertIss($claims, self::GOOGLE_ISS);
        $this->assertAud($claims, array_values(array_filter([
            config('services.google.web_client_id'),
            config('services.google.ios_client_id'),
        ])));

        return [
            'sub' => $claims['sub'] ?? null,
            'email' => $claims['email'] ?? null,
            'name' => $claims['name'] ?? null,
            'avatar' => $claims['picture'] ?? null,
        ];
    }

    protected function verifyApple(string $idToken): array
    {
        $claims = $this->decode($idToken, self::APPLE_JWKS, 'apple');
        $this->assertIss($claims, self::APPLE_ISS);
        $this->assertAud($claims, array_values(array_filter([
            config('services.apple.web_services_id'),
            config('services.apple.app_bundle_id'),
        ])));

        return [
            'sub' => $claims['sub'] ?? null,
            // Apple includes email only on the first authorization (and never the
            // name). Callers fall back to client-supplied values for new accounts.
            'email' => $claims['email'] ?? null,
            'name' => null,
            'avatar' => null,
        ];
    }

    /**
     * Decode + signature-verify a JWT against the provider's (cached) JWKS.
     * Refetches the key set once on failure to tolerate key rotation.
     */
    protected function decode(string $idToken, string $jwksUrl, string $cacheKey): array
    {
        $fetch = function () use ($jwksUrl): array {
            $resp = Http::timeout(5)->get($jwksUrl);
            if (! $resp->successful()) {
                throw new RuntimeException('Unable to fetch provider signing keys.');
            }

            return $resp->json();
        };

        $key = "social_jwks:{$cacheKey}";
        $jwks = Cache::remember($key, now()->addDay(), $fetch);

        try {
            return (array) JWT::decode($idToken, JWK::parseKeySet($jwks));
        } catch (\Throwable $e) {
            // The token may be signed with a key id not present in the cached set
            // (rotation). Refetch once, then fail hard if it still doesn't verify.
            $jwks = $fetch();
            Cache::put($key, $jwks, now()->addDay());

            return (array) JWT::decode($idToken, JWK::parseKeySet($jwks));
        }
    }

    protected function assertIss(array $claims, array $allowed): void
    {
        if (! in_array($claims['iss'] ?? null, $allowed, true)) {
            throw new RuntimeException('Invalid token issuer.');
        }
    }

    protected function assertAud(array $claims, array $allowed): void
    {
        if (empty($allowed)) {
            throw new RuntimeException('OAuth client id is not configured on the server.');
        }

        $aud = $claims['aud'] ?? null;
        $auds = is_array($aud) ? $aud : [$aud];

        if (count(array_intersect($auds, $allowed)) === 0) {
            throw new RuntimeException('Invalid token audience.');
        }
    }
}
