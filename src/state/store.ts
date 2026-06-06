import { create } from 'zustand'
import type { Shot } from '../director/types'
import type { QualityTier } from '../engine/perf/AdaptiveQuality'

/** Live, user-tunable parameters that shape the dynamic field (M3). */
export interface FieldParams {
  /** Fraction of gaussians drawn, 0.1..1 (density). */
  density: number
  /** Palette id: 0 = scene default, 1 = Ember, 2 = Aurora, 3 = Mono. */
  palette: number
  /** Global motion amplitude multiplier, 0..2. */
  amp: number
  /** Bloom strength, 0..1.2. */
  bloom: number
}

export const DEFAULT_FIELD: FieldParams = { density: 1, palette: 0, amp: 1, bloom: 0.4 }

/**
 * The bridge between the React HUD and the imperative Three.js engine.
 *
 * The engine reads/writes this store via `useViewerStore.getState()` (outside
 * React), and React components subscribe with the `useViewerStore(selector)`
 * hook. The engine is authoritative for `time` during playback (it advances it
 * each frame); the UI is authoritative while the user scrubs.
 */
export interface ViewerState {
  /** Engine has a live WebGL context + render loop. */
  ready: boolean
  /** Smoothed frames-per-second, updated ~2×/sec by the engine. */
  fps: number

  /** Timeline transport. */
  playing: boolean
  /** Normalized scene time in [0, 1). */
  time: number
  /** Playback rate multiplier. */
  speed: number

  /** Active scene index into SCENES. */
  scene: number

  /** Live field parameters (density, palette, amplitude, bloom). */
  fieldParams: FieldParams

  /** Render quality tier (Auto = adaptive FPS controller). */
  quality: QualityTier

  /** Incremented by the engine when a "grab-to-freeze" happens, to flash the badge. */
  freezeToken: number

  // ── Director Mode (M4) ──
  directorMode: boolean
  shot: Shot | null
  selectedKeyframeId: string | null
  isPreviewingShot: boolean
  shotPlaying: boolean
  shotTime: number // normalized shot playhead 0..1

  setReady: (v: boolean) => void
  setFps: (v: number) => void
  setPlaying: (v: boolean) => void
  togglePlaying: () => void
  setTime: (v: number) => void
  setSpeed: (v: number) => void
  setScene: (v: number) => void
  setFieldParams: (p: Partial<FieldParams>) => void
  setQuality: (v: QualityTier) => void
  bumpFreeze: () => void

  setDirectorMode: (v: boolean) => void
  setShot: (s: Shot | null) => void
  updateShot: (fn: (s: Shot) => Shot) => void
  selectKeyframe: (id: string | null) => void
  setPreviewingShot: (v: boolean) => void
  setShotPlaying: (v: boolean) => void
  toggleShotPlaying: () => void
  setShotTime: (v: number) => void
}

export const useViewerStore = create<ViewerState>((set) => ({
  ready: false,
  fps: 0,

  playing: true,
  time: 0,
  speed: 1,

  scene: 0,
  fieldParams: { ...DEFAULT_FIELD },
  quality: 'auto',
  freezeToken: 0,

  directorMode: false,
  shot: null,
  selectedKeyframeId: null,
  isPreviewingShot: false,
  shotPlaying: false,
  shotTime: 0,

  setReady: (ready) => set({ ready }),
  setFps: (fps) => set({ fps }),
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  setTime: (time) => set({ time }),
  setSpeed: (speed) => set({ speed }),
  setScene: (scene) => set({ scene }),
  setFieldParams: (p) =>
    set((s) => {
      const m = { ...s.fieldParams, ...p }
      const clamp = (v: number, lo: number, hi: number, d: number) =>
        Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d
      return {
        fieldParams: {
          density: clamp(m.density, 0.05, 1, 1),
          palette: Number.isFinite(m.palette) ? Math.min(3, Math.max(0, Math.round(m.palette))) : 0,
          amp: clamp(m.amp, 0, 3, 1),
          bloom: clamp(m.bloom, 0, 2, 0.4),
        },
      }
    }),
  setQuality: (quality) => set({ quality }),
  bumpFreeze: () => set((s) => ({ freezeToken: s.freezeToken + 1 })),

  setDirectorMode: (directorMode) =>
    set((s) => ({
      directorMode,
      isPreviewingShot: directorMode ? s.isPreviewingShot : false,
      shotPlaying: directorMode ? s.shotPlaying : false,
    })),
  setShot: (shot) => set({ shot }),
  updateShot: (fn) => set((s) => (s.shot ? { shot: fn(s.shot) } : {})),
  selectKeyframe: (selectedKeyframeId) => set({ selectedKeyframeId }),
  setPreviewingShot: (isPreviewingShot) =>
    set((s) => ({
      isPreviewingShot,
      shotPlaying: isPreviewingShot,
      shotTime: isPreviewingShot ? 0 : s.shotTime,
    })),
  setShotPlaying: (shotPlaying) => set({ shotPlaying }),
  toggleShotPlaying: () => set((s) => ({ shotPlaying: !s.shotPlaying })),
  setShotTime: (shotTime) => set({ shotTime }),
}))

// Dev-only handle for debugging / automated verification from the console.
if (import.meta.env.DEV) {
  ;(globalThis as Record<string, unknown>).chronoStore = useViewerStore
}
