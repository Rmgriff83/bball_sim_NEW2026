export const ACHIEVEMENTS = [
  // ROOKIE ACHIEVEMENTS
  { id: 'first_win', name: 'First Victory', description: 'Win your first game as a franchise owner.', category: 'rookie', points: 10, criteria: { type: 'wins', value: 1 } },
  { id: 'ten_wins', name: 'Getting Warmed Up', description: 'Win 10 games in your career.', category: 'rookie', points: 15, criteria: { type: 'wins', value: 10 } },
  { id: 'first_season', name: 'Rookie Season', description: 'Complete your first full season.', category: 'rookie', points: 20, criteria: { type: 'seasons_completed', value: 1 } },
  { id: 'first_playoff', name: 'Playoff Bound', description: 'Make the playoffs for the first time.', category: 'rookie', points: 25, criteria: { type: 'playoff_appearances', value: 1 } },
  { id: 'first_draft', name: 'Draft Day', description: 'Participate in your first draft.', category: 'rookie', points: 15, criteria: { type: 'drafts_participated', value: 1 } },
  { id: 'first_trade', name: 'Wheeling and Dealing', description: 'Complete your first trade.', category: 'rookie', points: 15, criteria: { type: 'trades_made', value: 1 } },
  { id: 'first_signing', name: 'Free Agent Frenzy', description: 'Sign your first free agent.', category: 'rookie', points: 15, criteria: { type: 'free_agents_signed', value: 1 } },

  // VETERAN ACHIEVEMENTS
  { id: 'fifty_wins', name: 'Fifty and Counting', description: 'Win 50 games in your career.', category: 'veteran', points: 30, criteria: { type: 'wins', value: 50 } },
  { id: 'hundred_wins', name: 'Century Club', description: 'Win 100 games in your career.', category: 'veteran', points: 50, criteria: { type: 'wins', value: 100 } },
  { id: 'five_seasons', name: 'Franchise Fixture', description: 'Complete 5 seasons.', category: 'veteran', points: 40, criteria: { type: 'seasons_completed', value: 5 } },
  { id: 'ten_seasons', name: 'Decade of Dominance', description: 'Complete 10 seasons.', category: 'veteran', points: 75, criteria: { type: 'seasons_completed', value: 10 } },
  { id: 'first_championship', name: 'Champion', description: 'Win your first championship.', category: 'veteran', points: 100, criteria: { type: 'championships', value: 1 } },
  { id: 'five_playoffs', name: 'Playoff Regular', description: 'Make the playoffs 5 times.', category: 'veteran', points: 35, criteria: { type: 'playoff_appearances', value: 5 } },
  { id: 'draft_lottery_pick', name: 'Lottery Winner', description: 'Draft a player in the top 5 picks.', category: 'veteran', points: 25, criteria: { type: 'lottery_picks', value: 1 } },
  { id: 'develop_star', name: 'Star Maker', description: 'Develop a player to 85+ overall rating.', category: 'veteran', points: 50, criteria: { type: 'players_developed_to_star', value: 1 } },

  // MASTERY ACHIEVEMENTS
  { id: 'three_championships', name: 'Three-Peat', description: 'Win 3 championships.', category: 'mastery', points: 150, criteria: { type: 'championships', value: 3 } },
  { id: 'five_championships', name: 'Dynasty', description: 'Win 5 championships.', category: 'mastery', points: 250, criteria: { type: 'championships', value: 5 } },
  { id: 'perfect_season', name: 'Perfect Season', description: 'Go undefeated in the regular season (54-0).', category: 'mastery', points: 500, criteria: { type: 'perfect_regular_season', value: 1 } },
  { id: 'perfect_playoffs', name: 'Playoff Perfection', description: 'Go undefeated in the playoffs (16-0).', category: 'mastery', points: 300, criteria: { type: 'perfect_playoff_run', value: 1 } },
  { id: 'hof_induction', name: 'Hall of Famer', description: 'Have a player inducted into the Hall of Fame.', category: 'mastery', points: 200, criteria: { type: 'hof_inductions', value: 1 } },
  { id: 'five_hof', name: 'Legacy Builder', description: 'Have 5 players inducted into the Hall of Fame.', category: 'mastery', points: 400, criteria: { type: 'hof_inductions', value: 5 } },
  { id: 'seventy_win_season', name: 'Historic Season', description: 'Win 70+ games in a single regular season.', category: 'mastery', points: 200, criteria: { type: 'season_wins', value: 70 } },
  { id: 'back_to_back', name: 'Back to Back', description: 'Win championships in consecutive seasons.', category: 'mastery', points: 175, criteria: { type: 'consecutive_championships', value: 2 } },
  { id: 'five_hundred_wins', name: 'Legend', description: 'Win 500 games in your career.', category: 'mastery', points: 200, criteria: { type: 'wins', value: 500 } },

  // HIDDEN ACHIEVEMENTS
  { id: 'buzzer_beater', name: 'Buzzer Beater', description: 'Win a game with a buzzer-beating shot.', category: 'hidden', points: 50, criteria: { type: 'buzzer_beater_wins', value: 1 } },
  { id: 'comeback_kid', name: 'Comeback Kid', description: 'Win a game after being down 20+ points.', category: 'hidden', points: 75, criteria: { type: 'big_comebacks', value: 1 } },
  { id: 'triple_double', name: 'Triple Double', description: 'Have a player record a triple-double.', category: 'hidden', points: 30, criteria: { type: 'triple_doubles', value: 1 } },
  { id: 'quadruple_double', name: 'Quadruple Double', description: 'Have a player record a quadruple-double.', category: 'hidden', points: 150, criteria: { type: 'quadruple_doubles', value: 1 } },
  { id: 'fifty_point_game', name: '50-Point Explosion', description: 'Have a player score 50+ points in a game.', category: 'hidden', points: 50, criteria: { type: 'fifty_point_games', value: 1 } },
  { id: 'cinderella_story', name: 'Cinderella Story', description: 'Win the championship as the 8th seed.', category: 'hidden', points: 200, criteria: { type: 'eight_seed_championship', value: 1 } },
  { id: 'tank_commander', name: 'Tank Commander', description: 'Finish with the worst record in the league.', category: 'hidden', points: 25, criteria: { type: 'worst_record', value: 1 } },
  { id: 'blockbuster_trade', name: 'Blockbuster', description: 'Complete a trade involving 5+ players.', category: 'hidden', points: 35, criteria: { type: 'large_trades', value: 1 } },
]
