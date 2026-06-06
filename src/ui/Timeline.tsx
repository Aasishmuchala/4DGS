import { useRef } from 'react'
import { useViewerStore } from '../state/store'
import { LOOP_SECONDS } from '../engine/constants'

function fmt(timeNorm: number): string {
  const s = timeNorm * LOOP_SECONDS
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${ss.toString().padStart(2, '0')}`
}

const SPEEDS = [0.5, 1, 2]

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <path d="M3 1.6c0-.5.55-.82.98-.56l8 5.4a.66.66 0 0 1 0 1.12l-8 5.4A.66.66 0 0 1 3 12.4z" />
    </svg>
  )
}
function PauseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <rect x="2" y="1" width="3.4" height="12" rx="1.2" />
      <rect x="8.6" y="1" width="3.4" height="12" rx="1.2" />
    </svg>
  )
}

/** The transport dock: play/pause, scrub track, time readout, speed. */
export function Timeline() {
  const playing = useViewerStore((s) => s.playing)
  const time = useViewerStore((s) => s.time)
  const speed = useViewerStore((s) => s.speed)
  const setPlaying = useViewerStore((s) => s.setPlaying)
  const setTime = useViewerStore((s) => s.setTime)
  const setSpeed = useViewerStore((s) => s.setSpeed)

  const trackRef = useRef<HTMLDivElement>(null)
  const wasPlaying = useRef(false)

  const scrubTo = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setTime(Math.min(1, Math.max(0, (clientX - r.left) / r.width)))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    wasPlaying.current = useViewerStore.getState().playing
    setPlaying(false) // pause while scrubbing for precise control
    scrubTo(e.clientX)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons) scrubTo(e.clientX)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    if (wasPlaying.current) setPlaying(true)
  }

  const cycleSpeed = () => {
    const i = SPEEDS.indexOf(speed)
    setSpeed(SPEEDS[(i + 1) % SPEEDS.length] ?? 1)
  }

  const pct = `${time * 100}%`

  return (
    <div className="glass pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3">
      <button
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Pause' : 'Play'}
        className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-lav-300/15 text-lav-100 ring-1 ring-lav-300/25 transition hover:bg-lav-300/25 active:scale-95"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="group relative flex h-6 flex-1 cursor-pointer touch-none items-center"
      >
        <div className="relative h-1.5 w-full rounded-full bg-white/10">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-lav-500 to-lav-200"
            style={{ width: pct }}
          />
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lav-100 shadow-[0_0_14px_rgba(198,191,255,0.85)] ring-2 ring-ink-950 transition-transform group-hover:scale-110"
            style={{ left: pct }}
          />
        </div>
      </div>

      <div className="w-10 text-right font-display text-[11px] tabular-nums tracking-[0.18em] text-ink-200">
        {fmt(time)}
      </div>

      <button
        onClick={cycleSpeed}
        aria-label="Playback speed"
        className="flex-none rounded-lg bg-white/5 px-2.5 py-1.5 font-display text-[11px] tabular-nums tracking-wide text-ink-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-ink-100"
      >
        {speed}×
      </button>
    </div>
  )
}
