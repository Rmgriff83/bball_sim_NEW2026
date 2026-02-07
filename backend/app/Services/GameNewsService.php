<?php

namespace App\Services;

use App\Models\NewsEvent;
use App\Models\Campaign;

class GameNewsService
{
    /**
     * Create news for a game-winning shot.
     */
    public function createGameWinnerNews(
        Campaign $campaign,
        array $player,
        array $homeTeam,
        array $awayTeam,
        int $homeScore,
        int $awayScore,
        bool $isHomeTeam,
        string $shotType
    ): NewsEvent {
        $playerName = ($player['firstName'] ?? $player['first_name'] ?? 'Unknown') . ' ' .
                      ($player['lastName'] ?? $player['last_name'] ?? 'Player');

        $winningTeam = $isHomeTeam ? $homeTeam['name'] : $awayTeam['name'];
        $losingTeam = $isHomeTeam ? $awayTeam['name'] : $homeTeam['name'];

        $headlines = [
            "{$playerName} hits game-winner! {$winningTeam} defeats {$losingTeam}",
            "Clutch! {$playerName} lifts {$winningTeam} to victory",
            "{$playerName}'s {$shotType} sinks {$losingTeam} at the buzzer",
        ];

        return NewsEvent::create([
            'campaign_id' => $campaign->id,
            'player_id' => is_numeric($player['id'] ?? null) ? (int)$player['id'] : null,
            'team_id' => $isHomeTeam ? ($homeTeam['id'] ?? null) : ($awayTeam['id'] ?? null),
            'event_type' => 'game_winner',
            'headline' => $headlines[array_rand($headlines)],
            'body' => "{$playerName} hit a clutch {$shotType} to give the {$winningTeam} a {$homeScore}-{$awayScore} victory over the {$losingTeam}.",
            'game_date' => $campaign->current_date,
        ]);
    }

    /**
     * Create news for overtime thriller.
     */
    public function createOvertimeThrillerNews(
        Campaign $campaign,
        array $homeTeam,
        array $awayTeam,
        int $homeScore,
        int $awayScore,
        int $overtimePeriods
    ): NewsEvent {
        $winner = $homeScore > $awayScore ? $homeTeam['name'] : $awayTeam['name'];
        $loser = $homeScore > $awayScore ? $awayTeam['name'] : $homeTeam['name'];
        $otText = $overtimePeriods > 1 ? "{$overtimePeriods}OT" : "OT";

        return NewsEvent::create([
            'campaign_id' => $campaign->id,
            'team_id' => $homeScore > $awayScore ? ($homeTeam['id'] ?? null) : ($awayTeam['id'] ?? null),
            'event_type' => 'general',
            'headline' => "{$winner} outlasts {$loser} in {$otText} thriller",
            'body' => "In an instant classic, the {$winner} defeated the {$loser} {$homeScore}-{$awayScore} after {$overtimePeriods} overtime period(s).",
            'game_date' => $campaign->current_date,
        ]);
    }
}
