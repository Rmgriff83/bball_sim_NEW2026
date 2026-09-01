// =============================================================================
// owners.js
// =============================================================================
// Per-team owner identities + expectations. One entry per team (all 30),
// mirroring the COACHES static-data pattern (see coaches.js). The owner is the
// person the user-GM ultimately answers to: each carries an `expectation` level
// (what they want the franchise to achieve) and `patience` (how forgiving they
// are). Part 1 keeps this minimal — a name, an expectation tier (defaulting to
// the team's facilities tier but individually tweakable), patience, and a short
// display blurb. Part 2 will flesh out the full granular motivations.
//
// Names are fictional/IP-safe (avoid real NBA owners), same spirit as the
// authored coaches. Tweak freely.
// =============================================================================

// Expectation level -> approximate expected regular-season win total. Used by
// OwnerService to gauge satisfaction (actual record vs what the owner wants).
export const EXPECTATION_WINS = {
  championship: 56,
  contender: 49,
  playoffs: 43,
  develop: 35,
  rebuild: 25,
};

// Display labels.
export const EXPECTATION_LABEL = {
  championship: 'Championship',
  contender: 'Contender',
  playoffs: 'Playoffs',
  develop: 'Development',
  rebuild: 'Rebuild',
};

export const EXPECTATION_BLURB_DEFAULT = {
  championship: 'Anything short of a title is a failure.',
  contender: 'Compete deep into the playoffs every year.',
  playoffs: 'Make the postseason and stay relevant.',
  develop: 'Develop the young core into something special.',
  rebuild: 'Build a foundation for the future — wins can wait.',
};

export const PATIENCE_LABEL = {
  1: 'Ruthless',
  2: 'Demanding',
  3: 'Moderate',
  4: 'Patient',
  5: 'Very Patient',
};

// Money-consciousness (1-5): how strongly the owner cares about staying under
// the salary cap. Higher = frugal (going over the cap weighs heavily against the
// GM); lower = spend-happy (a big-market owner who'll pay the tax for wins). Part
// 2 uses this as the weight of the global `under_cap` owner sub-task.
export const MONEY_CONSCIOUSNESS_LABEL = {
  1: 'Spend-happy',
  2: 'Flexible',
  3: 'Balanced',
  4: 'Budget-minded',
  5: 'Tightfisted',
};

// One owner per team. `expectation` loosely tracks the team's facilities tier
// (Elite -> championship/contender, Strong -> contender/playoffs, Average ->
// playoffs/develop, Developing/Rebuilding -> develop/rebuild) but is authored
// per owner so it can diverge.
export const OWNERS = [
  // Elite-facility franchises
  { firstName: 'Marcus',   lastName: 'Hale',      team: 'GSW', expectation: 'championship', patience: 2, moneyConsciousness: 1, wealthSource: 'Founded a streaming empire, then bought the team so the games would stop buffering.', blurb: 'A dynasty owner who measures every season in banners.' },
  { firstName: 'Sterling', lastName: 'Roark',     team: 'LAL', expectation: 'championship', patience: 1, moneyConsciousness: 1, wealthSource: 'Hollywood studio mogul who turned three blockbuster franchises into a yacht collection.', blurb: 'Glitz and titles — nothing less will do.' },
  { firstName: 'Vincent',  lastName: 'Crane',     team: 'MIA', expectation: 'championship', patience: 2, moneyConsciousness: 3, wealthSource: 'Made a fortune in private security contracts nobody asks too many questions about.', blurb: 'Demands a hardened, championship-or-bust culture.' },
  { firstName: 'Eleanor',  lastName: 'Whitlock',  team: 'BOS', expectation: 'contender',    patience: 2, moneyConsciousness: 2, superfan: true, wealthSource: 'Old-money biotech heiress who patented half the pills in your medicine cabinet.', blurb: 'Expects to contend for the title every single year.' },
  { firstName: 'Hank',     lastName: 'Brunswick', team: 'DAL', expectation: 'contender',    patience: 2, moneyConsciousness: 1, wealthSource: 'Texas oil and gas — struck it rich and never looked back (or down at the EPA fines).', blurb: 'Spends big and wants a deep playoff run to show for it.' },
  { firstName: 'Priya',    lastName: 'Anand',     team: 'OKC', expectation: 'contender',    patience: 3, moneyConsciousness: 5, wealthSource: 'Self-made fintech founder who took her trading app public at 29.', blurb: 'Built through the draft and now expects to break through.' },
  { firstName: 'Walter',   lastName: 'Greaves',   team: 'SAS', expectation: 'contender',    patience: 3, moneyConsciousness: 4, wealthSource: 'Fourth-generation railroad fortune, polished by a lifetime of tasteful investments.', blurb: 'Old-school class — sustained excellence over flash.' },

  // Strong-facility franchises
  { firstName: 'Gus',      lastName: 'Lindholm',  team: 'DEN', expectation: 'contender',    patience: 2, moneyConsciousness: 3, wealthSource: 'Cornered the regional craft-brewing market, one over-hopped IPA at a time.', blurb: 'Has a window open and wants it pushed wide.' },
  { firstName: 'Dmitri',   lastName: 'Volkov',    team: 'BKN', expectation: 'contender',    patience: 2, moneyConsciousness: 1, wealthSource: 'A vague "overseas commodities" empire — the wire transfers always clear, somehow.', blurb: 'Impatient money — wants stars and results fast.' },
  { firstName: 'Carl',     lastName: 'Hutchins',  team: 'MIL', expectation: 'contender',    patience: 3, moneyConsciousness: 4, superfan: true, wealthSource: 'Frozen-custard chain magnate who franchised his way to a fortune.', blurb: 'Small market, big ambitions — contend while the core is here.' },
  { firstName: 'Reginald', lastName: 'Ashford',   team: 'PHI', expectation: 'contender',    patience: 2, moneyConsciousness: 2, wealthSource: 'Hedge-fund quant who shorted exactly the right thing at exactly the right time.', blurb: 'Done with the process — it is time to win.' },
  { firstName: 'Sol',      lastName: 'Mercado',   team: 'PHX', expectation: 'playoffs',     patience: 3, moneyConsciousness: 3, wealthSource: 'Built the Southwest\'s largest solar-panel installation business.', blurb: 'Wants a steady playoff team that can catch fire.' },
  { firstName: 'Bernard',  lastName: 'Kessler',   team: 'LAC', expectation: 'playoffs',     patience: 3, moneyConsciousness: 2, wealthSource: 'Made billions in self-storage units — turns out everyone hoards everything.', blurb: 'Tired of being second fiddle — make the postseason and matter.' },
  { firstName: 'Marv',     lastName: 'Stein',     team: 'CLE', expectation: 'playoffs',     patience: 3, moneyConsciousness: 3, wealthSource: 'Scrap-metal-to-recycling tycoon; one man\'s trash built his entire empire.', blurb: 'Wants a reliable playoff fixture.' },
  { firstName: 'Roy',      lastName: 'Caldwell',  team: 'HOU', expectation: 'playoffs',     patience: 4, moneyConsciousness: 3, wealthSource: 'Petrochemical pipelines and a suspiciously well-timed crypto exit.', blurb: 'Patient with the build, but wants postseason basketball soon.' },
  { firstName: 'Pierre',   lastName: 'Tremaine',  team: 'TOR', expectation: 'playoffs',     patience: 3, moneyConsciousness: 3, wealthSource: 'Maple-syrup conglomerate that quietly controls the continental supply.', blurb: 'Expects a competitive, playoff-caliber roster.' },

  // Average-facility franchises
  { firstName: 'Otis',     lastName: 'Granger',   team: 'MEM', expectation: 'playoffs',     patience: 4, moneyConsciousness: 4, superfan: true, wealthSource: 'Built a barbecue-sauce empire from a single roadside smoker.', blurb: 'Grit-and-grind faithful — earn a playoff spot.' },
  { firstName: 'Cliff',    lastName: 'Boudreaux', team: 'NOP', expectation: 'playoffs',     patience: 3, moneyConsciousness: 4, wealthSource: 'Riverboat casinos and a shrimp-fishing fleet — laissez les bons temps rouler.', blurb: 'Wants the talent on hand to translate to the postseason.' },
  { firstName: 'Sidney',   lastName: 'Marsh',     team: 'NYK', expectation: 'playoffs',     patience: 2, moneyConsciousness: 2, superfan: true, wealthSource: 'Manhattan real-estate dynasty; owns more of the skyline than he\'ll admit.', blurb: 'Big-market pressure — the fans demand playoff runs.' },
  { firstName: 'Dale',     lastName: 'Kowalski',  team: 'ORL', expectation: 'develop',      patience: 4, moneyConsciousness: 3, wealthSource: 'Made a killing in theme-park concessions — those $14 churros add up.', blurb: 'Believes in the young core — develop and rise.' },
  { firstName: 'Brent',    lastName: 'Halvorsen', team: 'UTA', expectation: 'develop',      patience: 4, moneyConsciousness: 4, wealthSource: 'Outdoor-gear retail empire built for people who summit things before breakfast.', blurb: 'Methodical builder — grow the roster the right way.' },
  { firstName: 'Curtis',   lastName: 'Vandiver',  team: 'ATL', expectation: 'playoffs',     patience: 3, moneyConsciousness: 3, wealthSource: 'Hip-hop label founder turned mogul, with a platinum plaque on every wall.', blurb: 'Wants a fun, competitive team in the postseason hunt.' },
  { firstName: 'Maxine',   lastName: 'Thorne',    team: 'CHI', expectation: 'develop',      patience: 3, moneyConsciousness: 3, wealthSource: 'Inherited a deep-dish pizza chain and somehow doubled it.', blurb: 'Wants direction and a young core to rally behind.' },
  { firstName: 'Ray',      lastName: 'Underwood', team: 'IND', expectation: 'develop',      patience: 4, moneyConsciousness: 4, wealthSource: 'Auto-parts manufacturing fortune — every pit stop in the country pays his bills.', blurb: 'Patient with a homegrown build.' },
  { firstName: 'Lars',     lastName: 'Sundgren',  team: 'MIN', expectation: 'playoffs',     patience: 3, moneyConsciousness: 3, wealthSource: 'Iron-ore mining heir who diversified into wind farms just in time.', blurb: 'Wants the talent here to finally make noise.' },
  { firstName: 'Manny',    lastName: 'Ortega',    team: 'SAC', expectation: 'develop',      patience: 4, moneyConsciousness: 4, superfan: true, wealthSource: 'Almond and wine-country agribusiness baron of the Central Valley.', blurb: 'Ends the drought by building something lasting.' },

  // Developing-facility franchises
  { firstName: 'Earl',     lastName: 'Bishop',    team: 'CHA', expectation: 'develop',      patience: 4, moneyConsciousness: 4, wealthSource: 'Built a regional bank, sold it twice, and bought it back cheaper each time.', blurb: 'Develop young talent and climb the standings.' },
  { firstName: 'Frank',    lastName: 'Mahoney',   team: 'DET', expectation: 'rebuild',      patience: 4, moneyConsciousness: 3, wealthSource: 'Automotive supplier who pivoted to EV batteries right before everyone else.', blurb: 'Lay a real foundation — patience over quick fixes.' },
  { firstName: 'Gail',     lastName: 'Sutter',    team: 'POR', expectation: 'rebuild',      patience: 5, moneyConsciousness: 4, superfan: true, wealthSource: 'Tech-IPO money she is patiently letting compound — same as her roster.', blurb: 'Full rebuild — collect assets and grow the future.' },
  { firstName: 'Howard',   lastName: 'Pell',      team: 'WAS', expectation: 'rebuild',      patience: 4, moneyConsciousness: 3, wealthSource: 'Beltway lobbying and "government consulting" — the swampier, the richer.', blurb: 'Tear it down and build it back the right way.' },
];

/**
 * Look up a team's owner by abbreviation. Returns null if none defined (callers
 * should handle a missing owner gracefully — same contract as findCoachForTeam).
 */
export function findOwnerForTeam(teamAbbreviation) {
  if (!teamAbbreviation) return null;
  return OWNERS.find((o) => o.team === teamAbbreviation) ?? null;
}

/** Expected regular-season wins for an owner's expectation level. */
export function expectedWinsForExpectation(expectation) {
  return EXPECTATION_WINS[expectation] ?? EXPECTATION_WINS.playoffs;
}

// Expectation tiers, lowest to highest. Used by the dynamic-expectation system
// (OwnerExpectationService) to rank tiers, promote, and map a win total to a tier.
export const EXPECTATION_ORDER = ['rebuild', 'develop', 'playoffs', 'contender', 'championship'];

/** Index of a tier in EXPECTATION_ORDER (rebuild=0 … championship=4); -1 if unknown. */
export function expectationRank(tier) {
  return EXPECTATION_ORDER.indexOf(tier);
}

/** The tier one level above `tier`, or null if already at the top (championship). */
export function nextExpectationTier(tier) {
  const i = EXPECTATION_ORDER.indexOf(tier);
  if (i < 0 || i >= EXPECTATION_ORDER.length - 1) return null;
  return EXPECTATION_ORDER[i + 1];
}

/** The highest tier whose win threshold a win total reaches (floor: rebuild). */
export function tierForWins(wins) {
  let result = EXPECTATION_ORDER[0];
  for (const tier of EXPECTATION_ORDER) {
    if ((wins ?? 0) >= EXPECTATION_WINS[tier]) result = tier;
  }
  return result;
}
