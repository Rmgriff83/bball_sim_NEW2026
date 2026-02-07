<?php

namespace Database\Seeders;

use App\Models\BadgeDefinition;
use Illuminate\Database\Seeder;

class BadgeDefinitionSeeder extends Seeder
{
    public function run(): void
    {
        $badges = [
            // ═══════════════════════════════════════════════════════════
            // FINISHING BADGES
            // ═══════════════════════════════════════════════════════════
            [
                'id' => 'acrobat',
                'name' => 'Acrobat',
                'category' => 'finishing',
                'description' => 'Improves the ability to hit layups with difficult gathers and awkward body positions.',
                'effects' => [
                    'bronze' => ['contestedLayupBoost' => 0.03],
                    'silver' => ['contestedLayupBoost' => 0.06],
                    'gold' => ['contestedLayupBoost' => 0.10],
                    'hof' => ['contestedLayupBoost' => 0.15],
                ],
            ],
            [
                'id' => 'contact_finisher',
                'name' => 'Contact Finisher',
                'category' => 'finishing',
                'description' => 'Increases the ability to convert contact layups and dunks through defenders.',
                'effects' => [
                    'bronze' => ['contactFinishBoost' => 0.04],
                    'silver' => ['contactFinishBoost' => 0.08],
                    'gold' => ['contactFinishBoost' => 0.12],
                    'hof' => ['contactFinishBoost' => 0.18],
                ],
            ],
            [
                'id' => 'posterizer',
                'name' => 'Posterizer',
                'category' => 'finishing',
                'description' => 'Increases the chances of throwing down a powerful dunk on a defender.',
                'effects' => [
                    'bronze' => ['posterDunkBoost' => 0.05],
                    'silver' => ['posterDunkBoost' => 0.10],
                    'gold' => ['posterDunkBoost' => 0.15],
                    'hof' => ['posterDunkBoost' => 0.22],
                ],
            ],
            [
                'id' => 'slithery_finisher',
                'name' => 'Slithery Finisher',
                'category' => 'finishing',
                'description' => 'Improves the ability to avoid contact when finishing at the rim.',
                'effects' => [
                    'bronze' => ['avoidContactBoost' => 0.04],
                    'silver' => ['avoidContactBoost' => 0.08],
                    'gold' => ['avoidContactBoost' => 0.12],
                    'hof' => ['avoidContactBoost' => 0.18],
                ],
            ],
            [
                'id' => 'giant_slayer',
                'name' => 'Giant Slayer',
                'category' => 'finishing',
                'description' => 'Boosts shot percentage for layups when finishing at the rim against taller defenders.',
                'effects' => [
                    'bronze' => ['giantSlayerBoost' => 0.04],
                    'silver' => ['giantSlayerBoost' => 0.08],
                    'gold' => ['giantSlayerBoost' => 0.12],
                    'hof' => ['giantSlayerBoost' => 0.18],
                ],
            ],
            [
                'id' => 'pro_touch',
                'name' => 'Pro Touch',
                'category' => 'finishing',
                'description' => 'Boosts shot percentage for layups with good timing.',
                'effects' => [
                    'bronze' => ['layupTimingBoost' => 0.03],
                    'silver' => ['layupTimingBoost' => 0.06],
                    'gold' => ['layupTimingBoost' => 0.10],
                    'hof' => ['layupTimingBoost' => 0.15],
                ],
            ],
            [
                'id' => 'floater_specialist',
                'name' => 'Floater Specialist',
                'category' => 'finishing',
                'description' => 'Improves the ability to make floaters and runners in the lane.',
                'effects' => [
                    'bronze' => ['floaterBoost' => 0.04],
                    'silver' => ['floaterBoost' => 0.08],
                    'gold' => ['floaterBoost' => 0.13],
                    'hof' => ['floaterBoost' => 0.18],
                ],
            ],
            [
                'id' => 'putback_boss',
                'name' => 'Putback Boss',
                'category' => 'finishing',
                'description' => 'Improves the ability to score on putback attempts after offensive rebounds.',
                'effects' => [
                    'bronze' => ['putbackBoost' => 0.05],
                    'silver' => ['putbackBoost' => 0.10],
                    'gold' => ['putbackBoost' => 0.15],
                    'hof' => ['putbackBoost' => 0.22],
                ],
            ],

            // ═══════════════════════════════════════════════════════════
            // SHOOTING BADGES
            // ═══════════════════════════════════════════════════════════
            [
                'id' => 'catch_and_shoot',
                'name' => 'Catch and Shoot',
                'category' => 'shooting',
                'description' => 'Boosts shot percentage on catch-and-shoot jumpers.',
                'effects' => [
                    'bronze' => ['catchShootBoost' => 0.03],
                    'silver' => ['catchShootBoost' => 0.06],
                    'gold' => ['catchShootBoost' => 0.10],
                    'hof' => ['catchShootBoost' => 0.15],
                ],
            ],
            [
                'id' => 'corner_specialist',
                'name' => 'Corner Specialist',
                'category' => 'shooting',
                'description' => 'Improves shooting from the corner three-point range.',
                'effects' => [
                    'bronze' => ['cornerThreeBoost' => 0.04],
                    'silver' => ['cornerThreeBoost' => 0.08],
                    'gold' => ['cornerThreeBoost' => 0.12],
                    'hof' => ['cornerThreeBoost' => 0.18],
                ],
            ],
            [
                'id' => 'deadeye',
                'name' => 'Deadeye',
                'category' => 'shooting',
                'description' => 'Reduces the penalty for contested shots.',
                'effects' => [
                    'bronze' => ['contestReduction' => 0.08],
                    'silver' => ['contestReduction' => 0.15],
                    'gold' => ['contestReduction' => 0.22],
                    'hof' => ['contestReduction' => 0.30],
                ],
            ],
            [
                'id' => 'deep_threes',
                'name' => 'Deep Threes',
                'category' => 'shooting',
                'description' => 'Extends the range for three-point shots beyond the arc.',
                'effects' => [
                    'bronze' => ['deepRangeBoost' => 0.03],
                    'silver' => ['deepRangeBoost' => 0.06],
                    'gold' => ['deepRangeBoost' => 0.10],
                    'hof' => ['deepRangeBoost' => 0.15],
                ],
            ],
            [
                'id' => 'difficult_shots',
                'name' => 'Difficult Shots',
                'category' => 'shooting',
                'description' => 'Improves moving, off-balance, and fadeaway shots.',
                'effects' => [
                    'bronze' => ['movingShotBoost' => 0.03],
                    'silver' => ['movingShotBoost' => 0.06],
                    'gold' => ['movingShotBoost' => 0.10],
                    'hof' => ['movingShotBoost' => 0.15],
                ],
            ],
            [
                'id' => 'green_machine',
                'name' => 'Green Machine',
                'category' => 'shooting',
                'description' => 'Increases shot percentage after consecutive makes.',
                'effects' => [
                    'bronze' => ['hotHandBoost' => 0.02],
                    'silver' => ['hotHandBoost' => 0.04],
                    'gold' => ['hotHandBoost' => 0.07],
                    'hof' => ['hotHandBoost' => 0.10],
                ],
            ],
            [
                'id' => 'hot_zone_hunter',
                'name' => 'Hot Zone Hunter',
                'category' => 'shooting',
                'description' => 'Boosts shot percentage from favorite spots on the court.',
                'effects' => [
                    'bronze' => ['hotZoneBoost' => 0.04],
                    'silver' => ['hotZoneBoost' => 0.08],
                    'gold' => ['hotZoneBoost' => 0.12],
                    'hof' => ['hotZoneBoost' => 0.17],
                ],
            ],
            [
                'id' => 'clutch_shooter',
                'name' => 'Clutch Shooter',
                'category' => 'shooting',
                'description' => 'Boosts shot percentage in clutch moments late in games.',
                'effects' => [
                    'bronze' => ['clutchShotBoost' => 0.05],
                    'silver' => ['clutchShotBoost' => 0.10],
                    'gold' => ['clutchShotBoost' => 0.15],
                    'hof' => ['clutchShotBoost' => 0.22],
                ],
            ],
            [
                'id' => 'volume_shooter',
                'name' => 'Volume Shooter',
                'category' => 'shooting',
                'description' => 'Shot percentage improves as shot attempts increase.',
                'effects' => [
                    'bronze' => ['volumeBoost' => 0.02],
                    'silver' => ['volumeBoost' => 0.04],
                    'gold' => ['volumeBoost' => 0.06],
                    'hof' => ['volumeBoost' => 0.09],
                ],
            ],
            [
                'id' => 'tireless_shooter',
                'name' => 'Tireless Shooter',
                'category' => 'shooting',
                'description' => 'Reduces the fatigue penalty on shot accuracy.',
                'effects' => [
                    'bronze' => ['fatigueReduction' => 0.15],
                    'silver' => ['fatigueReduction' => 0.30],
                    'gold' => ['fatigueReduction' => 0.45],
                    'hof' => ['fatigueReduction' => 0.60],
                ],
            ],

            // ═══════════════════════════════════════════════════════════
            // PLAYMAKING BADGES
            // ═══════════════════════════════════════════════════════════
            [
                'id' => 'ankle_breaker',
                'name' => 'Ankle Breaker',
                'category' => 'playmaking',
                'description' => 'Increases the likelihood of freezing defenders with dribble moves.',
                'effects' => [
                    'bronze' => ['crossoverBoost' => 0.05],
                    'silver' => ['crossoverBoost' => 0.10],
                    'gold' => ['crossoverBoost' => 0.15],
                    'hof' => ['crossoverBoost' => 0.22],
                ],
            ],
            [
                'id' => 'bail_out',
                'name' => 'Bail Out',
                'category' => 'playmaking',
                'description' => 'Improves the ability to throw accurate passes while in the air.',
                'effects' => [
                    'bronze' => ['bailOutPassBoost' => 0.10],
                    'silver' => ['bailOutPassBoost' => 0.20],
                    'gold' => ['bailOutPassBoost' => 0.30],
                    'hof' => ['bailOutPassBoost' => 0.45],
                ],
            ],
            [
                'id' => 'break_starter',
                'name' => 'Break Starter',
                'category' => 'playmaking',
                'description' => 'Improves full-court outlet passes after a rebound.',
                'effects' => [
                    'bronze' => ['outletPassBoost' => 0.08],
                    'silver' => ['outletPassBoost' => 0.15],
                    'gold' => ['outletPassBoost' => 0.22],
                    'hof' => ['outletPassBoost' => 0.30],
                ],
            ],
            [
                'id' => 'dimer',
                'name' => 'Dimer',
                'category' => 'playmaking',
                'description' => 'Boosts the shot percentage of teammates on passes.',
                'effects' => [
                    'bronze' => ['assistBoost' => 0.03],
                    'silver' => ['assistBoost' => 0.06],
                    'gold' => ['assistBoost' => 0.10],
                    'hof' => ['assistBoost' => 0.15],
                ],
            ],
            [
                'id' => 'floor_general',
                'name' => 'Floor General',
                'category' => 'playmaking',
                'description' => 'Boosts the offensive attributes of teammates when on the court.',
                'effects' => [
                    'bronze' => ['teamOffenseBoost' => 1],
                    'silver' => ['teamOffenseBoost' => 2],
                    'gold' => ['teamOffenseBoost' => 3],
                    'hof' => ['teamOffenseBoost' => 4],
                ],
            ],
            [
                'id' => 'handles_for_days',
                'name' => 'Handles for Days',
                'category' => 'playmaking',
                'description' => 'Reduces energy cost of dribble moves.',
                'effects' => [
                    'bronze' => ['dribbleStaminaReduction' => 0.15],
                    'silver' => ['dribbleStaminaReduction' => 0.30],
                    'gold' => ['dribbleStaminaReduction' => 0.45],
                    'hof' => ['dribbleStaminaReduction' => 0.60],
                ],
            ],
            [
                'id' => 'lob_city_passer',
                'name' => 'Lob City Passer',
                'category' => 'playmaking',
                'description' => 'Improves the ability to throw and convert alley-oop passes.',
                'effects' => [
                    'bronze' => ['lobPassBoost' => 0.08],
                    'silver' => ['lobPassBoost' => 0.15],
                    'gold' => ['lobPassBoost' => 0.22],
                    'hof' => ['lobPassBoost' => 0.30],
                ],
            ],
            [
                'id' => 'needle_threader',
                'name' => 'Needle Threader',
                'category' => 'playmaking',
                'description' => 'Improves the ability to complete difficult passes through traffic.',
                'effects' => [
                    'bronze' => ['tightPassBoost' => 0.08],
                    'silver' => ['tightPassBoost' => 0.15],
                    'gold' => ['tightPassBoost' => 0.22],
                    'hof' => ['tightPassBoost' => 0.30],
                ],
            ],
            [
                'id' => 'pick_and_roll_maestro',
                'name' => 'Pick and Roll Maestro',
                'category' => 'playmaking',
                'description' => 'Improves the ability to make the right read in pick and roll situations.',
                'effects' => [
                    'bronze' => ['pnrHandlerBoost' => 0.05],
                    'silver' => ['pnrHandlerBoost' => 0.10],
                    'gold' => ['pnrHandlerBoost' => 0.15],
                    'hof' => ['pnrHandlerBoost' => 0.22],
                ],
            ],
            [
                'id' => 'quick_first_step',
                'name' => 'Quick First Step',
                'category' => 'playmaking',
                'description' => 'Improves the ability to blow by defenders with the first dribble.',
                'effects' => [
                    'bronze' => ['firstStepBoost' => 0.04],
                    'silver' => ['firstStepBoost' => 0.08],
                    'gold' => ['firstStepBoost' => 0.12],
                    'hof' => ['firstStepBoost' => 0.18],
                ],
            ],
            [
                'id' => 'space_creator',
                'name' => 'Space Creator',
                'category' => 'playmaking',
                'description' => 'Improves ability to create space with step-backs and hesitations.',
                'effects' => [
                    'bronze' => ['separationBoost' => 0.04],
                    'silver' => ['separationBoost' => 0.08],
                    'gold' => ['separationBoost' => 0.12],
                    'hof' => ['separationBoost' => 0.18],
                ],
            ],
            [
                'id' => 'tight_handles',
                'name' => 'Tight Handles',
                'category' => 'playmaking',
                'description' => 'Reduces the chance of getting stripped while dribbling.',
                'effects' => [
                    'bronze' => ['ballSecurityBoost' => 0.08],
                    'silver' => ['ballSecurityBoost' => 0.15],
                    'gold' => ['ballSecurityBoost' => 0.22],
                    'hof' => ['ballSecurityBoost' => 0.30],
                ],
            ],

            // ═══════════════════════════════════════════════════════════
            // DEFENSE BADGES
            // ═══════════════════════════════════════════════════════════
            [
                'id' => 'clamps',
                'name' => 'Clamps',
                'category' => 'defense',
                'description' => 'Improves ability to stay in front of ball handlers on the perimeter.',
                'effects' => [
                    'bronze' => ['perimeterDefBoost' => 0.04],
                    'silver' => ['perimeterDefBoost' => 0.08],
                    'gold' => ['perimeterDefBoost' => 0.12],
                    'hof' => ['perimeterDefBoost' => 0.18],
                ],
            ],
            [
                'id' => 'chase_down_artist',
                'name' => 'Chase Down Artist',
                'category' => 'defense',
                'description' => 'Improves ability to block shots from behind on fast breaks.',
                'effects' => [
                    'bronze' => ['chaseDownBlockBoost' => 0.10],
                    'silver' => ['chaseDownBlockBoost' => 0.20],
                    'gold' => ['chaseDownBlockBoost' => 0.30],
                    'hof' => ['chaseDownBlockBoost' => 0.45],
                ],
            ],
            [
                'id' => 'heart_crusher',
                'name' => 'Heart Crusher',
                'category' => 'defense',
                'description' => 'Blocks and steals have a demoralizing effect on opponents.',
                'effects' => [
                    'bronze' => ['moraleImpact' => 0.02],
                    'silver' => ['moraleImpact' => 0.04],
                    'gold' => ['moraleImpact' => 0.06],
                    'hof' => ['moraleImpact' => 0.10],
                ],
            ],
            [
                'id' => 'interceptor',
                'name' => 'Interceptor',
                'category' => 'defense',
                'description' => 'Improves ability to intercept passes in the passing lane.',
                'effects' => [
                    'bronze' => ['stealChanceBoost' => 0.05],
                    'silver' => ['stealChanceBoost' => 0.10],
                    'gold' => ['stealChanceBoost' => 0.15],
                    'hof' => ['stealChanceBoost' => 0.22],
                ],
            ],
            [
                'id' => 'intimidator',
                'name' => 'Intimidator',
                'category' => 'defense',
                'description' => 'Reduces the shot percentage of opponents in close proximity.',
                'effects' => [
                    'bronze' => ['contestBoost' => 0.04],
                    'silver' => ['contestBoost' => 0.08],
                    'gold' => ['contestBoost' => 0.12],
                    'hof' => ['contestBoost' => 0.18],
                ],
            ],
            [
                'id' => 'pick_dodger',
                'name' => 'Pick Dodger',
                'category' => 'defense',
                'description' => 'Improves ability to navigate around and through screens.',
                'effects' => [
                    'bronze' => ['screenNavBoost' => 0.08],
                    'silver' => ['screenNavBoost' => 0.15],
                    'gold' => ['screenNavBoost' => 0.22],
                    'hof' => ['screenNavBoost' => 0.30],
                ],
            ],
            [
                'id' => 'pick_pocket',
                'name' => 'Pick Pocket',
                'category' => 'defense',
                'description' => 'Improves ability to strip the ball from handlers.',
                'effects' => [
                    'bronze' => ['onBallStealBoost' => 0.05],
                    'silver' => ['onBallStealBoost' => 0.10],
                    'gold' => ['onBallStealBoost' => 0.15],
                    'hof' => ['onBallStealBoost' => 0.22],
                ],
            ],
            [
                'id' => 'pogo_stick',
                'name' => 'Pogo Stick',
                'category' => 'defense',
                'description' => 'Allows for quicker recovery for a block attempt after jumping.',
                'effects' => [
                    'bronze' => ['blockRecoveryBoost' => 0.10],
                    'silver' => ['blockRecoveryBoost' => 0.20],
                    'gold' => ['blockRecoveryBoost' => 0.30],
                    'hof' => ['blockRecoveryBoost' => 0.45],
                ],
            ],
            [
                'id' => 'post_lockdown',
                'name' => 'Post Lockdown',
                'category' => 'defense',
                'description' => 'Improves ability to defend post moves.',
                'effects' => [
                    'bronze' => ['postDefBoost' => 0.05],
                    'silver' => ['postDefBoost' => 0.10],
                    'gold' => ['postDefBoost' => 0.15],
                    'hof' => ['postDefBoost' => 0.22],
                ],
            ],
            [
                'id' => 'rebound_chaser',
                'name' => 'Rebound Chaser',
                'category' => 'defense',
                'description' => 'Improves ability to track down rebounds from farther away.',
                'effects' => [
                    'bronze' => ['reboundRangeBoost' => 0.05],
                    'silver' => ['reboundRangeBoost' => 0.10],
                    'gold' => ['reboundRangeBoost' => 0.15],
                    'hof' => ['reboundRangeBoost' => 0.22],
                ],
            ],
            [
                'id' => 'rim_protector',
                'name' => 'Rim Protector',
                'category' => 'defense',
                'description' => 'Improves ability to block shots at the rim.',
                'effects' => [
                    'bronze' => ['rimProtectionBoost' => 0.05],
                    'silver' => ['rimProtectionBoost' => 0.10],
                    'gold' => ['rimProtectionBoost' => 0.15],
                    'hof' => ['rimProtectionBoost' => 0.22],
                ],
            ],
            [
                'id' => 'defensive_leader',
                'name' => 'Defensive Leader',
                'category' => 'defense',
                'description' => 'Boosts the defensive attributes of teammates when on the court.',
                'effects' => [
                    'bronze' => ['teamDefenseBoost' => 1],
                    'silver' => ['teamDefenseBoost' => 2],
                    'gold' => ['teamDefenseBoost' => 3],
                    'hof' => ['teamDefenseBoost' => 4],
                ],
            ],
            [
                'id' => 'worm',
                'name' => 'Worm',
                'category' => 'defense',
                'description' => 'Improves ability to swim around opponents for rebounds.',
                'effects' => [
                    'bronze' => ['boxOutEscapeBoost' => 0.08],
                    'silver' => ['boxOutEscapeBoost' => 0.15],
                    'gold' => ['boxOutEscapeBoost' => 0.22],
                    'hof' => ['boxOutEscapeBoost' => 0.30],
                ],
            ],

            // ═══════════════════════════════════════════════════════════
            // PHYSICAL BADGES
            // ═══════════════════════════════════════════════════════════
            [
                'id' => 'brick_wall',
                'name' => 'Brick Wall',
                'category' => 'physical',
                'description' => 'Improves the effectiveness of screens and drains energy from defenders.',
                'effects' => [
                    'bronze' => ['screenEffectBoost' => 0.08],
                    'silver' => ['screenEffectBoost' => 0.15],
                    'gold' => ['screenEffectBoost' => 0.22],
                    'hof' => ['screenEffectBoost' => 0.30],
                ],
            ],
            [
                'id' => 'box',
                'name' => 'Box',
                'category' => 'physical',
                'description' => 'Improves the ability to box out opponents for rebounds.',
                'effects' => [
                    'bronze' => ['boxOutBoost' => 0.05],
                    'silver' => ['boxOutBoost' => 0.10],
                    'gold' => ['boxOutBoost' => 0.15],
                    'hof' => ['boxOutBoost' => 0.22],
                ],
            ],
            [
                'id' => 'lob_city_finisher',
                'name' => 'Lob City Finisher',
                'category' => 'physical',
                'description' => 'Improves the ability to finish alley-oop dunks.',
                'effects' => [
                    'bronze' => ['alleyOopFinishBoost' => 0.08],
                    'silver' => ['alleyOopFinishBoost' => 0.15],
                    'gold' => ['alleyOopFinishBoost' => 0.22],
                    'hof' => ['alleyOopFinishBoost' => 0.30],
                ],
            ],
            [
                'id' => 'downhill',
                'name' => 'Downhill',
                'category' => 'physical',
                'description' => 'Increases speed with ball in transition.',
                'effects' => [
                    'bronze' => ['transitionSpeedBoost' => 0.03],
                    'silver' => ['transitionSpeedBoost' => 0.06],
                    'gold' => ['transitionSpeedBoost' => 0.10],
                    'hof' => ['transitionSpeedBoost' => 0.15],
                ],
            ],
            [
                'id' => 'tireless_defender',
                'name' => 'Tireless Defender',
                'category' => 'physical',
                'description' => 'Reduces energy lost when playing on-ball defense.',
                'effects' => [
                    'bronze' => ['defenseStaminaReduction' => 0.15],
                    'silver' => ['defenseStaminaReduction' => 0.30],
                    'gold' => ['defenseStaminaReduction' => 0.45],
                    'hof' => ['defenseStaminaReduction' => 0.60],
                ],
            ],

            // ═══════════════════════════════════════════════════════════
            // NEW BADGES FROM CSV (2K25 Style)
            // ═══════════════════════════════════════════════════════════

            // SHOOTING - New badges
            [
                'id' => 'limitless_range',
                'name' => 'Limitless Range',
                'category' => 'shooting',
                'description' => 'Extends the range from which a player can shoot three-pointers effectively.',
                'effects' => [
                    'bronze' => ['deepRangeBoost' => 0.05],
                    'silver' => ['deepRangeBoost' => 0.10],
                    'gold' => ['deepRangeBoost' => 0.15],
                    'hof' => ['deepRangeBoost' => 0.22],
                ],
            ],
            [
                'id' => 'mini_marksman',
                'name' => 'Mini Marksman',
                'category' => 'shooting',
                'description' => 'Improves shooting ability for smaller players against taller defenders.',
                'effects' => [
                    'bronze' => ['smallShooterBoost' => 0.04],
                    'silver' => ['smallShooterBoost' => 0.08],
                    'gold' => ['smallShooterBoost' => 0.12],
                    'hof' => ['smallShooterBoost' => 0.18],
                ],
            ],
            [
                'id' => 'set_shot_specialist',
                'name' => 'Set Shot Specialist',
                'category' => 'shooting',
                'description' => 'Boosts shot percentage on set shots with no dribble moves.',
                'effects' => [
                    'bronze' => ['setShotBoost' => 0.04],
                    'silver' => ['setShotBoost' => 0.08],
                    'gold' => ['setShotBoost' => 0.12],
                    'hof' => ['setShotBoost' => 0.18],
                ],
            ],
            [
                'id' => 'shifty_shooter',
                'name' => 'Shifty Shooter',
                'category' => 'shooting',
                'description' => 'Improves shooting off dribble moves and step-backs.',
                'effects' => [
                    'bronze' => ['offDribbleBoost' => 0.04],
                    'silver' => ['offDribbleBoost' => 0.08],
                    'gold' => ['offDribbleBoost' => 0.12],
                    'hof' => ['offDribbleBoost' => 0.18],
                ],
            ],

            // FINISHING - New badges
            [
                'id' => 'aerial_wizard',
                'name' => 'Aerial Wizard',
                'category' => 'finishing',
                'description' => 'Improves ability to finish difficult aerial layups and dunks.',
                'effects' => [
                    'bronze' => ['aerialFinishBoost' => 0.05],
                    'silver' => ['aerialFinishBoost' => 0.10],
                    'gold' => ['aerialFinishBoost' => 0.15],
                    'hof' => ['aerialFinishBoost' => 0.22],
                ],
            ],
            [
                'id' => 'float_game',
                'name' => 'Float Game',
                'category' => 'finishing',
                'description' => 'Enhances ability to score with floaters in the lane.',
                'effects' => [
                    'bronze' => ['floaterBoost' => 0.05],
                    'silver' => ['floaterBoost' => 0.10],
                    'gold' => ['floaterBoost' => 0.15],
                    'hof' => ['floaterBoost' => 0.22],
                ],
            ],
            [
                'id' => 'hook_specialist',
                'name' => 'Hook Specialist',
                'category' => 'finishing',
                'description' => 'Improves ability to score with hook shots in the post.',
                'effects' => [
                    'bronze' => ['hookShotBoost' => 0.05],
                    'silver' => ['hookShotBoost' => 0.10],
                    'gold' => ['hookShotBoost' => 0.15],
                    'hof' => ['hookShotBoost' => 0.22],
                ],
            ],
            [
                'id' => 'layup_mixmaster',
                'name' => 'Layup Mixmaster',
                'category' => 'finishing',
                'description' => 'Improves ability to finish with creative layup packages.',
                'effects' => [
                    'bronze' => ['creativeLayupBoost' => 0.04],
                    'silver' => ['creativeLayupBoost' => 0.08],
                    'gold' => ['creativeLayupBoost' => 0.12],
                    'hof' => ['creativeLayupBoost' => 0.18],
                ],
            ],
            [
                'id' => 'paint_prodigy',
                'name' => 'Paint Prodigy',
                'category' => 'finishing',
                'description' => 'Enhances scoring ability in the paint area.',
                'effects' => [
                    'bronze' => ['paintScoringBoost' => 0.04],
                    'silver' => ['paintScoringBoost' => 0.08],
                    'gold' => ['paintScoringBoost' => 0.12],
                    'hof' => ['paintScoringBoost' => 0.18],
                ],
            ],
            [
                'id' => 'physical_finisher',
                'name' => 'Physical Finisher',
                'category' => 'finishing',
                'description' => 'Improves ability to finish through contact at the rim.',
                'effects' => [
                    'bronze' => ['contactFinishBoost' => 0.05],
                    'silver' => ['contactFinishBoost' => 0.10],
                    'gold' => ['contactFinishBoost' => 0.15],
                    'hof' => ['contactFinishBoost' => 0.22],
                ],
            ],
            [
                'id' => 'post_fade_phenom',
                'name' => 'Post Fade Phenom',
                'category' => 'finishing',
                'description' => 'Improves ability to hit fadeaway shots from the post.',
                'effects' => [
                    'bronze' => ['postFadeBoost' => 0.05],
                    'silver' => ['postFadeBoost' => 0.10],
                    'gold' => ['postFadeBoost' => 0.15],
                    'hof' => ['postFadeBoost' => 0.22],
                ],
            ],
            [
                'id' => 'post_powerhouse',
                'name' => 'Post Powerhouse',
                'category' => 'finishing',
                'description' => 'Enhances ability to overpower defenders in the post.',
                'effects' => [
                    'bronze' => ['postStrengthBoost' => 0.05],
                    'silver' => ['postStrengthBoost' => 0.10],
                    'gold' => ['postStrengthBoost' => 0.15],
                    'hof' => ['postStrengthBoost' => 0.22],
                ],
            ],
            [
                'id' => 'post_up_poet',
                'name' => 'Post Up Poet',
                'category' => 'finishing',
                'description' => 'Improves overall post move effectiveness and footwork.',
                'effects' => [
                    'bronze' => ['postMoveBoost' => 0.04],
                    'silver' => ['postMoveBoost' => 0.08],
                    'gold' => ['postMoveBoost' => 0.12],
                    'hof' => ['postMoveBoost' => 0.18],
                ],
            ],
            [
                'id' => 'rise_up',
                'name' => 'Rise Up',
                'category' => 'finishing',
                'description' => 'Improves ability to rise up for dunks in traffic.',
                'effects' => [
                    'bronze' => ['riseUpDunkBoost' => 0.05],
                    'silver' => ['riseUpDunkBoost' => 0.10],
                    'gold' => ['riseUpDunkBoost' => 0.15],
                    'hof' => ['riseUpDunkBoost' => 0.22],
                ],
            ],

            // PLAYMAKING - New badges
            [
                'id' => 'ankle_assassin',
                'name' => 'Ankle Assassin',
                'category' => 'playmaking',
                'description' => 'Increases effectiveness of dribble moves to create separation.',
                'effects' => [
                    'bronze' => ['ankleBreakChance' => 0.05],
                    'silver' => ['ankleBreakChance' => 0.10],
                    'gold' => ['ankleBreakChance' => 0.15],
                    'hof' => ['ankleBreakChance' => 0.22],
                ],
            ],
            [
                'id' => 'lightning_launch',
                'name' => 'Lightning Launch',
                'category' => 'playmaking',
                'description' => 'Improves speed of passes to open shooters.',
                'effects' => [
                    'bronze' => ['passSpeedBoost' => 0.05],
                    'silver' => ['passSpeedBoost' => 0.10],
                    'gold' => ['passSpeedBoost' => 0.15],
                    'hof' => ['passSpeedBoost' => 0.22],
                ],
            ],
            [
                'id' => 'strong_handle',
                'name' => 'Strong Handle',
                'category' => 'playmaking',
                'description' => 'Reduces chance of losing the ball when pressured.',
                'effects' => [
                    'bronze' => ['ballSecurityBoost' => 0.05],
                    'silver' => ['ballSecurityBoost' => 0.10],
                    'gold' => ['ballSecurityBoost' => 0.15],
                    'hof' => ['ballSecurityBoost' => 0.22],
                ],
            ],
            [
                'id' => 'unpluckable',
                'name' => 'Unpluckable',
                'category' => 'playmaking',
                'description' => 'Protects the ball from being stripped by defenders.',
                'effects' => [
                    'bronze' => ['stripResistance' => 0.08],
                    'silver' => ['stripResistance' => 0.15],
                    'gold' => ['stripResistance' => 0.22],
                    'hof' => ['stripResistance' => 0.30],
                ],
            ],
            [
                'id' => 'versatile_visionary',
                'name' => 'Versatile Visionary',
                'category' => 'playmaking',
                'description' => 'Improves ability to make creative passes from any position.',
                'effects' => [
                    'bronze' => ['visionBoost' => 0.04],
                    'silver' => ['visionBoost' => 0.08],
                    'gold' => ['visionBoost' => 0.12],
                    'hof' => ['visionBoost' => 0.18],
                ],
            ],

            // DEFENSE - New badges
            [
                'id' => 'challenger',
                'name' => 'Challenger',
                'category' => 'defense',
                'description' => 'Improves ability to contest shots without fouling.',
                'effects' => [
                    'bronze' => ['contestBoost' => 0.04],
                    'silver' => ['contestBoost' => 0.08],
                    'gold' => ['contestBoost' => 0.12],
                    'hof' => ['contestBoost' => 0.18],
                ],
            ],
            [
                'id' => 'glove',
                'name' => 'Glove',
                'category' => 'defense',
                'description' => 'Enhances on-ball defense and ability to stay attached to ball handlers.',
                'effects' => [
                    'bronze' => ['onBallDefBoost' => 0.05],
                    'silver' => ['onBallDefBoost' => 0.10],
                    'gold' => ['onBallDefBoost' => 0.15],
                    'hof' => ['onBallDefBoost' => 0.22],
                ],
            ],
            [
                'id' => 'high_flying_denier',
                'name' => 'High Flying Denier',
                'category' => 'defense',
                'description' => 'Improves ability to block aerial attacks and alley-oops.',
                'effects' => [
                    'bronze' => ['aerialBlockBoost' => 0.08],
                    'silver' => ['aerialBlockBoost' => 0.15],
                    'gold' => ['aerialBlockBoost' => 0.22],
                    'hof' => ['aerialBlockBoost' => 0.30],
                ],
            ],
            [
                'id' => 'immovable_enforcer',
                'name' => 'Immovable Enforcer',
                'category' => 'defense',
                'description' => 'Makes it harder for offensive players to back you down.',
                'effects' => [
                    'bronze' => ['postDefStrength' => 0.05],
                    'silver' => ['postDefStrength' => 0.10],
                    'gold' => ['postDefStrength' => 0.15],
                    'hof' => ['postDefStrength' => 0.22],
                ],
            ],
            [
                'id' => 'off_ball_pest',
                'name' => 'Off Ball Pest',
                'category' => 'defense',
                'description' => 'Improves ability to deny and disrupt off-ball movement.',
                'effects' => [
                    'bronze' => ['offBallDefBoost' => 0.04],
                    'silver' => ['offBallDefBoost' => 0.08],
                    'gold' => ['offBallDefBoost' => 0.12],
                    'hof' => ['offBallDefBoost' => 0.18],
                ],
            ],
            [
                'id' => 'on_ball_menace',
                'name' => 'On Ball Menace',
                'category' => 'defense',
                'description' => 'Enhances pressure on ball handlers and disrupts their rhythm.',
                'effects' => [
                    'bronze' => ['pressureBoost' => 0.05],
                    'silver' => ['pressureBoost' => 0.10],
                    'gold' => ['pressureBoost' => 0.15],
                    'hof' => ['pressureBoost' => 0.22],
                ],
            ],
            [
                'id' => 'paint_patroller',
                'name' => 'Paint Patroller',
                'category' => 'defense',
                'description' => 'Improves help defense and rim protection in the paint.',
                'effects' => [
                    'bronze' => ['paintDefBoost' => 0.04],
                    'silver' => ['paintDefBoost' => 0.08],
                    'gold' => ['paintDefBoost' => 0.12],
                    'hof' => ['paintDefBoost' => 0.18],
                ],
            ],
            [
                'id' => 'boxout_beast',
                'name' => 'Boxout Beast',
                'category' => 'defense',
                'description' => 'Significantly improves ability to box out for rebounds.',
                'effects' => [
                    'bronze' => ['boxOutBoost' => 0.08],
                    'silver' => ['boxOutBoost' => 0.15],
                    'gold' => ['boxOutBoost' => 0.22],
                    'hof' => ['boxOutBoost' => 0.30],
                ],
            ],

            // PHYSICAL - New badges
            [
                'id' => 'slippery_off_ball',
                'name' => 'Slippery Off Ball',
                'category' => 'physical',
                'description' => 'Improves ability to get open by navigating through traffic off ball.',
                'effects' => [
                    'bronze' => ['offBallMovementBoost' => 0.05],
                    'silver' => ['offBallMovementBoost' => 0.10],
                    'gold' => ['offBallMovementBoost' => 0.15],
                    'hof' => ['offBallMovementBoost' => 0.22],
                ],
            ],
        ];

        foreach ($badges as $badge) {
            BadgeDefinition::updateOrCreate(
                ['id' => $badge['id']],
                [
                    'name' => $badge['name'],
                    'category' => $badge['category'],
                    'description' => $badge['description'],
                    'effects' => $badge['effects'],
                ]
            );
        }
    }
}
