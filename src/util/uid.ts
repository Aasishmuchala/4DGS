/**
 * Stable unique id with a fallback. `crypto.randomUUID()` only exists in secure
 * contexts (HTTPS / localhost) — on a plain `http://<lan-ip>` origin (e.g. testing
 * on a phone over the LAN) it throws, which would break "Add Pose" / shot creation.
 */
export function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  return `id-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}
