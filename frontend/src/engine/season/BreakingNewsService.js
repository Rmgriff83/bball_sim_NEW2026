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
      headline: 'TRADE & RE-SIGN DEADLINES HAVE PASSED',
      body: 'The trade window has officially closed and the in-season re-signing deadline has passed. Teams must rely on their current rosters for the remainder of the season, and any unsigned players in their contract year will reach free agency at season end.',
      category: 'DEADLINE',
      icon: 'Clock',
      date,
    }
  },

  tradeDeadlineWarning({ date }) {
    return {
      headline: 'ONE WEEK UNTIL THE TRADE & RE-SIGN DEADLINES',
      body: 'Front offices around the league are scrambling. The trade deadline closes in one week — no more trades can be proposed once it passes. The contract-extension deadline closes the same day, so any player on the final year of their deal must be re-signed before then or they\'ll hit free agency at season end.',
      category: 'DEADLINE',
      icon: 'Clock',
      date,
      // Doubles as the sim-pause warning: when displayed mid-sim, the modal
      // shows Pause Sim / Continue Sim buttons (in place of the standard
      // CONTINUE), and any dismiss (X / overlay / Escape) is treated as Pause
      // Sim so the user can't accidentally skip past the decision.
      simPause: true,
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
      body: `The ${teamName} are headed to the League Finals after defeating the ${opponentName} in the conference finals. A championship berth is on the line.`,
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

  coachFired({ coachName, teamName, reason, date }) {
    const reasonCopy = {
      missed_playoffs: 'after the team fell short of the playoffs despite expectations to contend',
      underperformed: 'after a season that fell well short of expectations',
      contract_expired: 'as the two sides parted ways at the end of his contract',
    }[reason] || 'after a disappointing campaign'
    return {
      headline: `${teamName.toUpperCase()} PART WAYS WITH HEAD COACH ${coachName.toUpperCase()}`,
      body: `The ${teamName} have relieved head coach ${coachName} of his duties ${reasonCopy}. The search for a replacement begins immediately, and ${coachName} now joins the open coaching market.`,
      category: 'COACHING',
      icon: 'UserCog',
      date,
    }
  },

  coachHired({ coachName, teamName, date }) {
    return {
      headline: `${teamName.toUpperCase()} NAME ${coachName.toUpperCase()} HEAD COACH`,
      body: `The ${teamName} have hired ${coachName} as their new head coach. The front office is betting his approach is the right fit for the roster's direction.`,
      category: 'COACHING',
      icon: 'UserCog',
      date,
    }
  },

  coachExtended({ coachName, teamName, date }) {
    return {
      headline: `${teamName.toUpperCase()} EXTEND HEAD COACH ${coachName.toUpperCase()}`,
      body: `The ${teamName} have signed head coach ${coachName} to a contract extension after a strong season, locking in their leadership rather than risk a lame-duck year.`,
      category: 'COACHING',
      icon: 'UserCog',
      date,
    }
  },

  coachRetired({ coachName, teamName, date }) {
    const where = teamName ? `the ${teamName}'s ${coachName}` : coachName
    return {
      headline: `HEAD COACH ${coachName.toUpperCase()} ANNOUNCES RETIREMENT`,
      body: `${where} has announced his retirement from coaching, closing the book on a long career on the sidelines. The franchise will look to the open market for its next leader.`,
      category: 'COACHING',
      icon: 'UserCog',
      date,
    }
  },
}
