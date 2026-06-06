export type QualityTier = 'auto' | 'low' | 'med' | 'high' | 'ultra'

export interface QualitySettings {
  /** fraction of gaussians drawn (multiplied into the active count) */
  coverage: number
  /** device pixel-ratio cap */
  pixelRatio: number
  /** bloom internal-resolution scale */
  bloomScale: number
}

/** Pinned tiers. */
const TIERS: Record<Exclude<QualityTier, 'auto'>, QualitySettings> = {
  low: { coverage: 0.4, pixelRatio: 1.0, bloomScale: 0.5 },
  med: { coverage: 0.65, pixelRatio: 1.25, bloomScale: 0.6 },
  high: { coverage: 0.85, pixelRatio: 1.5, bloomScale: 0.75 },
  ultra: { coverage: 1.0, pixelRatio: 2.0, bloomScale: 1.0 },
}

/** Monotonic ladder the Auto controller walks one rung at a time. */
const LADDER: QualitySettings[] = [
  { coverage: 0.4, pixelRatio: 1.0, bloomScale: 0.5 },
  { coverage: 0.55, pixelRatio: 1.0, bloomScale: 0.55 },
  { coverage: 0.7, pixelRatio: 1.25, bloomScale: 0.65 },
  { coverage: 0.85, pixelRatio: 1.5, bloomScale: 0.8 },
  { coverage: 1.0, pixelRatio: 1.75, bloomScale: 1.0 },
]

/**
 * Holds a target FPS by trading fidelity (coverage → pixelRatio → bloom). EMA of
 * frame time, dead-band around the target, fast-down / slow-up dwell times, and a
 * cooldown so it never oscillates. `Auto` walks the ladder; the named tiers pin.
 */
export class AdaptiveQuality {
  private emaMs: number
  private tier: QualityTier = 'auto'
  private rung = 3
  private cur: QualitySettings
  private downTimer = 0
  private upTimer = 0
  private cooldown = 0
  private settle = 24

  constructor(
    private readonly targetFps: number,
    private readonly maxPixelRatio: number,
  ) {
    this.emaMs = 1000 / targetFps
    this.cur = this.clamp(LADDER[this.rung])
  }

  private clamp(q: QualitySettings): QualitySettings {
    return { ...q, pixelRatio: Math.min(q.pixelRatio, this.maxPixelRatio) }
  }

  get current(): QualitySettings {
    return this.cur
  }
  get fpsEma(): number {
    return 1000 / this.emaMs
  }
  get currentTier(): QualityTier {
    return this.tier
  }

  setTier(t: QualityTier): QualitySettings {
    this.tier = t
    if (t !== 'auto') this.cur = this.clamp(TIERS[t])
    return this.cur
  }

  /** Call once per rendered frame. Returns new settings if they changed, else null. */
  update(dtSec: number, sceneChanged: boolean): QualitySettings | null {
    const dtMs = Math.min(100, Math.max(1, dtSec * 1000))
    this.emaMs += 0.1 * (dtMs - this.emaMs)

    if (sceneChanged) this.settle = 24
    if (this.settle > 0) {
      this.settle--
      return null
    }
    if (this.tier !== 'auto') return null
    if (this.cooldown > 0) {
      this.cooldown -= dtSec
      return null
    }

    const fps = 1000 / this.emaMs
    const down = this.targetFps * 0.9
    const up = this.targetFps * 1.12

    if (fps < down) {
      this.downTimer += dtSec
      this.upTimer = 0
      if (this.downTimer > 0.25 && this.rung > 0) {
        this.rung--
        this.cur = this.clamp(LADDER[this.rung])
        this.cooldown = 0.5
        this.downTimer = 0
        return this.cur
      }
    } else if (fps > up) {
      this.upTimer += dtSec
      this.downTimer = 0
      if (this.upTimer > 2.0 && this.rung < LADDER.length - 1) {
        this.rung++
        this.cur = this.clamp(LADDER[this.rung])
        this.cooldown = 0.5
        this.upTimer = 0
        return this.cur
      }
    } else {
      this.downTimer = 0
      this.upTimer = 0
    }
    return null
  }
}
