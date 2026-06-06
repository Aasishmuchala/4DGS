import { useViewerStore } from '../state/store'
import { SCENES } from '../engine/scenes/registry'

/** Segmented control to switch the active scene (full picker arrives in M3). */
export function SceneToggle() {
  const scene = useViewerStore((s) => s.scene)
  const setScene = useViewerStore((s) => s.setScene)

  return (
    <div className="glass pointer-events-auto flex gap-0.5 rounded-full p-1">
      {SCENES.map((s, i) => (
        <button
          key={s.id}
          onClick={() => setScene(i)}
          className={`rounded-full px-3 py-1.5 font-display text-[10px] uppercase tracking-[0.18em] transition ${
            scene === i
              ? 'bg-lav-300/20 text-lav-100 ring-1 ring-lav-300/30'
              : 'text-ink-400 hover:text-ink-200'
          }`}
        >
          {s.name}
        </button>
      ))}
    </div>
  )
}
