// =============================================================================
// colorContrast.js — small helpers to keep team-color theming readable.
// =============================================================================
// Team colors are arbitrary (e.g. Brooklyn is near-black), so using them raw as
// text — or as a background with fixed white text — produces unreadable combos
// on certain themes. These helpers adapt a hex color for adequate contrast.
// =============================================================================

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function toHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function mix(rgb, target, t) {
  return {
    r: rgb.r + (target.r - rgb.r) * t,
    g: rgb.g + (target.g - rgb.g) * t,
    b: rgb.b + (target.b - rgb.b) * t,
  }
}

// Relative luminance (sRGB, 0=black … 1=white).
export function luminance(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const lin = [rgb.r, rgb.g, rgb.b].map((v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

const WHITE = { r: 255, g: 255, b: 255 }
const BLACK = { r: 11, g: 14, b: 20 } // near-black, matches app dark surfaces

// Best readable text color (#fff or near-black) to place ON a solid `hex` fill.
export function idealTextOn(hex) {
  return luminance(hex) > 0.55 ? '#0b0e14' : '#ffffff'
}

// A contrast-safe version of `hex` for use as TEXT / accent lines on the app's
// panel background. On dark themes a too-dark color is lightened; on light
// themes a too-light color is darkened. Returns the original when already fine.
export function readableAccent(hex, isLight = false) {
  const rgb = hexToRgb(hex)
  if (!rgb) return isLight ? '#1f2937' : '#e2e8f0'
  const L = luminance(hex)
  if (isLight) {
    return L > 0.5 ? toHex(mix(rgb, BLACK, 0.55)) : hex
  }
  return L < 0.5 ? toHex(mix(rgb, WHITE, 0.6)) : hex
}
