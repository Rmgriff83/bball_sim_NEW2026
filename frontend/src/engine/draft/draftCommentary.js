// =============================================================================
// draftCommentary.js — ephemeral broadcast commentary for the LIVE ROOKIE draft.
// =============================================================================
// Pure, deterministic, template-based (no LLM / no TTS). Ties each pick to the
// drafting team's direction (from the draft store's teamDirections) + owner
// mandate (owners.js) + the prospect's position. Intentionally avoids citing
// exact ratings so it never spoils unscouted prospects.
//
// Used ONLY for rookie drafts (the caller gates on draftMode === 'rookie').
// =============================================================================

import { findOwnerForTeam } from '@/engine/data/owners'

const DIRECTION_LABEL = {
  title_contender: 'title-contending',
  win_now: 'win-now',
  ascending: 'ascending',
  rebuilding: 'rebuilding',
}

function positionGroup(pos) {
  if (pos === 'PG' || pos === 'SG') return 'backcourt'
  if (pos === 'SF' || pos === 'PF') return 'wing'
  if (pos === 'C') return 'frontcourt'
  return 'roster'
}

/**
 * Commissioner announcement shown in the on-the-clock banner. Works for any
 * team object that carries a name/abbr.
 */
export function onClockLine(team) {
  const name = team?.teamName || team?.name || team?.teamAbbr || team?.abbreviation || 'The next team'
  return `The ${name} are now on the clock.`
}

/**
 * One short analysis sentence about a just-completed pick.
 * @param {Object} p
 * @param {string} p.teamName
 * @param {string} p.teamAbbr
 * @param {string} p.direction  - title_contender | win_now | ascending | rebuilding
 * @param {Object} p.player     - { playerName, position }
 * @param {number} p.round
 * @param {number} p.pick
 * @returns {string}
 */
export function pickAnalysis({ teamName, teamAbbr, direction, player, round, pick }) {
  const team = teamName || teamAbbr || 'The team'
  const name = player?.playerName || 'the prospect'
  const pos = player?.position || ''
  const group = positionGroup(pos)
  const dir = direction || 'ascending'
  const dirLabel = DIRECTION_LABEL[dir] || 'building'
  const owner = findOwnerForTeam(teamAbbr)
  const posTag = pos ? `${pos} ` : ''

  const byDirection = {
    rebuilding: [
      `${team} add ${posTag}${name} — a long-term ${group} piece to build the rebuild around.`,
      `A patient swing: ${team} take ${name} and bet on development over the next few seasons.`,
      `${team} keep stacking youth, grabbing ${name} to deepen a ${dirLabel} core.`,
    ],
    ascending: [
      `${team} grab ${name}, doubling down on upside as their young core ascends.`,
      `${team} take ${posTag}${name} — a ${group} bet that fits a rising, ${dirLabel} roster.`,
      `Momentum pick: ${team} add ${name} to push their ascent up the standings.`,
    ],
    win_now: [
      `${team} take ${posTag}${name} for immediate ${group} help on a ${dirLabel} roster.`,
      `A win-now lean: ${team} want ${name} contributing right away.`,
      `${team} add ${name} to round out a rotation built to win now.`,
    ],
    title_contender: [
      `${team} land ${posTag}${name} — ${group} insurance for a ${dirLabel} push.`,
      `Contender move: ${team} add ${name} to keep the title window open.`,
      `${team} take ${name}, betting a ready-made ${group} piece pays off in the playoffs.`,
    ],
  }

  const variants = byDirection[dir] || byDirection.ascending
  const seed = (Number(pick) || 0) + (Number(round) || 0)
  let line = variants[seed % variants.length]

  // Occasional owner-mandate flavor on early picks for a championship owner.
  if (owner?.expectation === 'championship' && (Number(round) || 0) === 1 && seed % 3 === 0) {
    line += ` Ownership expects results.`
  }

  return line
}

export default { onClockLine, pickAnalysis }
