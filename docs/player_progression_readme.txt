================================================================================
                    BASKETBALL SIM - PLAYER PROGRESSION SYSTEM
================================================================================

OVERVIEW
--------
The player progression system manages player development, regression, injuries,
fatigue, morale, and streaks throughout the season and career.


================================================================================
                              WHEN PROGRESSION HAPPENS
================================================================================

1. AFTER EVERY GAME (processPostGameFromData)
   - Updates FATIGUE based on minutes played
   - Checks for INJURIES (0.1% base chance, modified by fatigue/minutes)
   - Updates MORALE based on win/loss and individual performance
   - Applies MICRO-DEVELOPMENT - small attribute gains/losses based on performance

2. WEEKLY UPDATES (processWeeklyUpdates)
   - Processes INJURY RECOVERY (counts down games remaining)
   - Natural FATIGUE RECOVERY (15 points per week)
   - Updates morale based on team record
   - Detects HOT/COLD STREAKS (3+ games above/below threshold)
   - Recalculates overall rating

3. MONTHLY UPDATES (processMonthlyDevelopment)
   - Main development checkpoint
   - Factors affecting development:
     * Age bracket (younger = faster development)
     * Work ethic attribute
     * Playing time (more minutes = more development)
     * Mentor presence (veteran teammates with mentor trait)
     * Badge synergies with teammates
     * Morale level
   - Applies REGRESSION for older players (starts at age 32)
   - Generates news for significant rating changes (+3 or more / -2 or more)

4. OFFSEASON (processOffseason)
   - Heals all injuries
   - Resets fatigue
   - Applies seasonal aging to attributes
   - Checks for RETIREMENT (starts at age 35)
   - Resets season stats
   - Decrements contract years


================================================================================
                              AGE BRACKETS
================================================================================

  Bracket    Age Range    Development    Regression
  -------    ---------    -----------    ----------
  Youth      19-23        1.5x           0.0x
  Rising     24-26        1.0x           0.0x
  Prime      27-31        0.3x           0.1x
  Decline    32-35        0.0x           0.5x
  Veteran    36+          0.0x           1.0x


================================================================================
                          ATTRIBUTE-SPECIFIC AGING
================================================================================

Different attributes peak and decline at different ages:

  Category        Peak Age    Decline Starts    Decline Rate    Can Improve Past Peak?
  --------        --------    --------------    ------------    ----------------------
  Physical        26          29                0.8/year        No
  (speed, acceleration, vertical, stamina)

  Strength        30          33                0.4/year        No

  Shooting        29          34                0.3/year        Yes
  (3pt, midRange, freeThrow, closeShot)

  Mental          32          37                0.2/year        Yes
  (basketballIQ, clutch, consistency, intangibles)

  Skill           28          33                0.4/year        Yes
  (ballHandling, passAccuracy, passVision, postControl, layup)

  Finishing       27          31                0.5/year        No
  (standingDunk, drivingDunk, drawFoul)

  Defense         28          32                0.4/year        Yes
  (perimeterDefense, interiorDefense, steal, block)

  Rebounding      29          33                0.3/year        Yes


================================================================================
                          MICRO-DEVELOPMENT (Per Game)
================================================================================

Performance Rating Formula:
  (Points + Rebounds + Assists*1.5 + Steals*2 + Blocks*2 - Turnovers) / Minutes * 10

Development Thresholds:
  - HIGH PERFORMANCE (rating >= 20): Gain 0.1-0.3 points to relevant attributes
  - POOR PERFORMANCE (rating <= 8 with 15+ mins): Lose 0.1-0.2 points

Attribute Gains Based on Stats:
  - 20+ points with 3+ threes -> +threePoint
  - 20+ points without threes -> +midRange, +layup
  - 6+ assists -> +passAccuracy
  - 8+ rebounds -> +defensiveRebound, +offensiveRebound
  - 2+ steals -> +steal
  - 2+ blocks -> +block


================================================================================
                              INJURY SYSTEM
================================================================================

Base Injury Chance: 0.1% per game (modified by fatigue and minutes)

Injury Types:
  MINOR (60% of injuries)
    Duration: 1-5 games
    Examples: Sprained ankle, bruised knee, sore back, finger sprain

  MODERATE (30% of injuries)
    Duration: 6-20 games
    Examples: Hamstring strain, groin injury, calf strain, shoulder sprain

  SEVERE (8% of injuries)
    Duration: 21-60 games
    Permanent Impact: -1 to physical attributes
    Examples: Torn meniscus, broken hand, stress fracture, concussion

  SEASON-ENDING (2% of injuries)
    Duration: 61-82 games
    Permanent Impact: -3 to physical attributes
    Examples: ACL tear, Achilles rupture, broken leg


================================================================================
                              FATIGUE SYSTEM
================================================================================

  - Fatigue gained: 0.5 per minute played
  - Maximum fatigue: 100
  - Weekly recovery: 15 points
  - Rest day recovery: 25 points
  - Performance penalty starts: 50 fatigue
  - Maximum performance penalty: 15%

ROOKIE WALL:
  - After 50 games in first season
  - 50% more fatigue gain
  - Lasts for 20 games


================================================================================
                              MORALE SYSTEM
================================================================================

Starting Morale: 80 (range 0-100)
Trade Request Threshold: 25

Factors:
  +1  Win
  -1  Loss
  +2  Winning streak bonus (3+ games)
  -2  Losing streak penalty
  +1  Playing time expectations met
  -3  Playing time unmet
  +2  Playing time exceeded
  -5  Final contract year
  +10 Extension offered

Effects by Level:
  HIGH (80+):    +5% development, +2% performance
  NORMAL (50+):  No modifier
  LOW (25+):     -5% development, -2% performance
  CRITICAL (<25): -10% development, -5% performance


================================================================================
                              STREAK SYSTEM
================================================================================

HOT STREAK:
  - Trigger: 3+ games with performance rating >= 25
  - Bonus: +2 to relevant attributes during streak
  - Max length: 10 games

COLD STREAK:
  - Trigger: 3+ games with performance rating <= 10
  - Penalty: -2 to relevant attributes during streak
  - Max length: 10 games


================================================================================
                              PERSONALITY TRAITS
================================================================================

COMPETITOR:    +10% development, +5 clutch, +5% playoff performance
LEADER:        +5 chemistry, +5% team development, +30% morale stability
MENTOR:        +15% boost to young players (age <= 24), -5% own development
HOT_HEAD:      2x morale volatility, 2% tech foul chance
BALL_HOG:      +10% usage, -3 chemistry, -10% assists
TEAM_PLAYER:   +3 chemistry, +10% assists, +50% morale stability
JOKER:         +2 chemistry, +5% morale boost
QUIET:         +70% morale stability
MEDIA_DARLING: +5% contract value, -2% under pressure


================================================================================
                          BADGE SYNERGY BONUSES
================================================================================

  - Development boost per synergy: +5%
  - HOF badge synergy boost: +8%
  - Maximum development boost: +15%
  - In-game performance boost: +3%
  - Chemistry contribution: +2 per synergy


================================================================================
                              RETIREMENT
================================================================================

  - Minimum age: 35
  - Base chance at 35: 10%
  - Additional chance per year over 35: +10%
  - Low rating bonus (<65 overall): +15%
  - Injury history factor: +5% per major injury


================================================================================
                          OVERALL RATING WEIGHTS
================================================================================

  Offense:  40%
  Defense:  25%
  Physical: 20%
  Mental:   15%


================================================================================
                          EVOLUTION DATA IN API RESPONSE
================================================================================

After each game, the API returns an 'evolution' object containing:

{
  "home": {
    "injuries": [{ player_id, name, injury_type, games_out, severity }],
    "development": [{ player_id, name, performance_rating, attributes_improved }],
    "regression": [{ player_id, name, performance_rating, attributes_declined }],
    "fatigue_warnings": [{ player_id, name, fatigue }],
    "morale_changes": [{ player_id, name, change, new_morale }],
    "hot_streaks": [{ player_id, name, games }],
    "cold_streaks": [{ player_id, name, games }]
  },
  "away": { ... same structure ... }
}

Empty arrays are filtered out for cleaner responses.


================================================================================
                              DEVELOPMENT FORMULA
================================================================================

Monthly Development Points =
  (potential - current) * base_rate * age_multiplier / 12
  + work_ethic_bonus (based on work ethic attribute)
  + playing_time_bonus (based on avg minutes per game)
  + mentor_bonus (if veteran mentor on team)
  + badge_synergy_bonus (from teammate badge synergies)
  * (1 + morale_modifier)

Maximum season gain: +5 overall
Maximum season loss: -4 overall


================================================================================
