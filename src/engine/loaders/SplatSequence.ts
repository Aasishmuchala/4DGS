import type { GaussianCloudData } from '../scenes/generators'
import { parseSplatPly } from './splatPly'
import { parseSplatSpz } from './splatSpz'

/**
 * A 4D capture as CHRONO sees it: an ordered set of per-frame gaussian clouds,
 * one `GaussianCloudData` per timestep. Playback walks the frames in order; each
 * frame is a full, independent cloud (the simplest "discrete keyframe" model of
 * 4D — no per-gaussian temporal interpolation, no shared topology assumed).
 *
 * v1 strategy: preload every frame into memory up front (`load` resolves only
 * once all frames are parsed). Dead simple, dependency-free, and correct for the
 * short captures we target now.
 *
 * ── Scaling note ────────────────────────────────────────────────────────────
 * For long sequences this full-preload approach is the thing to replace: swap
 * the `frames: GaussianCloudData[]` array for a streaming ring buffer that holds
 * only a sliding window around the playhead (fetch/parse ahead on a worker,
 * evict frames that fall behind), so memory stays bounded regardless of length.
 * `frame(i)` would then become async / return the nearest resident frame while
 * the requested one streams in. Keep that boundary at this class so callers that
 * use `frameCount` / `frame(i)` don't have to change.
 */

/** Pick a parser by file extension. Defaults to PLY for unknown/extensionless URLs. */
async function parseByExtension(url: string, buffer: ArrayBuffer): Promise<GaussianCloudData> {
  // Strip query string / hash before reading the extension (e.g. signed URLs).
  const path = url.split(/[?#]/, 1)[0]
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'spz':
      return await parseSplatSpz(buffer)
    case 'ply':
    default:
      return parseSplatPly(buffer)
  }
}

export class SplatSequence {
  /** Per-frame clouds in playback order. (v1: fully resident; see class note.) */
  private readonly frames: GaussianCloudData[]

  private constructor(frames: GaussianCloudData[]) {
    this.frames = frames
  }

  /** Build a sequence from already-parsed frames (e.g. local files chosen in the UI). */
  static fromFrames(frames: GaussianCloudData[]): SplatSequence {
    if (frames.length === 0) throw new Error('SplatSequence.fromFrames: no frames')
    return new SplatSequence(frames)
  }

  /**
   * Fetch and parse every URL in order, picking the parser by extension
   * (`.ply` → parseSplatPly, `.spz` → parseSplatSpz). Resolves once all frames
   * are loaded. URLs define the frame order — frame `i` is `urls[i]`.
   *
   * Fetches run in parallel; the resulting array preserves URL order regardless
   * of which response lands first.
   */
  static async load(urls: string[]): Promise<SplatSequence> {
    if (urls.length === 0) {
      throw new Error('SplatSequence.load: no frame URLs provided')
    }

    // v1: preload all frames. A streaming/ring-buffer impl would replace this
    // with a windowed fetch around the playhead (see class note).
    const frames = await Promise.all(
      urls.map(async (url, i) => {
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`SplatSequence.load: frame ${i} (${url}) → HTTP ${res.status}`)
        }
        const buffer = await res.arrayBuffer()
        return parseByExtension(url, buffer)
      }),
    )

    return new SplatSequence(frames)
  }

  /** Number of frames in the sequence (always ≥ 1 after a successful load). */
  get frameCount(): number {
    return this.frames.length
  }

  /** The cloud at frame `i`. Out-of-range indices clamp into [0, frameCount-1]. */
  frame(i: number): GaussianCloudData {
    const last = this.frames.length - 1
    const idx = i < 0 ? 0 : i > last ? last : i | 0
    return this.frames[idx]
  }
}
