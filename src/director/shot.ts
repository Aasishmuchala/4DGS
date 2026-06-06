import type { Shot, Keyframe } from './types'
import { uid } from '../util/uid'

export function createEmptyShot(): Shot {
  return {
    id: uid(),
    name: 'Shot 01',
    durationSec: 8,
    loop: true,
    keyframes: [],
  }
}

/** Insert a keyframe, keeping the array sorted by tShot. Returns a NEW shot. */
export function withKeyframeInserted(shot: Shot, kf: Keyframe): Shot {
  const keyframes = [...shot.keyframes, kf].sort((a, b) => a.tShot - b.tShot)
  return { ...shot, keyframes }
}

export function withKeyframeUpdated(shot: Shot, id: string, patch: Partial<Keyframe>): Shot {
  const keyframes = shot.keyframes
    .map((k) => (k.id === id ? { ...k, ...patch } : k))
    .sort((a, b) => a.tShot - b.tShot)
  return { ...shot, keyframes }
}

export function withKeyframeRemoved(shot: Shot, id: string): Shot {
  return { ...shot, keyframes: shot.keyframes.filter((k) => k.id !== id) }
}
