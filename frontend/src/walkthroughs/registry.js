// Walkthrough step definitions. Pure data — no logic.
//
// Each walkthrough is an ordered array of steps:
//   {
//     target:    data-tour attribute value, resolved as [data-tour="<target>"].
//                Omit (or use placement 'center') for a centered card with no spotlight.
//     title:     short heading
//     body:      explainer text
//     route?:    route NAME the engine should be on for this step (router.push if not)
//     tab?:      { view, tab } internal tab a mounted view must show (via requestTab)
//     placement: 'top' | 'bottom' | 'left' | 'right' | 'center'  (default 'bottom')
//   }
//
// Anchors are added to the first item of any v-for list so each selector is unique.

export const WALKTHROUGHS = {
  campaignHome: [
    {
      placement: 'center',
      title: 'Welcome, GM',
      body: "This is your campaign home base. Each in-game day you'll set your lineup, play or simulate games, scout prospects, and steer your franchise toward a title. Let's take a quick lap.",
    },
    {
      target: 'home-team-header',
      placement: 'bottom',
      title: 'Your Team',
      body: "This banner is your franchise at a glance — logo, name, overall rating, and the current date. Let's break down the two key readouts.",
    },
    {
      target: 'home-team-overall',
      placement: 'bottom',
      title: 'Team Overall',
      body: "This badge is your team's overall rating — the average quality of your healthy roster, and the quickest read on how your franchise stacks up. Build it through smart lineups, player development, and trades.",
    },
    {
      // Desktop shows the date in the team header; mobile shows it in the
      // campaign top bar — spotlight whichever is visible at this breakpoint.
      target: ['home-date', 'home-date-mobile'],
      placement: 'bottom',
      title: "Today's Date",
      body: 'Your current spot on the calendar. The season plays out day by day — games, trades, scouting, and the draft all happen on this timeline, and playing or simulating games advances it.',
    },
    {
      target: 'home-record-card',
      placement: 'bottom',
      title: 'Your Standing',
      body: 'Your win-loss record and conference rank live here. Climb the standings to lock in playoff seeding — top seeds get home court through the bracket.',
    },
    {
      target: 'home-tokens',
      placement: 'bottom',
      title: 'Tokens',
      body: 'Tokens are your premium currency. Spend them in the Store or on attribute upgrade points for your players. You earn them by playing and hitting milestones.',
    },
    {
      target: 'home-next-game',
      placement: 'top',
      title: 'Next Matchup',
      body: 'Your upcoming game shows the opponent, their record, and the projected starters on both sides. Size up the matchup before you commit to playing it out.',
    },
    {
      target: 'home-play-btn',
      placement: 'top',
      title: 'Play the Game',
      body: 'Hit PLAY to coach the matchup live — making substitutions and calling the action quarter by quarter.',
    },
    {
      target: 'home-sim-btn',
      placement: 'top',
      title: 'Or Simulate',
      body: 'Short on time? SIMULATE resolves the game instantly using your current lineup and minutes. The engine still respects your rotations and schemes.',
    },
    {
      target: 'home-quick-actions',
      placement: 'top',
      title: 'Quick Actions',
      body: 'These shortcuts jump straight to the key areas of your franchise — the GM Desk to manage your lineup and staff, Scouting to study the draft class, Standings, and your Schedule. You can also reach all of them from the navigation bar at the top.',
    },
    {
      target: 'home-featured-player',
      placement: 'top',
      title: 'Featured Player',
      body: 'Every couple of weeks we spotlight a standout on your roster with their recent form. Tap the card to open their full profile.',
    },
    {
      target: 'home-news',
      placement: 'top',
      title: 'Around the League',
      body: 'Trades, injuries, awards, and breaking storylines land here. Keep an eye out — they hint at trade targets and roster risks.',
    },
    {
      placement: 'center',
      title: "You're set",
      body: 'That\'s the home base. Set your lineup, then play or sim your way to the playoffs. Good luck.',
    },
  ],

  // Offseason tour — fires once when the user first hits the offseason hub
  // on Campaign Home (after the championship is decided). Walks the user
  // through the reshape-the-franchise phase: staff, facilities, then the
  // two big offseason events (free agency + rookie draft).
  campaignOffseason: [
    {
      placement: 'center',
      title: 'Welcome to the Offseason',
      body: "The season's over and the franchise is yours to reshape. You'll have time to hire or fire staff, upgrade your facilities, work the free-agent market, and draft the next class of rookies before next year tips off. Let's walk through the moves you've got.",
    },
    {
      target: 'offseason-manage-roster',
      placement: 'top',
      title: 'Roster & Staff',
      body: "Manage Roster drops you into the GM Desk — your roster page, plus the Personnel tab where you can fire your head coach, replace your scouts, or bring in new trainers, and the Facilities tab where you spend tokens to upgrade Training, Medical, Scouting, and Analytics. Smart investments here pay dividends all next season.",
    },
    {
      target: 'offseason-enter-fa',
      placement: 'top',
      title: 'Free Agency Window',
      body: "When you're ready, this kicks off the free-agency period. You'll see every unsigned player league-wide, place bids on the ones who fit your roster, and watch other teams move alongside you. Bench depth, role players, and the occasional veteran cornerstone all come from here.",
    },
    {
      target: 'offseason-scouting',
      placement: 'top',
      title: 'Rookie Draft Prep',
      body: "Scouting opens the incoming rookie class — overalls, archetypes, projected picks. Study it before the draft so you're not flying blind. Once free agency wraps, this same slot turns into BEGIN DRAFT and you're on the clock.",
    },
    {
      placement: 'center',
      title: 'Tip-off the Next Season',
      body: "Once free agency and the draft are both done, START SEASON launches year two. Until then, take your time — the offseason is where dynasties are built.",
    },
  ],

  gmTeam: [
    {
      placement: 'center',
      route: 'team-management',
      tab: { view: 'gm', tab: 'team' },
      title: 'Your GM Desk',
      body: "Welcome to the GM Desk — your franchise command center. Everything you manage lives behind these tabs: your lineup, staff, contracts, trades, facilities, and schedule.",
    },
    {
      target: ['gm-tab-team', 'gm-roster'],
      tab: { view: 'gm', tab: 'team' },
      placement: 'bottom',
      title: 'Your Lineup',
      body: "You're on the Lineup tab — where you set your starting five and rotation. This is the single biggest lever on your results, whether you play games or simulate them. Let's break it down.",
    },
    {
      target: 'gm-starters',
      tab: { view: 'gm', tab: 'team' },
      placement: 'bottom',
      title: 'Starters & Chemistry',
      body: 'Your five starters, plus a team chemistry read and your minutes total. Chemistry rises when complementary players share the floor.',
    },
    {
      target: 'gm-minutes',
      tab: { view: 'gm', tab: 'team' },
      placement: 'bottom',
      title: '200 Minutes',
      body: 'Rotation minutes must total exactly 200 (five players over 40 minutes). The meter turns green when you\'re balanced — red means the game will reject your lineup.',
    },
    {
      target: 'gm-cpu-auto',
      tab: { view: 'gm', tab: 'team' },
      placement: 'left',
      title: 'Auto-Set',
      body: 'In a hurry? Auto lets the CPU pick your best five and spread minutes sensibly. Tweak from there.',
    },
    {
      target: 'gm-starter-card',
      tab: { view: 'gm', tab: 'team' },
      placement: 'right',
      title: 'Player Cards',
      body: "Each card shows a player's ratings, assigned minutes, and fatigue at a glance.",
    },
    {
      target: ['gm-move-btn', 'gm-move-dropdown'],
      tab: { view: 'gm', tab: 'team' },
      placement: 'right',
      action: { view: 'gm', enter: 'openFirstStarterMenu', leave: 'closeLineupMenus' },
      title: 'Adjust Your Lineup',
      body: "Each card's swap button opens this menu. From here you can promote a bench player into the starting five, or send a starter to the bench — it's how you set your rotation.",
    },
    {
      target: 'gm-starter-card',
      tab: { view: 'gm', tab: 'team' },
      placement: 'right',
      interactive: true,
      title: "Open a Player's Profile",
      body: "Now tap this player's card to open their full profile — ratings, badges, development, morale, and upgrade points to spend. Go ahead and tap it.",
    },
  ],

  gmPersonnel: [
    {
      target: ['gm-personnel-coach', 'gm-coach-skills'],
      tab: { view: 'gm', tab: 'personnel' },
      placement: 'left',
      title: 'Personnel',
      body: 'Hire and manage your head coach, scout, team physician, and training staff. Better staff means sharper development, fewer injuries, and better scouting.',
    },
    {
      target: 'gm-coach-candidates',
      tab: { view: 'gm', tab: 'personnel' },
      placement: 'bottom',
      title: 'Hiring Coaches',
      body: "Browse coaching candidates here. They range from free hires to premium coaches that cost tokens. Hiring a new one replaces your current coach — re-sign yours from the button beside this to keep them instead.",
    },
    {
      target: 'gm-coach-badges',
      tab: { view: 'gm', tab: 'personnel' },
      placement: 'left',
      title: 'Coach Badges',
      body: 'Badges your coach has earned — they boost things like player development, scheme effectiveness, and clutch-time decisions.',
    },
    {
      target: 'gm-coach-badge-store',
      tab: { view: 'gm', tab: 'personnel' },
      placement: 'bottom',
      title: 'Shop Coach Badges',
      body: 'Spend tokens here to buy new coach badges and sharpen your staff\'s edge.',
    },
    {
      target: 'gm-coach-schemes',
      tab: { view: 'gm', tab: 'personnel' },
      placement: 'left',
      title: 'Coach & Schemes',
      body: "Your head coach sets the offensive and defensive schemes. Match the scheme to your roster's strengths for a real in-game edge.",
    },
  ],

  gmFinances: [
    {
      target: 'gm-tab-finances',
      tab: { view: 'gm', tab: 'finances' },
      placement: 'bottom',
      title: 'Roster & Contracts',
      body: 'Review every contract, expiring deal, and the salary picture. Players with expiring deals hit free agency unless you re-sign them — and the Free Agents sub-tab here is where you sign available players to fill out your roster.',
    },
    {
      target: 'gm-finances-overview',
      tab: { view: 'gm', tab: 'finances' },
      placement: 'bottom',
      title: 'Financial Overview',
      body: "At a glance: your salary cap, total payroll, remaining cap space, and roster count (out of 15). Stay under the cap and keep room to sign free agents.",
    },
    {
      target: 'gm-roster-card',
      tab: { view: 'gm', tab: 'finances' },
      placement: 'right',
      title: 'Player Cards',
      body: "Each player on your roster shows up as a card — name, position, age, overall, salary, and contract length. Tap a card to open the full player profile.",
    },
    {
      target: 'gm-player-actions',
      tab: { view: 'gm', tab: 'finances' },
      placement: 'right',
      title: 'Re-sign or Drop',
      body: "Players in the final year of their deal get a Re-sign button to lock in a new multi-year contract before they walk in free agency. Drop releases a player outright to free up cap space and a roster spot.",
    },
    {
      target: 'gm-finances-subtabs',
      tab: { view: 'gm', tab: 'finances' },
      placement: 'bottom',
      title: 'Roster Views',
      body: 'Switch between your roster and contracts, expiring deals, available free agents, and your draft picks here.',
    },
  ],

  // Sub-sub-tab tour: fires when the Expiring sub-tab is opened with at least
  // one expiring contract to point at (triggered from FinancesTab).
  gmFinancesExpiring: [
    {
      target: 'gm-expiring-card',
      placement: 'right',
      title: 'Expiring Contracts',
      body: "These players are in the final year of their deals. Do nothing and they'll hit free agency at season's end — and could walk for nothing.",
    },
    {
      target: 'gm-player-actions',
      placement: 'bottom',
      title: 'Re-sign or Drop',
      body: 'Re-sign keeps a player on a new multi-year deal; Drop releases them now to free up cap space and a roster spot. Re-signing closes at the Dec 15 deadline.',
    },
  ],

  gmTrades: [
    {
      target: 'gm-tab-trades',
      tab: { view: 'gm', tab: 'trades' },
      placement: 'bottom',
      title: 'Trades',
      body: 'Build and propose trades with other teams here — until the in-season trade deadline (Dec 15), after which this tab closes for the season.',
    },
    {
      target: 'gm-trades-content',
      tab: { view: 'gm', tab: 'trades' },
      placement: 'top',
      title: 'Make a Deal',
      body: 'Pick a trade partner, add players and picks from both sides, and the engine tells you whether the AI accepts. Salary-matching rules apply.',
    },
    {
      target: 'gm-trades-subtabs',
      tab: { view: 'gm', tab: 'trades' },
      placement: 'bottom',
      title: 'Trade Views',
      body: 'Switch between the Trade Center to build a deal, incoming Offers from other teams, and your Trading Block of players you\'ve made available.',
    },
  ],

  gmFacilities: [
    {
      target: 'gm-tab-facilities',
      tab: { view: 'gm', tab: 'facilities' },
      placement: 'bottom',
      title: 'Facilities',
      body: 'Upgrade your training, medical, and scouting facilities. Higher levels unlock staff perks and speed up player growth.',
    },
    {
      target: 'gm-facilities-content',
      tab: { view: 'gm', tab: 'facilities' },
      placement: 'top',
      title: 'Invest in Infrastructure',
      body: 'Facility upgrades are long-term bets — they compound across seasons by keeping players healthier and developing faster.',
    },
  ],

  gmSchedule: [
    {
      target: 'gm-tab-schedule',
      tab: { view: 'gm', tab: 'schedule' },
      placement: 'bottom',
      title: 'Schedule',
      body: 'Your full season schedule, results, and upcoming opponents at a glance.',
    },
    {
      target: 'gm-schedule-content',
      tab: { view: 'gm', tab: 'schedule' },
      placement: 'top',
      title: 'Plan Ahead',
      body: "Spot back-to-backs and rivalry games and plan rest around tough stretches. You can also simulate ahead from here — jump multiple games forward, or run the entire season at once. Heads up: tokens aren't granted when you sim several games at a time.",
    },
  ],

  // Pre-game preview screen — fires on first visit to any user game that
  // hasn't been played yet. Walks through the matchup card, court preview,
  // coaches, substitutions, the strategy pills, and the START button.
  gamePreview: [
    {
      placement: 'center',
      title: 'Game Day',
      body: "This is your pre-game war room. Before tipoff you can size up the matchup, tweak your starting five, set your offensive and defensive plan, then play it out live or simulate. Let's walk through it.",
    },
    {
      target: 'game-court',
      placement: 'bottom',
      title: 'Starting Lineups',
      body: "A court-level preview of both teams' starters with their positions and overall ratings, side by side. Quick way to spot mismatches — your point guard versus theirs, your center under the rim, and so on.",
    },
    {
      target: ['game-subs-btn', 'game-subs-dropdown'],
      placement: 'top',
      action: { view: 'gamePreview', enter: 'openSubsDropdown', leave: 'closeSubsDropdown' },
      title: 'Last-Minute Substitutions',
      body: "Need to swap a starter or adjust the rotation before tipoff? This dropdown is your full lineup control — same as the GM Desk, contextual to this game.",
    },
    {
      target: 'game-coaches',
      placement: 'top',
      title: 'Head Coaches',
      body: "Both head coaches' cards live here — their overall, badges, and the offensive and defensive schemes they're running. Coach badges and schemes both swing the simulation, so know what you're up against.",
    },
    {
      target: 'game-plan',
      placement: 'top',
      title: 'Your Game Plan',
      body: "Pick your offensive and defensive schemes for tonight. The percentage on each pill is the fit % — how well your current roster matches that scheme. Higher fit means a bigger in-game edge.",
    },
    {
      target: 'game-start-btn',
      placement: 'top',
      title: 'Tip It Off',
      body: "When you're ready, hit START to launch the game. If there are any earlier games on the schedule that haven't been played yet, you'll be prompted to sim them through first.",
    },
    {
      placement: 'center',
      title: "Let's play",
      body: "That's the pre-game flow. Set your lineup, pick your schemes, and go win one. Good luck.",
    },
  ],

  // Post-game recap — fires the first time the user lands on a completed
  // user game. Walks through the quarter scores, box score, the result
  // banner with explicit win/loss commentary, the rewards earned, and the
  // player evolution / development updates (which is the most game-impacting
  // thing on this page and the one users miss most often).
  gameRecap: [
    {
      placement: 'center',
      title: 'Game in the Books',
      body: "Here's the post-game recap. We'll quickly walk through what happened — the score by quarter, the stat lines, what you earned, and how the result reshaped your roster going forward.",
    },
    {
      target: 'postgame-quarter-scores',
      placement: 'bottom',
      title: 'Quarter by Quarter',
      body: "How the game flowed — points scored each quarter, with the winning team's row highlighted. Useful for spotting when momentum swung or when you got buried by a run.",
    },
    {
      target: 'postgame-box-score',
      placement: 'top',
      title: 'Box Score',
      body: "Every player's stat line for the game — points, rebounds, assists, shooting splits, plus/minus. Switch tabs between the two teams. The leaders here are usually the ones who carried (or sank) the result.",
    },
    {
      target: 'postgame-rewards',
      placement: 'top',
      title: 'Rewards Earned',
      body: "Tokens you banked from this game, doubled if you won. Synergies Activated counts the badge combos your lineup triggered on the floor — a sign your roster's chemistry is paying off. Tokens spend in the Store and on player upgrade points.",
    },
    {
      target: 'postgame-updates',
      placement: 'top',
      title: 'Player Updates',
      body: "This is the biggest thing on the page. After every game, players can grow, regress, get hot, cool off, get tired, or shift morale. Development bumps real ratings — the +Speed or +Three Point you see here is a permanent attribute increase that makes that player better in every future game. Regression is the opposite: ratings tick down on older players or those riding the bench too much.",
    },
    {
      placement: 'center',
      title: 'On to the next',
      body: "That's the recap. Growth and regression compound over a season, so a steady run of starter minutes for your young guys is one of the best ways to build a contender. Head back to the home page when you're ready for the next matchup.",
    },
  ],

  scouting: [
    {
      placement: 'center',
      route: 'scouting',
      title: 'Scouting Room',
      body: 'This is where you study the upcoming draft class. Information is power — the more you scout, the fewer surprises on draft night.',
    },
    {
      target: 'scout-points',
      placement: 'bottom',
      title: 'Scout Points',
      body: "Scout Points are your scouting currency. You earn them weekly — a sharper scout and better scouting facility earn more. Spend them to reveal prospects' hidden ratings.",
    },
    {
      target: 'scout-tab-rookies',
      placement: 'bottom',
      title: 'Prospect Board',
      body: "The Rookies tab lists this year's draft class. Filter and sort to find fits for your roster's needs.",
    },
    {
      target: 'scout-filters',
      placement: 'bottom',
      title: 'Filter by Position',
      body: 'Narrow the board by position to target the holes in your lineup, or search by name.',
    },
    {
      target: 'scout-card',
      placement: 'right',
      title: 'Prospect Cards',
      body: "Each card shows what you've uncovered so far. Click a card for the full breakdown, attribute by attribute.",
    },
    {
      target: 'scout-meter',
      placement: 'top',
      title: 'Scouting Progress',
      body: 'This meter shows how fully you\'ve scouted a prospect. Ratings stay hidden until you reveal them — and potential only unlocks at 100%.',
    },
    {
      target: 'scout-card-btn',
      placement: 'top',
      title: 'Scout a Prospect',
      body: "Spend one Scout Point to reveal a chunk of a prospect's ratings. Fully scout your draft targets before they're on the clock.",
    },
    {
      target: 'scout-tab-mock',
      placement: 'bottom',
      title: 'Mock Draft',
      body: 'The Draft tab projects the draft order. Your picks are highlighted — track where you\'re slotted and which prospects might fall to you.',
    },
    {
      placement: 'center',
      title: 'Draft smart',
      body: "Scout aggressively, target your needs, and you'll find steals late in the first round. Good luck on draft night.",
    },
  ],

  // Live draft room (fantasy or rookie draft). Fires on first visit; the draft
  // pick clock is paused for the duration of the tour (see DraftRoomView).
  liveDraft: [
    {
      placement: 'center',
      title: 'The Draft Room',
      body: "Welcome to the live draft — you'll build your roster pick by pick. Don't worry, your pick clock is paused while we take a quick tour.",
    },
    {
      target: 'draft-clock',
      placement: 'bottom',
      title: 'On the Clock',
      body: "Shows whose turn it is. When you're up, a 60-second timer counts down — if it hits zero, the best available player is auto-drafted for you.",
    },
    {
      target: 'draft-ticker',
      placement: 'bottom',
      title: 'Draft Order',
      body: 'The full pick order runs across here. Your team is highlighted so you can see exactly when you pick.',
    },
    {
      target: 'draft-pool',
      placement: 'top',
      title: 'Available Players',
      body: 'Every undrafted player. Tap a column header to sort — chase overall rating for win-now talent, or potential for upside.',
    },
    {
      target: 'draft-filters',
      placement: 'bottom',
      title: 'Filter & Search',
      body: 'Narrow the pool by position, or search by name to zero in on a player.',
    },
    {
      target: 'draft-player-row',
      placement: 'top',
      title: 'Scout & Pick',
      body: "Tap a player's row to open their profile. When you're on the clock, a Draft button appears on each row — hit it to add that player to your roster.",
    },
    {
      // Desktop shows the roster sidebar; mobile collapses it behind a toggle
      // button — spotlight whichever is visible at the current breakpoint.
      target: ['draft-roster', 'draft-roster-toggle'],
      placement: 'right',
      title: 'Your Roster',
      body: 'Every player you draft lands here, grouped by position. Keep an eye on it to build a balanced lineup.',
    },
    {
      target: 'draft-controls',
      placement: 'top',
      title: 'Skip Controls',
      body: 'In a hurry? Skip to your next pick, or skip the entire draft to auto-fill your roster with the best available players.',
    },
    {
      placement: 'center',
      title: "You're on the clock",
      body: "That's the draft room. Build a balanced roster and good luck — your pick clock resumes as soon as you close this.",
    },
  ],

  playerDetail: [
    {
      target: 'pdm-header',
      placement: 'bottom',
      title: 'Player Profile',
      body: "The header gives you the quick read — their vitals (height, weight, and age), position(s), current morale, and overall rating.",
    },
    {
      target: 'pdm-trade-toggle',
      placement: 'left',
      title: 'Trade Block',
      body: "Tap this toggle to put the player on your trading block — a signal to the rest of the league that you're open to dealing them. Flip it off anytime to pull them back.",
    },
    {
      target: 'pdm-fatigue',
      placement: 'bottom',
      title: 'Fatigue',
      body: 'Tired players play worse and risk injury. Watch fatigue across a heavy stretch and rest starters before it climbs into the red. A high Durability rating slows how fast a player tires, while strong Stamina blunts the performance hit when they do.',
    },
    {
      target: 'pdm-badges',
      placement: 'top',
      title: 'Badges',
      body: 'Badges are special abilities that boost specific situations — and some form synergies when the right teammates share the floor. They can swing close games.',
      link: { label: 'See the full badge synergy database →', to: '/profile?tab=database' },
    },
    {
      target: 'pdm-stats',
      placement: 'left',
      title: 'Season Stats',
      body: "This is the player's stat line, season by season, with the current season up top. It starts empty and fills in as you play or simulate games.",
    },
    {
      target: 'pdm-contract',
      placement: 'top',
      title: 'Contract',
      body: "Down in the footer is the player's contract — their salary and years remaining. Watch the years: an expiring deal must be re-signed or the player walks in free agency.",
    },
    {
      target: 'pdm-tabs',
      placement: 'bottom',
      title: 'Deep Dive',
      body: 'Switch between stats, attributes, badges, development history, and morale using these tabs.',
    },
  ],

  // --- Sub-tab tours (fire on first visit to each tab; intentionally minimal) ---

  playerDetailAttributes: [
    {
      target: 'pdm-upgrade-banner',
      placement: 'bottom',
      title: 'Upgrade Points',
      body: 'Two pools — offense and defense — earned through game performance. Every 1.0 points buys a +1 attribute bump.',
    },
    {
      target: ['pdm-buy-offense', 'pdm-buy-defense'],
      placement: 'bottom',
      title: 'Buy Points',
      body: 'Short on points? Spend tokens here to buy one outright for either pool.',
    },
    {
      target: 'pdm-attributes-list',
      placement: 'top',
      title: 'Attributes',
      body: "Ratings broken down by category. Hit the + on any attribute to spend a point and raise it.",
    },
  ],

  playerDetailBadges: [
    {
      target: 'pdm-badges-list',
      placement: 'left',
      title: 'Badges',
      body: "Every badge this player has earned, grouped by tier — Bronze, Silver, Gold, and Hall of Fame — unlocked as their attributes grow. A badge that's glowing with a ⚡ is firing an active synergy with a teammate on the floor.",
      link: { label: 'See the full badge synergy database →', to: '/profile?tab=database' },
    },
    {
      target: 'pdm-badge-store-btn',
      placement: 'bottom',
      title: 'Badge Store',
      body: 'You can also buy new badges and upgrade their tiers with tokens here.',
    },
  ],

  playerDetailGrowth: [
    {
      target: 'pdm-growth',
      placement: 'left',
      title: 'Development',
      body: 'Players evolve season to season. The young grow toward their Potential — faster with high Work Ethic, heavy minutes, and good morale — while age brings decline, physical attributes fading first. A strong development coach speeds it along.',
    },
    {
      target: 'pdm-growth-recent',
      placement: 'left',
      title: 'Recent vs. All-Time',
      body: 'Recent lists the last 7 days of changes; expand All-Time below for every adjustment across the player\'s career.',
    },
  ],

  playerDetailMorale: [
    {
      target: 'pdm-morale-current',
      placement: 'bottom',
      title: 'Morale',
      body: "A player's morale rises and falls with their minutes versus what they expect, plus the team's wins and losses. Happy players perform better and develop faster; unhappy ones can sour the locker room or ask out.",
    },
    {
      target: 'pdm-coach-meeting',
      placement: 'bottom',
      title: 'Coach Meeting',
      body: 'Hold a coach meeting for a quick morale boost. Your head coach gets a limited number each season — when they run out, you can buy extra meetings with tokens.',
    },
    {
      target: 'pdm-traits',
      placement: 'left',
      title: 'Personality Traits',
      body: 'Traits shape how a player affects team chemistry — leaders lift the locker room, ball-hogs drag it down. Not every player has notable traits.',
    },
    {
      target: 'pdm-motivations',
      placement: 'left',
      title: 'Motivations',
      body: "What the player values most — money, winning, role, loyalty. When their deal is up, how well you've satisfied these drives whether they re-sign or walk.",
    },
  ],

  // Headshot editor tour — fires on first visit even when global walkthroughs
  // are disabled (the editor is an opt-in unlock, the user just paid to use
  // it, so we don't want them landing on the page with no orientation). The
  // editor view triggers via walkthroughStore.forceStart() on first visit,
  // falling back to maybeStart() on subsequent visits so the standard
  // enabled-gate + isDone() guard applies.
  headshotEditor: [
    {
      placement: 'center',
      title: 'Make Them Yours',
      body: "Tweak any layer of this player's face — style, color, or toggle features on and off. Save when you like the look and it syncs across your devices.",
    },
    {
      target: 'editor-layer-hair',
      placement: 'left',
      title: 'Layers',
      body: 'Each button on the side opens controls for one part of the face — hair, skin, eyes, mouth, and so on.',
    },
    {
      target: 'editor-context-menu',
      placement: 'top',
      // The context menu only renders when a layer is active. Have the editor
      // open the Hair menu for this step so the user sees what we're spotlighting,
      // then close it when the step leaves.
      action: { view: 'headshotEditor', enter: 'openHairContext', leave: 'closeContext' },
      title: 'Pick a Variant',
      body: 'Tap a thumbnail to swap that part. Color swatches under the styles let you change just the tint. The big preview updates instantly.',
    },
    {
      target: 'editor-save',
      placement: 'bottom',
      title: 'Save',
      body: 'Locks in your changes and returns you to the player.',
    },
    {
      target: 'editor-exit',
      placement: 'bottom',
      title: 'Back Out',
      body: "Closes the editor. If you have unsaved changes you'll be asked first.",
    },
    {
      placement: 'center',
      title: "You're Set",
      body: 'Have fun. You can come back and re-edit anytime from any player.',
    },
  ],
}
