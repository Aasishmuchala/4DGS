import LZString from 'lz-string'
import type { FieldParams } from '../state/store'

/** The exact orbitable view: camera position + look-at target + fov. We store
 *  position+target (NOT a quaternion) because that's what OrbitControls derives
 *  orientation from — storing a quaternion would fight it and snap. */
export interface CameraState {
  px: number
  py: number
  pz: number
  tx: number
  ty: number
  tz: number
  fov: number
}

/** Everything needed to reopen an exact, orbitable instant. Keys are terse —
 *  every byte lives in the URL. `v` versions the schema for forward-compat. */
export interface Moment {
  v: 1
  s: number // scene index
  t: number // normalized time 0..1
  cam: CameraState
  play: { p: boolean; sp: number } // playing?, speed
  fp: FieldParams
}

export function encodeMoment(m: Moment): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(m))
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Returns null on any malformed / wrong-version / non-finite payload (never throws). */
export function decodeMoment(encoded: string): Moment | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded)
    if (!json) return null
    const o = JSON.parse(json) as Moment
    if (o?.v !== 1 || !fin(o.t) || !fin(o.s)) return null
    const c = o.cam
    if (!c || !fin(c.px) || !fin(c.py) || !fin(c.pz) || !fin(c.tx) || !fin(c.ty) || !fin(c.tz) || !fin(c.fov)) {
      return null
    }
    return o // fp is re-clamped by store.setFieldParams; scene is clamped on apply
  } catch {
    return null
  }
}

export function momentHash(m: Moment): string {
  return `#m=${encodeMoment(m)}`
}

export function momentUrl(m: Moment): string {
  return `${location.origin}${location.pathname}${momentHash(m)}`
}

/** Extract the encoded Moment from a location hash, or null. */
export function readMomentHash(hash: string = window.location.hash): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(raw).get('m')
}

/** Live camera moves → replaceState (don't flood history). */
export function writeMomentLive(m: Moment): void {
  history.replaceState(history.state, '', momentHash(m))
}

/** Explicit "Copy Moment" → pushState (a real, back-navigable entry). */
export function writeMomentExplicit(m: Moment): void {
  history.pushState(history.state, '', momentHash(m))
}
