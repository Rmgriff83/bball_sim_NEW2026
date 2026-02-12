<?php

namespace App\Console\Commands;

use App\Models\BadgeDefinition;
use App\Models\Player;
use App\Models\PlayerBadge;
use App\Services\CampaignPlayerService;
use Illuminate\Console\Command;

class BackfillPlayerBadgesCommand extends Command
{
    protected $signature = 'players:backfill-badges';
    protected $description = 'Backfill badges for existing DB players from players_master.js';

    public function handle(CampaignPlayerService $playerService): int
    {
        $master = $playerService->loadPlayersMaster();
        $this->info("Loaded " . count($master) . " master players");

        // Build lookup by name (lowercase)
        $masterByName = [];
        foreach ($master as $mp) {
            $key = strtolower($mp['firstName'] . ' ' . $mp['lastName']);
            $masterByName[$key] = $mp;
        }

        $validBadgeIds = BadgeDefinition::pluck('id')->toArray();
        $this->info("Valid badge definitions: " . count($validBadgeIds));

        if (empty($validBadgeIds)) {
            $this->error("No badge definitions found. Run BadgeDefinitionSeeder first.");
            return 1;
        }

        $dbPlayers = Player::all();
        $this->info("DB players: " . $dbPlayers->count());

        $totalInserted = 0;
        $now = now();

        foreach ($dbPlayers as $player) {
            $key = strtolower($player->first_name . ' ' . $player->last_name);
            $masterPlayer = $masterByName[$key] ?? null;

            if (!$masterPlayer) {
                $this->warn("No master match for: {$player->first_name} {$player->last_name}");
                continue;
            }

            $badges = $masterPlayer['badges'] ?? [];
            if (empty($badges)) {
                $this->warn("No badges in master for: {$player->first_name} {$player->last_name}");
                continue;
            }

            // Skip if already has badges
            if (PlayerBadge::where('player_id', $player->id)->exists()) {
                $this->line("Already has badges: {$player->first_name} {$player->last_name}");
                continue;
            }

            $records = [];
            foreach ($badges as $badge) {
                if (!isset($badge['id']) || !isset($badge['level'])) {
                    continue;
                }
                if (!in_array($badge['id'], $validBadgeIds)) {
                    $this->warn("  Skipping unknown badge: {$badge['id']}");
                    continue;
                }
                $records[] = [
                    'player_id' => $player->id,
                    'badge_definition_id' => $badge['id'],
                    'level' => $badge['level'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }

            if (!empty($records)) {
                PlayerBadge::insert($records);
                $totalInserted += count($records);
                $this->info("Inserted " . count($records) . " badges for: {$player->first_name} {$player->last_name}");
            }
        }

        $this->newLine();
        $this->info("Total badges inserted: {$totalInserted}");
        $this->info("PlayerBadge count: " . PlayerBadge::count());

        return 0;
    }
}
