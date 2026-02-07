<?php

namespace App\Services\PlayerEvolution;

use App\Models\NewsEvent;
use App\Models\Campaign;

class EvolutionNewsService
{
    /**
     * Create news event for player injury.
     */
    public function createInjuryNews(Campaign $campaign, array $player, array $injury): NewsEvent
    {
        $playerName = $this->getPlayerName($player);
        $injuryName = $injury['name'] ?? 'injury';
        $estimate = $this->getRecoveryEstimate($injury['games_remaining'] ?? 0);

        $headlines = [
            "{$playerName} suffers {$injuryName}, out {$estimate}",
            "Injury report: {$playerName} sidelined with {$injuryName}",
            "{$playerName} to miss time with {$injuryName}",
        ];

        return NewsEvent::create([
            'campaign_id' => $campaign->id,
            'player_id' => $this->getPlayerId($player),
            'team_id' => $this->getTeamId($player, $campaign),
            'event_type' => 'injury',
            'headline' => $headlines[array_rand($headlines)],
            'body' => "{$playerName} has been diagnosed with a {$injuryName} and is expected to be out {$estimate}.",
            'game_date' => $campaign->current_date,
        ]);
    }

    /**
     * Create news event for player recovery.
     */
    public function createRecoveryNews(Campaign $campaign, array $player, array $injury): NewsEvent
    {
        $playerName = $this->getPlayerName($player);
        $injuryName = $injury['name'] ?? 'injury';

        $headlines = [
            "{$playerName} cleared to return from {$injuryName}",
            "{$playerName} back in action after recovering from {$injuryName}",
            "Good news: {$playerName} healthy and ready to play",
        ];

        return NewsEvent::create([
            'campaign_id' => $campaign->id,
            'player_id' => $this->getPlayerId($player),
            'team_id' => $this->getTeamId($player, $campaign),
            'event_type' => 'recovery',
            'headline' => $headlines[array_rand($headlines)],
            'body' => "{$playerName} has fully recovered and has been cleared to return to game action.",
            'game_date' => $campaign->current_date,
        ]);
    }

    /**
     * Create news event for hot streak.
     */
    public function createHotStreakNews(Campaign $campaign, array $player, int $games, array $attributeBoosts): NewsEvent
    {
        $playerName = $this->getPlayerName($player);
        $boostText = $this->formatAttributeBoosts($attributeBoosts);

        $headlines = [
            "{$playerName} is on fire!",
            "{$playerName} continues red-hot stretch",
            "Unstoppable: {$playerName} extends hot streak to {$games} games",
        ];

        return NewsEvent::create([
            'campaign_id' => $campaign->id,
            'player_id' => $this->getPlayerId($player),
            'team_id' => $this->getTeamId($player, $campaign),
            'event_type' => 'hot_streak',
            'headline' => $headlines[array_rand($headlines)],
            'body' => "{$playerName} has been playing at an elite level over the past {$games} games. {$boostText}",
            'game_date' => $campaign->current_date,
        ]);
    }

    /**
     * Create news event for cold streak.
     */
    public function createColdStreakNews(Campaign $campaign, array $player, int $games): NewsEvent
    {
        $playerName = $this->getPlayerName($player);

        $headlines = [
            "{$playerName} struggling through slump",
            "{$playerName} mired in {$games}-game cold stretch",
            "Concerns mount as {$playerName} continues to struggle",
        ];

        return NewsEvent::create([
            'campaign_id' => $campaign->id,
            'player_id' => $this->getPlayerId($player),
            'team_id' => $this->getTeamId($player, $campaign),
            'event_type' => 'cold_streak',
            'headline' => $headlines[array_rand($headlines)],
            'body' => "{$playerName} has been struggling over the past {$games} games and is looking to break out of the slump.",
            'game_date' => $campaign->current_date,
        ]);
    }

    /**
     * Create news event for development milestone.
     */
    public function createDevelopmentNews(Campaign $campaign, array $player, string $attribute, float $increase): NewsEvent
    {
        $playerName = $this->getPlayerName($player);
        $attrName = $this->formatAttributeName($attribute);

        $headlines = [
            "{$playerName} showing improvement in {$attrName}",
            "Development report: {$playerName}'s {$attrName} on the rise",
            "{$playerName} making strides with {$attrName}",
        ];

        return NewsEvent::create([
            'campaign_id' => $campaign->id,
            'player_id' => $this->getPlayerId($player),
            'team_id' => $this->getTeamId($player, $campaign),
            'event_type' => 'development',
            'headline' => $headlines[array_rand($headlines)],
            'body' => "{$playerName} has been working hard and showing noticeable improvement in {$attrName}.",
            'game_date' => $campaign->current_date,
        ]);
    }

    /**
     * Create news event for breakout performance.
     */
    public function createBreakoutNews(Campaign $campaign, array $player, int $overallGain): NewsEvent
    {
        $playerName = $this->getPlayerName($player);
        $age = $player['age'] ?? 22;

        $headlines = [
            "Breakout alert: {$playerName} emerging as a star",
            "{$playerName} taking a major leap forward",
            "Rising star: {$playerName} making a name for themselves",
        ];

        return NewsEvent::create([
            'campaign_id' => $campaign->id,
            'player_id' => $this->getPlayerId($player),
            'team_id' => $this->getTeamId($player, $campaign),
            'event_type' => 'breakout',
            'headline' => $headlines[array_rand($headlines)],
            'body' => "At just {$age} years old, {$playerName} has shown tremendous growth this month, improving their overall rating by {$overallGain} points.",
            'game_date' => $campaign->current_date,
        ]);
    }

    /**
     * Create news event for veteran decline.
     */
    public function createDeclineNews(Campaign $campaign, array $player, int $overallLoss): NewsEvent
    {
        $playerName = $this->getPlayerName($player);
        $age = $player['age'] ?? 35;

        $headlines = [
            "Father Time catching up with {$playerName}",
            "{$playerName} showing signs of age",
            "Veteran {$playerName} slowing down",
        ];

        return NewsEvent::create([
            'campaign_id' => $campaign->id,
            'player_id' => $this->getPlayerId($player),
            'team_id' => $this->getTeamId($player, $campaign),
            'event_type' => 'decline',
            'headline' => $headlines[array_rand($headlines)],
            'body' => "At {$age} years old, {$playerName} appears to be losing a step. The veteran's overall rating has dropped by {$overallLoss} points this month.",
            'game_date' => $campaign->current_date,
        ]);
    }

    /**
     * Create news event for trade request.
     */
    public function createTradeRequestNews(Campaign $campaign, array $player): NewsEvent
    {
        $playerName = $this->getPlayerName($player);

        $headlines = [
            "{$playerName} requests trade",
            "Unhappy {$playerName} wants out",
            "Trade demand: {$playerName} asks to be moved",
        ];

        return NewsEvent::create([
            'campaign_id' => $campaign->id,
            'player_id' => $this->getPlayerId($player),
            'team_id' => $this->getTeamId($player, $campaign),
            'event_type' => 'trade_request',
            'headline' => $headlines[array_rand($headlines)],
            'body' => "{$playerName} has formally requested a trade, citing dissatisfaction with their current situation.",
            'game_date' => $campaign->current_date,
        ]);
    }

    /**
     * Create news event for retirement.
     */
    public function createRetirementNews(Campaign $campaign, array $player, int $careerSeasons): NewsEvent
    {
        $playerName = $this->getPlayerName($player);

        $headlines = [
            "{$playerName} announces retirement after {$careerSeasons} seasons",
            "End of an era: {$playerName} calls it a career",
            "{$playerName} hangs up the sneakers after {$careerSeasons} years",
        ];

        return NewsEvent::create([
            'campaign_id' => $campaign->id,
            'player_id' => $this->getPlayerId($player),
            'team_id' => $this->getTeamId($player, $campaign),
            'event_type' => 'retirement',
            'headline' => $headlines[array_rand($headlines)],
            'body' => "{$playerName} has announced their retirement after a {$careerSeasons}-year career in the league.",
            'game_date' => $campaign->current_date,
        ]);
    }

    /**
     * Get player name from player array.
     */
    private function getPlayerName(array $player): string
    {
        $first = $player['firstName'] ?? $player['first_name'] ?? 'Unknown';
        $last = $player['lastName'] ?? $player['last_name'] ?? 'Player';
        return "{$first} {$last}";
    }

    /**
     * Get player ID (may be database ID or string ID for JSON players).
     */
    private function getPlayerId(array $player): ?int
    {
        $id = $player['id'] ?? null;
        return is_numeric($id) ? (int) $id : null;
    }

    /**
     * Get team ID for player.
     */
    private function getTeamId(array $player, Campaign $campaign): ?int
    {
        if (isset($player['team_id'])) {
            return $player['team_id'];
        }

        // For JSON players, lookup team by abbreviation
        $abbr = $player['teamAbbreviation'] ?? null;
        if ($abbr) {
            $team = $campaign->teams()->where('abbreviation', $abbr)->first();
            return $team?->id;
        }

        return null;
    }

    /**
     * Get human-readable recovery estimate.
     */
    private function getRecoveryEstimate(int $games): string
    {
        if ($games <= 5) return 'day-to-day';
        if ($games <= 14) return '1-2 weeks';
        if ($games <= 28) return '2-4 weeks';
        if ($games <= 42) return '4-6 weeks';
        if ($games <= 60) return '6-8 weeks';
        return 'for the season';
    }

    /**
     * Format attribute boosts for news content.
     */
    private function formatAttributeBoosts(array $boosts): string
    {
        if (empty($boosts)) {
            return '';
        }

        $parts = [];
        foreach ($boosts as $attr => $value) {
            $name = $this->formatAttributeName($attr);
            $parts[] = "+{$value} {$name}";
        }

        return "Their " . implode(', ', $parts) . " ratings have improved.";
    }

    /**
     * Format attribute name for display.
     */
    private function formatAttributeName(string $attribute): string
    {
        // Handle nested attributes like "offense.threePoint"
        if (str_contains($attribute, '.')) {
            $attribute = explode('.', $attribute)[1];
        }

        // Convert camelCase to words
        $words = preg_replace('/([a-z])([A-Z])/', '$1 $2', $attribute);
        return strtolower($words);
    }
}
