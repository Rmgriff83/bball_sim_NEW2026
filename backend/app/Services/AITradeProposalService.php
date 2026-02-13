<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\DraftPick;
use App\Models\NewsEvent;
use App\Models\Team;
use App\Models\TradeProposal;
use Carbon\Carbon;
use Illuminate\Support\Facades\Log;

class AITradeProposalService
{
    private const TRADE_DEADLINE_MONTH = 1;
    private const TRADE_DEADLINE_DAY = 13;

    public function __construct(
        private AITradeEvaluationService $evaluationService,
        private CampaignPlayerService $playerService,
        private DraftPickService $draftPickService,
        private TradeService $tradeService
    ) {}

    /**
     * Generate weekly AI trade proposals to the user.
     */
    public function generateWeeklyProposals(Campaign $campaign): void
    {
        // Expire stale proposals first
        $this->expireStaleProposals($campaign);

        // Check trade deadline
        $deadline = $this->getTradeDeadline($campaign);
        if ($campaign->current_date->gt($deadline)) {
            return;
        }

        $daysUntilDeadline = $campaign->current_date->diffInDays($deadline, false);
        $isDeadlineMonth = $daysUntilDeadline >= 0 && $daysUntilDeadline <= 30;

        $aiTeams = Team::where('campaign_id', $campaign->id)
            ->where('id', '!=', $campaign->team_id)
            ->get();

        $userTeam = $campaign->team;
        if (!$userTeam) return;

        $userRoster = $userTeam->players()->get()->map(function ($p) {
            return [
                'id' => $p->id,
                'firstName' => $p->first_name,
                'lastName' => $p->last_name,
                'position' => $p->position,
                'secondaryPosition' => $p->secondary_position,
                'overallRating' => $p->overall_rating,
                'age' => $p->birth_date ? (int) abs(now()->diffInYears($p->birth_date)) : 25,
                'contractSalary' => (float) $p->contract_salary,
                'contractYearsRemaining' => $p->contract_years_remaining ?? 1,
                'tradeValue' => $p->trade_value,
                'tradeValueTotal' => $p->trade_value_total,
            ];
        })->toArray();

        if (empty($userRoster)) return;

        foreach ($aiTeams as $aiTeam) {
            // Skip if team already has a pending proposal
            $hasPending = TradeProposal::where('campaign_id', $campaign->id)
                ->where('proposing_team_id', $aiTeam->id)
                ->where('status', 'pending')
                ->exists();

            if ($hasPending) continue;

            // Probability check
            $baseProbability = 0.15;
            $context = $this->evaluationService->buildContext($campaign, $aiTeam);
            $direction = $this->evaluationService->analyzeTeamDirection($aiTeam, $context);

            if ($isDeadlineMonth) {
                if (in_array($direction, ['title_contender', 'win_now'])) {
                    $baseProbability *= 3.0;
                } else {
                    $baseProbability *= 2.0;
                }
            }

            if (mt_rand(1, 100) > ($baseProbability * 100)) {
                continue;
            }

            // Try to build a proposal
            $proposal = $this->buildProposalForTeam($campaign, $aiTeam, $direction, $userRoster);

            if ($proposal) {
                $this->storeProposal($campaign, $aiTeam, $proposal);
            }
        }
    }

    /**
     * Build a trade proposal from an AI team to the user.
     */
    private function buildProposalForTeam(
        Campaign $campaign,
        Team $aiTeam,
        string $direction,
        array $userRoster
    ): ?array {
        $aiRoster = $this->playerService->getTeamRoster($campaign->id, $aiTeam->abbreviation);
        if (empty($aiRoster)) return null;

        // Identify team's need
        $need = $this->identifyNeed($aiTeam, $direction, $aiRoster, $campaign);
        if (!$need) return null;

        // Find user players that fill the need
        $targetPlayers = $this->findTargetPlayers($userRoster, $need, $direction);
        if (empty($targetPlayers)) return null;

        // Pick the best target
        $target = $targetPlayers[0];

        // Find AI players to offer in return
        $aiOffer = $this->buildAiOffer($campaign, $aiTeam, $target, $direction, $aiRoster);
        if (!$aiOffer) return null;

        // Verify the AI would accept its own proposal
        $verification = $this->evaluationService->evaluateTrade(
            [
                'aiReceives' => [['type' => 'player', 'playerId' => $target['id']]],
                'aiGives' => $aiOffer['assets'],
            ],
            $aiTeam,
            $campaign
        );

        if ($verification['decision'] !== 'accept') {
            return null;
        }

        return [
            'aiGives' => $aiOffer['assets'],
            'aiReceives' => [['type' => 'player', 'playerId' => $target['id']]],
            'reason' => $this->generateProposalReason($direction, $target, $need),
            'targetPlayer' => $target,
        ];
    }

    /**
     * Identify what the AI team needs.
     */
    private function identifyNeed(Team $team, string $direction, array $roster, Campaign $campaign): ?array
    {
        // Contenders/win-now: need star or key position upgrade
        if (in_array($direction, ['title_contender', 'win_now'])) {
            // Find weakest starting position
            $positions = ['PG', 'SG', 'SF', 'PF', 'C'];
            $weakest = null;
            $weakestRating = 100;

            foreach ($positions as $pos) {
                $bestAtPos = null;
                foreach ($roster as $p) {
                    $pPos = $p['position'] ?? '';
                    $pSec = $p['secondaryPosition'] ?? '';
                    if ($pPos === $pos || $pSec === $pos) {
                        $rating = $p['overallRating'] ?? $p['overall_rating'] ?? 75;
                        if (!$bestAtPos || $rating > ($bestAtPos['overallRating'] ?? $bestAtPos['overall_rating'] ?? 75)) {
                            $bestAtPos = $p;
                        }
                    }
                }

                $bestRating = $bestAtPos ? ($bestAtPos['overallRating'] ?? $bestAtPos['overall_rating'] ?? 75) : 0;
                if ($bestRating < $weakestRating) {
                    $weakestRating = $bestRating;
                    $weakest = $pos;
                }
            }

            if ($weakest && $weakestRating < 80) {
                return ['type' => 'position', 'position' => $weakest, 'minRating' => $weakestRating + 2];
            }

            // Otherwise need a star upgrade
            return ['type' => 'star', 'minRating' => 80];
        }

        // Rebuilding: need picks/young talent, willing to offer vets
        if ($direction === 'rebuilding') {
            return ['type' => 'young', 'maxAge' => 24];
        }

        // Ascending: selective, need specific position upgrades
        $positions = ['PG', 'SG', 'SF', 'PF', 'C'];
        $weakest = null;
        $weakestRating = 100;

        foreach ($positions as $pos) {
            $bestAtPos = null;
            foreach ($roster as $p) {
                $pPos = $p['position'] ?? '';
                $pSec = $p['secondaryPosition'] ?? '';
                if ($pPos === $pos || $pSec === $pos) {
                    $rating = $p['overallRating'] ?? $p['overall_rating'] ?? 75;
                    if (!$bestAtPos || $rating > ($bestAtPos['overallRating'] ?? $bestAtPos['overall_rating'] ?? 75)) {
                        $bestAtPos = $p;
                    }
                }
            }

            $bestRating = $bestAtPos ? ($bestAtPos['overallRating'] ?? $bestAtPos['overall_rating'] ?? 75) : 0;
            if ($bestRating < $weakestRating) {
                $weakestRating = $bestRating;
                $weakest = $pos;
            }
        }

        if ($weakest) {
            return ['type' => 'position', 'position' => $weakest, 'minRating' => max(72, $weakestRating + 2)];
        }

        return null;
    }

    /**
     * Find user players that match the AI team's need.
     */
    private function findTargetPlayers(array $userRoster, array $need, string $direction): array
    {
        $targets = [];

        foreach ($userRoster as $player) {
            $rating = $player['overallRating'] ?? 75;
            $age = $player['age'] ?? 25;
            $position = $player['position'] ?? '';

            switch ($need['type']) {
                case 'position':
                    if ($position === ($need['position'] ?? '') && $rating >= ($need['minRating'] ?? 70)) {
                        $targets[] = $player;
                    }
                    break;

                case 'star':
                    if ($rating >= ($need['minRating'] ?? 80)) {
                        $targets[] = $player;
                    }
                    break;

                case 'young':
                    if ($age <= ($need['maxAge'] ?? 24) && $rating >= 70) {
                        $targets[] = $player;
                    }
                    break;
            }
        }

        // Sort by trade value descending (prefer mid-range targets, not user's best player)
        usort($targets, function ($a, $b) {
            $aVal = $a['tradeValue'] ?? $a['tradeValueTotal'] ?? $a['overallRating'] ?? 75;
            $bVal = $b['tradeValue'] ?? $b['tradeValueTotal'] ?? $b['overallRating'] ?? 75;
            return $bVal <=> $aVal;
        });

        // Skip the very best player (don't target the user's #1 guy unless it's the only option)
        if (count($targets) > 1) {
            array_shift($targets);
        }

        return array_slice($targets, 0, 3);
    }

    /**
     * Build what the AI will offer in return.
     */
    private function buildAiOffer(
        Campaign $campaign,
        Team $aiTeam,
        array $targetPlayer,
        string $direction,
        array $aiRoster
    ): ?array {
        $targetValue = $targetPlayer['tradeValue'] ?? $targetPlayer['tradeValueTotal'] ?? $targetPlayer['overallRating'] ?? 75;
        $assets = [];

        // Sort AI roster by rating (offer mid-tier players, not their stars)
        usort($aiRoster, function ($a, $b) {
            return ($b['overallRating'] ?? $b['overall_rating'] ?? 75) <=> ($a['overallRating'] ?? $a['overall_rating'] ?? 75);
        });

        // For rebuilders, offer veterans first
        if ($direction === 'rebuilding') {
            $vets = array_filter($aiRoster, function ($p) {
                $age = $p['age'] ?? (isset($p['birthDate']) ? (int) abs(now()->diffInYears($p['birthDate'])) : 25);
                return $age >= 28;
            });
            $candidates = !empty($vets) ? array_values($vets) : $aiRoster;
        } else {
            // Skip the top 3 players (protect stars)
            $candidates = array_slice($aiRoster, 3);
            if (empty($candidates)) {
                $candidates = array_slice($aiRoster, 1);
            }
        }

        // Find a suitable player to offer
        foreach ($candidates as $candidate) {
            $candidateRating = $candidate['overallRating'] ?? $candidate['overall_rating'] ?? 75;
            $candidateValue = $candidate['tradeValue'] ?? $candidate['tradeValueTotal'] ?? $candidateRating;

            // Offer should be reasonably close in value
            if ($candidateValue >= $targetValue * 0.5 && $candidateValue <= $targetValue * 1.5) {
                $assets[] = ['type' => 'player', 'playerId' => $candidate['id']];
                break;
            }
        }

        if (empty($assets)) {
            // Couldn't find a suitable player — try offering picks instead
            $picks = $this->draftPickService->getTeamPicksForTrade($campaign, $aiTeam->id);
            if (!empty($picks)) {
                $assets[] = ['type' => 'pick', 'pickId' => $picks[0]['id']];
            }
        }

        // If the AI offer seems light, add a pick to sweeten
        if (count($assets) === 1 && $assets[0]['type'] === 'player') {
            $offeredPlayer = $this->evaluationService->getPlayer($assets[0]['playerId'], $campaign);
            $offeredValue = $offeredPlayer ? ($offeredPlayer['tradeValue'] ?? $offeredPlayer['overallRating'] ?? 75) : 0;

            if ($offeredValue < $targetValue * 0.8) {
                $picks = $this->draftPickService->getTeamPicksForTrade($campaign, $aiTeam->id);
                if (!empty($picks)) {
                    $assets[] = ['type' => 'pick', 'pickId' => $picks[0]['id']];
                }
            }
        }

        return !empty($assets) ? ['assets' => $assets] : null;
    }

    /**
     * Generate a human-readable reason for the AI's proposal.
     */
    private function generateProposalReason(string $direction, array $target, array $need): string
    {
        $playerName = ($target['firstName'] ?? '') . ' ' . ($target['lastName'] ?? '');

        return match ($direction) {
            'title_contender' => "We believe {$playerName} is the missing piece for a championship run.",
            'win_now' => "Adding {$playerName} would give us the boost we need to compete this season.",
            'ascending' => "{$playerName} fits our timeline perfectly and would help accelerate our build.",
            'rebuilding' => "We think {$playerName} has the kind of upside we're looking for in our rebuild.",
            default => "We see {$playerName} as a great fit for our team going forward.",
        };
    }

    /**
     * Store a proposal and create a news event.
     */
    private function storeProposal(Campaign $campaign, Team $aiTeam, array $proposal): void
    {
        $expiresAt = $campaign->current_date->copy()->addDays(3);

        TradeProposal::create([
            'campaign_id' => $campaign->id,
            'proposing_team_id' => $aiTeam->id,
            'status' => 'pending',
            'proposal' => [
                'aiGives' => $proposal['aiGives'],
                'aiReceives' => $proposal['aiReceives'],
            ],
            'reason' => $proposal['reason'],
            'expires_at' => $expiresAt,
        ]);

        $targetName = ($proposal['targetPlayer']['firstName'] ?? '') . ' ' . ($proposal['targetPlayer']['lastName'] ?? '');

        NewsEvent::create([
            'campaign_id' => $campaign->id,
            'team_id' => $aiTeam->id,
            'event_type' => 'trade',
            'headline' => "The {$aiTeam->city} {$aiTeam->name} have proposed a trade",
            'body' => "The {$aiTeam->name} are interested in acquiring {$targetName} and have sent a formal trade proposal.",
            'game_date' => $campaign->current_date,
        ]);

        Log::info("AI trade proposal generated", [
            'campaign' => $campaign->id,
            'team' => $aiTeam->abbreviation,
            'target' => $targetName,
        ]);
    }

    /**
     * Expire stale proposals past their expires_at date.
     */
    public function expireStaleProposals(Campaign $campaign): void
    {
        TradeProposal::where('campaign_id', $campaign->id)
            ->where('status', 'pending')
            ->where('expires_at', '<', $campaign->current_date)
            ->update(['status' => 'expired']);
    }

    /**
     * Get the trade deadline date for a campaign.
     */
    public function getTradeDeadline(Campaign $campaign): Carbon
    {
        $seasonYear = $campaign->currentSeason?->year ?? 2025;
        // Season 2025 starts Oct 2025, deadline is Feb 5, 2026
        return Carbon::create($seasonYear + 1, self::TRADE_DEADLINE_MONTH, self::TRADE_DEADLINE_DAY);
    }

    /**
     * Check if trades are allowed (before deadline).
     */
    public function isBeforeDeadline(Campaign $campaign): bool
    {
        return $campaign->current_date->lte($this->getTradeDeadline($campaign));
    }

    /**
     * Process trade deadline events (approaching + passed).
     * Called during date advancement.
     */
    public function processTradeDeadlineEvents(Campaign $campaign): void
    {
        $deadline = $this->getTradeDeadline($campaign);
        $currentDate = $campaign->current_date;
        $settings = $campaign->settings ?? [];

        // Approaching warning: 16 days before deadline (Jan 20)
        $warningDate = $deadline->copy()->subDays(16);
        if ($currentDate->gte($warningDate) && !($settings['trade_deadline_warned'] ?? false)) {
            $daysUntil = $currentDate->diffInDays($deadline);

            NewsEvent::create([
                'campaign_id' => $campaign->id,
                'event_type' => 'trade',
                'headline' => 'Trade deadline approaching',
                'body' => "The January 13th trade deadline is {$daysUntil} days away. Teams are expected to increase activity.",
                'game_date' => $currentDate,
            ]);

            $settings['trade_deadline_warned'] = true;
            $campaign->update(['settings' => $settings]);
        }

        // Deadline passed
        if ($currentDate->gt($deadline) && !($settings['trade_deadline_passed'] ?? false)) {
            NewsEvent::create([
                'campaign_id' => $campaign->id,
                'event_type' => 'trade',
                'headline' => 'Trade deadline has passed',
                'body' => 'The trade deadline has officially passed. No more trades can be made this season.',
                'game_date' => $currentDate,
            ]);

            // Expire all pending proposals
            TradeProposal::where('campaign_id', $campaign->id)
                ->where('status', 'pending')
                ->update(['status' => 'expired']);

            $settings['trade_deadline_passed'] = true;
            $campaign->update(['settings' => $settings]);
        }
    }
}
