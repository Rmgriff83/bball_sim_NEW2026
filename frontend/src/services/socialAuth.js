// =============================================================================
// socialAuth.js — platform-aware "Sign in with Apple / Google" (one-tap).
// =============================================================================
// Each provider yields an IDENTITY TOKEN client-side which the backend verifies
// (POST /api/auth/social/token). External SDKs are loaded lazily so the native
// bundle isn't bloated by web SDKs (and vice-versa).
//
//   - iOS:     native Sign in with Apple via @capacitor-community/apple-sign-in.
//   - Web:     Apple JS (AppleID.auth) + Google Identity Services (GIS).
//   - Android: Google (deferred — gated out in the UI for now).
// =============================================================================

import { Capacitor } from '@capacitor/core'

export function platform() {
  return Capacitor.getPlatform() // 'web' | 'ios' | 'android'
}

// Which provider buttons to show per platform (see plan / product spec):
//   web → Apple + Google · ios → Apple only · android → Google only.
export function availableProviders() {
  switch (platform()) {
    case 'ios':
      return ['apple']
    case 'android':
      return ['google']
    default:
      return ['apple', 'google']
  }
}

// --- lazy external-script loader -------------------------------------------
const _scripts = new Map()
function loadScript(src) {
  if (_scripts.has(src)) return _scripts.get(src)
  const p = new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(el)
  })
  _scripts.set(src, p)
  return p
}

// --- Apple ------------------------------------------------------------------
const APPLE_JS = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'

function _fullName(first, last) {
  return [first, last].filter(Boolean).join(' ').trim() || null
}

/**
 * Sign in with Apple. Resolves to { provider, credential, name, email }.
 * `name`/`email` are only populated by Apple on the FIRST authorization.
 */
export async function signInWithApple() {
  if (platform() === 'ios') {
    // Native Sign in with Apple via @capgo/capacitor-social-login (Capacitor 8).
    const { SocialLogin } = await import('@capgo/capacitor-social-login')
    // clientId is unused at the OS level on iOS (the token's `aud` is the app
    // bundle id) — it only tells the plugin which provider to initialize.
    await SocialLogin.initialize({ apple: { clientId: 'com.bballsim.app' } })
    const { result } = await SocialLogin.login({
      provider: 'apple',
      options: { scopes: ['name', 'email'] },
    })
    const p = result.profile || {}
    return {
      provider: 'apple',
      credential: result.idToken,
      name: _fullName(p.givenName, p.familyName),
      email: p.email || null,
    }
  }

  // Web — Apple JS popup flow.
  const clientId = import.meta.env.VITE_APPLE_WEB_SERVICES_ID
  const redirectURI = import.meta.env.VITE_APPLE_WEB_REDIRECT_URI
  if (!clientId) throw new Error('Apple sign-in is not configured (VITE_APPLE_WEB_SERVICES_ID).')

  await loadScript(APPLE_JS)
  /* global AppleID */
  AppleID.auth.init({
    clientId,
    scope: 'name email',
    redirectURI,
    usePopup: true,
  })
  const data = await AppleID.auth.signIn() // throws/rejects on user cancel
  const nm = data?.user?.name
  return {
    provider: 'apple',
    credential: data.authorization.id_token,
    name: nm ? _fullName(nm.firstName, nm.lastName) : null,
    email: data?.user?.email || null,
  }
}

// --- Google (web) -----------------------------------------------------------
const GSI_JS = 'https://accounts.google.com/gsi/client'

async function _ensureGsi(onCredential) {
  const clientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID
  if (!clientId) throw new Error('Google sign-in is not configured (VITE_GOOGLE_WEB_CLIENT_ID).')
  await loadScript(GSI_JS)
  /* global google */
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (resp) => onCredential({ provider: 'google', credential: resp.credential }),
    auto_select: false,
    cancel_on_tap_outside: true,
  })
  return google
}

/**
 * Render Google's official Identity Services button into `container`. Google's
 * credential flow requires either their rendered button or the One Tap prompt;
 * `onCredential({ provider, credential })` fires on success.
 */
export async function renderGoogleButton(container, onCredential, opts = {}) {
  const g = await _ensureGsi(onCredential)
  g.accounts.id.renderButton(container, {
    type: 'standard',
    theme: opts.theme || 'filled_black',
    size: 'large',
    shape: 'pill',
    text: opts.text || 'continue_with',
    logo_alignment: 'center',
    width: opts.width || 320,
  })
}

/** Trigger the Google One Tap prompt (best-effort; subject to Google cooldowns). */
export async function promptGoogleOneTap(onCredential) {
  const g = await _ensureGsi(onCredential)
  g.accounts.id.prompt()
}
