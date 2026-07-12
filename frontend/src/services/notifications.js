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
const COPY = {
  training: (playerName) => ({
    title: 'Training complete!',
    body: playerName
      ? `${playerName}'s training session is done — claim the reward.`
      : 'A training session is done — claim the reward.',
  }),
  points: (n) => {
    // Points accumulate as floats (fractional training/evolution awards) —
    // only whole points are spendable, so floor for display. Guards the
    // "9.95000000001 attribute points" notification.
    const whole = Math.floor(Number(n) || 0)
    return {
      title: 'Upgrade points waiting',
      body: `You have ${whole} attribute upgrade point${whole === 1 ? '' : 's'} ready to spend on your players.`,
    }
  },
  lapse2d: () => ({
    title: 'Your next game is waiting',
    body: 'The league is paused until you return, GM. Jump back in and keep the run going.',
  }),
  lapseWeekly: () => ({
    title: 'Your dynasty misses you',
    body: 'Your roster, your picks, your season — all right where you left them.',
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
      name: 'Reminders',
      description: 'Training and franchise reminders',
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
 * after the user completes a game sim, so users who never touch training
 * still get one natural chance to opt in. One-shot per device — the flag is
 * set BEFORE requesting so this hook can only ever fire the OS prompt once,
 * and users who already granted/denied elsewhere are never re-prompted.
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
    try { localStorage.setItem(GAME_PROMPT_DONE_KEY, 'true') } catch { /* ignore */ }
    if (display === 'prompt' || display === 'prompt-with-rationale') {
      await LocalNotifications.requestPermissions()
    }
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
export async function scheduleTrainingReady({ playerName = null, endsAt } = {}) {
  if (!isNative() || !endsAt) return
  try {
    if (!(await ensurePermission())) return
    const at = new Date(endsAt)
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return
    const { title, body } = COPY.training(playerName)
    await _schedule([{ id: NOTIF_IDS.TRAINING, title, body, schedule: { at, allowWhileIdle: true } }])
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
export async function scheduleRetentionReminders({ pendingPoints = 0 } = {}) {
  if (!isNative()) return
  try {
    if (!(await _hasPermission())) return
    // Replace any prior ladder so timers restart from this backgrounding.
    await _cancel([NOTIF_IDS.POINTS, NOTIF_IDS.LAPSE_2D, NOTIF_IDS.LAPSE_WEEKLY])

    const now = Date.now()
    const batch = []

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
      })
    }

    {
      const { title, body } = COPY.lapse2d()
      batch.push({
        id: NOTIF_IDS.LAPSE_2D,
        title,
        body,
        schedule: { at: new Date(now + LAPSE_2D_MS), allowWhileIdle: true },
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
