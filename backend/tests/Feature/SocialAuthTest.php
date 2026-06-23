<?php

namespace Tests\Feature;

use App\Models\SocialAccount;
use App\Models\User;
use App\Models\UserProfile;
use App\Services\SocialTokenVerifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

class SocialAuthTest extends TestCase
{
    use RefreshDatabase;

    /** Bind a mock verifier that returns the given normalized claims. */
    private function mockVerifier(array $claims): void
    {
        $this->mock(SocialTokenVerifier::class, function ($mock) use ($claims) {
            $mock->shouldReceive('verify')->andReturn($claims);
        });
    }

    public function test_new_user_is_created_and_gets_a_token(): void
    {
        $this->mockVerifier([
            'sub' => 'google-123',
            'email' => 'newbie@example.com',
            'name' => 'New Bie',
            'avatar' => null,
        ]);

        $res = $this->postJson('/api/auth/social/token', [
            'provider' => 'google',
            'credential' => 'fake-id-token',
        ]);

        $res->assertOk()
            ->assertJsonStructure(['message', 'user' => ['id', 'username', 'email'], 'token']);

        $this->assertDatabaseHas('users', ['email' => 'newbie@example.com']);
        $this->assertDatabaseHas('social_accounts', [
            'provider' => 'google',
            'provider_id' => 'google-123',
        ]);
        $user = User::where('email', 'newbie@example.com')->first();
        $this->assertNotNull(UserProfile::where('user_id', $user->id)->first());
        $this->assertNotEmpty($res->json('token'));
    }

    public function test_existing_email_user_is_linked_not_duplicated(): void
    {
        $existing = User::create([
            'username' => 'existing',
            'email' => 'taken@example.com',
            'password' => bcrypt('secret123'),
        ]);

        $this->mockVerifier([
            'sub' => 'apple-999',
            'email' => 'taken@example.com',
            'name' => null,
            'avatar' => null,
        ]);

        $res = $this->postJson('/api/auth/social/token', [
            'provider' => 'apple',
            'credential' => 'fake-id-token',
        ]);

        $res->assertOk();
        // No new user — linked to the existing one.
        $this->assertSame(1, User::where('email', 'taken@example.com')->count());
        $this->assertDatabaseHas('social_accounts', [
            'user_id' => $existing->id,
            'provider' => 'apple',
            'provider_id' => 'apple-999',
        ]);
    }

    public function test_repeat_login_reuses_account_without_duplicate_link(): void
    {
        $this->mockVerifier([
            'sub' => 'google-abc',
            'email' => 'repeat@example.com',
            'name' => 'Repeat User',
            'avatar' => null,
        ]);

        $first = $this->postJson('/api/auth/social/token', [
            'provider' => 'google',
            'credential' => 'fake-id-token',
        ])->assertOk();

        // Second sign-in with the same identity.
        $this->mockVerifier([
            'sub' => 'google-abc',
            'email' => 'repeat@example.com',
            'name' => 'Repeat User',
            'avatar' => null,
        ]);

        $second = $this->postJson('/api/auth/social/token', [
            'provider' => 'google',
            'credential' => 'fake-id-token-2',
        ])->assertOk();

        $this->assertSame($first->json('user.id'), $second->json('user.id'));
        $this->assertSame(1, User::where('email', 'repeat@example.com')->count());
        $this->assertSame(1, SocialAccount::where('provider', 'google')->where('provider_id', 'google-abc')->count());
    }

    public function test_invalid_token_is_rejected(): void
    {
        $this->mock(SocialTokenVerifier::class, function ($mock) {
            $mock->shouldReceive('verify')->andThrow(new \RuntimeException('Invalid token audience.'));
        });

        $this->postJson('/api/auth/social/token', [
            'provider' => 'google',
            'credential' => 'bad-token',
        ])->assertStatus(401);
    }

    public function test_unsupported_provider_is_rejected(): void
    {
        $this->postJson('/api/auth/social/token', [
            'provider' => 'myspace',
            'credential' => 'whatever',
        ])->assertStatus(422);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
