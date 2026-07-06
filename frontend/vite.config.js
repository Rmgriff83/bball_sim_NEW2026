import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      // Native (Capacitor) builds must NOT run a service worker: assets are
      // local files, and the SW's precache survives app-store updates in
      // WebView storage — so the first launch after every update serves the
      // PREVIOUS version's entire JS bundle from cache. selfDestroying ships
      // a stub sw.js that unregisters itself and clears caches on existing
      // installs (removing the SW entirely would strand old installs on the
      // stale worker forever). Web builds keep the full PWA.
      selfDestroying: !!process.env.VITE_NATIVE_BUILD,
      registerType: 'autoUpdate',
      includeAssets: ['app-icon.svg'],
      manifest: {
        name: 'Basketball Simulator',
        short_name: 'BballSim',
        description: 'A comprehensive basketball simulation game',
        theme_color: '#121214',
        background_color: '#121214',
        display: 'standalone',
        icons: [
          {
            src: 'app-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml'
          },
          {
            src: 'app-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,json,mp3,flac}'],
        // Don't precache the ~16MB of player-headshot SVGs — on slow networks that
        // made the service-worker install download the whole set up front. They're
        // runtime-cached on first view instead (rule below). Safety cap guards
        // against any single oversized file sneaking into the precache.
        globIgnores: ['**/headshot_*.svg', '**/premade_*.svg'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Headshots: cache on first access, then serve from cache.
            urlPattern: /headshot_.*\.svg$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'headshots',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  worker: {
    format: 'es'
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})
