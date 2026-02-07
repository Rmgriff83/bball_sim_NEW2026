<?php

namespace App\Services;

class PlayService
{
    private string $masterFilePath;
    private ?array $cachedPlays = null;

    public function __construct()
    {
        $this->masterFilePath = resource_path('data/plays_master.js');
    }

    /**
     * Load and cache master plays.
     */
    public function loadPlaysMaster(): array
    {
        if ($this->cachedPlays !== null) {
            return $this->cachedPlays;
        }

        if (!file_exists($this->masterFilePath)) {
            throw new \Exception("Plays master file not found: {$this->masterFilePath}");
        }

        $content = file_get_contents($this->masterFilePath);

        // Extract JSON from the JS file - try multiple patterns for robustness
        $patterns = [
            '/export const playsMaster = (\[[\s\S]*?\]);?\s*(?:export default|\Z)/m',
            '/export const playsMaster = (\[[\s\S]*\]);\s*\n/m',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $content, $matches)) {
                $json = $matches[1];
                $decoded = json_decode($json, true);

                if ($decoded !== null) {
                    $this->cachedPlays = $decoded;
                    return $decoded;
                }
            }
        }

        // Debug: output what we're working with
        throw new \Exception("Could not parse plays master file. File size: " . strlen($content) . " bytes");
    }

    /**
     * Get a specific play by ID.
     */
    public function getPlay(string $playId): ?array
    {
        $plays = $this->loadPlaysMaster();

        foreach ($plays as $play) {
            if ($play['id'] === $playId) {
                return $play;
            }
        }

        return null;
    }

    /**
     * Get plays by category.
     */
    public function getPlaysByCategory(string $category): array
    {
        $plays = $this->loadPlaysMaster();

        return array_filter($plays, fn($play) => $play['category'] === $category);
    }

    /**
     * Get plays by tags (must have all specified tags).
     */
    public function getPlaysByTags(array $tags): array
    {
        $plays = $this->loadPlaysMaster();

        return array_filter($plays, function($play) use ($tags) {
            foreach ($tags as $tag) {
                if (!in_array($tag, $play['tags'])) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * Get plays by tempo (halfcourt, transition, fastbreak).
     */
    public function getPlaysByTempo(string $tempo): array
    {
        $plays = $this->loadPlaysMaster();

        return array_filter($plays, fn($play) => $play['tempo'] === $tempo);
    }

    /**
     * Select a play based on game situation and team composition.
     */
    public function selectPlay(
        array $offensiveLineup,
        array $defensiveLineup,
        string $coachingScheme,
        array $context = []
    ): array {
        $plays = $this->loadPlaysMaster();
        $isTransition = $context['isTransition'] ?? false;
        $shotClock = $context['shotClock'] ?? 24;
        $scoreDifferential = $context['scoreDifferential'] ?? 0;

        // Filter by tempo
        if ($isTransition) {
            $eligiblePlays = array_filter($plays, fn($p) => in_array($p['tempo'], ['transition', 'fastbreak']));
        } else {
            $eligiblePlays = array_filter($plays, fn($p) => $p['tempo'] === 'halfcourt');
        }

        // If no plays available for tempo, use all plays
        if (empty($eligiblePlays)) {
            $eligiblePlays = $plays;
        }

        // Get scheme weights
        $schemeWeights = $this->getSchemeWeights($coachingScheme);

        // Calculate weighted probabilities for each play
        $weightedPlays = [];
        foreach ($eligiblePlays as $play) {
            $weight = 1.0;

            // Apply scheme weight by category
            if (isset($schemeWeights[$play['category']])) {
                $weight *= $schemeWeights[$play['category']];
            }

            // Adjust weight based on primary ball handler position match
            $weight *= $this->calculatePositionFit($play, $offensiveLineup);

            // Adjust weight based on team chemistry vs play difficulty
            $avgIQ = $this->calculateAverageIQ($offensiveLineup);
            $difficultyPenalty = max(0.5, 1 - (($play['difficulty'] - $avgIQ) / 100));
            $weight *= $difficultyPenalty;

            // Late shot clock favors quicker plays
            if ($shotClock < 8) {
                if (in_array($play['category'], ['isolation', 'spot_up'])) {
                    $weight *= 1.5;
                }
            }

            // When behind, favor higher-risk/reward plays
            if ($scoreDifferential < -10) {
                if ($play['category'] === 'isolation' || in_array('three_point', $play['tags'])) {
                    $weight *= 1.3;
                }
            }

            $weightedPlays[] = [
                'play' => $play,
                'weight' => $weight
            ];
        }

        // Weighted random selection
        return $this->weightedRandomSelect($weightedPlays);
    }

    /**
     * Get scheme category weights.
     */
    private function getSchemeWeights(string $scheme): array
    {
        return match($scheme) {
            'motion' => [
                'motion' => 2.0,
                'cut' => 1.5,
                'pick_and_roll' => 1.2,
                'isolation' => 0.5,
                'post_up' => 0.8,
                'spot_up' => 1.0,
                'transition' => 1.0,
            ],
            'iso_heavy' => [
                'isolation' => 2.5,
                'pick_and_roll' => 1.2,
                'post_up' => 1.0,
                'motion' => 0.5,
                'cut' => 0.6,
                'spot_up' => 0.8,
                'transition' => 1.0,
            ],
            'post_centric' => [
                'post_up' => 2.5,
                'pick_and_roll' => 1.0,
                'cut' => 1.2,
                'isolation' => 0.7,
                'motion' => 0.8,
                'spot_up' => 0.8,
                'transition' => 0.8,
            ],
            'three_point' => [
                'spot_up' => 2.0,
                'pick_and_roll' => 1.5,
                'motion' => 1.3,
                'isolation' => 0.8,
                'post_up' => 0.5,
                'cut' => 1.0,
                'transition' => 1.2,
            ],
            'run_and_gun' => [
                'transition' => 2.5,
                'pick_and_roll' => 1.3,
                'spot_up' => 1.2,
                'isolation' => 1.0,
                'motion' => 0.7,
                'post_up' => 0.5,
                'cut' => 0.8,
            ],
            default => [ // balanced
                'pick_and_roll' => 1.2,
                'isolation' => 1.0,
                'post_up' => 1.0,
                'motion' => 1.0,
                'cut' => 1.0,
                'spot_up' => 1.0,
                'transition' => 1.0,
            ],
        };
    }

    /**
     * Calculate how well the lineup fits a play's position requirements.
     */
    private function calculatePositionFit(array $play, array $lineup): float
    {
        $primaryPositions = $play['primaryPositions'];
        $fit = 0.5; // Base fit

        foreach ($lineup as $player) {
            $position = $player['position'] ?? 'SF';
            if (in_array($position, $primaryPositions)) {
                $fit = 1.0;
                break;
            }
        }

        return $fit;
    }

    /**
     * Calculate average basketball IQ of lineup.
     */
    private function calculateAverageIQ(array $lineup): float
    {
        $totalIQ = 0;
        $count = 0;

        foreach ($lineup as $player) {
            $iq = $player['attributes']['mental']['basketballIQ'] ?? 50;
            $totalIQ += $iq;
            $count++;
        }

        return $count > 0 ? $totalIQ / $count : 50;
    }

    /**
     * Perform weighted random selection.
     */
    private function weightedRandomSelect(array $weightedItems): array
    {
        $totalWeight = array_sum(array_column($weightedItems, 'weight'));

        if ($totalWeight <= 0) {
            // Fallback to first item
            return $weightedItems[0]['play'] ?? $this->loadPlaysMaster()[0];
        }

        $random = mt_rand() / mt_getrandmax() * $totalWeight;
        $cumulative = 0;

        foreach ($weightedItems as $item) {
            $cumulative += $item['weight'];
            if ($random <= $cumulative) {
                return $item['play'];
            }
        }

        // Fallback
        return end($weightedItems)['play'];
    }

    /**
     * Get all available coaching schemes.
     */
    public function getCoachingSchemes(): array
    {
        return [
            'balanced' => 'Balanced offense with varied play selection',
            'motion' => 'Motion-heavy offense emphasizing ball movement and cuts',
            'iso_heavy' => 'Isolation-focused offense for star players',
            'post_centric' => 'Post-up heavy offense utilizing big men',
            'three_point' => 'Perimeter-oriented offense maximizing three-point attempts',
            'run_and_gun' => 'Fast-paced transition offense',
        ];
    }

    /**
     * Get an action from a play by ID.
     */
    public function getAction(array $play, string $actionId): ?array
    {
        foreach ($play['actions'] as $action) {
            if ($action['id'] === $actionId) {
                return $action;
            }
        }
        return null;
    }
}
