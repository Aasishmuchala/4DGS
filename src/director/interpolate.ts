import * as THREE from 'three'
import type { Shot, Keyframe, ShotSample, Easing } from './types'

/** Map a segment parameter u∈[0,1] to an eased u'. */
function ease(kind: Easing, u: number): number {
  switch (kind) {
    case 'linear':
      return u
    case 'easeIn':
      return u * u
    case 'easeOut':
      return 1 - (1 - u) * (1 - u)
    case 'hold':
      return u >= 1 ? 1 : 0
    case 'easeInOut':
    default:
      return u * u * (3 - 2 * u) // smoothstep
  }
}

/** Catmull-Rom (tension 0.5) through a Vector3 channel; p1→p2 is the active segment. */
function catmullRom(
  out: THREE.Vector3,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  u: number,
): THREE.Vector3 {
  const u2 = u * u
  const u3 = u2 * u
  out.x =
    0.5 *
    (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3)
  out.y =
    0.5 *
    (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3)
  out.z =
    0.5 *
    (2 * p1.z + (-p0.z + p2.z) * u + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * u3)
  return out
}

/** Interpolate scene phase on the SHORTEST arc on the unit loop (so 0.95→0.05
 *  advances forward through the wrap). Equal endpoints ⇒ a flat/frozen segment. */
function lerpScenePhase(a: number, b: number, u: number): number {
  let d = b - a
  d -= Math.round(d) // wrap to [-0.5, 0.5]
  let v = a + d * u
  v -= Math.floor(v)
  return v
}

const _p0 = new THREE.Vector3()
const _p1 = new THREE.Vector3()
const _p2 = new THREE.Vector3()
const _p3 = new THREE.Vector3()
const _ta = new THREE.Vector3()
const _tb = new THREE.Vector3()

function vget(kf: Keyframe, which: 'camPos' | 'camTarget', out: THREE.Vector3): THREE.Vector3 {
  const a = kf[which]
  return out.set(a[0], a[1], a[2])
}

/** Sample the shot at normalized shot time tShot∈[0,1]. `out` is reused. */
export function sampleShot(shot: Shot, tShot: number, out: ShotSample): ShotSample {
  const kfs = shot.keyframes
  const n = kfs.length

  if (n === 0) {
    out.camPos.set(0, 2.2, 4.2)
    out.camTarget.set(0, 0, 0)
    out.fov = 50
    out.sceneTime = 0
    return out
  }
  if (n === 1) {
    vget(kfs[0], 'camPos', out.camPos)
    vget(kfs[0], 'camTarget', out.camTarget)
    out.fov = kfs[0].fov
    out.sceneTime = kfs[0].sceneTime
    return out
  }

  const tt = Math.min(1, Math.max(0, tShot))
  let i = 0
  while (i < n - 2 && kfs[i + 1].tShot < tt) i++
  const kA = kfs[i]
  const kB = kfs[i + 1]

  const span = Math.max(1e-6, kB.tShot - kA.tShot)
  const uRaw = Math.min(1, Math.max(0, (tt - kA.tShot) / span))
  const u = ease(kA.easing, uRaw)

  // camera position — Catmull-Rom through neighbours (clamped at the ends)
  const i0 = Math.max(0, i - 1)
  const i3 = Math.min(n - 1, i + 2)
  vget(kfs[i0], 'camPos', _p0)
  vget(kA, 'camPos', _p1)
  vget(kB, 'camPos', _p2)
  vget(kfs[i3], 'camPos', _p3)
  catmullRom(out.camPos, _p0, _p1, _p2, _p3, u)

  // look-at target + fov — linear, eased
  vget(kA, 'camTarget', _ta)
  vget(kB, 'camTarget', _tb)
  out.camTarget.copy(_ta).lerp(_tb, u)
  out.fov = kA.fov + (kB.fov - kA.fov) * u

  // world clock — shortest-arc; equal endpoints = frozen
  out.sceneTime = lerpScenePhase(kA.sceneTime, kB.sceneTime, u)
  return out
}
