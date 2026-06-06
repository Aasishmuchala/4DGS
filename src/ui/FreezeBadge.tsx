import { useEffect, useRef, useState } from 'react'
import { useViewerStore } from '../state/store'
import { LOOP_SECONDS } from '../engine/constants'

/**
 * The "Moment frozen" flash. The engine bumps `freezeToken` whenever a
 * grab-to-freeze happens; this surfaces a brief, cinematic confirmation so the
 * gesture feels intentional and magical.
 */
export function FreezeBadge() {
  const token = useViewerStore((s) => s.freezeToken)
  const [visible, setVisible] = useState(false)
  const label = useRef('0:00')

  useEffect(() => {
    if (token === 0) return
    const t = useViewerStore.getState().time * LOOP_SECONDS
    label.current = `${Math.floor(t / 60)}:${Math.floor(t % 60)
      .toString()
      .padStart(2, '0')}`
    setVisible(true)
    const id = setTimeout(() => setVisible(false), 1500)
    return () => clearTimeout(id)
  }, [token])

  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2 transition-all duration-500 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      <div className="glass-deep flex items-center gap-2.5 rounded-full px-4 py-2">
        <span className="text-sm text-aqua-300">❄</span>
        <span className="font-display text-[11px] uppercase tracking-[0.3em] text-ink-100">
          Moment frozen · {label.current}
        </span>
      </div>
    </div>
  )
}
