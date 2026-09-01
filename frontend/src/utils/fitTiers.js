// Rough scheme-fit buckets shown in place of the exact Fit % while the
// ANALYTICS facility is below Lv2 (Lv1 = rough tiers, Lv2+ = exact %).
// Shared by every surface that renders scheme fit — the GM view coaching
// subtab, the pregame Game Plan card, and the live-game coaches overlay —
// so all of them reveal the same precision for a given facility level.
// Labels render through $tDynamic; wl-i18n.config.js extracts them from
// this file.
export const FIT_TIERS = [
  { min: 80, label: 'Elite Fit' },
  { min: 65, label: 'Good Fit' },
  { min: 50, label: 'Fair Fit' },
  { min: 0, label: 'Poor Fit' },
]

export function fitTierLabel(value) {
  return FIT_TIERS.find(t => (value ?? 0) >= t.min)?.label ?? 'Poor Fit'
}
