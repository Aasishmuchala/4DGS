import { useRef } from 'react'
import { useViewerStore } from '../state/store'
import { getViewer } from '../engine/viewerRef'
import {
  createEmptyShot,
  withKeyframeInserted,
  withKeyframeUpdated,
  withKeyframeRemoved,
} from '../director/shot'
import type { Easing, Shot } from '../director/types'

const EASINGS: { id: Easing; label: string }[] = [
  { id: 'linear', label: 'Lin' },
  { id: 'easeIn', label: 'In' },
  { id: 'easeInOut', label: 'Ease' },
  { id: 'easeOut', label: 'Out' },
  { id: 'hold', label: 'Hold' },
]
const DURATIONS = [4, 6, 8, 12, 16]

/** Evenly distribute keyframes along the shot (after add/delete). */
function respace(shot: Shot): Shot {
  const n = shot.keyframes.length
  return { ...shot, keyframes: shot.keyframes.map((k, i) => ({ ...k, tShot: n <= 1 ? 0 : i / (n - 1) })) }
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d={d} />
    </svg>
  )
}

/**
 * Director Mode dual-track: the camera keyframes (dots) and the scene-time curve
 * share one X axis (shot time). A flat span on the scene-time curve = the world
 * is frozen while the camera keeps moving — the headline capability.
 */
export function DirectorTrack() {
  const shot = useViewerStore((s) => s.shot)
  const setShot = useViewerStore((s) => s.setShot)
  const updateShot = useViewerStore((s) => s.updateShot)
  const selected = useViewerStore((s) => s.selectedKeyframeId)
  const selectKeyframe = useViewerStore((s) => s.selectKeyframe)
  const previewing = useViewerStore((s) => s.isPreviewingShot)
  const shotPlaying = useViewerStore((s) => s.shotPlaying)
  const shotTime = useViewerStore((s) => s.shotTime)
  const setPreviewingShot = useViewerStore((s) => s.setPreviewingShot)
  const toggleShotPlaying = useViewerStore((s) => s.toggleShotPlaying)
  const setShotPlaying = useViewerStore((s) => s.setShotPlaying)
  const setShotTime = useViewerStore((s) => s.setShotTime)

  const trackRef = useRef<HTMLDivElement>(null)
  const dragId = useRef<string | null>(null)

  const kfs = shot?.keyframes ?? []
  const selKf = kfs.find((k) => k.id === selected) ?? null

  const addPose = () => {
    const v = getViewer()
    if (!v) return
    const base = shot ?? createEmptyShot()
    const kf = v.captureKeyframe(1)
    setShot(respace(withKeyframeInserted(base, kf)))
    selectKeyframe(kf.id)
  }

  const deleteSelected = () => {
    if (!shot || !selected) return
    setShot(respace(withKeyframeRemoved(shot, selected)))
    selectKeyframe(null)
  }

  const xFromClient = (clientX: number) => {
    const el = trackRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }

  // Drag a keyframe dot horizontally → its tShot.
  const onDotDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragId.current = id
    selectKeyframe(id)
  }
  const onDotMove = (e: React.PointerEvent) => {
    if (!dragId.current) return
    updateShot((s) => withKeyframeUpdated(s, dragId.current!, { tShot: xFromClient(e.clientX) }))
  }
  const onDotUp = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    dragId.current = null
  }

  // Scrub the shot playhead by dragging the track background.
  const onTrackDown = (e: React.PointerEvent) => {
    if (!previewing) setPreviewingShot(true)
    setShotPlaying(false)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setShotTime(xFromClient(e.clientX))
  }
  const onTrackMove = (e: React.PointerEvent) => {
    if (e.buttons && !dragId.current) setShotTime(xFromClient(e.clientX))
  }

  const curve = kfs.map((k) => `${(k.tShot * 100).toFixed(2)},${((1 - k.sceneTime) * 100).toFixed(2)}`).join(' ')

  return (
    <div className="glass-deep pointer-events-auto mb-2 rounded-2xl px-4 py-3">
      {/* Header */}
      <div className="mb-2.5 flex items-center gap-2">
        <span className="font-display text-[11px] uppercase tracking-[0.3em] text-lav-200">Director</span>
        <span className="text-[10px] tracking-wide text-ink-500">{kfs.length} keys</span>
        <div className="flex-1" />

        <button
          onClick={addPose}
          className="flex items-center gap-1 rounded-lg bg-lav-300/15 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-lav-100 ring-1 ring-lav-300/25 transition hover:bg-lav-300/25"
        >
          <Icon d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
          Pose
        </button>

        {previewing && (
          <button
            onClick={toggleShotPlaying}
            aria-label={shotPlaying ? 'Pause shot' : 'Play shot'}
            className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-ink-200 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            {shotPlaying ? <Icon d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <Icon d="M7 4l13 8-13 8z" />}
          </button>
        )}

        <button
          onClick={() => setPreviewingShot(!previewing)}
          disabled={kfs.length < 1}
          className={`rounded-lg px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide ring-1 transition disabled:opacity-40 ${
            previewing
              ? 'bg-rose-400/15 text-rose-200 ring-rose-300/30 hover:bg-rose-400/25'
              : 'bg-white/5 text-ink-200 ring-white/10 hover:bg-white/10'
          }`}
        >
          {previewing ? 'Stop' : 'Preview'}
        </button>

        <button
          onClick={() => updateShot((s) => ({ ...s, loop: !s.loop }))}
          className={`rounded-lg px-2.5 py-1.5 text-[10px] uppercase tracking-wide ring-1 transition ${
            shot?.loop ?? true
              ? 'bg-lav-300/15 text-lav-100 ring-lav-300/25'
              : 'bg-white/5 text-ink-400 ring-white/10'
          }`}
        >
          Loop
        </button>

        <button
          onClick={() =>
            updateShot((s) => {
              const i = DURATIONS.indexOf(s.durationSec)
              return { ...s, durationSec: DURATIONS[(i + 1) % DURATIONS.length] ?? 8 }
            })
          }
          className="rounded-lg bg-white/5 px-2.5 py-1.5 font-display text-[10px] tabular-nums text-ink-300 ring-1 ring-white/10 transition hover:bg-white/10"
        >
          {shot?.durationSec ?? 8}s
        </button>
      </div>

      {/* Dual track */}
      <div
        ref={trackRef}
        onPointerDown={onTrackDown}
        onPointerMove={(e) => {
          onDotMove(e)
          onTrackMove(e)
        }}
        onPointerUp={onDotUp}
        className="relative h-16 cursor-pointer touch-none overflow-hidden rounded-lg bg-white/[0.03] ring-1 ring-white/5"
      >
        {/* Scene-time curve (flat = frozen world) */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
          {kfs.length >= 2 && (
            <polyline
              points={curve}
              fill="none"
              stroke="rgba(198,191,255,0.55)"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Camera keyframe dots */}
        {kfs.map((k) => (
          <button
            key={k.id}
            onPointerDown={(e) => onDotDown(e, k.id)}
            onPointerUp={onDotUp}
            style={{ left: `${k.tShot * 100}%`, top: `${(1 - k.sceneTime) * 100}%` }}
            className={`absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 transition ${
              k.id === selected
                ? 'bg-lav-100 ring-ink-950 shadow-[0_0_12px_rgba(198,191,255,0.9)]'
                : 'bg-lav-300/80 ring-ink-950 hover:bg-lav-200'
            }`}
            title={`pose @ shot ${(k.tShot * 100) | 0}% · time ${(k.sceneTime * 100) | 0}%`}
          />
        ))}

        {/* Shot playhead */}
        {previewing && (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-lav-200/80 shadow-[0_0_8px_rgba(198,191,255,0.8)]"
            style={{ left: `${shotTime * 100}%` }}
          />
        )}

        {kfs.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-[10px] uppercase tracking-[0.3em] text-ink-600">
            orbit + freeze, then add a pose
          </div>
        )}
      </div>

      {/* Selected keyframe editor */}
      {selKf && (
        <div className="mt-2.5 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.2em] text-ink-500">Ease</span>
          <div className="flex gap-0.5">
            {EASINGS.map((e) => (
              <button
                key={e.id}
                onClick={() => updateShot((s) => withKeyframeUpdated(s, selKf.id, { easing: e.id }))}
                className={`rounded-md px-2 py-1 text-[9px] uppercase tracking-wide transition ${
                  selKf.easing === e.id
                    ? 'bg-lav-300/25 text-lav-100 ring-1 ring-lav-300/40'
                    : 'bg-white/5 text-ink-400 hover:text-ink-200'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <span className="font-display text-[10px] tabular-nums text-ink-500">
            t {(selKf.sceneTime * 100) | 0}%
          </span>
          <button
            onClick={deleteSelected}
            aria-label="Delete keyframe"
            className="grid h-7 w-7 place-items-center rounded-md bg-white/5 text-ink-400 ring-1 ring-white/10 transition hover:bg-rose-400/15 hover:text-rose-200"
          >
            <Icon d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 11H7z" />
          </button>
        </div>
      )}
    </div>
  )
}
