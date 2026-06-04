export const COACH_FIRST_NAMES = [
  "Greg",
  "Steve",
  "Mike",
  "Erik",
  "Joe",
  "Tyronn",
  "Doc",
  "Nick",
  "Taylor",
  "Ime",
  "Billy",
  "Quin",
  "Michael",
  "Rick",
  "Jason",
  "Monty",
  "Chris",
  "Chauncey",
  "Mark",
  "Willie",
  "Tom",
  "JB",
  "Jamahl",
  "Darvin",
  "Wes",
  "Frank",
  "Nate",
  "Charles",
  "Terry",
  "Dwane",
];

export const COACH_LAST_NAMES = [
  "Popovich",
  "Kerr",
  "Budenholzer",
  "Spoelstra",
  "Mazzulla",
  "Lue",
  "Rivers",
  "Nurse",
  "Jenkins",
  "Udoka",
  "Donovan",
  "Snyder",
  "Malone",
  "Carlisle",
  "Kidd",
  "Williams",
  "Finch",
  "Billups",
  "Daigneault",
  "Green",
  "Thibodeau",
  "Bickerstaff",
  "Mosley",
  "Ham",
  "Unseld",
  "Vogel",
  "McMillan",
  "Lee",
  "Stotts",
  "Casey",
];

export const OFFENSIVE_SCHEMES = [
  "motion",
  "iso_heavy",
  "pick_and_roll",
  "post_up",
  "pace_and_space",
  "princeton",
];
export const DEFENSIVE_SCHEMES = [
  "man_to_man",
  "zone_2_3",
  "zone_3_2",
  "switch_everything",
  "drop_coverage",
];

export const COACH_TIER_RANGES = {
  1: [78, 92],
  2: [72, 85],
  3: [65, 78],
  4: [58, 72],
};

export const COACH_SALARY_RANGES = {
  elite: [8000000, 12000000], // 85+
  great: [5000000, 9000000], // 78-84
  good: [3000000, 6000000], // 70-77
  average: [1500000, 4000000], // 62-69
  below: [800000, 2000000], // <62
};

export const COACH_ATTRIBUTES = [
  "offensiveIQ",
  "defensiveIQ",
  "playerDevelopment",
  "strictness",
  "gameManagement",
];

/**
 * Master coach list. Each entry maps a coach to their CURRENT team via the
 * team abbreviation. Attributes and schemes are still generated randomly at
 * campaign creation (see `generateCoachAttributes` below); this list only
 * carries the identity bits — name, current team, headshot, starter badges.
 *
 * Add entries over time. Teams without a master coach entry will fall back to
 * a randomly-named coach from COACH_FIRST_NAMES / COACH_LAST_NAMES with no
 * badges and no headshot — same legacy behavior as before this list existed.
 *
 * Shape:
 * {
 *   firstName: string,
 *   lastName:  string,
 *   team:      string  (team abbreviation, e.g. 'SAS')
 *   headshot:  string | null  (filename in assets/coach-headshots/)
 *   badges:    Array<{ id: string, level: 'bronze'|'silver'|'gold'|'hof' }>
 *               // badge IDs reference coachBadges.js. Each entry carries the
 *               // current level — upgrading the badge replaces the entry.
 * }
 */
export const COACHES = [
  // Fill in over time. e.g.:
  {
    firstName: "Tyler",
    lastName: "Masemey",
    team: "SAS",
    headshot: "",
    badges: [{ id: "defensive_mastermind", level: "gold" }],
  },
  {
    firstName: "Bilard",
    lastName: "McKenzie",
    team: "MIL",
    headshot: "",
    badges: [{ id: "defensive_mastermind", level: "silver" }],
  },
  {
    firstName: "Harry",
    lastName: "Hounzand",
    team: "DET",
    headshot: "",
    badges: [
      { id: "defensive_mastermind", level: "bronze" },
      { id: "player_whisperer", level: "gold" },
    ],
  },
  {
    firstName: "Sherrod",
    lastName: "Heart",
    team: "PHI",
    headshot: "",
    badges: [
      { id: "offensive_mastermind", level: "bronze" },
      { id: "player_whisperer", level: "bronze" },
    ],
  },
  {
    firstName: "Bill",
    lastName: "Pazzuchi",
    team: "BOS",
    headshot: "",
    badges: [{ id: "player_whisperer", level: "silver" }],
  },
  {
    firstName: "Marty",
    lastName: "Hernangomez",
    team: "BKN",
    headshot: "",
    badges: [{ id: "offensive_mastermind", level: "bronze" }],
  },
  {
    firstName: "Mike",
    lastName: "Denk",
    team: "NYK",
    headshot: "",
    badges: [{ id: "defensive_mastermind", level: "silver" }],
  },
];

/**
 * Look up a master coach by their current team's abbreviation.
 * Returns null when no master entry exists for that team — caller should
 * fall back to the random name pools.
 */
export function findCoachForTeam(teamAbbreviation) {
  if (!teamAbbreviation) return null;
  return COACHES.find((c) => c.team === teamAbbreviation) ?? null;
}

function clampRating(rating) {
  return Math.max(40, Math.min(99, rating));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateCoachAttributes(overall) {
  const variance = 10;
  const attrs = {};
  for (const attr of COACH_ATTRIBUTES) {
    attrs[attr] = clampRating(overall + randInt(-variance, variance));
  }
  return attrs;
}

export function calculateCoachSalary(overall) {
  if (overall >= 85) return randInt(...COACH_SALARY_RANGES.elite);
  if (overall >= 78) return randInt(...COACH_SALARY_RANGES.great);
  if (overall >= 70) return randInt(...COACH_SALARY_RANGES.good);
  if (overall >= 62) return randInt(...COACH_SALARY_RANGES.average);
  return randInt(...COACH_SALARY_RANGES.below);
}

/**
 * Free-agent coach pool tier configuration. Used by generateCoachPool /
 * generateFreeAgentCoach in CampaignManager.js to assemble the user-facing
 * `campaign.settings.availableCoaches` array.
 *
 * - free: cheap-and-cheerful options, no badges, no token cost.
 * - good: mid-tier with a couple bronze/silver badges, modest token cost.
 * - really_good: premium hires with multiple silver/gold badges, premium cost.
 *
 * `count` slots per tier sum to FREE_AGENT_POOL_SIZE.
 */
export const FREE_AGENT_COACH_TIERS = {
  free: {
    overallRange: [60, 72],
    minBadges: 0,
    maxBadges: 0,
    badgeLevels: [],
    hireCost: 0,
    // Cost to re-sign an already-hired coach for another 2 seasons. Cheaper
    // than hiring fresh (continuity, no morale hit), but never free — even a
    // free-tier coach costs tokens to retain, so a strong starting coach can't
    // be kept indefinitely at zero cost. Scales up with tier.
    resignCost: 400,
    count: 3,
    // Number of free 1-on-1 "Coach Meeting" actions the coach can hold per
    // season before the user has to start spending tokens for extras.
    coachActionsPerSeason: 1,
  },
  good: {
    overallRange: [73, 82],
    minBadges: 1,
    maxBadges: 2,
    badgeLevels: ["bronze", "silver"],
    hireCost: 1500,
    resignCost: 1000,
    count: 3,
    coachActionsPerSeason: 3,
  },
  really_good: {
    overallRange: [83, 92],
    minBadges: 2,
    maxBadges: 3,
    badgeLevels: ["silver", "gold"],
    hireCost: 3500,
    resignCost: 2200,
    count: 2,
    coachActionsPerSeason: 5,
  },
};

// Flat token cost for one extra coach meeting after the per-season budget
// is exhausted. Same cost across all tiers — keeps the economy decision
// simple ("do I want one more meeting?" → yes / no).
export const COACH_MEETING_EXTRA_COST = 800;

// Badge level → score points. Levels are rarer the higher you go, so the
// score curve rewards a single gold/hof badge more than a stack of bronzes.
const COACH_BADGE_LEVEL_POINTS = { bronze: 1, silver: 2, gold: 4, hof: 8 };
const COACH_BADGE_POINT_WEIGHT = 3;

/**
 * Compute a coach's tier from their overallRating + badge loadout. Used at
 * generation time so every coach — whether predefined in COACHES, randomly
 * generated for an AI team, or built for the free-agent pool — carries a
 * canonical `tier` field. Same three buckets as the free-agent pool
 * (`free` | `good` | `really_good`).
 */
export function computeCoachTier(coach) {
  if (!coach) return "free";
  const ovr = coach.overallRating ?? coach.overall_rating ?? 0;
  const badges = Array.isArray(coach.badges) ? coach.badges : [];
  let badgeScore = 0;
  for (const badge of badges) {
    const level = badge?.level ?? "bronze";
    badgeScore +=
      (COACH_BADGE_LEVEL_POINTS[level] ?? 1) * COACH_BADGE_POINT_WEIGHT;
  }
  const total = ovr + badgeScore;
  if (total >= 95) return "really_good";
  if (total >= 76) return "good";
  return "free";
}

/**
 * Resolve a coach to one of the FREE_AGENT_COACH_TIERS keys. Prefers the
 * canonical `coach.tier` field stamped at generation; falls back to a fresh
 * compute for legacy records that pre-date the field.
 */
export function getCoachTierKey(coach) {
  if (coach?.tier && FREE_AGENT_COACH_TIERS[coach.tier]) return coach.tier;
  return computeCoachTier(coach);
}

/** Per-season free coach-meeting budget for a hired coach. */
export function getCoachActionBudget(coach) {
  if (!coach) return 0;
  return FREE_AGENT_COACH_TIERS[getCoachTierKey(coach)].coachActionsPerSeason;
}

/**
 * Token cost to re-sign (renew) an already-hired coach for another 2 seasons,
 * scaled by the coach's tier. Always > 0 so a top coach can't be kept forever
 * for free. See `resignCost` notes on FREE_AGENT_COACH_TIERS.
 */
export function getCoachResignCost(coach) {
  if (!coach) return 0;
  return FREE_AGENT_COACH_TIERS[getCoachTierKey(coach)].resignCost;
}

export const FREE_AGENT_POOL_SIZE = 8; // 3 + 3 + 2

/** Map a master coach's badge count to a free-agent tier key. */
export function masterCoachTier(masterCoach) {
  const badgeCount = Array.isArray(masterCoach?.badges)
    ? masterCoach.badges.length
    : 0;
  if (badgeCount === 0) return "free";
  if (badgeCount <= 2) return "good";
  return "really_good";
}
