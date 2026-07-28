// Rebuilds the camelCase mirrors of a player's snake_case fields. The sync
// push strips camelCase duplicates to halve the wire payload
// (sync.js PLAYER_DROP_KEYS), so any player that round-trips through the
// cloud — a pull, or a community roster-build import — comes back
// snake_case-only and must be re-hydrated before UI code that reads
// camelCase (e.g. TradeProposalModal's firstName/contractSalary) sees it.
// Pure and non-destructive: existing camelCase values are never overwritten.
export function hydratePlayerKeys(player) {
  const p = { ...player }

  // Identity
  if (p.first_name && !p.firstName) p.firstName = p.first_name
  if (p.last_name && !p.lastName) p.lastName = p.last_name
  if (p.secondary_position !== undefined && !p.secondaryPosition) p.secondaryPosition = p.secondary_position
  if (p.jersey_number !== undefined && !p.jerseyNumber) p.jerseyNumber = p.jersey_number
  if (p.height_inches !== undefined && !p.heightInches) p.heightInches = p.height_inches
  if (p.weight_lbs !== undefined && !p.weightLbs) p.weightLbs = p.weight_lbs
  if (p.birth_date && !p.birthDate) p.birthDate = p.birth_date

  // Ratings
  if (p.overall_rating !== undefined && !p.overallRating) p.overallRating = p.overall_rating
  if (p.potential_rating !== undefined && !p.potentialRating) p.potentialRating = p.potential_rating

  // Contract
  if (p.contract_years_remaining !== undefined && p.contractYearsRemaining === undefined) p.contractYearsRemaining = p.contract_years_remaining
  if (p.contract_salary !== undefined && p.contractSalary === undefined) p.contractSalary = p.contract_salary
  if (p.contract_details && !p.contractDetails) p.contractDetails = p.contract_details

  // Status
  if (p.is_injured !== undefined && p.isInjured === undefined) p.isInjured = p.is_injured
  if (p.injury_details !== undefined && !p.injuryDetails) p.injuryDetails = p.injury_details

  // Evolution
  if (p.development_history && !p.developmentHistory) p.developmentHistory = p.development_history
  if (p.recent_performances && !p.recentPerformances) p.recentPerformances = p.recent_performances
  if (p.streak_data !== undefined && p.streakData === undefined) p.streakData = p.streak_data
  if (p.upgrade_points !== undefined && p.upgradePoints === undefined) p.upgradePoints = p.upgrade_points
  if (p.games_played_this_season !== undefined && p.gamesPlayedThisSeason === undefined) p.gamesPlayedThisSeason = p.games_played_this_season
  if (p.minutes_played_this_season !== undefined && p.minutesPlayedThisSeason === undefined) p.minutesPlayedThisSeason = p.minutes_played_this_season
  if (p.career_seasons !== undefined && p.careerSeasons === undefined) p.careerSeasons = p.career_seasons

  // Awards
  if (p.all_star_selections !== undefined && p.allStarSelections === undefined) p.allStarSelections = p.all_star_selections
  if (p.mvp_awards !== undefined && p.mvpAwards === undefined) p.mvpAwards = p.mvp_awards
  if (p.finals_mvp_awards !== undefined && p.finalsMvpAwards === undefined) p.finalsMvpAwards = p.finals_mvp_awards
  if (p.rookie_of_the_year !== undefined && p.rookieOfTheYear === undefined) p.rookieOfTheYear = p.rookie_of_the_year
  if (p.all_nba_selections !== undefined && p.allNbaSelections === undefined) p.allNbaSelections = p.all_nba_selections
  if (p.all_nba_first_team !== undefined && p.allNbaFirstTeam === undefined) p.allNbaFirstTeam = p.all_nba_first_team
  if (p.all_rookie_team !== undefined && p.allRookieTeam === undefined) p.allRookieTeam = p.all_rookie_team
  if (p.all_defensive_team !== undefined && p.allDefensiveTeam === undefined) p.allDefensiveTeam = p.all_defensive_team

  return p
}
