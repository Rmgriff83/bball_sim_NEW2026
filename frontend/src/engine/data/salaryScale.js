// =============================================================================
// salaryScale.js
// =============================================================================
// The single source of truth for the league's salary economy, calibrated to the
// real 2025-26 NBA. Every salary number in the sim — league generation, aging,
// free-agent demands, re-sign asks, AI offers, trade matching, the owner cap
// sub-task — derives from the constants and the rating→salary curve here, so the
// whole economy scales together when these numbers change.
//
// Pure and import-free so it's directly node-testable.
//
// Reference (2025-26): cap $154.6M, tax $187.9M (121.5% of cap), 1st apron
// $195.9M, 2nd apron $207.8M, max contracts 25/30/35% of cap by experience,
// non-taxpayer MLE ~$14.1M, vet-min ~$1.3M–$3.6M.
// =============================================================================

// --- League-wide thresholds -------------------------------------------------
// LEGACY (2025-26) set — every campaign created before the 2026 rebase reads
// these via the capNumbersFor fallback, so their economy never shifts.
export const SALARY_CAP = 154_600_000;
export const LUXURY_TAX = 187_900_000; // ≈ 121.5% of the cap
export const FIRST_APRON = 195_900_000;
export const SECOND_APRON = 207_800_000;

// --- Per-campaign cap sets ---------------------------------------------------
// NEW campaigns (created 2026-07+) start in season 2026 and stamp CAP_SET_2026
// into campaign.settings.capNumbers at creation; the tax/aprons here are
// derived with the 2025-26 ratios (×1.2154 / ×1.2672 / ×1.3441) — swap in the
// official figures when the league publishes them.
export const CAP_SET_2026 = {
  salaryCap: 164_961_000,
  luxuryTax: 200_500_000,
  firstApron: 209_000_000,
  secondApron: 221_700_000,
};

export const CAP_SET_LEGACY = {
  salaryCap: SALARY_CAP,
  luxuryTax: LUXURY_TAX,
  firstApron: FIRST_APRON,
  secondApron: SECOND_APRON,
};

/**
 * The cap/tax/apron numbers for a campaign: its stored set when present, else
 * the legacy constants (every pre-rebase save — no migration, by design).
 * Accepts the campaign object or its settings object; tolerant of partial
 * stored sets (each field falls back individually).
 */
export function capNumbersFor(campaignOrSettings) {
  const settings = campaignOrSettings?.settings ?? campaignOrSettings;
  const stored = settings?.capNumbers;
  if (!stored) return CAP_SET_LEGACY;
  return {
    salaryCap: stored.salaryCap ?? CAP_SET_LEGACY.salaryCap,
    luxuryTax: stored.luxuryTax ?? CAP_SET_LEGACY.luxuryTax,
    firstApron: stored.firstApron ?? CAP_SET_LEGACY.firstApron,
    secondApron: stored.secondApron ?? CAP_SET_LEGACY.secondApron,
  };
}

// --- Maximum salary (first-year), by years of service -----------------------
// 0–6 yrs → 25% of cap, 7–9 → 30%, 10+ → 35%. Pass the campaign's cap for
// post-2026 campaigns; defaults to the legacy cap.
export function maxSalary(experienceYears = 0, salaryCap = SALARY_CAP) {
  const yrs = Number(experienceYears) || 0;
  const pct = yrs >= 10 ? 0.35 : yrs >= 7 ? 0.30 : 0.25;
  return Math.round((salaryCap * pct) / 10_000) * 10_000;
}

// --- Veteran minimum -------------------------------------------------------
// Flat $4M floor — the least any player signs for. Kept as three constants so
// the helper signature stays stable if tiering is ever reintroduced.
export const VET_MIN_ROOKIE = 4_000_000;
export const VET_MIN_MID = 4_000_000;
export const VET_MIN_VETERAN = 4_000_000;

export function veteranMinSalary(player) {
  const seasons = player?.careerSeasons ?? player?.career_seasons ?? 0;
  if (seasons >= 10) return VET_MIN_VETERAN;
  if (seasons >= 2) return VET_MIN_MID;
  return VET_MIN_ROOKIE;
}

// --- Rating → base-salary curve ---------------------------------------------
// Smooth (linearly interpolated) overall-rating → open-market base salary,
// calibrated so a contending roster (a ~90 + a ~85 + quality starters/bench)
// sums to roughly $170–195M — over the cap, into/near the tax — while an
// average team lands near the cap and a rebuilder well under. The top anchor is
// the 35% supermax (~$54M); the curve is intentionally rich through the middle
// (role players and starters cost real money) so payrolls press the cap.
export const SALARY_ANCHORS = [
  [60, 2_500_000],
  [65, 5_000_000],
  [70, 9_000_000],
  [73, 12_000_000],
  [75, 15_000_000],
  [78, 20_000_000],
  [80, 24_000_000],
  [82, 28_000_000],
  [85, 34_000_000],
  [88, 40_000_000],
  [90, 45_000_000],
  [92, 49_000_000],
  [95, 54_000_000],
];

/**
 * Open-market base salary for an overall rating, interpolated between anchors
 * and flat outside the endpoints. This is the rating-only base; production, age,
 * and motivation adjustments live in the valuation layer (ResignValuationService).
 */
export function baseSalaryForRating(overall) {
  const a = SALARY_ANCHORS;
  const r = Number(overall);
  if (!Number.isFinite(r)) return a[0][1];
  if (r <= a[0][0]) return a[0][1];
  if (r >= a[a.length - 1][0]) return a[a.length - 1][1];
  for (let i = 0; i < a.length - 1; i++) {
    const [r0, s0] = a[i];
    const [r1, s1] = a[i + 1];
    if (r >= r0 && r <= r1) {
      const t = (r - r0) / (r1 - r0);
      return s0 + (s1 - s0) * t;
    }
  }
  return a[a.length - 1][1];
}
