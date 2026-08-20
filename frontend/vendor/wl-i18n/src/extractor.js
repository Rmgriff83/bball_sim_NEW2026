import { glob } from 'glob'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Extract all $t() / t() string keys from Vue/JS source files.
 *
 * @param {string} srcDir - Absolute path to the source directory
 * @returns {Promise<string[]>} Sorted unique array of extracted strings
 */
export async function extractStrings(srcDir) {
  const files = await glob('**/*.{vue,js}', {
    cwd: srcDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/locales/**'],
  })

  const strings = new Set()
  // Matches $t('...') always, or standalone t('...') only when not part of a longer identifier.
  // (?:\$t|(?<![a-zA-Z_])t) ensures we don't match closest(), mount(), etc.
  const pattern = /(?:\$t|(?<![a-zA-Z_.])t)\(\s*(['"])((?:(?!\1).)*?)\1/g

  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    let match
    while ((match = pattern.exec(content)) !== null) {
      const str = match[2]
      // Skip empty/whitespace-only strings and template literals with ${}
      if (str && str.trim() && !str.includes('${')) {
        strings.add(str)
      }
    }
  }

  return [...strings].sort()
}
