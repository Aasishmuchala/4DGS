import { useViewerStore } from '../state/store'

/** Enter/exit Director Mode (the dual-track camera × time authoring panel). */
export function DirectorToggle() {
  const on = useViewerStore((s) => s.directorMode)
  const setOn = useViewerStore((s) => s.setDirectorMode)

  return (
    <button
      onClick={() => setOn(!on)}
      aria-label="Director Mode"
      title="Director Mode — author a cinematic shot"
      className={`glass pointer-events-auto flex items-center gap-2 rounded-full px-3.5 py-2 font-display text-[11px] uppercase tracking-[0.2em] transition ${
        on ? 'text-lav-100 ring-1 ring-lav-300/40' : 'text-ink-300 hover:text-ink-100'
      }`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
        <path d="M2.5 10h19M7 6 5 18M12 6l-2 12M17 6l-2 12" />
      </svg>
      Director
    </button>
  )
}
