import { useViewerStore } from '../state/store'
import { Timeline } from './Timeline'
import { SceneToggle } from './SceneToggle'
import { SettingsPanel } from './SettingsPanel'
import { ActionBar } from './ActionBar'
import { DirectorToggle } from './DirectorToggle'
import { DirectorTrack } from './DirectorTrack'
import { FreezeBadge } from './FreezeBadge'

/**
 * Heads-up display overlay. Everything is pointer-events-none by default so
 * orbit gestures pass through to the canvas; interactive islands opt back in.
 */
export function Hud() {
  const fps = useViewerStore((s) => s.fps)
  const ready = useViewerStore((s) => s.ready)
  const playing = useViewerStore((s) => s.playing)
  const directorMode = useViewerStore((s) => s.directorMode)

  return (
    <div className="pointer-events-none absolute inset-0 p-4 sm:p-6">
      {/* Freeze focus — vignette deepens when time is held */}
      <div
        className={`vignette pointer-events-none absolute inset-0 -m-6 transition-opacity duration-700 ${
          playing ? 'opacity-0' : 'opacity-90'
        }`}
      />

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3">
        <div className="glass pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-lav-200 to-lav-500 shadow-[0_4px_16px_-4px_rgba(139,125,255,0.7)]">
            <span className="font-display text-sm font-extrabold text-ink-950">C</span>
          </div>
          <div className="leading-tight">
            <div className="font-display text-sm font-semibold tracking-[0.34em] text-ink-100">
              CHRONO
            </div>
            <div className="text-[10px] font-medium uppercase tracking-[0.34em] text-ink-500">
              4D Splat Studio
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DirectorToggle />
          <ActionBar />
          <div className="glass pointer-events-auto flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-medium tracking-wide text-ink-300">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                ready ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-ink-600'
              }`}
            />
            <span className="tabular-nums">{fps}</span>
            <span className="text-ink-500">FPS</span>
          </div>
        </div>
      </header>

      {/* Scene switcher, centered under the top bar */}
      <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 sm:top-6">
        <SceneToggle />
      </div>

      {/* Live field controls, right rail */}
      <div className="pointer-events-none absolute right-4 top-24 sm:right-6 sm:top-28">
        <SettingsPanel />
      </div>

      {/* Freeze flash */}
      <FreezeBadge />

      {/* Center hint — teaches the signature gesture, only while playing */}
      <div className="pointer-events-none absolute inset-x-0 bottom-32 flex justify-center">
        <div
          className={`select-none font-display text-[11px] uppercase tracking-mega text-ink-500/70 transition-opacity duration-700 ${
            playing ? 'opacity-100' : 'opacity-0'
          }`}
        >
          drag to freeze &amp; orbit
        </div>
      </div>

      {/* ── Bottom dock ─────────────────────────────────────────── */}
      <footer className="absolute inset-x-0 bottom-4 mx-auto w-full max-w-3xl px-4 sm:bottom-6">
        {directorMode && <DirectorTrack />}
        <Timeline />
      </footer>
    </div>
  )
}
