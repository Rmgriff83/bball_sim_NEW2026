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

  // Rookie scale aligned to the CAP_SET_2026 cap ($164.96M): #1 ≈ $14.5M,
  // lottery ≈ $6-10M, mid/late-1st ≈ $3-5.5M, 2nd round near the minimum.
  if (pickNumber <= 5) {
    salary = randomBetween(11500000, 14500000)
    years = 4
    guaranteed = 2
  } else if (pickNumber <= 14) {
    salary = randomBetween(6000000, 10000000)
    years = 4
    guaranteed = 2
  } else if (pickNumber <= 30) {
    salary = randomBetween(3000000, 5500000)
    years = 4
    guaranteed = 2
  } else {
    // Round 2 picks (31-60)
    salary = randomBetween(1700000, 2600000)
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
  const salary = 1200000
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
