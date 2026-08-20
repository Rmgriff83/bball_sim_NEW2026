// Pure data helper — NO i18n imports here (engine code may run in a worker).
// Returns the interpolated English text plus the template + params so the UI
// can translate at render time via tDynamic(tpl, params).
export function T(tpl, params = null) {
  let text = tpl
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), () => String(v))
    }
  }
  return { text, tpl, params }
}
