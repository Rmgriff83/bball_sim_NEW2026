<?php

namespace App\Services;

class PlayExecutionEngine
{
    private array $roleAssignments = [];
    private array $playerPositions = [];
    private array $playerLineupIndices = []; // Maps player ID to their lineup slot (0-4)
    private ?string $ballCarrierId = null;
    private array $keyframes = [];
    private float $elapsedTime = 0;
    private array $playResult = [];
    private array $activatedBadges = [];
    private string $defensiveScheme = 'man';
    private array $defensiveModifiers = [];

    /**
     * Execute a play through its action points.
     *
     * @param array $play The play to execute
     * @param array $offensiveLineup The offensive team's lineup
     * @param array $defensiveLineup The defensive team's lineup
     * @param string $defensiveScheme The defensive scheme being used (man, zone_2_3, etc.)
     * @param array $defensiveModifiers Pre-calculated defensive modifiers
     * @return array Play result with stats, outcome, and animation keyframes
     */
    public function executePlay(
        array $play,
        array $offensiveLineup,
        array $defensiveLineup,
        string $defensiveScheme = 'man',
        array $defensiveModifiers = []
    ): array {
        // Store defensive context
        $this->defensiveScheme = $defensiveScheme;
        $this->defensiveModifiers = $defensiveModifiers;
        // Reset state
        $this->resetState();

        // Track lineup indices for all players (offensive 0-4, defensive 5-9)
        foreach ($offensiveLineup as $index => $player) {
            $playerId = (string) ($player['id'] ?? '');
            if ($playerId) {
                $this->playerLineupIndices[$playerId] = $index;
            }
        }
        foreach ($defensiveLineup as $index => $player) {
            $playerId = (string) ($player['id'] ?? '');
            if ($playerId) {
                $this->playerLineupIndices[$playerId] = $index;
            }
        }

        // Assign players to roles
        $this->assignRoles($play, $offensiveLineup);

        // Set initial formation
        $this->setFormation($play);

        // Find first action (usually the first one in the array)
        $currentActionId = $play['actions'][0]['id'] ?? null;

        // Execute action sequence until we hit an end state
        $maxIterations = 20; // Safety limit
        $iterations = 0;

        while ($currentActionId && $iterations < $maxIterations) {
            $action = $this->findAction($play, $currentActionId);
            if (!$action) {
                break;
            }

            $outcome = $this->executeAction($action, $play, $offensiveLineup, $defensiveLineup);

            // Check for terminal states
            if (str_starts_with($outcome['next'], 'end_')) {
                $this->handleEndState($outcome, $action);
                break;
            }

            if ($outcome['next'] === 'rebound_battle') {
                $this->handleReboundBattle($offensiveLineup, $defensiveLineup);
                break;
            }

            if ($outcome['next'] === 'free_throws') {
                $this->handleFreeThrows($outcome, $offensiveLineup);
                break;
            }

            $currentActionId = $outcome['next'];
            $iterations++;
        }

        return $this->buildPlayResult($play);
    }

    /**
     * Execute a single action point.
     */
    private function executeAction(
        array $action,
        array $play,
        array $offensiveLineup,
        array $defensiveLineup
    ): array {
        // Get actor player
        $actorRole = $action['actor'];
        $actor = $this->getPlayerByRole($actorRole, $offensiveLineup);

        // Get defender if applicable
        $defender = $this->getMatchingDefender($actor, $defensiveLineup);

        // Apply movement
        if (isset($action['movement'])) {
            $this->applyMovement($action['movement'], $offensiveLineup);
        }

        // Calculate outcome probabilities based on attributes
        $modifiedOutcomes = $this->calculateModifiedOutcomes(
            $action,
            $actor,
            $defender,
            $offensiveLineup,
            $defensiveLineup,
            $play
        );

        // Select outcome
        $selectedOutcome = $this->selectOutcome($modifiedOutcomes);

        // Record keyframe
        $this->recordKeyframe($action, $actor, $selectedOutcome);

        // Update elapsed time
        $this->elapsedTime += $action['duration'] ?? 1.0;

        // Handle specific action types
        $this->processActionType($action, $selectedOutcome, $actor, $offensiveLineup);

        return $selectedOutcome;
    }

    /**
     * Calculate modified outcome probabilities based on player attributes.
     */
    private function calculateModifiedOutcomes(
        array $action,
        array $actor,
        ?array $defender,
        array $offensiveLineup,
        array $defensiveLineup,
        array $play
    ): array {
        $outcomes = $action['outcomes'];
        $modified = [];

        // Get relevant attributes
        $offenseAttrs = $action['attributes']['offense'] ?? [];
        $defenseAttrs = $action['attributes']['defense'] ?? [];

        // Calculate offensive rating for this action
        $offenseRating = $this->calculateAttributeRating($actor, $offenseAttrs);

        // Calculate defensive rating
        $defenseRating = 50; // Default
        if ($defender) {
            $defenseRating = $this->calculateAttributeRating($defender, $defenseAttrs);
        }

        // Calculate advantage (-50 to +50 range typically)
        $advantage = ($offenseRating - $defenseRating) / 2;

        // Apply badge effects
        $badgeBoost = $this->calculateBadgeBoost($action, $actor, $play);
        $advantage += $badgeBoost * 10;

        // Apply defensive scheme modifiers
        $shotMod = $this->defensiveModifiers['shotModifier'] ?? 0;
        $turnoverMod = $this->defensiveModifiers['turnoverModifier'] ?? 0;
        $blockMod = $this->defensiveModifiers['blockModifier'] ?? 0;
        $stealMod = $this->defensiveModifiers['stealModifier'] ?? 0;

        foreach ($outcomes as $key => $outcome) {
            $baseProbability = $outcome['probability'] ?? 0.5;
            $modifier = $outcome['modifier'] ?? 0;

            // Adjust probability based on advantage
            $adjustedProbability = $baseProbability;

            // Positive outcomes boosted by positive advantage
            if (in_array($key, ['success', 'made', 'finish', 'open', 'beat_defender', 'drive', 'shooter_open', 'cutter_open'])) {
                $adjustedProbability = $baseProbability + ($advantage / 200);
                // Apply shot modifier from defensive scheme
                if ($key === 'made') {
                    $adjustedProbability += $shotMod;
                }
            }
            // Negative outcomes reduced by positive advantage
            elseif (in_array($key, ['stolen', 'turnover', 'blocked', 'deflected', 'covered'])) {
                $adjustedProbability = $baseProbability - ($advantage / 200);

                // Apply defensive scheme modifiers
                if ($key === 'blocked') {
                    $adjustedProbability += $blockMod;
                }
                if ($key === 'stolen') {
                    $adjustedProbability += $stealMod;
                }
                if ($key === 'turnover') {
                    $adjustedProbability += $turnoverMod;
                }
            }

            // Apply action-specific modifier
            $adjustedProbability += $modifier;

            // Clamp probability
            $adjustedProbability = max(0.05, min(0.95, $adjustedProbability));

            $modified[$key] = array_merge($outcome, ['probability' => $adjustedProbability]);
        }

        // Normalize probabilities to sum to 1
        return $this->normalizeProbabilities($modified);
    }

    /**
     * Calculate rating from multiple attributes.
     */
    private function calculateAttributeRating(array $player, array $attributeNames): float
    {
        if (empty($attributeNames)) {
            return $player['overall_rating'] ?? $player['overallRating'] ?? 70;
        }

        $total = 0;
        $count = 0;

        foreach ($attributeNames as $attrName) {
            $value = $this->getPlayerAttribute($player, $attrName);
            if ($value !== null) {
                $total += $value;
                $count++;
            }
        }

        return $count > 0 ? $total / $count : 70;
    }

    /**
     * Get a player attribute by name (searches all categories).
     */
    private function getPlayerAttribute(array $player, string $attrName): ?float
    {
        $attributes = $player['attributes'] ?? [];

        foreach (['offense', 'defense', 'physical', 'mental'] as $category) {
            if (isset($attributes[$category][$attrName])) {
                return (float) $attributes[$category][$attrName];
            }
        }

        // Check camelCase variations
        $camelName = lcfirst(str_replace('_', '', ucwords($attrName, '_')));
        foreach (['offense', 'defense', 'physical', 'mental'] as $category) {
            if (isset($attributes[$category][$camelName])) {
                return (float) $attributes[$category][$camelName];
            }
        }

        return null;
    }

    /**
     * Calculate badge boost for an action.
     */
    private function calculateBadgeBoost(array $action, array $actor, array $play): float
    {
        $boost = 0;
        $actionId = $action['id'];

        // Get relevant badges for this action
        $relevantBadges = $play['badgeEffects'][$actionId] ?? [];

        $playerBadges = $actor['badges'] ?? [];
        foreach ($playerBadges as $badge) {
            if (in_array($badge['id'], $relevantBadges)) {
                $badgeBoost = match($badge['level']) {
                    'hof' => 0.08,
                    'gold' => 0.05,
                    'silver' => 0.03,
                    'bronze' => 0.01,
                    default => 0,
                };

                if ($badgeBoost > 0) {
                    $boost += $badgeBoost;
                    // Track badge activation for animation
                    $this->activatedBadges[] = [
                        'badgeId' => $badge['id'],
                        'level' => $badge['level'],
                        'playerId' => $actor['id'] ?? 'unknown',
                        'playerName' => ($actor['first_name'] ?? $actor['firstName'] ?? '') . ' ' . ($actor['last_name'] ?? $actor['lastName'] ?? ''),
                        'actionId' => $actionId,
                        'time' => $this->elapsedTime,
                    ];
                }
            }
        }

        return $boost;
    }

    /**
     * Normalize probabilities to sum to 1.
     */
    private function normalizeProbabilities(array $outcomes): array
    {
        $total = array_sum(array_column($outcomes, 'probability'));

        if ($total <= 0) {
            // Equal distribution
            $count = count($outcomes);
            foreach ($outcomes as &$outcome) {
                $outcome['probability'] = 1 / $count;
            }
            return $outcomes;
        }

        foreach ($outcomes as &$outcome) {
            $outcome['probability'] = $outcome['probability'] / $total;
        }

        return $outcomes;
    }

    /**
     * Select an outcome based on probabilities.
     */
    private function selectOutcome(array $outcomes): array
    {
        $random = mt_rand() / mt_getrandmax();
        $cumulative = 0;

        foreach ($outcomes as $key => $outcome) {
            $cumulative += $outcome['probability'];
            if ($random <= $cumulative) {
                return array_merge($outcome, ['key' => $key]);
            }
        }

        // Fallback to last outcome
        $lastKey = array_key_last($outcomes);
        return array_merge($outcomes[$lastKey], ['key' => $lastKey]);
    }

    /**
     * Assign players to play roles using attribute-weighted selection.
     * This distributes shots more realistically across the team.
     */
    private function assignRoles(array $play, array $lineup): void
    {
        $roles = $play['roles'];
        $assigned = [];
        $category = $play['category'] ?? 'motion';

        foreach ($roles as $role => $positions) {
            // Get all eligible candidates (matching position)
            $candidates = [];
            foreach ($lineup as $player) {
                $playerId = $player['id'];
                if (in_array($playerId, $assigned)) {
                    continue;
                }

                // Check if player can play any of the role's positions
                $playerPos = $player['position'] ?? 'SF';
                $secondaryPos = $player['secondary_position'] ?? null;
                foreach ($positions as $position) {
                    if ($playerPos === $position || $secondaryPos === $position) {
                        $fitness = $this->calculateRoleFitness($player, $role, $category);
                        $candidates[] = [
                            'player' => $player,
                            'fitness' => $fitness,
                        ];
                        break;
                    }
                }
            }

            // Select from candidates with weighted randomness
            if (!empty($candidates)) {
                // Sort by fitness (highest first)
                usort($candidates, fn($a, $b) => $b['fitness'] <=> $a['fitness']);

                // Add variance: 70% best, 25% second best, 5% random
                $selectedPlayer = $this->selectWithVariance($candidates);
                $this->roleAssignments[$role] = $selectedPlayer['id'];
                $assigned[] = $selectedPlayer['id'];
            }

            // Fallback: assign any unassigned player
            if (!isset($this->roleAssignments[$role])) {
                foreach ($lineup as $player) {
                    if (!in_array($player['id'], $assigned)) {
                        $this->roleAssignments[$role] = $player['id'];
                        $assigned[] = $player['id'];
                        break;
                    }
                }
            }
        }

        // Set initial ball carrier (usually ballHandler, point, or first role)
        $ballHandlerRoles = ['ballHandler', 'point', 'passer', 'pointGuard'];
        foreach ($ballHandlerRoles as $role) {
            if (isset($this->roleAssignments[$role])) {
                $this->ballCarrierId = $this->roleAssignments[$role];
                break;
            }
        }

        if (!$this->ballCarrierId && !empty($this->roleAssignments)) {
            $this->ballCarrierId = reset($this->roleAssignments);
        }
    }

    /**
     * Calculate how well a player fits a given role based on attributes.
     */
    private function calculateRoleFitness(array $player, string $role, string $category): float
    {
        $score = $player['overall_rating'] ?? $player['overallRating'] ?? 70;
        $offense = $player['attributes']['offense'] ?? [];
        $physical = $player['attributes']['physical'] ?? [];

        switch ($role) {
            case 'ballHandler':
            case 'point':
            case 'passer':
            case 'pointGuard':
                $score += ($offense['ballHandling'] ?? 50) * 0.3;
                $score += ($offense['passVision'] ?? 50) * 0.2;
                $score += ($physical['speed'] ?? 50) * 0.1;
                break;

            case 'shooter':
            case 'wing1':
            case 'wing2':
            case 'weakWing':
                $score += ($offense['threePoint'] ?? 50) * 0.4;
                $score += ($offense['offensiveConsistency'] ?? 50) * 0.1;
                break;

            case 'screener':
            case 'post':
            case 'postPlayer':
            case 'elbow1':
            case 'elbow2':
            case 'block1':
            case 'block2':
                $score += ($offense['postControl'] ?? 50) * 0.3;
                $score += ($physical['strength'] ?? 50) * 0.2;
                break;

            case 'corner':
            case 'corner1':
            case 'corner2':
                $score += ($offense['threePoint'] ?? 50) * 0.35;
                break;

            case 'cutter':
            case 'trailer1':
            case 'trailer2':
            case 'rim_runner':
                $score += ($offense['layup'] ?? 50) * 0.25;
                $score += ($physical['speed'] ?? 50) * 0.2;
                break;
        }

        return $score;
    }

    /**
     * Select a player from sorted candidates with variance.
     * 70% chance: best fit, 25% chance: second best, 5% chance: random
     */
    private function selectWithVariance(array $sortedCandidates): array
    {
        $count = count($sortedCandidates);
        if ($count === 1) {
            return $sortedCandidates[0]['player'];
        }

        $rand = mt_rand(1, 100);

        if ($rand <= 70) {
            // Best candidate
            return $sortedCandidates[0]['player'];
        } elseif ($rand <= 95 && $count >= 2) {
            // Second best candidate
            return $sortedCandidates[1]['player'];
        } else {
            // Random from remaining
            $randomIndex = mt_rand(0, $count - 1);
            return $sortedCandidates[$randomIndex]['player'];
        }
    }

    /**
     * Set initial formation positions.
     */
    private function setFormation(array $play): void
    {
        $formation = $play['formation'];

        foreach ($formation as $role => $position) {
            if (isset($this->roleAssignments[$role])) {
                $playerId = $this->roleAssignments[$role];
                $this->playerPositions[$playerId] = $position;
            }
        }

        // Record initial keyframe
        $this->keyframes[] = [
            'time' => 0,
            'positions' => $this->buildPositionsSnapshot(),
            'ball' => $this->ballCarrierId ? $this->playerPositions[$this->ballCarrierId] : ['x' => 0.5, 'y' => 0.5],
            'action' => 'formation',
            'description' => 'Setting up play'
        ];
    }

    /**
     * Apply movement from an action.
     */
    private function applyMovement(array $movement, array $lineup): void
    {
        foreach ($movement as $role => $newPosition) {
            if ($role === 'ball') {
                continue; // Ball handled separately
            }

            if ($role === 'dynamic') {
                // Dynamic means current ball carrier
                if ($this->ballCarrierId) {
                    $this->playerPositions[$this->ballCarrierId] = $newPosition;
                }
                continue;
            }

            if (isset($this->roleAssignments[$role])) {
                $playerId = $this->roleAssignments[$role];
                $this->playerPositions[$playerId] = $newPosition;
            }
        }
    }

    /**
     * Get player by role.
     */
    private function getPlayerByRole(string $role, array $lineup): array
    {
        // Safety check: if lineup is empty, return a placeholder to prevent crashes
        if (empty($lineup)) {
            return [
                'id' => 'unknown_player',
                'first_name' => 'Unknown',
                'last_name' => 'Player',
                'position' => 'SF',
                'attributes' => [],
            ];
        }

        if ($role === 'dynamic') {
            // Return current ball carrier
            foreach ($lineup as $player) {
                if (($player['id'] ?? null) === $this->ballCarrierId) {
                    return $player;
                }
            }
        }

        $playerId = $this->roleAssignments[$role] ?? null;
        if ($playerId) {
            foreach ($lineup as $player) {
                if (($player['id'] ?? null) === $playerId) {
                    return $player;
                }
            }
        }

        // Fallback to first player (with safety check for empty lineup)
        return $lineup[0] ?? null;
    }

    /**
     * Get matching defender for a player.
     */
    private function getMatchingDefender(array $offensivePlayer, array $defensiveLineup): ?array
    {
        $position = $offensivePlayer['position'] ?? 'SF';

        // Find defender with matching position
        foreach ($defensiveLineup as $defender) {
            if ($defender['position'] === $position) {
                return $defender;
            }
        }

        // Fallback to any defender
        return $defensiveLineup[0] ?? null;
    }

    /**
     * Find an action in a play by ID.
     */
    private function findAction(array $play, string $actionId): ?array
    {
        foreach ($play['actions'] as $action) {
            if ($action['id'] === $actionId) {
                return $action;
            }
        }
        return null;
    }

    /**
     * Record a keyframe for animation.
     */
    private function recordKeyframe(array $action, array $actor, array $outcome): void
    {
        $description = $this->generateDescription($action, $actor, $outcome);
        $outcomeKey = $outcome['key'] ?? '';

        $keyframe = [
            'time' => $this->elapsedTime,
            'positions' => $this->buildPositionsSnapshot(),
            'ball' => $this->ballCarrierId ? ($this->playerPositions[$this->ballCarrierId] ?? ['x' => 0.5, 'y' => 0.5]) : ['x' => 0.5, 'y' => 0.5],
            'action' => $action['id'],
            'actionType' => $action['type'],
            'outcome' => $outcomeKey,
            'description' => $description,
        ];

        // Add result info if this is a scoring action
        if (isset($outcome['points'])) {
            $keyframe['result'] = [
                'type' => $outcomeKey,
                'points' => $outcome['points']
            ];
        }

        // Flag defensive plays for frontend animations
        if (in_array($outcomeKey, ['blocked', 'stolen', 'turnover'])) {
            $keyframe['defensive_play'] = true;
            $keyframe['defensive_scheme'] = $this->defensiveScheme;
        }

        $this->keyframes[] = $keyframe;
    }

    /**
     * Build positions snapshot for all players.
     */
    private function buildPositionsSnapshot(): array
    {
        $snapshot = [];

        foreach ($this->playerPositions as $playerId => $position) {
            $snapshot[$playerId] = [
                'x' => $position['x'],
                'y' => $position['y'],
                'hasBall' => $playerId === $this->ballCarrierId,
                'lineupIndex' => $this->playerLineupIndices[$playerId] ?? null,
            ];
        }

        return $snapshot;
    }

    /**
     * Generate human-readable description.
     */
    private function generateDescription(array $action, array $actor, array $outcome): string
    {
        $name = $actor['first_name'] ?? $actor['firstName'] ?? 'Player';
        $outcomeKey = $outcome['key'] ?? '';

        // Handle special defensive outcomes
        if (in_array($outcomeKey, ['stolen', 'turnover'])) {
            return $this->getTurnoverDescription($name);
        }

        return match($action['type']) {
            'screen' => "{$name} sets a screen",
            'pass' => $outcomeKey === 'stolen' ? $this->getTurnoverDescription($name) : "{$name} passes the ball",
            'drive' => $outcomeKey === 'turnover' ? $this->getTurnoverDescription($name) : "{$name} drives to the basket",
            'shot' => $this->getShotDescription($action, $actor, $outcome),
            'decision' => "{$name} reads the defense",
            'cut' => "{$name} cuts to the basket",
            'setup' => "{$name} sets up the play",
            'post' => "{$name} works in the post",
            'handoff' => $outcomeKey === 'turnover' ? $this->getTurnoverDescription($name) : "{$name} executes a handoff",
            'reset' => "Resetting the offense",
            default => "{$name} executes play action"
        };
    }

    /**
     * Get shot description based on outcome.
     */
    private function getShotDescription(array $action, array $actor, array $outcome): string
    {
        $name = $actor['first_name'] ?? $actor['firstName'] ?? 'Player';
        $shotType = $action['shotType'] ?? 'shot';

        $shotName = match($shotType) {
            'threePoint' => 'three-pointer',
            'midRange' => 'mid-range jumper',
            'paint' => 'shot at the rim',
            default => 'shot'
        };

        if ($outcome['key'] === 'made') {
            return "{$name} makes the {$shotName}!";
        } elseif ($outcome['key'] === 'missed') {
            return "{$name} misses the {$shotName}";
        } elseif ($outcome['key'] === 'blocked') {
            return $this->getBlockedDescription($name);
        } elseif ($outcome['key'] === 'fouled') {
            return "{$name} is fouled on the {$shotName}";
        }

        return "{$name} takes a {$shotName}";
    }

    /**
     * Get scheme-aware description for blocked shots.
     */
    private function getBlockedDescription(string $shooterName): string
    {
        $descriptions = match($this->defensiveScheme) {
            'man' => [
                "{$shooterName}'s shot is swatted away!",
                "Strong man defense leads to a block!",
                "{$shooterName} gets his shot rejected!",
            ],
            'zone_2_3' => [
                "The 2-3 zone collapses and blocks!",
                "Zone defense walls off the paint!",
                "{$shooterName} is met by the zone!",
            ],
            'zone_3_2' => [
                "The 3-2 zone rotates for the block!",
                "{$shooterName}'s shot is sent back!",
            ],
            'zone_1_3_1' => [
                "The 1-3-1 zone gets the block!",
                "Weak side help leads to a rejection!",
            ],
            'press' => [
                "{$shooterName}'s rushed shot is blocked!",
                "Press forces contested attempt that's rejected!",
            ],
            'trap' => [
                "Double team leads to a blocked shot!",
                "{$shooterName} gets trapped and blocked!",
            ],
            default => [
                "{$shooterName}'s shot is blocked!",
                "Great defensive play for the block!",
            ],
        };

        return $descriptions[array_rand($descriptions)];
    }

    /**
     * Get scheme-aware description for turnovers/steals.
     */
    private function getTurnoverDescription(string $playerName): string
    {
        $descriptions = match($this->defensiveScheme) {
            'man' => [
                "Tight man defense forces the turnover!",
                "Man-to-man pressure creates the steal!",
                "{$playerName} coughs it up against the pressure!",
            ],
            'zone_2_3' => [
                "The 2-3 zone reads the pass!",
                "Zone defense anticipates and steals!",
            ],
            'zone_3_2' => [
                "The 3-2 zone picks off the pass!",
                "Quick hands in the zone cause the turnover!",
            ],
            'zone_1_3_1' => [
                "The 1-3-1 trap forces the turnover!",
                "Aggressive trapping creates the steal!",
                "{$playerName} is caught in the 1-3-1!",
            ],
            'press' => [
                "Full court press creates the turnover!",
                "Press defense forces the bad pass!",
                "{$playerName} can't handle the pressure!",
            ],
            'trap' => [
                "Double team forces the turnover!",
                "Trap defense creates another steal!",
                "{$playerName} is suffocated by the trap!",
            ],
            default => [
                "Turnover! Great defensive play!",
                "{$playerName} loses the ball!",
            ],
        };

        return $descriptions[array_rand($descriptions)];
    }

    /**
     * Process action type for state updates.
     */
    private function processActionType(array $action, array $outcome, array $actor, array $lineup): void
    {
        // Handle pass - transfer ball carrier
        if ($action['type'] === 'pass' && $outcome['key'] !== 'stolen') {
            $receiverRole = $action['receiver'] ?? null;
            if ($receiverRole && isset($this->roleAssignments[$receiverRole])) {
                $this->ballCarrierId = $this->roleAssignments[$receiverRole];
            }
        }

        // Handle handoff
        if ($action['type'] === 'handoff' && $outcome['key'] !== 'turnover') {
            $receiverRole = $action['receiver'] ?? null;
            if ($receiverRole && isset($this->roleAssignments[$receiverRole])) {
                $this->ballCarrierId = $this->roleAssignments[$receiverRole];
            }
        }

        // Track shot attempts
        if ($action['type'] === 'shot') {
            $this->playResult['shotAttempt'] = [
                'shooter' => $actor['id'] ?? 'unknown',
                'shooterName' => ($actor['first_name'] ?? $actor['firstName'] ?? '') . ' ' . ($actor['last_name'] ?? $actor['lastName'] ?? ''),
                'shotType' => $action['shotType'] ?? 'paint',
                'made' => $outcome['key'] === 'made',
                'fouled' => $outcome['key'] === 'fouled',
                'blocked' => $outcome['key'] === 'blocked',
                'points' => $outcome['points'] ?? 0
            ];
        }
    }

    /**
     * Handle end states.
     */
    private function handleEndState(array $outcome, array $action): void
    {
        $endType = $outcome['next'];

        if ($endType === 'end_made') {
            $this->playResult['outcome'] = 'made';
            $this->playResult['points'] = $outcome['points'] ?? 2;
        } elseif ($endType === 'end_turnover') {
            $this->playResult['outcome'] = 'turnover';
            $this->playResult['points'] = 0;
        } else {
            $this->playResult['outcome'] = 'completed';
            $this->playResult['points'] = $outcome['points'] ?? 0;
        }
    }

    /**
     * Handle rebound battle.
     */
    private function handleReboundBattle(array $offensiveLineup, array $defensiveLineup): void
    {
        $offRebRating = 0;
        $defRebRating = 0;

        foreach ($offensiveLineup as $player) {
            $offRebRating += $player['attributes']['defense']['offensiveRebound'] ?? 40;
        }

        foreach ($defensiveLineup as $player) {
            $defRebRating += $player['attributes']['defense']['defensiveRebound'] ?? 50;
        }

        // Defense has inherent positioning advantage (box out)
        $defAdvantage = 2.5;
        $totalWeighted = $offRebRating + $defRebRating * $defAdvantage;
        if ($totalWeighted <= 0) $totalWeighted = 1;

        $offRebChance = $offRebRating / $totalWeighted;
        $offRebChance = max(0.15, min(0.40, $offRebChance));

        if (mt_rand(1, 1000) <= (int)($offRebChance * 1000)) {
            $this->playResult['outcome'] = 'offensive_rebound';
            $this->playResult['points'] = 0;
        } else {
            $this->playResult['outcome'] = 'missed';
            $this->playResult['points'] = 0;
        }

        // Record rebound keyframe
        $this->keyframes[] = [
            'time' => $this->elapsedTime + 0.5,
            'positions' => $this->buildPositionsSnapshot(),
            'ball' => ['x' => 0.5, 'y' => 0.8],
            'action' => 'rebound_battle',
            'description' => $this->playResult['outcome'] === 'offensive_rebound'
                ? 'Offensive rebound!'
                : 'Defensive rebound'
        ];
    }

    /**
     * Handle free throws.
     */
    private function handleFreeThrows(array $outcome, array $offensiveLineup): void
    {
        // Safety check: if lineup is empty, skip free throws
        if (empty($offensiveLineup)) {
            $this->playResult['outcome'] = 'free_throws';
            $this->playResult['points'] = 0;
            $this->playResult['freeThrows'] = ['made' => 0, 'attempted' => 0];
            return;
        }

        $shooter = null;
        foreach ($offensiveLineup as $player) {
            if ($player['id'] === $this->ballCarrierId) {
                $shooter = $player;
                break;
            }
        }

        if (!$shooter) {
            $shooter = $offensiveLineup[0];
        }

        $ftRating = $shooter['attributes']['offense']['freeThrow'] ?? 70;
        $ftPercentage = $ftRating / 100;

        // Assume 2 free throws
        $made = 0;
        for ($i = 0; $i < 2; $i++) {
            if (mt_rand() / mt_getrandmax() < $ftPercentage) {
                $made++;
            }
        }

        $this->playResult['outcome'] = 'free_throws';
        $this->playResult['points'] = $made;
        $this->playResult['freeThrows'] = ['made' => $made, 'attempted' => 2];

        $this->keyframes[] = [
            'time' => $this->elapsedTime + 1.0,
            'positions' => $this->buildPositionsSnapshot(),
            'ball' => ['x' => 0.5, 'y' => 0.75],
            'action' => 'free_throws',
            'description' => ($shooter['first_name'] ?? $shooter['firstName'] ?? 'Player') . " makes {$made} of 2 free throws"
        ];
    }

    /**
     * Build final play result.
     */
    private function buildPlayResult(array $play): array
    {
        return [
            'playId' => $play['id'],
            'playName' => $play['name'],
            'category' => $play['category'],
            'outcome' => $this->playResult['outcome'] ?? 'completed',
            'points' => $this->playResult['points'] ?? 0,
            'duration' => $this->elapsedTime,
            'shotAttempt' => $this->playResult['shotAttempt'] ?? null,
            'freeThrows' => $this->playResult['freeThrows'] ?? null,
            'keyframes' => $this->keyframes,
            'roleAssignments' => $this->roleAssignments,
            'activatedBadges' => $this->activatedBadges,
        ];
    }

    /**
     * Reset engine state for new play.
     */
    private function resetState(): void
    {
        $this->roleAssignments = [];
        $this->playerPositions = [];
        $this->playerLineupIndices = [];
        $this->ballCarrierId = null;
        $this->keyframes = [];
        $this->elapsedTime = 0;
        $this->playResult = [];
        $this->activatedBadges = [];
        // Note: defensiveScheme and defensiveModifiers are set at start of executePlay
    }

    /**
     * Generate animation data for frontend.
     */
    public function generateAnimationData(array $playResult): array
    {
        return [
            'playId' => $playResult['playId'],
            'playName' => $playResult['playName'],
            'duration' => $playResult['duration'],
            'keyframes' => $playResult['keyframes'],
        ];
    }
}
