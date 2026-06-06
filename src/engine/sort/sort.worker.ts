/// <reference lib="webworker" />
/**
 * Depth-sort Web Worker (module worker).
 *
 * Owns a private copy of one cloud's base positions + seeds. On every `sort` message it
 * deforms the first `activeCount` points to the requested phase, counting-sorts them
 * farthest-first for the supplied camera, and ships back a `Uint32Array` of indices.
 * This keeps the per-frame CPU cost (a deform pass + an O(n) sort, a few ms at 1M points)
 * off the render thread so large clouds stay smooth.
 *
 * Hard constraint: this file MUST NOT import `three`. The deform math is an inline COPY of
 * `scenes/deform.deformPosition` (non-morph modes 0–4 + static mode 6) and the sort is an
 * inline copy of `sort/sortGaussians.DepthSorter.sortN`, both kept in lock-step by hand.
 * Every matrix crosses the boundary as raw column-major elements.
 */
import type {
  ToWorkerMessage,
  SetSceneMessage,
  SortMessage,
  SortedMessage,
} from './sortProtocol'

const TAU = 6.283185307179586

// ── Worker-owned state ──────────────────────────────────────────────────────
let epoch = -1 // bumped on each setScene; replies for older epochs are dropped
let count = 0
let base: Float32Array | null = null // base[count*3] world centers (owned, transferred in)
let seeds: Float32Array | null = null // seeds[count] (owned, transferred in)
let deformed: Float32Array | null = null // scratch current-frame positions (count*3)

// Persisted deform state so a camera-only move (deformDirty=false, same mode) can skip it.
let lastTn = Number.NaN
let lastAmp = Number.NaN
let lastMode = -1
let lastDeformN = -1

// Counting-sort scratch (reused; grown to fit count).
let keys: Uint16Array | null = null
let sortDepths: Float32Array | null = null
const hist = new Uint32Array(65536)

/**
 * Inline mirror of `deformPosition` for the analytic modes. Writes the deformed world
 * position of one gaussian into `out[o..o+2]`. MUST match scenes/deform.ts exactly.
 * (Morph mode 5 is intentionally unsupported here — those scenes sort on the main thread.)
 */
function deformPosition(
  out: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  seed: number,
  tn: number,
  mode: number,
  amp: number,
): void {
  // Static loaded data (real captures): identity. Handled by the caller's fast copy,
  // but kept here so a stray mode-6 point is still correct.
  if (mode === 6) {
    out[o] = x
    out[o + 1] = y
    out[o + 2] = z
    return
  }

  const ph = TAU * tn
  let px: number
  let py: number
  let pz: number

  if (mode === 0) {
    // Galaxy — continuous 2-turn/loop spin + gentle differential arm flex.
    const r = Math.sqrt(x * x + z * z)
    const ang = ph * 2.0 + (0.5 * Math.sin(ph)) / (1.0 + 0.9 * r)
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    px = ca * x - sa * z
    py = y + amp * 0.14 * Math.sin(ph * 2.0 + r * 3.0 + seed * TAU)
    pz = sa * x + ca * z
  } else if (mode === 1) {
    // Pulse — slow rigid spin carries the ripple, over radial breathing.
    const ca = Math.cos(ph)
    const sa = Math.sin(ph)
    const rx = ca * x - sa * z
    const ry = y
    const rz = sa * x + ca * z
    const inv = 1.0 / (Math.sqrt(rx * rx + ry * ry + rz * rz) + 1e-5)
    const breathe = 1.0 + 0.14 * Math.sin(ph)
    const ripple =
      amp *
      (0.1 * Math.sin(ph * 2.0 + ry * 7.0 + seed * TAU) +
        0.07 * Math.sin(ph + rx * 5.0) +
        0.05 * Math.sin(ph * 3.0 + rz * 6.0))
    px = rx * breathe + rx * inv * ripple
    py = ry * breathe + ry * inv * ripple
    pz = rz * breathe + rz * inv * ripple
  } else if (mode === 2) {
    // Supernova — radial blast that swells and re-collapses each loop.
    const e = 0.5 * (1.0 - Math.cos(ph))
    const inv = 1.0 / (Math.sqrt(x * x + y * y + z * z) + 1e-5)
    const blast = amp * e * (0.7 + 0.9 * seed)
    px = x + x * inv * blast
    py = y + y * inv * blast
    pz = z + z * inv * blast
  } else if (mode === 3) {
    // Wave — traveling vertical ripples on a flat disk.
    const h =
      amp *
      (0.14 * Math.sin(x * 2.0 + ph * 2.0) +
        0.1 * Math.sin(z * 2.3 + ph * 2.0) +
        0.07 * Math.sin((x + z) * 1.7 - ph * 2.0))
    px = x
    py = y + h
    pz = z
  } else {
    // Aurora — a swaying, flowing curtain.
    px = x + amp * 0.25 * Math.sin(y * 1.5 + ph * 2.0 + seed * TAU)
    py = y + amp * 0.1 * Math.sin(x * 1.2 + ph * 2.0)
    pz = z + amp * 0.15 * Math.sin(y * 2.0 - ph * 2.0)
  }

  // Shared organic turbulence (curl-ish, seamless, amplitude-scaled).
  px += amp * 0.045 * Math.sin(y * 3.0 + ph * 2.0 + seed * TAU)
  py += amp * 0.045 * Math.sin(z * 3.0 + ph * 2.0 + 1.7)
  pz += amp * 0.045 * Math.sin(x * 3.0 + ph * 2.0 + 3.3)

  out[o] = px
  out[o + 1] = py
  out[o + 2] = pz
}

/** Deform (or copy) the first `n` base points into `deformed`. */
function runDeform(tn: number, mode: number, amp: number, n: number): void {
  const b = base!
  const s = seeds!
  const out = deformed!
  if (mode === 6) {
    // Static capture: no animation — copy base straight through.
    out.set(b.subarray(0, n * 3))
    return
  }
  for (let i = 0; i < n; i++) {
    const j = i * 3
    deformPosition(out, j, b[j], b[j + 1], b[j + 2], s[i], tn, mode, amp)
  }
}

/**
 * Inline mirror of `DepthSorter.sortN`: 16-bit counting sort on quantized view-space
 * depth, farthest-first. Writes the first `n` gaussian indices into `order`.
 */
function countingSort(
  positions: Float32Array,
  viewElems: Float32Array,
  n: number,
  order: Uint32Array,
): void {
  // View-space z = row 2 of the view matrix · (x, y, z, 1). More negative = farther.
  const m2 = viewElems[2]
  const m6 = viewElems[6]
  const m10 = viewElems[10]
  const m14 = viewElems[14]

  const depths = sortDepths!
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
  const range = max - min
  const scale = range > 0 && Number.isFinite(range) ? 65535 / range : 0
  const k16 = keys!
  hist.fill(0)
  for (let i = 0; i < n; i++) {
    let k = ((depths[i] - min) * scale) | 0
    if (k < 0) k = 0
    else if (k > 65535) k = 65535
    k16[i] = k
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
  for (let i = 0; i < n; i++) {
    order[hist[k16[i]]++] = i
  }
}

function onSetScene(msg: SetSceneMessage): void {
  epoch = msg.epoch
  count = msg.count
  base = new Float32Array(msg.positions) // adopt the transferred buffers
  seeds = new Float32Array(msg.seeds)
  deformed = new Float32Array(count * 3)
  keys = new Uint16Array(count)
  sortDepths = new Float32Array(count)
  lastTn = Number.NaN
  lastAmp = Number.NaN
  lastMode = msg.mode
  lastDeformN = -1
}

function onSort(msg: SortMessage): void {
  // Drop work for a superseded cloud.
  if (msg.epoch !== epoch || !base || !deformed) {
    // Still hand back any recycled buffer so the client's pool isn't leaked.
    if (msg.recycle) {
      const stale: SortedMessage = {
        type: 'sorted',
        epoch: msg.epoch,
        frameId: msg.frameId,
        count: 0,
        order: msg.recycle,
      }
      ;(self as DedicatedWorkerGlobalScope).postMessage(stale, [msg.recycle])
    }
    return
  }

  const n = Math.max(1, Math.min(count, msg.activeCount | 0))
  const view = new Float32Array(msg.view) // 16 column-major elements

  // Re-deform only when something that affects positions changed; a pure camera move
  // (deformDirty=false, same mode/phase/amp/n) reuses the previous deformed buffer.
  const needDeform =
    msg.deformDirty ||
    msg.mode !== lastMode ||
    msg.tn !== lastTn ||
    msg.amp !== lastAmp ||
    n !== lastDeformN
  if (needDeform) {
    runDeform(msg.tn, msg.mode, msg.amp, n)
    lastTn = msg.tn
    lastAmp = msg.amp
    lastMode = msg.mode
    lastDeformN = n
  }

  // Reuse the recycled buffer if it's big enough; otherwise allocate a fresh one.
  // Track the backing ArrayBuffer explicitly so it stays statically non-shared for transfer.
  const orderBuf: ArrayBuffer =
    msg.recycle && msg.recycle.byteLength >= n * 4 ? msg.recycle : new ArrayBuffer(n * 4)
  const order = new Uint32Array(orderBuf, 0, n)

  countingSort(deformed, view, n, order)

  const reply: SortedMessage = {
    type: 'sorted',
    epoch,
    frameId: msg.frameId,
    count: n,
    order: orderBuf,
  }
  ;(self as DedicatedWorkerGlobalScope).postMessage(reply, [orderBuf])
}

self.onmessage = (ev: MessageEvent<ToWorkerMessage>) => {
  const msg = ev.data
  switch (msg.type) {
    case 'setScene':
      onSetScene(msg)
      break
    case 'sort':
      onSort(msg)
      break
  }
}
