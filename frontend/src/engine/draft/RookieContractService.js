// =============================================================================
// RookieContractService.js
// =============================================================================
// Assigns rookie-scale contracts based on draft pick position.
// =============================================================================

/**
 * Get rookie-scale contract fields for a given pick number.
 *
 * @param {number} pickNumber - Overall pick number (1-60)
 * @returns {Object} Contract fields to merge onto the player object
 */
export function assignRookieContract(pickNumber) {
  let salary, years, guaranteed

  if (pickNumber <= 5) {
    salary = randomBetween(10000000, 12000000)
    years = 4
    guaranteed = 2
  } else if (pickNumber <= 14) {
    salary = randomBetween(4000000, 6000000)
    years = 4
    guaranteed = 2
  } else if (pickNumber <= 30) {
    salary = randomBetween(2000000, 3500000)
    years = 4
    guaranteed = 2
  } else {
    // Round 2 picks (31-60)
    salary = randomBetween(1000000, 2000000)
    years = 2
    guaranteed = 0
  }

  // Round salary to nearest 10K
  salary = Math.round(salary / 10000) * 10000

  const salaries = []
  for (let i = 0; i < years; i++) {
    salaries.push(Math.round(salary * (1 + 0.05 * i) / 10000) * 10000)
  }

  const options = {}
  if (guaranteed > 0 && years > guaranteed) {
    for (let y = guaranteed + 1; y <= years; y++) {
      options[`year${y}`] = 'team'
    }
  }

  const contractDetails = {
    totalYears: years,
    salaries,
    options,
    noTradeClause: false,
    rookieScale: true,
    pickNumber,
  }

  return {
    contractYearsRemaining: years,
    contract_years_remaining: years,
    contractSalary: salary,
    contract_salary: salary,
    contractDetails,
    contract_details: contractDetails,
  }
}

/**
 * Get minimum contract for undrafted rookies.
 *
 * @returns {Object} Contract fields for undrafted free agent
 */
export function assignUndraftedContract() {
  const salary = 900000
  const years = 1

  const contractDetails = {
    totalYears: 1,
    salaries: [salary],
    options: {},
    noTradeClause: false,
    rookieScale: false,
    undrafted: true,
  }

  return {
    contractYearsRemaining: years,
    contract_years_remaining: years,
    contractSalary: salary,
    contract_salary: salary,
    contractDetails,
    contract_details: contractDetails,
  }
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
