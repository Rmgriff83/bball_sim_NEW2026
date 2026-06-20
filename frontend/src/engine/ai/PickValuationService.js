// =============================================================================
// PickValuationService.js
// =============================================================================
// Draft-pick trade valuation for the AI trade engine.
//
// Replaces the old flat "every R1 pick = 5, every R2 = 0.5" model (which was
// never even wired in — getPickValueFn defaulted to () => 5 everywhere). Picks
// are now valued the way NBA front offices actually treat them, on the SAME
// numeric scale as a player's `tradeValue` (see CampaignManager.computeTradeValue:
// a 92+ OVR star ~ 25-40, an 80+ OVR starter ~ 8-14):
//
//   - by PROJECTED DRAFT SLOT, derived from the pick's *original* team's record
//     (worst record => slot 1 => most valuable). pick_number/projected_position
//     are null until draft time, so mid-season we project from standings.
//   - by DRAFT-CLASS STRENGTH — a "generational" prospect (POT 99-100) at the
//     top of a class inflates the high picks dramatically and barely touches the
//     late ones; a weak class flattens the top.
//   - by FUTURE UNCERTAINTY — a pick several drafts away is discounted because the
//     owning team's record (and thus the slot) is unknown.
//
// The TEAM-DIRECTION weighting the user asked for already lives in
// AITradeService's DIRECTION_MULTIPLIERS (pickReceiveDiscount / pickGiveSensitivity)
// and DIFFICULTY_CONFIGS (pick_sensitivity); those layer on top of the base value
// produced here, so rebuilders still prize picks and contenders still discount them.
// =============================================================================

// Floor returned for a pick we can't resolve — keeps a trade from ever crashing
// on a stale/unknown pickId while still counting it as ~nothing.
const UNKNOWN_PICK_VALUE = 0.3;

// Base value of a pick by projected overall slot (1-60), expressed in player
// `tradeValue` units. Anchors are log-interpolated between; the jump from slot 30
// (~1.8) to slot 31 (~1.2) is the first/second-round value cliff. Tunable.
const SLOT_ANCHORS = [
  [1, 22], [2, 17], [3, 14], [4, 12], [5, 10.5],
  [8, 7.5], [10, 6], [14, 4.5], [20, 3], [25, 2.3], [30, 1.8],
  [31, 1.2], [40, 0.7], [50, 0.45], [60, 0.3],
];

/**
 * Build a reverse-standings rank map (worst record => rank 1), mirroring
 * DraftOrderService's ordering (wins ascending, point-diff ascending tiebreak).
 * @returns {{ rankById: Map, rankByAbbr: Map, total: number, anyRecord: boolean }}
 */
export function buildReverseStandingsRank(standings = { east: [], west: [] }, allTeams = []) {
  const all = [...(standings?.east || []), ...(standings?.west || [])];

  const records = allTeams.map(team => {
    const s = all.find(st =>
      (st.teamId ?? st.team_id) === team.id ||
      st.teamAbbreviation === team.abbreviation ||
      st.abbreviation === team.abbreviation
    );
    const pointDiff = s
      ? (s.pointDifferential ?? s.pointDiff ?? ((s.pointsFor ?? 0) - (s.pointsAgainst ?? 0)))
      : 0;
    const wins = s?.wins ?? 0;
    const losses = s?.losses ?? 0;
    return {
      id: team.id,
      abbreviation: team.abbreviation,
      wins,
      pointDiff,
      hasRecord: !!s && (wins + losses) > 0,
    };
  });

  // Fewer wins = worse record = earlier (more valuable) pick.
  records.sort((a, b) => {
    if (a.wins !== b.wins) return a.wins - b.wins;
    return a.pointDiff - b.pointDiff;
  });

  const rankById = new Map();
  const rankByAbbr = new Map();
  records.forEach((r, i) => {
    rankById.set(r.id, i + 1);
    rankByAbbr.set(r.abbreviation, i + 1);
  });

  return {
    rankById,
    rankByAbbr,
    total: records.length || 30,
    anyRecord: records.some(r => r.hasRecord),
  };
}

/**
 * Project the overall draft slot (1-60) a pick is likely to land at.
 * @param {object} params
 * @param {object} params.pick - draft pick object
 * @param {object} params.standings
 * @param {Array} params.allTeams
 * @param {number} params.currentSeasonYear
 * @param {object} [params._rank] - precomputed buildReverseStandingsRank() result
 * @returns {number} integer slot 1-60
 */
export function projectPickSlot({ pick, standings, allTeams = [], currentSeasonYear, _rank }) {
  const round = pick?.round ?? 1;

  // If the draft order has already been assigned (at/near draft time), trust it.
  if (pick?.pick_number != null) return pick.pick_number;

  const rankInfo = _rank ?? buildReverseStandingsRank(standings, allTeams);
  const totalTeams = rankInfo.total || 30;
  const mean = (totalTeams + 1) / 2; // ~15.5 for 30 teams

  let rank;
  if (!rankInfo.anyRecord) {
    rank = mean; // preseason / no games played: assume a middle pick
  } else {
    rank = rankInfo.rankById.get(pick?.originalTeamId)
      ?? rankInfo.rankByAbbr.get(pick?.original_team_abbreviation)
      ?? mean;
  }

  // Future picks: regress the slot toward the league mean since the owning
  // team's future record is unknown (25% per draft out, capped at 80%).
  const draftYearForSeason = (currentSeasonYear ?? 0) + 1;
  const yearsOut = Math.max(0, (pick?.year ?? draftYearForSeason) - draftYearForSeason);
  if (yearsOut > 0) {
    const regress = Math.min(0.8, yearsOut * 0.25);
    rank = rank + (mean - rank) * regress;
  }

  let slot = Math.max(1, Math.min(totalTeams, Math.round(rank)));
  if (round === 2) slot += totalTeams; // round 2 lands in slots (total+1)..(2*total)
  return slot;
}

/**
 * Log-interpolated base value for a projected slot, in player tradeValue units.
 */
export function slotBaseValue(slot) {
  const a = SLOT_ANCHORS;
  if (slot <= a[0][0]) return a[0][1];
  if (slot >= a[a.length - 1][0]) return a[a.length - 1][1];
  for (let i = 0; i < a.length - 1; i++) {
    const [s0, v0] = a[i];
    const [s1, v1] = a[i + 1];
    if (slot >= s0 && slot <= s1) {
      const t = (Math.log(slot) - Math.log(s0)) / (Math.log(s1) - Math.log(s0));
      return v0 + (v1 - v0) * t;
    }
  }
  return a[a.length - 1][1];
}

/**
 * Summarize how strong a draft class is from its generated prospect pool.
 * @param {Array} prospects - players with isDraftProspect for a given draftYear
 * @returns {{ generational: boolean, franchiseCount: number, topPotential: number, known: boolean }}
 */
export function computeDraftClassStrength(prospects = []) {
  if (!prospects || prospects.length === 0) {
    return { generational: false, franchiseCount: 0, topPotential: 0, known: false };
  }
  let generational = false;
  let franchiseCount = 0;
  let topPotential = 0;
  for (const p of prospects) {
    const pot = p.potentialRating ?? p.potential_rating ?? 0;
    if (pot > topPotential) topPotential = pot;
    if (p.isGenerational || pot >= 99) generational = true;
    if (p.rookieTier === 'franchise' || p.rookieTier === 'generational' || pot >= 88) {
      franchiseCount++;
    }
  }
  return { generational, franchiseCount, topPotential, known: true };
}

/**
 * Class-strength multiplier for a given slot. Influence fades fast with slot
 * (~full at slot 1, negligible by slot 10), so class strength reshapes the top
 * of the draft and leaves late picks alone — matching how teams actually behave.
 */
export function classMultiplier(slot, strength) {
  if (!strength || !strength.known) return 1.0; // ungenerated future class: neutral
  const influence = Math.exp(-(slot - 1) / 2.5); // ~1 @ slot1, ~0.27 @ slot4, ~0.03 @ slot10

  let topFactor;
  if (strength.generational) {
    topFactor = 0.6; // up to +60% on the #1 pick in a generational year
  } else {
    // topPotential 90 -> neutral, 97 -> +0.35, weak (<90) -> down to -0.2
    topFactor = Math.max(-0.2, Math.min(0.4, (strength.topPotential - 90) / 20));
  }
  // Extra franchise-tier depth (baseline ~3) adds a small lottery-wide bump.
  const depthBonus = Math.max(0, strength.franchiseCount - 3) * 0.03;

  return 1 + influence * (topFactor + depthBonus);
}

/**
 * Discount for picks several drafts in the future (slot uncertainty grows).
 */
export function futureUncertaintyDiscount(yearsOut) {
  if (yearsOut <= 0) return 1.0;
  const table = [1.0, 0.9, 0.82, 0.74];
  return yearsOut >= table.length ? 0.65 : table[yearsOut];
}

/**
 * Compute a single pick's trade value (player tradeValue units).
 * @param {object} params
 * @param {object} params.pick
 * @param {object} params.standings
 * @param {Array} params.allTeams
 * @param {object} params.draftProspectsByYear - { [year]: prospect[] }
 * @param {number} params.currentSeasonYear
 * @param {object} [params._rank]
 * @returns {number}
 */
export function computePickValue({
  pick,
  standings,
  allTeams = [],
  draftProspectsByYear = {},
  currentSeasonYear,
  _rank,
}) {
  if (!pick) return UNKNOWN_PICK_VALUE;

  const slot = projectPickSlot({ pick, standings, allTeams, currentSeasonYear, _rank });
  const base = slotBaseValue(slot);

  const prospects = draftProspectsByYear[pick.year] ?? draftProspectsByYear[String(pick.year)] ?? [];
  const strength = computeDraftClassStrength(prospects);
  const classMult = classMultiplier(slot, strength);

  const draftYearForSeason = (currentSeasonYear ?? 0) + 1;
  const yearsOut = Math.max(0, (pick.year ?? draftYearForSeason) - draftYearForSeason);
  const uncert = futureUncertaintyDiscount(yearsOut);

  const value = base * classMult * uncert;
  return Math.round(value * 100) / 100;
}

/**
 * Build the `getPickValueFn(pickId) => number` closure the trade evaluator
 * expects. Resolves picks across every team's draftPicks and reads draft-class
 * strength from the in-memory prospect pool — no new persisted data required.
 *
 * @param {object} params
 * @param {Array} params.allTeams - every team (each with a draftPicks array)
 * @param {object} params.standings - { east, west }
 * @param {Array} params.allPlayers - league players (used to find draft prospects)
 * @param {number} params.currentSeasonYear
 * @returns {(pickId: string|number) => number}
 */
export function buildPickValueFn({ allTeams = [], standings = { east: [], west: [] }, allPlayers = [], currentSeasonYear }) {
  const pickById = new Map();
  for (const team of allTeams) {
    for (const pick of team.draftPicks || []) {
      if (pick?.id != null) pickById.set(String(pick.id), pick);
    }
  }

  const draftProspectsByYear = {};
  for (const p of allPlayers) {
    if (p?.isDraftProspect && p.draftYear != null) {
      (draftProspectsByYear[p.draftYear] ??= []).push(p);
    }
  }

  // Compute the reverse-standings rank once and reuse for every pick lookup.
  const rank = buildReverseStandingsRank(standings, allTeams);

  return (pickId) => {
    const pick = pickById.get(String(pickId));
    if (!pick) return UNKNOWN_PICK_VALUE;
    return computePickValue({
      pick,
      standings,
      allTeams,
      draftProspectsByYear,
      currentSeasonYear,
      _rank: rank,
    });
  };
}
