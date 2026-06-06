import type {
  SetSceneMessage,
  SortMessage,
  FromWorkerMessage,
  DeformMode,
} from './sortProtocol'

/**
 * Main-thread handle to the off-main-thread depth sorter.
 *
 * Hands a cloud to {@link ./sort.worker sort.worker} once per scene, then each frame asks
 * it (fire-and-forget) to deform + sort for the current camera. The render loop polls
 * {@link takeLatestOrder} for the newest finished order and uploads it. Because the sort
 * runs on another thread, the order applied on frame N reflects roughly the camera/phase
 * of frame N−1 — a ~1-frame latency that is invisible for orbit/playback but means the
 * client never blocks the render thread on a large sort.
 *
 * Only ever one sort is in flight: {@link requestSort} is a no-op while the worker is busy,
 * so a slow sort naturally drops intermediate frames instead of queueing a backlog.
 *
 * Order buffers are double-buffered: the worker transfers a finished buffer to us, the
 * engine consumes it, then {@link recycle} returns it to a small pool that is transferred
 * back on the next request — so steady state allocates zero buffers per frame.
 */
export class SortClient {
  private readonly worker: Worker
  private epoch = 0
  private inFlight = false
  private disposed = false

  /** Newest finished order, awaiting pickup by the render loop (Uint32Array over a transferred buffer). */
  private latest: Uint32Array | null = null
  /** Free order buffers available to transfer to the worker (the double-buffer pool). */
  private readonly pool: ArrayBuffer[] = []

  constructor() {
    // The URL MUST be a static literal so the bundler can find + emit the worker chunk.
    this.worker = new Worker(new URL('./sort.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = this.onMessage
  }

  private onMessage = (ev: MessageEvent<FromWorkerMessage>) => {
    const msg = ev.data
    if (msg.type !== 'sorted') return
    this.inFlight = false
    // Drop replies for a cloud we've since replaced.
    if (msg.epoch !== this.epoch || msg.count === 0) {
      this.pool.push(msg.order) // recycle even stale buffers
      return
    }
    // If a previous order was never picked up, recycle its buffer rather than leak it.
    // (These views are always over the non-shared ArrayBuffers we received from the worker.)
    if (this.latest) this.pool.push(this.latest.buffer as ArrayBuffer)
    this.latest = new Uint32Array(msg.order, 0, msg.count)
  }

  /**
   * Hand the worker a new cloud. Posts **copies** of `positions`/`seeds` (via `.slice()`,
   * then transfers the copies) so the engine keeps its own originals intact. Bumps the
   * epoch so any in-flight sort for the previous cloud is discarded on arrival.
   */
  setScene(
    count: number,
    mode: DeformMode,
    positions: Float32Array,
    seeds: Float32Array,
  ): void {
    if (this.disposed) return
    this.epoch++
    this.inFlight = false
    this.latest = null
    this.pool.length = 0 // old buffers were sized for the old count; let them be GC'd

    // Detached copies over explicit (non-shared) ArrayBuffers, safe to transfer.
    const posBuf = new ArrayBuffer(count * 3 * 4)
    const seedBuf = new ArrayBuffer(count * 4)
    new Float32Array(posBuf).set(positions.subarray(0, count * 3))
    new Float32Array(seedBuf).set(seeds.subarray(0, count))
    const msg: SetSceneMessage = {
      type: 'setScene',
      epoch: this.epoch,
      count,
      mode,
      positions: posBuf,
      seeds: seedBuf,
    }
    this.worker.postMessage(msg, [posBuf, seedBuf])
  }

  /**
   * Ask the worker to deform + sort for this frame. No-op if a sort is already in flight
   * (so the render thread never waits and slow sorts just skip frames). `viewElems` is
   * `camera.matrixWorldInverse.elements`; it is copied before transfer so the caller's
   * matrix is untouched.
   */
  requestSort(
    frameId: number,
    tn: number,
    mode: DeformMode,
    amp: number,
    viewElems: ArrayLike<number>,
    activeCount: number,
    deformDirty: boolean,
  ): void {
    if (this.disposed || this.inFlight) return

    const viewBuf = new ArrayBuffer(16 * 4)
    const view = new Float32Array(viewBuf)
    for (let i = 0; i < 16; i++) view[i] = viewElems[i] // copy: 16 elements
    const recycle = this.pool.pop()

    const msg: SortMessage = {
      type: 'sort',
      epoch: this.epoch,
      frameId,
      tn,
      mode,
      amp,
      view: viewBuf,
      activeCount,
      deformDirty,
      recycle,
    }
    const transfer: Transferable[] = [viewBuf]
    if (recycle) transfer.push(recycle)
    this.worker.postMessage(msg, transfer)
    this.inFlight = true
  }

  /**
   * Pop the newest finished order, or null if nothing new since the last pickup. The
   * returned view is valid until you {@link recycle} its buffer; copy out the indices you
   * need (e.g. `GaussianCloud.setOrder`) before recycling.
   */
  takeLatestOrder(): Uint32Array | null {
    const order = this.latest
    this.latest = null
    return order
  }

  /** Return a consumed order buffer to the pool to be transferred back on the next sort. */
  recycle(order: Uint32Array): void {
    if (this.disposed) return
    this.pool.push(order.buffer as ArrayBuffer)
  }

  /** True while the worker is busy with a sort (a fresh request would be dropped). */
  get busy(): boolean {
    return this.inFlight
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.worker.onmessage = null
    this.worker.terminate()
    this.latest = null
    this.pool.length = 0
  }
}
