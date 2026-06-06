import * as THREE from 'three'

/** Per-keyframe timing curve applied to the segment leaving this keyframe. */
export type Easing = 'linear' | 'easeInOut' | 'easeIn' | 'easeOut' | 'hold'

/**
 * One authored moment in a Shot. Camera pose is stored as world vectors
 * (position + look-at target), exactly what we read from / write to OrbitControls
 * — never a quaternion (which would fight the controls and snap).
 */
export interface Keyframe {
  id: string
  tShot: number // 0..1 along the shot
  camPos: [number, number, number]
  camTarget: [number, number, number]
  fov: number
  sceneTime: number // 0..1 world clock at this keyframe (equal across two kfs ⇒ frozen segment)
  easing: Easing
}

export interface Shot {
  id: string
  name: string
  durationSec: number
  loop: boolean
  keyframes: Keyframe[] // always kept sorted ascending by tShot
}

/** What sampleShot() returns — everything a frame needs. `out` is reused. */
export interface ShotSample {
  camPos: THREE.Vector3
  camTarget: THREE.Vector3
  fov: number
  sceneTime: number
}
