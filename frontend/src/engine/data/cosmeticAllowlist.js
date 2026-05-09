// =============================================================================
// cosmeticAllowlist.js
// =============================================================================
// Attributes and badges that are INTENTIONALLY cosmetic/display-only and
// should NOT be flagged by `scripts/audit-gameplay-coverage.js`.
//
// Default empty. Add an entry only when an attribute or badge is genuinely
// flavor (e.g. a nickname-tier badge) and you've verified it has no gameplay
// impact by design. Most additions belong in the simulation engine instead.
// =============================================================================

export const COSMETIC_ALLOWLIST = {
  attributes: [
    // none — every attribute should affect at least one play action
  ],
  badges: [
    // none — every badge should affect at least one per-possession outcome
  ],
}
