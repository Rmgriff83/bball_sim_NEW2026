/**
 * BreakingNewsService
 * Generates headline + body copy for breaking news events.
 * Pure functions — no side effects.
 */
export const BreakingNewsService = {

  tradeCompleted({ playersSent, playersReceived, otherTeamName, userTeamName, date }) {
    const topReceived = playersReceived[0] || 'unknown'
    const sentNames = playersSent.join(', ')
    const receivedNames = playersReceived.join(', ')

    return {
      headline: `${userTeamName} ACQUIRE ${topReceived.toUpperCase()} IN BLOCKBUSTER DEAL`,
      body: `The ${userTeamName} have completed a trade with the ${otherTeamName}, sending ${sentNames} in exchange for ${receivedNames}. The deal reshapes both rosters as the season progresses.`,
      category: 'TRADE',
      icon: 'Repeat',
      date,
    }
  },

  tradeDeadlinePassed({ date }) {
    return {
      headline: 'TRADE DEADLINE HAS PASSED',
      body: 'The trade window has officially closed. Teams must now rely on their current rosters for the remainder of the season and any playoff push.',
      category: 'DEADLINE',
      icon: 'Clock',
      date,
    }
  },

  allStarSelection({ playerName, teamName, selectionType, date }) {
    const label = selectionType === 'rising_stars' ? 'RISING STARS' : 'ALL-STAR'
    return {
      headline: `${playerName.toUpperCase()} NAMED TO ${label} TEAM`,
      body: `${playerName} of the ${teamName} has been selected to represent their conference in the ${label} game. The honor recognizes an outstanding first-half performance.`,
      category: 'ALL-STAR',
      icon: 'Star',
      date,
    }
  },

  topSeed({ teamName, conference, record, date }) {
    const confLabel = conference === 'east' ? 'Eastern Conference' : 'Western Conference'
    return {
      headline: `${teamName.toUpperCase()} CLINCH TOP SEED IN ${confLabel.toUpperCase()}`,
      body: `With a league-best record of ${record}, the ${teamName} have secured the number one seed in the ${confLabel} and home-court advantage throughout the playoffs.`,
      category: 'PLAYOFFS',
      icon: 'Trophy',
      date,
    }
  },

  makingFinals({ teamName, opponentName, date }) {
    return {
      headline: `${teamName.toUpperCase()} PUNCH TICKET TO THE FINALS`,
      body: `The ${teamName} are headed to the NBA Finals after defeating the ${opponentName} in the conference finals. A championship berth is on the line.`,
      category: 'PLAYOFFS',
      icon: 'Trophy',
      date,
    }
  },

  winningFinals({ teamName, year, date }) {
    return {
      headline: `${teamName.toUpperCase()} ARE YOUR ${year} CHAMPIONS`,
      body: `The ${teamName} have won the ${year} championship! After a grueling playoff run, they stand alone at the summit of professional basketball.`,
      category: 'CHAMPION',
      icon: 'Trophy',
      date,
    }
  },

  seasonMVP({ playerName, teamName, stats, date }) {
    return {
      headline: `${playerName.toUpperCase()} WINS LEAGUE MVP`,
      body: `${playerName} of the ${teamName} has been named the League MVP after a dominant season${stats ? `, averaging ${stats.ppg} PPG, ${stats.rpg} RPG, and ${stats.apg} APG` : ''}.`,
      category: 'AWARD',
      icon: 'Award',
      date,
    }
  },

  rookieOfTheYear({ playerName, teamName, stats, date }) {
    return {
      headline: `${playerName.toUpperCase()} NAMED ROOKIE OF THE YEAR`,
      body: `${playerName} of the ${teamName} has been named Rookie of the Year after an impressive debut season${stats ? `, averaging ${stats.ppg} PPG, ${stats.rpg} RPG, and ${stats.apg} APG` : ''}.`,
      category: 'AWARD',
      icon: 'Award',
      date,
    }
  },
}
