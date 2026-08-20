// =============================================================================
// draftCommentary.js — ephemeral broadcast commentary for the LIVE ROOKIE draft.
// =============================================================================
// Pure, deterministic, template-based (no LLM / no TTS). Ties each pick to the
// drafting team's direction (from the draft store's teamDirections) + owner
// mandate (owners.js) + the prospect's position. Intentionally avoids citing
// exact ratings so it never spoils unscouted prospects.
//
// Used ONLY for rookie drafts (the caller gates on draftMode === 'rookie').
//
// Every line is built via T() (commentaryTemplate.js) so callers receive
// { text, tpl, params } — unchanged English `text` plus the translation
// template — and the UI renders via $tDynamic(tpl, params) with fallback to
// the English string. Commentary is never persisted (render-time only).
// Enumerable labels (position group, direction) are baked into separate full
// templates per value rather than interpolated as English fragments.
// =============================================================================

import { findOwnerForTeam } from '@/engine/data/owners'
import { T } from '@/engine/simulation/commentaryTemplate'

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

// --- Per-position-group template pools ---------------------------------------
// One complete sentence per position-group value (order matches GROUP_ORDER),
// so translators never see an interpolated English label mid-sentence. The
// `*_TPLS` naming is load-bearing: wl-i18n.config.js regex-extracts the quoted
// strings of these const blocks (plus direct quoted first args of T calls).

const GROUP_ORDER = ['backcourt', 'wing', 'frontcourt', 'roster']

const REBUILDING_ADD_POS_TPLS = [
  '{team} add {pos} {name} — a long-term backcourt piece to build the rebuild around.',
  '{team} add {pos} {name} — a long-term wing piece to build the rebuild around.',
  '{team} add {pos} {name} — a long-term frontcourt piece to build the rebuild around.',
  '{team} add {pos} {name} — a long-term roster piece to build the rebuild around.',
]

const ASCENDING_BET_POS_TPLS = [
  '{team} take {pos} {name} — a backcourt bet that fits a rising, ascending roster.',
  '{team} take {pos} {name} — a wing bet that fits a rising, ascending roster.',
  '{team} take {pos} {name} — a frontcourt bet that fits a rising, ascending roster.',
  '{team} take {pos} {name} — a roster bet that fits a rising, ascending roster.',
]

// Fallback wording when the team direction is unrecognized (dirLabel 'building').
const BUILDING_BET_POS_TPLS = [
  '{team} take {pos} {name} — a backcourt bet that fits a rising, building roster.',
  '{team} take {pos} {name} — a wing bet that fits a rising, building roster.',
  '{team} take {pos} {name} — a frontcourt bet that fits a rising, building roster.',
  '{team} take {pos} {name} — a roster bet that fits a rising, building roster.',
]

const WIN_NOW_HELP_POS_TPLS = [
  '{team} take {pos} {name} for immediate backcourt help on a win-now roster.',
  '{team} take {pos} {name} for immediate wing help on a win-now roster.',
  '{team} take {pos} {name} for immediate frontcourt help on a win-now roster.',
  '{team} take {pos} {name} for immediate roster help on a win-now roster.',
]

const CONTENDER_INSURANCE_POS_TPLS = [
  '{team} land {pos} {name} — backcourt insurance for a title-contending push.',
  '{team} land {pos} {name} — wing insurance for a title-contending push.',
  '{team} land {pos} {name} — frontcourt insurance for a title-contending push.',
  '{team} land {pos} {name} — roster insurance for a title-contending push.',
]

const CONTENDER_READY_TPLS = [
  '{team} take {name}, betting a ready-made backcourt piece pays off in the playoffs.',
  '{team} take {name}, betting a ready-made wing piece pays off in the playoffs.',
  '{team} take {name}, betting a ready-made frontcourt piece pays off in the playoffs.',
  '{team} take {name}, betting a ready-made roster piece pays off in the playoffs.',
]

function groupTpl(tpls, group) {
  const i = GROUP_ORDER.indexOf(group)
  return tpls[i >= 0 ? i : 3]
}

/**
 * Commissioner announcement shown in the on-the-clock banner. Works for any
 * team object that carries a name/abbr.
 * @returns {{ text: string, tpl: string, params: Object }}
 */
export function onClockLine(team) {
  const name = team?.teamName || team?.name || team?.teamAbbr || team?.abbreviation || 'The next team'
  return T('The {name} are now on the clock.', { name })
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
 * @returns {{ text: string, tpl: string, params: Object, tail?: { text: string, tpl: string, params: null } }}
 *   `text` is the full English line (tail sentence included when present);
 *   `tail` is the optional owner-mandate sentence, translated separately.
 */
export function pickAnalysis({ teamName, teamAbbr, direction, player, round, pick }) {
  const team = teamName || teamAbbr || 'The team'
  const name = player?.playerName || 'the prospect'
  const pos = player?.position || ''
  const group = positionGroup(pos)
  const dir = direction || 'ascending'
  const dirLabel = DIRECTION_LABEL[dir] || 'building'
  const owner = findOwnerForTeam(teamAbbr)

  const byDirection = {
    rebuilding: [
      () => pos
        ? T(groupTpl(REBUILDING_ADD_POS_TPLS, group), { team, pos, name })
        : T('{team} add {name} — a long-term roster piece to build the rebuild around.', { team, name }),
      () => T('A patient swing: {team} take {name} and bet on development over the next few seasons.', { team, name }),
      () => T('{team} keep stacking youth, grabbing {name} to deepen a rebuilding core.', { team, name }),
    ],
    ascending: [
      () => T('{team} grab {name}, doubling down on upside as their young core ascends.', { team, name }),
      () => {
        const rising = dirLabel === 'ascending'
        if (pos) {
          return T(groupTpl(rising ? ASCENDING_BET_POS_TPLS : BUILDING_BET_POS_TPLS, group), { team, pos, name })
        }
        return rising
          ? T('{team} take {name} — a roster bet that fits a rising, ascending roster.', { team, name })
          : T('{team} take {name} — a roster bet that fits a rising, building roster.', { team, name })
      },
      () => T('Momentum pick: {team} add {name} to push their ascent up the standings.', { team, name }),
    ],
    win_now: [
      () => pos
        ? T(groupTpl(WIN_NOW_HELP_POS_TPLS, group), { team, pos, name })
        : T('{team} take {name} for immediate roster help on a win-now roster.', { team, name }),
      () => T('A win-now lean: {team} want {name} contributing right away.', { team, name }),
      () => T('{team} add {name} to round out a rotation built to win now.', { team, name }),
    ],
    title_contender: [
      () => pos
        ? T(groupTpl(CONTENDER_INSURANCE_POS_TPLS, group), { team, pos, name })
        : T('{team} land {name} — roster insurance for a title-contending push.', { team, name }),
      () => T('Contender move: {team} add {name} to keep the title window open.', { team, name }),
      () => T(groupTpl(CONTENDER_READY_TPLS, group), { team, name }),
    ],
  }

  const variants = byDirection[dir] || byDirection.ascending
  const seed = (Number(pick) || 0) + (Number(round) || 0)
  const line = variants[seed % variants.length]()

  // Occasional owner-mandate flavor on early picks for a championship owner.
  if (owner?.expectation === 'championship' && (Number(round) || 0) === 1 && seed % 3 === 0) {
    const tail = T('Ownership expects results.')
    return { text: line.text + ' ' + tail.text, tpl: line.tpl, params: line.params, tail }
  }

  return line
}

export default { onClockLine, pickAnalysis }
