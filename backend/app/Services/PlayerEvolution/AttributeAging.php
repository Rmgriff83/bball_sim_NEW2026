<?php

namespace App\Services\PlayerEvolution;

use Carbon\Carbon;

class AttributeAging
{
    private array $config;
    private array $attributeToProfile = [];

    public function __construct()
    {
        $this->config = config('player_evolution.attribute_profiles');
        $this->buildAttributeIndex();
    }

    /**
     * Build index mapping attributes to their aging profiles.
     */
    private function buildAttributeIndex(): void
    {
        foreach ($this->config as $profile => $data) {
            foreach ($data['attributes'] as $attr) {
                $this->attributeToProfile[$attr] = $profile;
            }
        }
    }

    /**
     * Get the aging profile for a specific attribute.
     */
    public function getAttributeProfile(string $attribute): ?array
    {
        $profile = $this->attributeToProfile[$attribute] ?? null;
        return $profile ? $this->config[$profile] : null;
    }

    /**
     * Calculate attribute-specific change based on age.
     * Returns positive for development, negative for regression.
     */
    public function calculateAttributeChange(string $attribute, int $age, float $developmentPoints, float $regressionPoints): float
    {
        $profile = $this->getAttributeProfile($attribute);

        if (!$profile) {
            // Unknown attribute - use default aging
            return $developmentPoints - $regressionPoints;
        }

        $peakAge = $profile['peak_age'];
        $declineStart = $profile['decline_start'];
        $declineRate = $profile['decline_rate'];
        $canImprove = $profile['can_improve_past_peak'] ?? false;

        // Before peak - full development possible
        if ($age < $peakAge) {
            return $developmentPoints;
        }

        // Between peak and decline - limited development
        if ($age >= $peakAge && $age < $declineStart) {
            if ($canImprove) {
                return $developmentPoints * 0.5; // Reduced development
            }
            return 0; // No change in plateau
        }

        // After decline starts - regression
        $yearsDecline = $age - $declineStart;
        $regression = $yearsDecline * $declineRate / 12; // Monthly decline

        // Mental attributes can still improve slightly even during decline
        if ($canImprove && $developmentPoints > 0) {
            return max(-$regression, $developmentPoints * 0.3 - $regression);
        }

        return -$regression;
    }

    /**
     * Apply seasonal aging to all attributes.
     */
    public function applySeasonalAging(array $attributes, int $age): array
    {
        $aged = $attributes;

        foreach ($attributes as $category => $attrs) {
            if (!is_array($attrs)) continue;

            foreach ($attrs as $attrName => $value) {
                $profile = $this->getAttributeProfile($attrName);
                if (!$profile) continue;

                $change = $this->calculateYearlyChange($attrName, $age);
                $newValue = max(25, min(99, $value + $change));
                $aged[$category][$attrName] = round($newValue, 1);
            }
        }

        return $aged;
    }

    /**
     * Calculate yearly attribute change based on age.
     */
    private function calculateYearlyChange(string $attribute, int $age): float
    {
        $profile = $this->getAttributeProfile($attribute);
        if (!$profile) return 0;

        $declineStart = $profile['decline_start'];
        $declineRate = $profile['decline_rate'];

        if ($age < $declineStart) {
            return 0; // No natural decline yet
        }

        return -$declineRate;
    }

    /**
     * Get attributes that will decline most for a given age.
     * Returns array of attribute names sorted by decline severity.
     */
    public function getMostVulnerableAttributes(int $age): array
    {
        $vulnerable = [];

        foreach ($this->config as $profile => $data) {
            $declineStart = $data['decline_start'];
            if ($age >= $declineStart) {
                $severity = ($age - $declineStart) * $data['decline_rate'];
                foreach ($data['attributes'] as $attr) {
                    $vulnerable[$attr] = $severity;
                }
            }
        }

        arsort($vulnerable);
        return array_keys($vulnerable);
    }

    /**
     * Apply injury impact to physical attributes.
     */
    public function applyInjuryImpact(array $attributes, int $impactPoints): array
    {
        $affected = $attributes;

        // Physical attributes are affected by injuries
        $physicalAttrs = $this->config['physical']['attributes'] ?? [];

        foreach ($physicalAttrs as $attr) {
            if (isset($affected['physical'][$attr])) {
                $reduction = $impactPoints * (0.8 + (mt_rand(0, 40) / 100)); // 80-120% of impact
                $affected['physical'][$attr] = max(25, $affected['physical'][$attr] - $reduction);
            }
        }

        return $affected;
    }

    /**
     * Check if an attribute is at its natural ceiling for the player's age.
     */
    public function isAtAgeCeiling(string $attribute, int $age, int $currentValue, int $potential): bool
    {
        $profile = $this->getAttributeProfile($attribute);
        if (!$profile) return false;

        $peakAge = $profile['peak_age'];

        // If past peak and not a "can improve" category, ceiling is current value
        if ($age > $peakAge && !($profile['can_improve_past_peak'] ?? false)) {
            return true;
        }

        // If at potential, at ceiling
        return $currentValue >= $potential;
    }
}
