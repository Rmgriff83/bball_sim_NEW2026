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
      // Desktop shows the date in the team header; mobile shows it in the
      // campaign top bar — spotlight whichever is visible at this breakpoint.
      target: ['home-date', 'home-date-mobile'],
      placement: 'bottom',
      title: "Today's Date",
      body: 'Your current spot on the calendar. The season plays out day by day — games, trades, scouting, and the draft all happen on this timeline, and playing or simulating games advances it.',
    },
    {
      target: 'home-team-overall',
      placement: 'bottom',
      title: 'Team Overall',
      body: "This badge is your team's overall rating — the average quality of your healthy roster, and the quickest read on how your franchise stacks up. Build it through smart lineups, player development, and trades.",
    },
    {
      target: 'home-facilities',
      placement: 'bottom',
      title: 'Facilities',
      body: 'A quick read on your four franchise facilities — Training, Medical, Scouting, and Analytics — each rated 1 to 5 stars. They degrade a step every offseason if you don\'t maintain them. Higher facility levels unlock the perks your hired staff can apply, so upgrading here is what turns a 4-star trainer or scout into their full-strength version.',
      // Strip only renders once a team is loaded with facilities data —
      // skip cleanly if it's not on screen (e.g. cold-load mid-tour).
      skipIfMissing: true,
    },
    {
      target: 'home-team-morale',
      placement: 'bottom',
      title: 'Team Morale',
      body: 'Rolling average of every player\'s personal morale. Wins, losses, playing time, and re-sign drama all move this needle — green is a happy locker room, red is danger. Drill into any player\'s profile to see what\'s driving theirs and where a coach meeting could help.',
      // Chip only renders once the team store has populated; skip cleanly
      // if a cold-load fires the tour before that.
      skipIfMissing: true,
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
      target: 'home-upcoming-fa',
      placement: 'top',
      title: 'Expiring Contracts',
      body: 'Players whose deals end this offseason show up here, sorted by overall — with a re-sign likelihood meter under each row. Tap any name to open their profile, or hit View all to jump to the full Expiring sub-tab where you can extend them.',
      // The card only renders once a team has loaded; if it isn't on
      // screen (cold load mid-tour, or the user hasn't entered season
      // 1 yet) skip cleanly instead of stalling.
      skipIfMissing: true,
    },
    {
      target: 'home-news',
      placement: 'top',
      title: 'Around the League',
      body: 'Trades, injuries, awards, and breaking storylines land here. Keep an eye out — they hint at trade targets and roster risks.',
    },
    {
      // Desktop puts the nav in a horizontal strip in the campaign header;
      // mobile uses the floating bottom-nav island. Spotlight whichever
      // is visible at this breakpoint so the user knows where to jump
      // around the franchise from here on.
      target: ['home-top-nav', 'home-bottom-nav'],
      placement: 'top',
      title: 'Where To Next',
      body: 'These tabs are how you actually run the franchise day-to-day. GM View is your roster, finances, and personnel hub. League shows standings, stat leaders, and other rosters. Scout opens the upcoming draft class. And Play takes you to your next game. Bounce around — every screen has more to offer than the homepage can show.',
    },
  ],

  // Offseason tour — fires once when the user first hits the offseason hub
  // on Campaign Home (after the championship is decided). Walks the user
  // through the reshape-the-franchise phase: staff, facilities, then the
  // three big offseason events (draft lottery → free agency → rookie draft).
  campaignOffseason: [
    {
      placement: 'center',
      title: 'Welcome to the Offseason',
      body: "The season's over and the franchise is yours to reshape. You'll have time to hire or fire staff, upgrade your facilities, run the draft lottery, work the free-agent market, and draft the next class of rookies before next year tips off. Let's walk through the moves you've got.",
    },
    {
      target: 'offseason-manage-roster',
      placement: 'top',
      title: 'Roster & Staff',
      body: "Manage Roster drops you into the GM Desk — your roster page, plus the Personnel tab where you can fire your head coach, replace your scouts, or bring in new trainers, and the Facilities tab where you spend tokens to upgrade Training, Medical, Scouting, and Analytics. Smart investments here pay dividends all next season.",
    },
    {
      target: 'offseason-draft-lottery',
      placement: 'top',
      title: 'Draft Lottery',
      body: "First stop: the lottery decides this year's draft order. The 14 worst teams enter a weighted drawing for the top 4 picks — the worst three each have a 14% shot at #1, with odds tapering down from there. A bad season doesn't guarantee the top pick anymore; it just gives you the best odds. Click to run it and see who climbed up the board (and who got jumped).",
      // After the lottery runs, this button is replaced by Enter Free Agency.
      // Skip cleanly on second visits so the tour doesn't try to spotlight
      // an element that's no longer in the DOM.
      skipIfMissing: true,
    },
    {
      target: 'offseason-enter-fa',
      placement: 'top',
      title: 'Free Agency Window',
      body: "After the lottery, this kicks off the free-agency period. You'll see every unsigned player league-wide, place bids on the ones who fit your roster, and watch other teams move alongside you. Bench depth, role players, and the occasional veteran cornerstone all come from here.",
      // FA button only appears after the lottery has run; before that, the
      // Draft Lottery button takes its slot. Skip cleanly during the lottery
      // window so the tour doesn't fall back to a centered card.
      skipIfMissing: true,
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
      body: "Once the lottery, free agency, and the draft are all done, START SEASON launches year two. Until then, take your time — the offseason is where dynasties are built.",
    },
  ],

  // Free-agency tour — fires when the user closes the Draft Lottery results
  // modal (the lottery is done, free agency is the very next move). Goes deeper
  // on the FA mechanics than the offseason overview's single FA step, and lands
  // at the exact moment the user is about to work the market.
  freeAgency: [
    {
      placement: 'center',
      title: 'Now: Free Agency',
      body: "With the lottery settled, the free-agent market opens. For two in-game weeks you'll compete with every other team to sign unsigned players — bench depth, role players, and the occasional difference-maker. Here's how to work it.",
    },
    {
      target: 'offseason-enter-fa',
      placement: 'top',
      title: 'Open the Window',
      body: "Hit ENTER FREE AGENCY to start the period. It drops you straight onto the free-agent board in your GM Desk, where every available player is listed with their asking price.",
      // The button is gone once FA has already started — skip cleanly then.
      skipIfMissing: true,
    },
    {
      placement: 'center',
      title: 'Place Your Offers',
      body: "On the board, make multi-year offers to players who fit your roster and cap space. Rival teams are bidding too — the winning offer balances money, role, and team fit, so a perfect-fit pitch can beat a richer one.",
    },
    {
      placement: 'center',
      title: 'Sim the Days',
      body: "Back on the home page you'll sim free agency a day at a time — watching who signs where and adjusting your offers in response — or sim the rest of the window at once. When it wraps, you're on the clock for the rookie draft.",
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
      title: '240 Minutes',
      body: 'Rotation minutes must total exactly 240 (five players over 48 minutes). The meter turns green when you\'re balanced — red means the game will reject your lineup.',
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
      target: 'gm-min-fatigue',
      tab: { view: 'gm', tab: 'team' },
      placement: 'right',
      title: 'Minutes vs. Fatigue',
      body: "Drag the MIN slider to set this player's rough minutes for the next game — but watch the FATIGUE bar underneath. Push tired starters too hard and their efficiency tanks AND they're far more likely to get hurt.",
      skipIfMissing: true,
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
      target: 'gm-coach-skills',
      tab: { view: 'gm', tab: 'personnel' },
      placement: 'top',
      skipIfMissing: true,
      title: 'Coaching Skills',
      body: "Your head coach's skill ratings — their strengths across areas like player development, offense, defense, and motivation. A sharper coach squeezes more out of your roster.",
    },
    {
      target: 'gm-coach-actions',
      tab: { view: 'gm', tab: 'personnel' },
      placement: 'top',
      skipIfMissing: true,
      title: 'Coach Actions',
      body: "Your coach's per-season action pools — Coach Meetings (lift a player's morale) and Player Trainings — showing how many remain this season and what each one does. They reset every season, so spend them wisely.",
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
      body: "At a glance: your salary cap, total payroll, cap space, roster count, and your position mix. You're allowed to spend past the cap — but the deeper you go, the harsher the league's penalties. More on that next.",
    },
    {
      target: 'gm-cap-ladder',
      tab: { view: 'gm', tab: 'finances' },
      placement: 'bottom',
      title: 'League Thresholds & Penalties',
      body: "The league's spending lines — Salary Cap, Luxury Tax, First Apron, Second Apron — with a chip showing where your payroll sits. Over the First Apron, trades can't bring back more salary than you send out. Over the Second, only minimum-salary signings are allowed — and finishing a season there drops your next first-round pick to the end of round 1. The 'Owner limit' tag marks the line your owner expects you to respect; blow past it and your job security takes the hit.",
      // Ladder is hidden on legacy finance summaries without the tax passthrough.
      skipIfMissing: true,
    },
    {
      target: 'gm-roster-card',
      tab: { view: 'gm', tab: 'finances' },
      placement: 'right',
      title: 'Player Cards',
      body: "Each player on your roster shows up as a card — name, position, age, overall, salary, and contract length. Tap a card to open the full player profile.",
      // Roster cards only render on the Roster sub-tab. If the tour fires while
      // the user is on another finances sub-tab (e.g. Free Agents during the FA
      // window), skip cleanly instead of stalling waiting for an absent element.
      skipIfMissing: true,
    },
    {
      target: 'gm-player-actions',
      tab: { view: 'gm', tab: 'finances' },
      placement: 'right',
      title: 'Re-sign or Drop',
      body: "Players in the final year of their deal get a Re-sign button to lock in a new multi-year contract before they walk in free agency. Drop releases a player outright to free up cap space and a roster spot.",
      // Same as above — these actions live on roster cards (Roster sub-tab only).
      skipIfMissing: true,
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
      body: 'Re-sign keeps a player on a new multi-year deal; Drop releases them now to free up cap space and a roster spot. Re-signing closes at the Feb 5 deadline.',
    },
  ],

  gmTrades: [
    {
      target: 'gm-tab-trades',
      tab: { view: 'gm', tab: 'trades' },
      placement: 'bottom',
      title: 'Trades',
      body: 'Build and propose trades with other teams here — until the in-season trade deadline (Feb 5), after which this tab closes for the season.',
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
      body: 'Upgrade your training, medical, scouting, and analytics facilities. Your hired staff\'s perks only take effect once the matching facility reaches the level listed on each perk — a 4-star hire runs at partial strength until the facility catches up.',
    },
    {
      target: 'gm-facilities-content',
      tab: { view: 'gm', tab: 'facilities' },
      placement: 'top',
      title: 'Invest in Infrastructure',
      body: 'Each level card spells out exactly what it activates — extra scouting points, your trainer\'s development boost, your physician\'s recovery perks, your analyst\'s reports. Locked staff perks show "Requires Facility Lv X" on the Staff tab and switch on the moment you hit that level.',
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

  gmOwner: [
    {
      target: 'gm-tab-owner',
      tab: { view: 'gm', tab: 'owner' },
      placement: 'bottom',
      title: 'The Owner',
      body: "This is the Owner tab — your relationship with the person who signs your checks. Your standing here is what decides whether you keep the job.",
    },
    {
      target: 'owner-identity',
      tab: { view: 'gm', tab: 'owner' },
      placement: 'bottom',
      title: 'Meet the Owner',
      body: "Who you answer to: their name, the franchise, and how they made their fortune — which hints at how freely they'll let you spend.",
    },
    {
      target: 'owner-satisfaction',
      tab: { view: 'gm', tab: 'owner' },
      placement: 'bottom',
      skipIfMissing: true,
      title: 'Owner Satisfaction',
      body: "Your overall standing — 60% how your record measures up to their expectations, 40% the sub-tasks below. Let it slide too far and your seat gets hot.",
    },
    {
      target: 'owner-expectations',
      tab: { view: 'gm', tab: 'owner' },
      placement: 'top',
      title: 'Expectations',
      body: "The owner's mandate and expected wins, plus how Patient and money-conscious they are — all of which shape how harshly they judge you.",
    },
    {
      target: 'owner-subtasks',
      tab: { view: 'gm', tab: 'owner' },
      placement: 'top',
      title: 'Owner Sub-Tasks',
      body: "Concrete goals the owner tracks across your whole contract. Knock these out to lift your satisfaction — they make up 40% of your evaluation.",
    },
    {
      target: 'owner-gm-level',
      tab: { view: 'gm', tab: 'owner' },
      placement: 'top',
      skipIfMissing: true,
      title: 'Your GM Level',
      body: "Your career rank as a GM. It climbs each time an owner re-signs you, and higher levels let you take over stronger, more prestigious franchises.",
    },
    {
      target: 'owner-contract',
      tab: { view: 'gm', tab: 'owner' },
      placement: 'top',
      title: 'Your GM Contract',
      body: "Your deal: when you signed, its length, and the years remaining. The final year is your audition — deliver and the owner extends you (and bumps your GM Level).",
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
      target: 'game-pacing',
      placement: 'top',
      title: 'Game Pacing',
      body: "Pacing controls how often a live game pauses for your input. By Quarter plays a full quarter straight through and stops at the breaks — the fastest, most hands-off way to watch. Every Play pauses after every single possession for maximum control. Dead Balls is the middle ground: play runs until a natural stoppage — a foul, an out-of-bounds, a timeout — then pauses so you can sub and adjust. You can change it any time from this screen, and for a game in progress the new mode applies when you resume.",
    },
    {
      target: 'game-matchups',
      placement: 'top',
      title: 'Defensive Matchups',
      body: "Choose who guards whom. Swap any defender onto a different opponent — put your best stopper on their star, or hide a weak defender on a low-usage player. Your assignments carry into the game and can be adjusted at quarter breaks.",
      skipIfMissing: true,
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

  // Live broadcast — fires the first time the user enters a live game.
  // GameView holds tip-off (the animation is loaded but not playing) while
  // this runs, and starts play the moment the tour finishes or is dismissed.
  gameLive: [
    {
      placement: 'center',
      title: 'Welcome to the Broadcast',
      body: "This is your live game. We've held tip-off while we show you around — play starts the moment you finish.",
    },
    {
      target: 'game-live-court',
      placement: 'bottom',
      title: 'The Court',
      body: "Plays animate here possession by possession. At dead balls the game pauses (based on your pacing setting) with a stoppage bubble — hit Continue to keep playing.",
    },
    {
      target: 'game-live-controls',
      placement: 'top',
      title: 'Playback Controls',
      body: "Pause or resume the action, change the playback speed, and mute the game sounds.",
    },
    {
      target: 'game-live-coach',
      placement: 'bottom',
      title: 'Coach Overview',
      body: "Your head coach, with the offensive and defensive schemes you're currently running on the chips below. Your in-game actions live on this strip too.",
    },
    {
      target: 'game-live-timeout',
      placement: 'bottom',
      title: 'Timeouts',
      body: "Tap mid-play to arm a timeout — it's called at the end of the current play — or tap at a dead ball to call one immediately. A timeout resets momentum to even and gives your five on the floor a real breather.",
    },
    {
      target: 'game-live-cluster',
      placement: 'bottom',
      interactive: true,
      title: 'Your Coaching Panel',
      body: "Tap your coach box to open the coaching panel — it works any time, even while the ball is live. Go ahead — tap it.",
    },
    {
      target: 'game-live-coaches-panel',
      placement: 'bottom',
      action: { view: 'gameLive', enter: 'openCoaches', leave: 'closeCoaches' },
      title: 'One Panel, Three Tabs',
      body: "Adjust your offensive and defensive settings, defensive matchups, and substitutions from these tabs. Changes made while the ball is live take effect right after the current play.",
    },
    {
      target: 'game-live-momentum',
      placement: 'right',
      title: 'Momentum',
      body: "The rail tracks who has the run — a hot streak boosts that team's play until it cools off, or until you burn a timeout to reset it.",
    },
    {
      target: 'game-live-stats',
      placement: 'left',
      title: 'Live Stats',
      body: "Top performers update as plays resolve. The colored percentage is each player's fatigue — tired players play worse and risk injury, so sub them out before it climbs into the red.",
    },
    {
      placement: 'center',
      title: 'Enjoy the Game',
      body: "That's the broadcast. Good luck, coach — tip-off is right after you close this.",
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
      body: "Scout Points are your scouting currency. You earn them every two weeks — a sharper scout and better scouting facility earn more. Spend them to reveal prospects' hidden ratings.",
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
      body: 'Every undrafted player. Tap Name, OVR, or POT at the top to sort — chase overall rating for win-now talent, or potential for upside. Each row scrolls sideways to reveal the full attribute breakdown.',
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
      // Banner is only rendered when the player is on the user team and
      // hasn't already capped their potential — skip the tip cleanly when
      // it isn't on screen so the tour doesn't stall waiting for it.
      skipIfMissing: true,
    },
    {
      target: ['pdm-buy-offense', 'pdm-buy-defense'],
      placement: 'bottom',
      title: 'Buy Points',
      body: 'Short on points? Spend tokens here to buy one outright for either pool.',
      // Buy buttons live inside the upgrade banner — same gating.
      skipIfMissing: true,
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
      body: "Every badge this player has earned, grouped by tier — Bronze, Silver, Gold, and Hall of Fame. A badge that's glowing with a ⚡ is firing an active synergy with a teammate on the floor.",
      link: { label: 'See the full badge synergy database →', to: '/profile?tab=database' },
    },
    {
      target: 'pdm-train-btn',
      placement: 'bottom',
      title: 'Train',
      body: 'Each season your coach gets a handful of training actions (2 / 3 / 4 by tier). Tap Train, wait 3 hours real-time, then claim — you\'ll earn a random open badge or upgrade. Bronzes are most common, HoF the rarest. Hire a 4-Star Staff Trainer with the Accelerated Training perk to cut the timer to 45 minutes.',
      // Train CTA is hidden when there's no eligible reward, no coach
      // hired, or a training is already in flight. Skip cleanly in those
      // states instead of stalling the tour.
      skipIfMissing: true,
    },
    {
      target: 'pdm-badge-store-btn',
      placement: 'bottom',
      title: 'Badge Store',
      body: 'Need a specific badge or upgrade right now? The Badge Store lets you spend tokens to pick exactly what you want — a secondary route when you don\'t want to wait on the training cycle.',
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
      target: 'editor-name',
      placement: 'bottom',
      title: 'Rename the Player',
      body: 'Tap the pencil next to the name up top to give this player a different one — useful if you want them to feel like your own. Press Enter or tap the check to save the new name.',
    },
    {
      target: 'editor-layer-pills',
      placement: 'bottom',
      // The pill row only renders once the context menu is open, so make
      // sure the editor opens the Hair menu before this step shows. The
      // next step (Pick a Variant) re-issues the same enter action so the
      // menu stays open across both spotlights — and stays open through
      // the rest of the walkthrough too, since the layer pills live
      // inside this menu and a leave-time closeContext would leave the
      // user with no way back to them without exiting the editor.
      action: { view: 'headshotEditor', enter: 'openHairContext' },
      title: 'Layers',
      body: 'Tap a pill to switch which part of the face you\'re editing — hair, eyes, mouth, headband, and so on.',
    },
    {
      target: 'editor-context-menu',
      placement: 'top',
      action: { view: 'headshotEditor', enter: 'openHairContext' },
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

  // ===========================================================================
  // Custom Roster Editor (paid feature) — a CHAIN of small tours, each ending
  // where the next begins. Started with forceStart (first use, any player) by
  // RosterSetupView; the chain gates on isDone flags. Interactive steps finish
  // their tour BEFORE the tapped element's handler runs, which is what hands
  // off cleanly from grid → team page → row flow → player editor modal.
  // ===========================================================================

  // Fires the moment the editor opens on the start-choice screen (before any
  // mode is picked) — the grid tour then takes over once a choice is made.
  rosterEditorStart: [
    {
      placement: 'center',
      route: 'roster-setup',
      title: 'Welcome to the Roster Editor',
      body: 'First, pick your starting point. Whichever you choose, every team, player, and coach stays fully editable afterward — this only decides what fills the league before you take over.',
    },
    {
      target: 'rse-start-generated',
      route: 'roster-setup',
      placement: 'bottom',
      title: 'Start From Generated',
      body: 'A full, balanced league is already built — the fastest path. Tweak as much or as little as you like.',
    },
    {
      target: 'rse-start-scratch',
      route: 'roster-setup',
      placement: 'bottom',
      title: 'Start From Scratch',
      body: 'Empties every roster so you author each team yourself. And if you\'ve downloaded community rosters, they appear here as a third option — pick one to start from it.',
    },
  ],

  rosterEditorGrid: [
    {
      placement: 'center',
      route: 'roster-setup',
      title: 'Your League, Your Rules',
      body: "This is the Roster Editor. Every team card opens that franchise's roster, coach, history, and draft picks for editing. The Free Agents card holds the league's starting signing market — you author that pool too. Shape everything to your liking, then Finish & Start Season locks it in.",
    },
    {
      target: 'rse-user-team',
      route: 'roster-setup',
      placement: 'bottom',
      interactive: true,
      title: 'Start With Your Team',
      body: "This one's yours. Tap your team card to open its roster and start editing.",
    },
  ],

  // Builder (workshop) variant of the grid tour — a roster TEMPLATE has no
  // "your team", so the interactive step anchors to the first team card (the
  // view tags it rse-user-team when no user team exists) with neutral copy.
  rosterEditorGridWorkshop: [
    {
      placement: 'center',
      route: 'roster-setup',
      title: 'Your League, Your Rules',
      body: "This is the Roster Editor. Every team card opens that franchise's roster, coach, history, and draft picks for editing. The Free Agents card holds the league's starting signing market — you author that pool too. Shape everything to your liking, then Done saves it to your Builder projects.",
    },
    {
      target: 'rse-user-team',
      route: 'roster-setup',
      placement: 'bottom',
      interactive: true,
      title: 'Open a Team',
      body: 'Tap any team card to open its roster and start editing.',
    },
  ],

  rosterEditorTeam: [
    {
      target: ['rse-team-header', 'rse-owner-row'],
      route: 'roster-setup',
      placement: 'bottom',
      title: 'The Team at a Glance',
      body: "Team overall, owner, payroll against the cap, and facilities. The pencil next to the name renames the city and team — the 3-letter abbreviation stays fixed.",
    },
    {
      target: 'rse-history-picks',
      route: 'roster-setup',
      placement: 'bottom',
      title: 'History & Draft Picks',
      body: "Author this franchise's past — titles, playoff runs, season records — with Edit History. Draft Picks lets you re-assign future firsts and seconds to other teams; traded picks carry their 'via' credit into the campaign.",
    },
    {
      target: 'rse-coach-row',
      route: 'roster-setup',
      placement: 'top',
      title: 'The Head Coach',
      body: 'Every team keeps a head coach — edit their name, ratings, schemes, and badges here. Own the Headshot Editor too? Then you can redraw their face as well.',
    },
  ],

  rosterEditorScratch: [
    {
      target: 'rse-add-btn',
      route: 'roster-setup',
      placement: 'top',
      interactive: true,
      title: 'Create Your First Player',
      body: 'This roster is empty — tap Add Player to create one. Pick an archetype and talent level for the base, then fine-tune every detail.',
    },
  ],

  rosterEditorRows: [
    {
      target: 'rse-first-row',
      route: 'roster-setup',
      placement: 'bottom',
      interactive: true,
      title: 'Select a Player',
      body: 'Tap a player once to select their row.',
    },
    {
      target: 'rse-selected-header',
      route: 'roster-setup',
      placement: 'bottom',
      title: 'The Selected Player',
      body: 'Selecting a row swaps in this player header — name (tap the pencil to rename), positions, jersey number, vitals, archetype, and contract, with overall and potential tracking your edits live.',
    },
    {
      target: ['rse-first-row', 'rse-mode-toggle'],
      route: 'roster-setup',
      placement: 'bottom',
      title: 'Overall vs. Potential',
      body: "With a row selected, the chevrons adjust each attribute directly. The Overall / Potential toggle switches what you're editing: current ratings, or the growth ceilings each attribute can develop to over a career.",
    },
    {
      target: 'rse-first-row',
      route: 'roster-setup',
      placement: 'bottom',
      interactive: true,
      title: 'Open the Full Editor',
      body: 'Tap the selected row again to open the full player editor.',
    },
  ],

  rosterEditorPlayer: [
    {
      target: 'pdem-hero',
      route: 'roster-setup',
      placement: 'bottom',
      title: 'The Player Editor',
      body: 'Everything else about a player lives here — name, vitals, and position. If you own the Headshot Editor, the brush on the avatar opens it.',
    },
    {
      target: 'pdem-edit-tabs',
      route: 'roster-setup',
      placement: 'bottom',
      title: 'Six Tabs, Full Control',
      body: 'Vitals, history, archetype, badges, contract, and personality. Two deserve a closer look — open the Archetype or Badges tab for a quick tour of each.',
    },
  ],

  rosterEditorArchetype: [
    {
      target: 'pdem-arch-section',
      route: 'roster-setup',
      placement: 'bottom',
      title: 'Archetype Rebuilds',
      body: "Pick an archetype and a talent tier, then Apply to rebuild the player's base attributes in one tap — a fast way to rough out a player before tweaking individual ratings.",
    },
  ],

  rosterEditorBadges: [
    {
      target: 'pdem-badges-panel',
      route: 'roster-setup',
      placement: 'top',
      title: 'Levels & Ceilings',
      body: 'Each badge carries a current level (Lvl) and a top level (Max). Set Lvl to None with a Max to make the badge earnable only through campaign play — or grant it now at any tier. Players hold at most 12 badges total.',
    },
    {
      target: 'pdem-add-badge',
      route: 'roster-setup',
      placement: 'top',
      skipIfMissing: true,
      title: 'Add From the Catalog',
      body: 'Add any badge from the full catalog, grouped by category.',
    },
  ],
}
