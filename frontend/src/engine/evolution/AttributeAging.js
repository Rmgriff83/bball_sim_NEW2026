/**
 * AttributeAging.js
 *
 * Handles attribute-specific aging, seasonal aging, and injury impact on attributes.
 * Different attributes peak and decline at different ages based on their profile.
 * Translated from backend/app/Services/PlayerEvolution/AttributeAging.php
 */

import { ATTRIBUTE_PROFILES } from '../config/GameConfig.js';

/**
 * Internal index mapping attribute names to their profile keys.
 * Built once at module load time.
 */
const attributeToProfile = {};

for (const [profile, data] of Object.entries(ATTRIBUTE_PROFILES)) {
  for (const attr of data.attributes) {
    attributeToProfile[attr] = profile;
  }
}

/**
 * Get the aging profile for a specific attribute.
 *
 * @param {string} attribute - Attribute name (e.g., 'speed', 'threePoint')
 * @returns {object|null} Profile object or null if unknown
 */
function getAttributeProfile(attribute) {
  const profile = attributeToProfile[attribute] ?? null;
  return profile ? ATTRIBUTE_PROFILES[profile] : null;
}

/**
 * Calculate attribute-specific change based on age.
 * Returns positive for development, negative for regression.
 *
 * @param {string} attribute - Attribute name
 * @param {number} age - Player's age
 * @param {number} developmentPoints - Available development points
 * @param {number} regressionPoints - Available regression points
 * @returns {number} Change amount
 */
function calculateAttributeChange(attribute, age, developmentPoints, regressionPoints) {
  const profile = getAttributeProfile(attribute);

  if (!profile) {
    // Unknown attribute - use default aging
    return developmentPoints - regressionPoints;
  }

  const peakAge = profile.peak_age;
  const declineStart = profile.decline_start;
  const declineRate = profile.decline_rate;
  const canImprove = profile.can_improve_past_peak ?? false;

  // Before peak - full development possible
  if (age < peakAge) {
    return developmentPoints;
  }

  // Between peak and decline - limited development
  if (age >= peakAge && age < declineStart) {
    if (canImprove) {
      return developmentPoints * 0.5; // Reduced development
    }
    return 0; // No change in plateau
  }

  // After decline starts - regression
  const yearsDecline = age - declineStart;
  const regression = yearsDecline * declineRate / 12; // Monthly decline

  // Mental attributes can still improve slightly even during decline
  if (canImprove && developmentPoints > 0) {
    return Math.max(-regression, developmentPoints * 0.3 - regression);
  }

  return -regression;
}

/**
 * Calculate yearly attribute change based on age.
 *
 * @param {string} attribute - Attribute name
 * @param {number} age - Player's age
 * @returns {number} Yearly change (0 or negative)
 */
function calculateYearlyChange(attribute, age) {
  const profile = getAttributeProfile(attribute);
  if (!profile) return 0;

  const declineStart = profile.decline_start;
  const declineRate = profile.decline_rate;

  if (age < declineStart) {
    return 0; // No natural decline yet
  }

  return -declineRate;
}

/**
 * Apply seasonal aging to all attributes.
 *
 * @param {object} attributes - Player attributes object (e.g., { offense: {...}, defense: {...}, ... })
 * @param {number} age - Player's age
 * @returns {object} New attributes object with aging applied
 */
function applySeasonalAging(attributes, age) {
  const aged = {};

  for (const [category, attrs] of Object.entries(attributes)) {
    if (typeof attrs !== 'object' || attrs === null) {
      aged[category] = attrs;
      continue;
    }

    aged[category] = { ...attrs };

    for (const [attrName, value] of Object.entries(attrs)) {
      const profile = getAttributeProfile(attrName);
      if (!profile) continue;

      const change = calculateYearlyChange(attrName, age);
      const newValue = Math.max(25, Math.min(99, value + change));
      aged[category][attrName] = Math.round(newValue * 10) / 10;
    }
  }

  return aged;
}

/**
 * Get attributes that will decline most for a given age.
 * Returns array of attribute names sorted by decline severity (most severe first).
 *
 * @param {number} age - Player's age
 * @returns {string[]} Attribute names sorted by decline severity
 */
function getMostVulnerableAttributes(age) {
  const vulnerable = {};

  for (const [, data] of Object.entries(ATTRIBUTE_PROFILES)) {
    const declineStart = data.decline_start;
    if (age >= declineStart) {
      const severity = (age - declineStart) * data.decline_rate;
      for (const attr of data.attributes) {
        vulnerable[attr] = severity;
      }
    }
  }

  // Sort by severity descending
  return Object.entries(vulnerable)
    .sort((a, b) => b[1] - a[1])
    .map(([attr]) => attr);
}

/**
 * Apply injury impact to physical attributes.
 *
 * @param {object} attributes - Player attributes object
 * @param {number} impactPoints - Number of points to reduce
 * @returns {object} New attributes object with injury impact applied
 */
function applyInjuryImpact(attributes, impactPoints) {
  const affected = {};

  for (const [category, attrs] of Object.entries(attributes)) {
    if (typeof attrs !== 'object' || attrs === null) {
      affected[category] = attrs;
    } else {
      affected[category] = { ...attrs };
    }
  }

  // Physical attributes are affected by injuries
  const physicalAttrs = ATTRIBUTE_PROFILES.physical?.attributes ?? [];

  for (const attr of physicalAttrs) {
    if (affected.physical && affected.physical[attr] != null) {
      const reduction = impactPoints * (0.8 + Math.random() * 0.4); // 80-120% of impact
      affected.physical[attr] = Math.max(25, affected.physical[attr] - reduction);
    }
  }

  return affected;
}

/**
 * Check if an attribute is at its natural ceiling for the player's age.
 *
 * @param {string} attribute - Attribute name
 * @param {number} age - Player's age
 * @param {number} currentValue - Current attribute value
 * @param {number} potential - Player's potential rating
 * @returns {boolean}
 */
function isAtAgeCeiling(attribute, age, currentValue, potential) {
  const profile = getAttributeProfile(attribute);
  if (!profile) return false;

  const peakAge = profile.peak_age;

  // If past peak and not a "can improve" category, ceiling is current value
  if (age > peakAge && !(profile.can_improve_past_peak ?? false)) {
    return true;
  }

  // If at potential, at ceiling
  return currentValue >= potential;
}

export {
  getAttributeProfile,
  calculateAttributeChange,
  calculateYearlyChange,
  applySeasonalAging,
  getMostVulnerableAttributes,
  applyInjuryImpact,
  isAtAgeCeiling,
};
