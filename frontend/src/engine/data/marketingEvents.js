// Marketing events — token-costing one-time fandom boosts run from the Arena
// facility sub-tab. Capped at MARKETING_EVENTS_PER_SEASON with a
// MARKETING_COOLDOWN_DAYS in-game-day cooldown between uses (both enforced by
// FandomService.canRunMarketingEvent against campaign.settings.marketing).
//
// `name`/`description` are display strings rendered via $tDynamic — this
// module is enumerated in wl-i18n.config.js dynamicSources. `raw` is the
// pre-soft-cap fandom delta fed to applyFandomDelta (multiplied by
// MARKETING_BOOST_MULTIPLIER when the arena manager's Promo Machine perk is
// active). Costs sit against the existing token economy: facility upgrade
// 500, staff hires 1500/2500.
//
// Import-free data module (safe for build-time i18n extraction via dynamic
// import). Keep ids stable — they are stamped into campaign saves.

export const MARKETING_EVENTS = [
  // Tier 1 — cheap, modest bump
  {
    id: 'fan_appreciation_night',
    tier: 1,
    cost: 400,
    raw: 4,
    name: 'Fan Appreciation Night',
    description: 'Discounted concessions and a halftime thank-you to the faithful.',
  },
  {
    id: 'tshirt_cannon_blitz',
    tier: 1,
    cost: 400,
    raw: 4,
    name: 'T-Shirt Cannon Blitz',
    description: 'Nothing wins a crowd like free laundry fired at 60 mph.',
  },
  // Tier 2 — mid spend, solid bump
  {
    id: 'bobblehead_giveaway',
    tier: 2,
    cost: 750,
    raw: 9,
    name: 'Bobblehead Giveaway',
    description: "A collectible bobblehead of your franchise star for the first 10,000 fans.",
  },
  {
    id: 'legends_reunion',
    tier: 2,
    cost: 750,
    raw: 9,
    name: 'Legends Reunion Night',
    description: 'Franchise greats return for a halftime ceremony under the banners.',
  },
  // Tier 3 — premium spend, big bump
  {
    id: 'downtown_fan_rally',
    tier: 3,
    cost: 1300,
    raw: 16,
    name: 'Downtown Fan Rally',
    description: 'Close the streets, roll out the team bus, and let the city celebrate its team.',
  },
  {
    id: 'superstar_meet_greet',
    tier: 3,
    cost: 1300,
    raw: 16,
    name: 'Superstar Meet & Greet',
    description: 'An all-day autograph and photo session with the whole roster.',
  },
]

export function marketingEventById(id) {
  return MARKETING_EVENTS.find((e) => e.id === id) ?? null
}
