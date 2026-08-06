// Shared community-build blob fetcher (rosters AND draft classes — both ride
// the same /api/roster-builds/{id}/blob endpoint; the inflated JSON's `type`
// key discriminates).
//
// Preferred path asks the server for the raw gz bytes (octet-stream, no
// Content-Encoding — immune to proxies/service workers that decompress the
// body but leave the header, which surfaces as ERR_CONTENT_DECODING_FAILED)
// and inflates explicitly. Uses bare fetch() (not the axios client) so
// nothing can coerce the body to a lossy string, and inflates in a LOOP so an
// accidentally double-gzipped object still resolves. WebViews without
// DecompressionStream use the legacy Content-Encoding route.

import api from '@/composables/useApi'
import { getToken } from '@/composables/useTokenStorage'

export async function fetchBuildBlob(id) {
  if (typeof DecompressionStream === 'undefined') {
    const res = await api.get(`/api/roster-builds/${id}/blob`)
    return res.data
  }
  const token = await getToken()
  const base = import.meta.env.VITE_API_URL || ''
  const resp = await fetch(`${base}/api/roster-builds/${id}/blob?raw=1`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!resp.ok) {
    throw new Error(resp.status === 404 ? 'This build is no longer available' : `Import fetch failed (${resp.status})`)
  }
  let bytes = new Uint8Array(await resp.arrayBuffer())
  // Tolerate stray leading whitespace (a single space from PHP stray-output
  // bugs corrupted the stream once — harmless to JSON, fatal to gunzip).
  let start = 0
  while (start < bytes.length && (bytes[start] === 0x20 || bytes[start] === 0x0a || bytes[start] === 0x0d || bytes[start] === 0x09)) start++
  if (start > 0) bytes = bytes.subarray(start)
  // Inflate while the payload still starts with the gzip magic bytes (guards
  // gz-of-gz artifacts from manual bucket surgery); cap the loop for safety.
  for (let pass = 0; pass < 3 && bytes[0] === 0x1f && bytes[1] === 0x8b; pass++) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}
