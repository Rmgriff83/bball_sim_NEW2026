/**
 * Hash Generator — must stay identical to packages/extraction-core/src/hashGenerator.js
 * Duplicated here because symlinks don't resolve across Docker volume mounts.
 * If you change this, update extraction-core too (and vice versa).
 */

/**
 * Generate hash ID from text content
 * Uses same algorithm as toolbar for consistency
 * @param {string} content - Text content to hash
 * @returns {string} Hash ID in base36 format
 */
export function generateContentHash(content) {
  if (!content || content.length === 0) {
    return 'empty'
  }

  let hash = 0

  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }

  const hashId = Math.abs(hash).toString(36)
  return hashId
}
