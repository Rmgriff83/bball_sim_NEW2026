/**
 * BreakingNewsService
 * Generates headline + body copy for breaking news events.
 * Pure functions — no side effects.
 *
 * Every headline/body is built via T() (commentaryTemplate.js) so news items
 * carry `headline_tpl`/`headline_params` and `body_tpl`/`body_params`
 * alongside the unchanged English `headline`/`body` — the UI translates via
 * $tDynamic(tpl, params) with fallback to the stored English string.
 * Player/coach/team names are always params (pre-uppercased where the copy
 * is uppercase), never baked into templates.
 */
import { T } from '../simulation/commentaryTemplate'

// Full body template per firing reason — one complete paragraph each (the
// reason phrase is part of the sentence, never a concatenated fragment). The
// `*_TPLS` naming is load-bearing: wl-i18n.config.js regex-extracts the
// quoted strings of these const blocks (plus direct quoted T call args).
const COACH_FIRED_BODY_TPLS = {
  missed_playoffs: 'The {team} have relieved head coach {coach} of his duties after the team fell short of the playoffs despite expectations to contend. The search for a replacement begins immediately, and {coach} now joins the open coaching market.',
  underperformed: 'The {team} have relieved head coach {coach} of his duties after a season that fell well short of expectations. The search for a replacement begins immediately, and {coach} now joins the open coaching market.',
  contract_expired: 'The {team} have relieved head coach {coach} of his duties as the two sides parted ways at the end of his contract. The search for a replacement begins immediately, and {coach} now joins the open coaching market.',
  default: 'The {team} have relieved head coach {coach} of his duties after a disappointing campaign. The search for a replacement begins immediately, and {coach} now joins the open coaching market.',
}

// Spread a T() result into the additive template fields news records carry.
const tplFields = (headline, body) => ({
  headline_tpl: headline.tpl,
  headline_params: headline.params,
  body_tpl: body.tpl,
  body_params: body.params,
})

export const BreakingNewsService = {

  tradeCompleted({ playersSent, playersReceived, otherTeamName, userTeamName, date }) {
    const topReceived = playersReceived[0] || 'unknown'
    const sentNames = playersSent.join(', ')
    const receivedNames = playersReceived.join(', ')

    const headline = T('{team} ACQUIRE {player} IN BLOCKBUSTER DEAL', {
      team: userTeamName, player: topReceived.toUpperCase(),
    })
    const body = T('The {team} have completed a trade with the {otherTeam}, sending {sent} in exchange for {received}. The deal reshapes both rosters as the season progresses.', {
      team: userTeamName, otherTeam: otherTeamName, sent: sentNames, received: receivedNames,
    })

    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'TRADE',
      icon: 'Repeat',
      date,
    }
  },

  tradeDeadlinePassed({ date }) {
    const headline = T('TRADE & RE-SIGN DEADLINES HAVE PASSED')
    const body = T('The trade window has officially closed and the in-season re-signing deadline has passed. Teams must rely on their current rosters for the remainder of the season, and any unsigned players in their contract year will reach free agency at season end.')
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'DEADLINE',
      icon: 'Clock',
      date,
    }
  },

  tradeDeadlineWarning({ date }) {
    const headline = T('ONE WEEK UNTIL THE TRADE & RE-SIGN DEADLINES')
    const body = T("Front offices around the league are scrambling. The trade deadline closes in one week — no more trades can be proposed once it passes. The contract-extension deadline closes the same day, so any player on the final year of their deal must be re-signed before then or they'll hit free agency at season end.")
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
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
    const isRising = selectionType === 'rising_stars'
    const headline = isRising
      ? T('{player} NAMED TO RISING STARS TEAM', { player: playerName.toUpperCase() })
      : T('{player} NAMED TO ALL-STAR TEAM', { player: playerName.toUpperCase() })
    const body = isRising
      ? T('{player} of the {team} has been selected to represent their conference in the RISING STARS game. The honor recognizes an outstanding first-half performance.', { player: playerName, team: teamName })
      : T('{player} of the {team} has been selected to represent their conference in the ALL-STAR game. The honor recognizes an outstanding first-half performance.', { player: playerName, team: teamName })
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'ALL-STAR',
      icon: 'Star',
      date,
    }
  },

  topSeed({ teamName, conference, record, date }) {
    const isEast = conference === 'east'
    const headline = isEast
      ? T('{team} CLINCH TOP SEED IN EASTERN CONFERENCE', { team: teamName.toUpperCase() })
      : T('{team} CLINCH TOP SEED IN WESTERN CONFERENCE', { team: teamName.toUpperCase() })
    const body = isEast
      ? T('With a league-best record of {record}, the {team} have secured the number one seed in the Eastern Conference and home-court advantage throughout the playoffs.', { record, team: teamName })
      : T('With a league-best record of {record}, the {team} have secured the number one seed in the Western Conference and home-court advantage throughout the playoffs.', { record, team: teamName })
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'PLAYOFFS',
      icon: 'Trophy',
      date,
    }
  },

  makingFinals({ teamName, opponentName, date }) {
    const headline = T('{team} PUNCH TICKET TO THE FINALS', { team: teamName.toUpperCase() })
    const body = T('The {team} are headed to the League Finals after defeating the {opponent} in the conference finals. A championship berth is on the line.', {
      team: teamName, opponent: opponentName,
    })
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'PLAYOFFS',
      icon: 'Trophy',
      date,
    }
  },

  winningFinals({ teamName, year, date }) {
    const headline = T('{team} ARE YOUR {year} CHAMPIONS', { team: teamName.toUpperCase(), year })
    const body = T('The {team} have won the {year} championship! After a grueling playoff run, they stand alone at the summit of professional basketball.', {
      team: teamName, year,
    })
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'CHAMPION',
      icon: 'Trophy',
      date,
    }
  },

  seasonMVP({ playerName, teamName, stats, date }) {
    const headline = T('{player} WINS LEAGUE MVP', { player: playerName.toUpperCase() })
    const body = stats
      ? T('{player} of the {team} has been named the League MVP after a dominant season, averaging {ppg} PPG, {rpg} RPG, and {apg} APG.', {
        player: playerName, team: teamName, ppg: stats.ppg, rpg: stats.rpg, apg: stats.apg,
      })
      : T('{player} of the {team} has been named the League MVP after a dominant season.', {
        player: playerName, team: teamName,
      })
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'AWARD',
      icon: 'Award',
      date,
    }
  },

  rookieOfTheYear({ playerName, teamName, stats, date }) {
    const headline = T('{player} NAMED ROOKIE OF THE YEAR', { player: playerName.toUpperCase() })
    const body = stats
      ? T('{player} of the {team} has been named Rookie of the Year after an impressive debut season, averaging {ppg} PPG, {rpg} RPG, and {apg} APG.', {
        player: playerName, team: teamName, ppg: stats.ppg, rpg: stats.rpg, apg: stats.apg,
      })
      : T('{player} of the {team} has been named Rookie of the Year after an impressive debut season.', {
        player: playerName, team: teamName,
      })
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'AWARD',
      icon: 'Award',
      date,
    }
  },

  coachFired({ coachName, teamName, reason, date }) {
    const bodyTpl = COACH_FIRED_BODY_TPLS[reason] || COACH_FIRED_BODY_TPLS.default
    const headline = T('{team} PART WAYS WITH HEAD COACH {coach}', {
      team: teamName.toUpperCase(), coach: coachName.toUpperCase(),
    })
    const body = T(bodyTpl, { team: teamName, coach: coachName })
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'COACHING',
      icon: 'UserCog',
      date,
    }
  },

  coachHired({ coachName, teamName, date }) {
    const headline = T('{team} NAME {coach} HEAD COACH', {
      team: teamName.toUpperCase(), coach: coachName.toUpperCase(),
    })
    const body = T("The {team} have hired {coach} as their new head coach. The front office is betting his approach is the right fit for the roster's direction.", {
      team: teamName, coach: coachName,
    })
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'COACHING',
      icon: 'UserCog',
      date,
    }
  },

  coachExtended({ coachName, teamName, date }) {
    const headline = T('{team} EXTEND HEAD COACH {coach}', {
      team: teamName.toUpperCase(), coach: coachName.toUpperCase(),
    })
    const body = T('The {team} have signed head coach {coach} to a contract extension after a strong season, locking in their leadership rather than risk a lame-duck year.', {
      team: teamName, coach: coachName,
    })
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'COACHING',
      icon: 'UserCog',
      date,
    }
  },

  coachRetired({ coachName, teamName, date }) {
    const headline = T('HEAD COACH {coach} ANNOUNCES RETIREMENT', { coach: coachName.toUpperCase() })
    const body = teamName
      ? T("the {team}'s {coach} has announced his retirement from coaching, closing the book on a long career on the sidelines. The franchise will look to the open market for its next leader.", {
        team: teamName, coach: coachName,
      })
      : T('{coach} has announced his retirement from coaching, closing the book on a long career on the sidelines. The franchise will look to the open market for its next leader.', {
        coach: coachName,
      })
    return {
      headline: headline.text,
      body: body.text,
      ...tplFields(headline, body),
      category: 'COACHING',
      icon: 'UserCog',
      date,
    }
  },
}
