/**
 * Wire protocol for the off-main-thread depth sorter.
 *
 * The main thread ({@link ../sort/SortClient.SortClient}) owns the camera and the
 * timeline; the worker ({@link ../sort/sort.worker}) owns a private copy of the base
 * positions + seeds and does the per-frame deform + counting sort. Keeping the cloud
 * resident in the worker means each frame only ships a 64-byte view matrix across the
 * thread boundary (plus a recycled order buffer), not the whole point cloud.
 *
 * All types here are `type`/`interface` only, so this module is erased at build time
 * and can be imported by both the main thread and the worker with zero runtime cost.
 * The worker MUST stay free of `three`, so every matrix is passed as raw elements.
 */

/** Deform mode mirror of `scenes/deform`. Mode 6 = static (identity, no animation). */
export type DeformMode = number

/**
 * Hand the worker ownership of a cloud. Sent once per scene/cloud rebuild.
 *
 * `positions` (count*3) and `seeds` (count) are **transferred** — the sender must
 * post detached copies (see `SortClient.setScene`) so the engine keeps its originals.
 * `epoch` lets the worker drop sort replies that belong to a previous cloud.
 */
export interface SetSceneMessage {
  type: 'setScene'
  epoch: number
  count: number
  /** Initial deform mode; mode 6 short-circuits to a straight copy of base. */
  mode: DeformMode
  /** Base (time-zero) world centers, count*3. Transferred. */
  positions: ArrayBuffer
  /** Per-gaussian deform seeds, count. Transferred. */
  seeds: ArrayBuffer
}

/**
 * Ask the worker to deform the first `activeCount` points at phase `tn` and sort them
 * farthest-first for the given camera. One per frame that needs a re-sort.
 *
 * `view` is `camera.matrixWorldInverse.elements` (16 column-major floats), transferred.
 * `recycle`, when present, is an order buffer handed back from a prior `sorted` reply so
 * the worker can reuse it instead of allocating — it is transferred back in the response.
 */
export interface SortMessage {
  type: 'sort'
  epoch: number
  /** Monotonic id echoed back so the client can match/skip replies. */
  frameId: number
  /** Normalized loop phase [0,1). */
  tn: number
  mode: DeformMode
  /** Motion amplitude. */
  amp: number
  /** 16 column-major view-matrix elements (camera.matrixWorldInverse.elements). Transferred. */
  view: ArrayBuffer
  /** Sort only the first `activeCount` gaussians (live density × adaptive coverage). */
  activeCount: number
  /** When false and mode unchanged, the worker may reuse the last deform (camera-only move). */
  deformDirty: boolean
  /** Optional recycled order buffer to reuse (transferred). */
  recycle?: ArrayBuffer
}

/** Anything the main thread → worker can send. */
export type ToWorkerMessage = SetSceneMessage | SortMessage

/**
 * A completed sort. `order` is a `Uint32Array`-backed buffer of `activeCount` gaussian
 * indices, farthest-first. Transferred back; the client should `recycle()` it on a later
 * `sort` once the GPU has consumed it. `epoch`/`frameId` are echoed for stale-drop.
 */
export interface SortedMessage {
  type: 'sorted'
  epoch: number
  frameId: number
  /** Number of valid indices at the front of `order`. */
  count: number
  /** Backing buffer of a Uint32Array of length `count`. Transferred. */
  order: ArrayBuffer
}

/** Anything the worker → main thread can send. */
export type FromWorkerMessage = SortedMessage
