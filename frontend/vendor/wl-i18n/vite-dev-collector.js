import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

/**
 * Dev-only Vite plugin: collects dynamic strings seen during play-testing.
 *
 * The runtime's tDynamic() POSTs unseen strings to /__wl-i18n/collect (dev
 * builds only); this middleware merges them into the committed manifest so
 * the next `npm run translate` picks them up. Never present in builds
 * (apply: 'serve').
 */
export function wlI18nDevCollector({ manifest = 'i18n/dynamic-strings.json' } = {}) {
  return {
    name: 'wl-i18n-dev-collector',
    apply: 'serve',
    configureServer(server) {
      const manifestPath = resolve(server.config.root, manifest)
      server.middlewares.use('/__wl-i18n/collect', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end()
        }
        let body = ''
        req.on('data', c => { body += c })
        req.on('end', () => {
          try {
            const { strings = [] } = JSON.parse(body || '{}')
            const incoming = strings.filter(
              s => typeof s === 'string' && s.trim() && !s.includes('${')
            )
            const existing = existsSync(manifestPath)
              ? JSON.parse(readFileSync(manifestPath, 'utf-8'))
              : []
            const merged = [...new Set([...existing, ...incoming])].sort()
            if (merged.length !== existing.length) {
              mkdirSync(dirname(manifestPath), { recursive: true })
              writeFileSync(manifestPath, JSON.stringify(merged, null, 2) + '\n')
            }
            res.statusCode = 204
            res.end()
          } catch {
            res.statusCode = 400
            res.end()
          }
        })
      })
    },
  }
}
