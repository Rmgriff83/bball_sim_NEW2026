// =============================================================================
// buildPlayKeyframes.js  (play graph helper for the looping preview)
// =============================================================================
// Turns a play definition (from plays.js) into a lightweight graph the preview
// animation walks live each loop: starting formation, per-action absolute
// movement, and each action's READ branches (the options the offense can take).
// The preview pauses at decision points (≥2 branches), draws dotted lines to
// each option, then randomly picks one — so reads vary loop-to-loop, mirroring
// the (random, per-possession) sim.
//
// Coordinate convention matches courtConfig / plays.js: normalized 0-1, x=0
// left → 1 right, y=0 perimeter → y≈0.9 rim. Pure / import-free (node-testable).
// =============================================================================

const TERMINALS = new Set(['end_made', 'end_turnover', 'rebound_battle', 'free_throws'])

function classifyRead(action) {
  if (!action) return null
  if (action.type === 'shot') {
    if (action.shotType === 'threePoint') return 'three'
    if (action.shotType === 'midRange') return 'mid'
    return 'rim'
  }
  if (action.type === 'pass' || action.type === 'handoff') return 'kick'
  if (action.type === 'post') return 'post'
  if (action.type === 'drive' || action.type === 'cut') return 'rim'
  return null
}

/**
 * @param {object} play
 * @returns {{
 *   roles: string[], roleLabels: Object, formation: Object,
 *   firstActionId: string|null,
 *   actions: Object  // id -> { id, type, actor, receiver, duration, movement,
 *                    //         branches:[{key,next,prob,readType}], isShot, isDecision }
 * }}
 */
export function buildPlayGraph(play) {
  const formation = {}
  const roles = Object.keys(play?.formation || {})
  for (const r of roles) formation[r] = { x: play.formation[r].x, y: play.formation[r].y }

  const roleLabels = {}
  for (const r of roles) {
    const posList = play?.roles?.[r]
    roleLabels[r] = Array.isArray(posList) && posList.length ? posList[0] : ''
  }

  const actions = {}
  for (const a of play?.actions || []) {
    const branches = []
    for (const [key, o] of Object.entries(a.outcomes || {})) {
      if (!o?.next || TERMINALS.has(o.next)) continue
      branches.push({ key, next: o.next, prob: o.probability ?? null })
    }
    // Fill missing probabilities evenly so the weighted pick is well-defined.
    const missing = branches.filter((b) => b.prob == null)
    if (missing.length) {
      const used = branches.reduce((s, b) => s + (b.prob ?? 0), 0)
      const each = Math.max(0.01, (1 - used) / missing.length)
      missing.forEach((b) => (b.prob = each))
    }
    actions[a.id] = {
      id: a.id,
      type: a.type,
      actor: a.actor,
      receiver: a.receiver ?? null,
      duration: a.duration ?? 1,
      movement: a.movement || null,
      branches,
      isShot: a.type === 'shot',
      isDecision: branches.length >= 2,
    }
  }

  return {
    roles,
    roleLabels,
    formation,
    firstActionId: play?.actions?.[0]?.id ?? null,
    actions,
  }
}

export { classifyRead }
export default buildPlayGraph
