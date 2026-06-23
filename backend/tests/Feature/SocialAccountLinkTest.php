<?php

namespace Tests\Feature;

use App\Models\SocialAccount;
use App\Models\User;
use App\Services\SocialTokenVerifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class SocialAccountLinkTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $attrs = []): User
    {
        // ->fresh() so DB defaults (e.g. has_password=true) are hydrated, matching
        // how Sanctum loads the user from the DB on a real authenticated request.
        return User::create(array_merge([
            'username' => 'user_'.uniqid(),
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret123'),
        ], $attrs))->fresh();
    }

    private function mockVerifier(string $sub, ?string $email = null): void
    {
        $this->mock(SocialTokenVerifier::class, function ($mock) use ($sub, $email) {
            $mock->shouldReceive('verify')->andReturn([
                'sub' => $sub, 'email' => $email, 'name' => null, 'avatar' => null,
            ]);
        });
    }

    public function test_links_a_new_provider_to_current_user(): void
    {
        $user = $this->user();
        Sanctum::actingAs($user);
        $this->mockVerifier('apple-sub-1');

        $res = $this->postJson('/api/user/social/link', [
            'provider' => 'apple',
            'credential' => 'tok',
        ]);

        $res->assertOk()->assertJsonPath('linked_providers', ['apple']);
        $this->assertDatabaseHas('social_accounts', [
            'user_id' => $user->id, 'provider' => 'apple', 'provider_id' => 'apple-sub-1',
        ]);
    }

    public function test_linking_is_idempotent_for_same_user(): void
    {
        $user = $this->user();
        SocialAccount::create(['user_id' => $user->id, 'provider' => 'google', 'provider_id' => 'g-1']);
        Sanctum::actingAs($user);
        $this->mockVerifier('g-1');

        $this->postJson('/api/user/social/link', ['provider' => 'google', 'credential' => 'tok'])
            ->assertOk()
            ->assertJsonPath('linked_providers', ['google']);

        $this->assertSame(1, SocialAccount::where('provider', 'google')->where('provider_id', 'g-1')->count());
    }

    public function test_rejects_linking_provider_owned_by_another_user(): void
    {
        $other = $this->user();
        SocialAccount::create(['user_id' => $other->id, 'provider' => 'apple', 'provider_id' => 'shared-sub']);

        $user = $this->user();
        Sanctum::actingAs($user);
        $this->mockVerifier('shared-sub');

        $this->postJson('/api/user/social/link', ['provider' => 'apple', 'credential' => 'tok'])
            ->assertStatus(409);
        $this->assertDatabaseMissing('social_accounts', ['user_id' => $user->id, 'provider' => 'apple']);
    }

    public function test_unlinks_a_provider(): void
    {
        $user = $this->user(); // has a real password
        SocialAccount::create(['user_id' => $user->id, 'provider' => 'apple', 'provider_id' => 'a-1']);
        Sanctum::actingAs($user);

        $this->deleteJson('/api/user/social/apple')
            ->assertOk()
            ->assertJsonPath('linked_providers', []);
        $this->assertDatabaseMissing('social_accounts', ['user_id' => $user->id, 'provider' => 'apple']);
    }

    public function test_cannot_unlink_only_method_when_no_password(): void
    {
        $user = $this->user(['has_password' => false]);
        SocialAccount::create(['user_id' => $user->id, 'provider' => 'apple', 'provider_id' => 'a-1']);
        Sanctum::actingAs($user);

        $this->deleteJson('/api/user/social/apple')->assertStatus(422);
        $this->assertDatabaseHas('social_accounts', ['user_id' => $user->id, 'provider' => 'apple']);
    }

    public function test_can_unlink_when_a_second_method_remains(): void
    {
        $user = $this->user(['has_password' => false]);
        SocialAccount::create(['user_id' => $user->id, 'provider' => 'apple', 'provider_id' => 'a-1']);
        SocialAccount::create(['user_id' => $user->id, 'provider' => 'google', 'provider_id' => 'g-1']);
        Sanctum::actingAs($user);

        $this->deleteJson('/api/user/social/apple')
            ->assertOk()
            ->assertJsonPath('linked_providers', ['google']);
    }

    public function test_show_exposes_linked_providers_and_has_password(): void
    {
        $user = $this->user(['has_password' => false]);
        SocialAccount::create(['user_id' => $user->id, 'provider' => 'google', 'provider_id' => 'g-1']);
        Sanctum::actingAs($user);

        $this->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('user.linked_providers', ['google'])
            ->assertJsonPath('user.has_password', false);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
