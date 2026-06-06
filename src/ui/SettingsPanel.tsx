import { useViewerStore } from '../state/store'
import type { QualityTier } from '../engine/perf/AdaptiveQuality'

const PALETTES = ['Default', 'Ember', 'Aurora', 'Mono']
const TIERS: QualityTier[] = ['auto', 'low', 'med', 'high', 'ultra']

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  fmt: (v: number) => string
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-ink-400">{label}</span>
        <span className="font-display text-[10px] tabular-nums text-ink-300">{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-lav-300"
      />
    </label>
  )
}

/** Live field-parameter controls (M3): density, motion amplitude, bloom, palette. */
export function SettingsPanel() {
  const fp = useViewerStore((s) => s.fieldParams)
  const set = useViewerStore((s) => s.setFieldParams)
  const quality = useViewerStore((s) => s.quality)
  const setQuality = useViewerStore((s) => s.setQuality)

  return (
    <div className="glass pointer-events-auto w-52 space-y-3.5 rounded-2xl p-4">
      <div className="font-display text-[11px] uppercase tracking-[0.3em] text-ink-200">Field</div>

      <Slider
        label="Density"
        value={fp.density}
        min={0.15}
        max={1}
        step={0.01}
        onChange={(v) => set({ density: v })}
        fmt={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Motion"
        value={fp.amp}
        min={0}
        max={2}
        step={0.01}
        onChange={(v) => set({ amp: v })}
        fmt={(v) => `${v.toFixed(2)}×`}
      />
      <Slider
        label="Bloom"
        value={fp.bloom}
        min={0}
        max={1.2}
        step={0.01}
        onChange={(v) => set({ bloom: v })}
        fmt={(v) => v.toFixed(2)}
      />

      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-ink-400">Palette</div>
        <div className="grid grid-cols-4 gap-1.5">
          {PALETTES.map((p, i) => (
            <button
              key={p}
              onClick={() => set({ palette: i })}
              className={`rounded-lg py-1.5 text-[9px] uppercase tracking-wide transition ${
                fp.palette === i
                  ? 'bg-lav-300/25 text-lav-100 ring-1 ring-lav-300/40'
                  : 'bg-white/5 text-ink-400 hover:text-ink-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-ink-400">Quality</div>
        <div className="grid grid-cols-5 gap-1">
          {TIERS.map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`rounded-md py-1 text-[8px] uppercase tracking-wide transition ${
                quality === q
                  ? 'bg-lav-300/25 text-lav-100 ring-1 ring-lav-300/40'
                  : 'bg-white/5 text-ink-400 hover:text-ink-200'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
