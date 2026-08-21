// =============================================================================
// notifications.js — device-LOCAL retention notifications (iOS + Android).
// =============================================================================
// Single owner of all notification scheduling. Three reminders, all scheduled
// on-device (no server, no FCM/APNs — the data they key off lives in IndexedDB
// on the device anyway):
//
//   1. TRAINING (1001)      — fires when coach.activeTraining.endsAt elapses.
//                             Scheduled at session start; cancelled on claim.
//   2. POINTS (1002)        — "+12h, you have unspent attribute upgrade points".
//                             Scheduled on app-background when the roster has
//                             pending offense/defense upgrade points.
//   3. LAPSE_2D (1003)      — "+48h, come back" one-shot.
//      LAPSE_WEEKLY (1004)  — first fire +7d, then REPEATS weekly for as long
//                             as the app stays installed.
//   2-4 are cancelled every time the user opens the app, so an active user
//   never sees them; a lapsed user gets 12h → 48h → weekly cadence.
//
// Everything no-ops on web. Permission is requested CONTEXTUALLY (first
// training start — the user just kicked off a 1-hour timer, the natural moment
// to offer "we'll tell you when it's done"), never from background handlers.
// =============================================================================

import { Capacitor } from '@capacitor/core'
import { t, currentLocale, loadLocale } from '@wl-i18n/i18n.js'

export const NOTIF_IDS = {
  TRAINING: 1001,
  POINTS: 1002,
  LAPSE_2D: 1003,
  LAPSE_WEEKLY: 1004,
}

const CHANNEL_ID = 'reminders'

const HOUR_MS = 60 * 60 * 1000
const POINTS_DELAY_MS = 12 * HOUR_MS
const LAPSE_2D_MS = 48 * HOUR_MS
const LAPSE_WEEK_MS = 7 * 24 * HOUR_MS

// --- copy (centralized for easy iteration) ----------------------------------
// The builders run at schedule time (never at module load), so t() here
// resolves against the user's current locale.
const COPY = {
  training: (playerName) => ({
    title: t('Training complete!'),
    body: playerName
      ? t("{name}'s training session is done — claim the reward.", { name: playerName })
      : t('A training session is done — claim the reward.'),
  }),
  points: (n) => {
    // Points accumulate as floats (fractional training/evolution awards) —
    // only whole points are spendable, so floor for display. Guards the
    // "9.95000000001 attribute points" notification.
    const whole = Math.floor(Number(n) || 0)
    return {
      title: t('Upgrade points waiting'),
      body: whole === 1
        ? t('You have {n} attribute upgrade point ready to spend on your players.', { n: whole })
        : t('You have {n} attribute upgrade points ready to spend on your players.', { n: whole }),
    }
  },
  lapse2d: () => ({
    title: t('Your next game is waiting'),
    body: t('The league is paused until you return, GM. Jump back in and keep the run going.'),
  }),
  lapseWeekly: () => ({
    title: t('Your dynasty misses you'),
    body: t('Your roster, your picks, your season — all right where you left them.'),
  }),
}

// --- plumbing ----------------------------------------------------------------
const isNative = () => Capacitor.isNativePlatform()

// Resolve with the MODULE NAMESPACE, never with the plugin object itself:
// Capacitor plugins are Proxies that turn any property access into a native
// call — resolving a Promise WITH the proxy makes the JS engine probe
// `.then`, which the proxy dutifully forwards as a native "then()" method →
// '"LocalNotifications.then()" is not implemented' and a permanently
// poisoned cache. Callers destructure: `const { LocalNotifications } = await _plugin()`.
// A failed import is not cached, so a transient load failure can recover.
let _pluginPromise = null
function _plugin() {
  if (!_pluginPromise) {
    _pluginPromise = import('@capacitor/local-notifications').catch(err => {
      _pluginPromise = null
      throw err
    })
  }
  return _pluginPromise
}

let _channelReady = false
async function _ensureChannel(LocalNotifications) {
  if (_channelReady || Capacitor.getPlatform() !== 'android') return
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: t('Reminders'),
      description: t('Training and franchise reminders'),
      importance: 4,
    })
    _channelReady = true
  } catch { /* channel creation is best-effort */ }
}

/**
 * Check/request notification permission. Safe to call anywhere; returns false
 * on web, on denial, or on any plugin error. Never throws.
 */
export async function ensurePermission() {
  if (!isNative()) return false
  try {
    const { LocalNotifications } = await _plugin()
    let { display } = await LocalNotifications.checkPermissions()
    if (display === 'prompt' || display === 'prompt-with-rationale') {
      ;({ display } = await LocalNotifications.requestPermissions())
    }
    return display === 'granted'
  } catch (err) {
    console.warn('[notif] ensurePermission failed', err)
    return false
  }
}

/**
 * Second contextual permission ask (the first is at training start): fires
 * after the user completes a game sim, so users who never touch training still
 * get one natural chance to opt in. One-shot per device — the flag is set AFTER
 * the request attempt (never before), so a transient/non-'prompt' state can't
 * permanently self-disable this hook before the OS prompt ever gets a chance.
 * Users who already granted/denied elsewhere are never re-prompted (the
 * `display === 'prompt'` guard makes it a no-op).
 */
const GAME_PROMPT_DONE_KEY = 'notif.gamePermissionAsked'

export async function maybeAskPermissionAfterGame() {
  if (!isNative()) return
  try {
    if (localStorage.getItem(GAME_PROMPT_DONE_KEY) === 'true') return
  } catch { /* unreadable storage — fall through and rely on the OS state */ }
  try {
    const { LocalNotifications } = await _plugin()
    const { display } = await LocalNotifications.checkPermissions()
    if (display === 'prompt' || display === 'prompt-with-rationale') {
      await LocalNotifications.requestPermissions()
    }
    // Consume the one-shot only after we've actually had the chance to prompt
    // (or found permission already resolved) — never before the request.
    try { localStorage.setItem(GAME_PROMPT_DONE_KEY, 'true') } catch { /* ignore */ }
  } catch { /* best-effort */ }
}

/**
 * Current permission state, normalized for UI use:
 * 'granted' | 'prompt' (can still ask) | 'denied' (needs system settings) |
 * 'unsupported' (web or plugin failure).
 */
export async function getPermissionStatus() {
  if (!isNative()) return 'unsupported'
  try {
    const { LocalNotifications } = await _plugin()
    const { display } = await LocalNotifications.checkPermissions()
    if (display === 'granted') return 'granted'
    if (display === 'prompt' || display === 'prompt-with-rationale') return 'prompt'
    return 'denied'
  } catch (err) {
    console.warn('[notif] getPermissionStatus failed', err)
    return 'unsupported'
  }
}

/**
 * Deep-link to this app's notification settings (Android) / app settings page
 * (iOS — the closest the OS allows). For users who previously denied the
 * permission, this is the only way back in. Best-effort.
 */
export async function openNotificationSettings() {
  if (!isNative()) return
  try {
    const { NativeSettings, AndroidSettings, IOSSettings } = await import('capacitor-native-settings')
    await NativeSettings.open({
      optionAndroid: AndroidSettings.AppNotification,
      optionIOS: IOSSettings.App,
    })
  } catch { /* best-effort */ }
}

async function _hasPermission() {
  if (!isNative()) return false
  try {
    const { LocalNotifications } = await _plugin()
    const { display } = await LocalNotifications.checkPermissions()
    return display === 'granted'
  } catch {
    return false
  }
}

async function _schedule(notifications) {
  const { LocalNotifications } = await _plugin()
  await _ensureChannel(LocalNotifications)
  await LocalNotifications.schedule({
    notifications: notifications.map(n => ({
      channelId: CHANNEL_ID,
      smallIcon: 'ic_launcher_foreground',
      ...n,
    })),
  })
}

async function _cancel(ids) {
  try {
    const { LocalNotifications } = await _plugin()
    await LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) })
  } catch { /* cancelling nothing is fine */ }
}

// --- public API ---------------------------------------------------------------

/**
 * Schedule the "training ready" notification for a just-started session.
 * Requests permission if not yet granted (contextual moment). Best-effort.
 */
export async function scheduleTrainingReady({ playerName = null, endsAt, campaignId = null } = {}) {
  if (!isNative() || !endsAt) return
  try {
    if (!(await ensurePermission())) return
    const at = new Date(endsAt)
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return
    const { title, body } = COPY.training(playerName)
    await _schedule([{
      id: NOTIF_IDS.TRAINING,
      title,
      body,
      schedule: { at, allowWhileIdle: true },
      // Tap target: App.vue's localNotificationActionPerformed listener
      // routes to this campaign's home. playerName rides along so
      // relocalizePendingNotifications can rebuild the body in a new locale.
      extra: { ...(campaignId ? { campaignId } : {}), ...(playerName ? { playerName } : {}) },
    }])
  } catch (err) {
    console.warn('[notif] scheduleTrainingReady failed', err)
  }
}

export async function cancelTrainingReady() {
  if (!isNative()) return
  await _cancel([NOTIF_IDS.TRAINING])
}

/**
 * Schedule the retention reminders on app-background:
 *   POINTS (+12h, only when pendingPoints > 0), LAPSE_2D (+48h),
 *   LAPSE_WEEKLY (+7d then repeating weekly).
 * Only schedules when permission is ALREADY granted — never prompts here.
 */
export async function scheduleRetentionReminders({ pendingPoints = 0, campaignId = null } = {}) {
  if (!isNative()) return
  try {
    if (!(await _hasPermission())) return
    // Replace any prior ladder so timers restart from this backgrounding.
    await _cancel([NOTIF_IDS.POINTS, NOTIF_IDS.LAPSE_2D, NOTIF_IDS.LAPSE_WEEKLY])

    const now = Date.now()
    const batch = []
    // Tap target: the campaign loaded at backgrounding (null when the user
    // backgrounded from the dashboard — tap then opens the app normally).
    const extra = campaignId ? { campaignId } : undefined

    // Only whole points are spendable — a fractional remainder (e.g. 0.4)
    // shouldn't fire a "points waiting" reminder at all.
    const wholePoints = Math.floor(Number(pendingPoints) || 0)
    if (wholePoints > 0) {
      const { title, body } = COPY.points(wholePoints)
      batch.push({
        id: NOTIF_IDS.POINTS,
        title,
        body,
        schedule: { at: new Date(now + POINTS_DELAY_MS), allowWhileIdle: true },
        // pendingPoints rides along so relocalizePendingNotifications can
        // rebuild the body in a new locale.
        extra: { ...(extra ?? {}), pendingPoints: wholePoints },
      })
    }

    {
      const { title, body } = COPY.lapse2d()
      batch.push({
        id: NOTIF_IDS.LAPSE_2D,
        title,
        body,
        schedule: { at: new Date(now + LAPSE_2D_MS), allowWhileIdle: true },
        extra,
      })
    }

    {
      const { title, body } = COPY.lapseWeekly()
      batch.push({
        id: NOTIF_IDS.LAPSE_WEEKLY,
        title,
        body,
        // First fire at +7d, then every week while the app stays installed.
        schedule: { at: new Date(now + LAPSE_WEEK_MS), every: 'week', allowWhileIdle: true },
        extra,
      })
    }

    await _schedule(batch)
  } catch (err) {
    console.warn('[notif] scheduleRetentionReminders failed', err)
  }
}

/** Cancel the retention ladder — call whenever the user opens/returns to the app. */
export async function cancelRetentionReminders() {
  if (!isNative()) return
  await _cancel([NOTIF_IDS.POINTS, NOTIF_IDS.LAPSE_2D, NOTIF_IDS.LAPSE_WEEKLY])
}

/**
 * Re-bake the text of every PENDING notification in the current locale,
 * preserving each one's fire time. Notification copy is translated at
 * SCHEDULE time and frozen into the OS queue — without this, a reminder
 * queued while the app was in French still fires in French after the user
 * switches to English. Called after every language change (ProfileView).
 * Best-effort: unknown ids and un-rebuildable entries are left untouched.
 */
export async function relocalizePendingNotifications() {
  if (!isNative()) return
  try {
    // On cold start the active locale's chunk may still be in flight —
    // re-baking before it lands would freeze ENGLISH text for a non-English
    // user. Await readiness (no-op for 'en' and already-loaded locales).
    await loadLocale(currentLocale.value)
    const { LocalNotifications } = await _plugin()
    const { notifications: pending = [] } = await LocalNotifications.getPending()
    if (!pending.length) return

    const batch = []
    for (const p of pending) {
      const id = Number(p.id)
      const at = p.schedule?.at ? new Date(p.schedule.at) : null
      if (!at || Number.isNaN(at.getTime())) continue
      // A one-shot whose time already passed can't be re-queued (it would
      // fire immediately); repeating ones keep their cadence.
      if (at.getTime() <= Date.now() && !p.schedule?.every) continue

      let copy = null
      if (id === NOTIF_IDS.TRAINING) {
        copy = COPY.training(p.extra?.playerName ?? null)
      } else if (id === NOTIF_IDS.POINTS) {
        // Pre-relocalization schedules didn't stash the count — leave those.
        const n = Number(p.extra?.pendingPoints)
        if (Number.isFinite(n) && n > 0) copy = COPY.points(n)
      } else if (id === NOTIF_IDS.LAPSE_2D) {
        copy = COPY.lapse2d()
      } else if (id === NOTIF_IDS.LAPSE_WEEKLY) {
        copy = COPY.lapseWeekly()
      }
      if (!copy) continue

      // Same id → Capacitor replaces the pending entry in place.
      batch.push({
        id,
        ...copy,
        schedule: {
          at,
          ...(p.schedule?.every ? { every: p.schedule.every } : {}),
          allowWhileIdle: true,
        },
        extra: p.extra ?? undefined,
      })
    }
    if (batch.length) await _schedule(batch)
  } catch (err) {
    console.warn('[notif] relocalizePendingNotifications failed', err)
  }
}
