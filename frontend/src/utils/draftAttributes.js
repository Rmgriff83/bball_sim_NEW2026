// =============================================================================
// draftAttributes.js — ordered, abbreviated attribute list for the draft board's
// horizontally-scrollable per-row attribute strip.
// =============================================================================
// Mirrors CANONICAL_ATTRIBUTES order from engine/data/attributeSchema.js, with
// short labels so many fit in a compact scrolling row. `cat` drives a subtle
// per-category color accent.
// =============================================================================

export const DRAFT_ATTRIBUTES = [
  // Offense
  { key: 'closeShot', label: 'CLS', name: 'Close Shot', cat: 'off' },
  { key: 'midRange', label: 'MID', name: 'Mid-Range Shot', cat: 'off' },
  { key: 'threePoint', label: '3PT', name: 'Three-Point Shot', cat: 'off' },
  { key: 'freeThrow', label: 'FT', name: 'Free Throw', cat: 'off' },
  { key: 'shotIQ', label: 'sIQ', name: 'Shot IQ', cat: 'off' },
  { key: 'offensiveConsistency', label: 'oCON', name: 'Offensive Consistency', cat: 'off' },
  { key: 'layup', label: 'LAY', name: 'Layup', cat: 'off' },
  { key: 'standingDunk', label: 'sDNK', name: 'Standing Dunk', cat: 'off' },
  { key: 'drivingDunk', label: 'dDNK', name: 'Driving Dunk', cat: 'off' },
  { key: 'postHook', label: 'pHK', name: 'Post Hook', cat: 'off' },
  { key: 'postFade', label: 'pFD', name: 'Post Fade', cat: 'off' },
  { key: 'postControl', label: 'pCTL', name: 'Post Control', cat: 'off' },
  { key: 'drawFoul', label: 'DRF', name: 'Draw Foul', cat: 'off' },
  { key: 'hands', label: 'HND', name: 'Hands', cat: 'off' },
  { key: 'ballHandling', label: 'BH', name: 'Ball Handling', cat: 'off' },
  { key: 'speedWithBall', label: 'SWB', name: 'Speed With Ball', cat: 'off' },
  { key: 'passAccuracy', label: 'pACC', name: 'Pass Accuracy', cat: 'off' },
  { key: 'passVision', label: 'pVIS', name: 'Pass Vision', cat: 'off' },
  { key: 'passIQ', label: 'pIQ', name: 'Pass IQ', cat: 'off' },
  // Defense
  { key: 'interiorDefense', label: 'iD', name: 'Interior Defense', cat: 'def' },
  { key: 'perimeterDefense', label: 'pD', name: 'Perimeter Defense', cat: 'def' },
  { key: 'steal', label: 'STL', name: 'Steal', cat: 'def' },
  { key: 'block', label: 'BLK', name: 'Block', cat: 'def' },
  { key: 'offensiveRebound', label: 'oREB', name: 'Offensive Rebound', cat: 'def' },
  { key: 'defensiveRebound', label: 'dREB', name: 'Defensive Rebound', cat: 'def' },
  { key: 'helpDefenseIQ', label: 'hIQ', name: 'Help Defense IQ', cat: 'def' },
  { key: 'passPerception', label: 'pPER', name: 'Pass Perception', cat: 'def' },
  { key: 'defensiveConsistency', label: 'dCON', name: 'Defensive Consistency', cat: 'def' },
  // Physical
  { key: 'speed', label: 'SPD', name: 'Speed', cat: 'phys' },
  { key: 'acceleration', label: 'ACC', name: 'Acceleration', cat: 'phys' },
  { key: 'strength', label: 'STR', name: 'Strength', cat: 'phys' },
  { key: 'vertical', label: 'VRT', name: 'Vertical', cat: 'phys' },
  { key: 'stamina', label: 'STA', name: 'Stamina', cat: 'phys' },
  { key: 'hustle', label: 'HSL', name: 'Hustle', cat: 'phys' },
  { key: 'durability', label: 'DUR', name: 'Durability', cat: 'phys' },
  // Mental
  { key: 'basketballIQ', label: 'bIQ', name: 'Basketball IQ', cat: 'men' },
  { key: 'clutch', label: 'CLT', name: 'Clutch', cat: 'men' },
  { key: 'workEthic', label: 'WE', name: 'Work Ethic', cat: 'men' },
  { key: 'coachability', label: 'COA', name: 'Coachability', cat: 'men' },
  { key: 'intangibles', label: 'INT', name: 'Intangibles', cat: 'men' },
]

const CAT_COLORS = {
  off: '#fb923c',
  def: '#38bdf8',
  phys: '#4ade80',
  men: '#a855f7',
}

export function attrCatColor(cat) {
  return CAT_COLORS[cat] || 'var(--color-text-tertiary)'
}

// Color denoting how high/low an attribute value is — matches getAttrColor in
// PlayerDetailModal so the draft board reads the same at a glance.
export function attrLevelColor(value) {
  if (value == null || Number.isNaN(value)) return 'var(--color-text-tertiary)'
  if (value >= 90) return 'var(--color-success)'
  if (value >= 80) return '#22D3EE'
  if (value >= 70) return 'var(--color-primary)'
  if (value >= 60) return 'var(--color-warning)'
  return 'var(--color-error)'
}

// Read a (nested) attribute value off a player object. Returns undefined if
// missing. Values are 0-99 integers.
export function getAttrValue(player, key) {
  const a = player?.attributes
  if (!a) return undefined
  return a.offense?.[key] ?? a.defense?.[key] ?? a.physical?.[key] ?? a.mental?.[key]
}
