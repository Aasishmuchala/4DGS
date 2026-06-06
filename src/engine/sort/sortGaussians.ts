import * as THREE from 'three'

/**
 * Back-to-front depth sorter for gaussian splats.
 *
 * Premultiplied "over" alpha blending is order-dependent, so every frame the
 * camera or geometry changes we must draw farthest-first. This is a stable
 * 16-bit counting sort on quantized view-space depth — O(n), allocation-free
 * after construction, a few ms for ~200k–1M points on the main thread. From M2
 * the same routine runs inside a Web Worker for per-frame dynamic re-sorts.
 */
export class DepthSorter {
  private readonly order: Uint32Array
  private readonly depths: Float32Array
  private readonly keys: Uint16Array
  private readonly hist = new Uint32Array(65536)

  constructor(public readonly count: number) {
    this.order = new Uint32Array(count)
    this.depths = new Float32Array(count)
    this.keys = new Uint16Array(count)
  }

  /**
   * @param positions world-space gaussian centers (count * 3)
   * @param viewMatrix camera world→view matrix (camera.matrixWorldInverse)
   * @param n sort only the first `n` gaussians (for the live density control); defaults to all
   * @returns the first `n` gaussian indices ordered farthest-first (reused buffer; copy if retained)
   */
  sort(positions: Float32Array, viewMatrix: THREE.Matrix4, n: number = this.count): Uint32Array {
    // Thin three-aware shim over the three-free core, so the same routine can run
    // unchanged inside the depth-sort Web Worker (which must not import three).
    return this.sortN(positions, viewMatrix.elements, n)
  }

  /**
   * Three-free counting sort. Identical to {@link sort} but takes the 16 view-matrix
   * elements directly (`camera.matrixWorldInverse.elements`, column-major), so it
   * can run inside a Web Worker with no `three` dependency.
   *
   * @param positions world-space gaussian centers (count * 3)
   * @param viewElems the 16 column-major elements of the world→view matrix
   * @param n sort only the first `n` gaussians
   * @returns the first `n` gaussian indices ordered farthest-first (reused buffer; copy if retained)
   */
  sortN(positions: Float32Array, viewElems: ArrayLike<number>, n: number): Uint32Array {
    const e = viewElems
    // View-space z = row 2 of the view matrix · (x, y, z, 1). More negative = farther.
    const m2 = e[2]
    const m6 = e[6]
    const m10 = e[10]
    const m14 = e[14]

    const depths = this.depths
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < n; i++) {
      const j = i * 3
      const vz = m2 * positions[j] + m6 * positions[j + 1] + m10 * positions[j + 2] + m14
      depths[i] = vz
      if (vz < min) min = vz
      if (vz > max) max = vz
    }

    // Quantize so the farthest gaussian (smallest vz) maps to key 0 → emitted first.
    // Guard against a zero/NaN/Infinity range (degenerate or poisoned positions).
    const range = max - min
    const scale = range > 0 && Number.isFinite(range) ? 65535 / range : 0
    const keys = this.keys
    const hist = this.hist
    hist.fill(0)
    for (let i = 0; i < n; i++) {
      let k = ((depths[i] - min) * scale) | 0
      if (k < 0) k = 0
      else if (k > 65535) k = 65535
      keys[i] = k
      hist[k]++
    }

    // Exclusive prefix sum → starting offset per bucket.
    let sum = 0
    for (let k = 0; k < 65536; k++) {
      const c = hist[k]
      hist[k] = sum
      sum += c
    }

    // Stable scatter.
    const order = this.order
    for (let i = 0; i < n; i++) {
      order[hist[keys[i]]++] = i
    }
    return order
  }
}
