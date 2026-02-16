export const COACH_FIRST_NAMES = [
  'Greg', 'Steve', 'Mike', 'Erik', 'Joe', 'Tyronn', 'Doc', 'Nick', 'Taylor',
  'Ime', 'Billy', 'Quin', 'Michael', 'Rick', 'Jason', 'Monty', 'Chris',
  'Chauncey', 'Mark', 'Willie', 'Tom', 'JB', 'Jamahl', 'Darvin', 'Wes',
  'Frank', 'Nate', 'Charles', 'Terry', 'Dwane',
]

export const COACH_LAST_NAMES = [
  'Popovich', 'Kerr', 'Budenholzer', 'Spoelstra', 'Mazzulla', 'Lue', 'Rivers', 'Nurse', 'Jenkins',
  'Udoka', 'Donovan', 'Snyder', 'Malone', 'Carlisle', 'Kidd', 'Williams', 'Finch',
  'Billups', 'Daigneault', 'Green', 'Thibodeau', 'Bickerstaff', 'Mosley', 'Ham', 'Unseld',
  'Vogel', 'McMillan', 'Lee', 'Stotts', 'Casey',
]

export const OFFENSIVE_SCHEMES = ['motion', 'iso_heavy', 'pick_and_roll', 'post_up', 'pace_and_space', 'princeton']
export const DEFENSIVE_SCHEMES = ['man_to_man', 'zone_2_3', 'zone_3_2', 'switch_everything', 'drop_coverage']

export const COACH_TIER_RANGES = {
  1: [78, 92],
  2: [72, 85],
  3: [65, 78],
  4: [58, 72],
}

export const COACH_SALARY_RANGES = {
  elite: [8000000, 12000000],   // 85+
  great: [5000000, 9000000],    // 78-84
  good: [3000000, 6000000],     // 70-77
  average: [1500000, 4000000],  // 62-69
  below: [800000, 2000000],     // <62
}

export const COACH_ATTRIBUTES = ['offensiveIQ', 'defensiveIQ', 'playerDevelopment', 'motivation', 'gameManagement']

function clampRating(rating) {
  return Math.max(40, Math.min(99, rating))
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function generateCoachAttributes(overall) {
  const variance = 10
  const attrs = {}
  for (const attr of COACH_ATTRIBUTES) {
    attrs[attr] = clampRating(overall + randInt(-variance, variance))
  }
  return attrs
}

export function calculateCoachSalary(overall) {
  if (overall >= 85) return randInt(...COACH_SALARY_RANGES.elite)
  if (overall >= 78) return randInt(...COACH_SALARY_RANGES.great)
  if (overall >= 70) return randInt(...COACH_SALARY_RANGES.good)
  if (overall >= 62) return randInt(...COACH_SALARY_RANGES.average)
  return randInt(...COACH_SALARY_RANGES.below)
}
