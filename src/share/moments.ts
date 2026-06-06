import type { SplatViewer } from '../engine/SplatViewer'
import { useViewerStore } from '../state/store'
import { SCENES } from '../engine/scenes/registry'
import type { Moment } from './deeplink'

/** Snapshot the current engine + store state into a shareable Moment. */
export function captureMoment(viewer: SplatViewer): Moment {
  const st = useViewerStore.getState()
  return {
    v: 1,
    s: st.scene,
    t: st.time,
    cam: viewer.getCameraState(),
    play: { p: st.playing, sp: st.speed },
    fp: { ...st.fieldParams },
  }
}

/** Restore a Moment: scene → params → transport → camera (order matters). */
export function applyMoment(viewer: SplatViewer, m: Moment): void {
  const st = useViewerStore.getState()
  const scene = Math.max(0, Math.min(SCENES.length - 1, Math.round(m.s)))
  if (scene !== st.scene) st.setScene(scene)
  st.setFieldParams(m.fp)
  st.setSpeed(m.play.sp)
  st.setTime(m.t)
  st.setPlaying(m.play.p)
  viewer.setCameraState(m.cam) // depends on nothing else; flips needsSort
}
