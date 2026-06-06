import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { useViewerStore } from '../state/store'
import { GaussianCloud } from './gaussian/GaussianCloud'
import { DepthSorter } from './sort/sortGaussians'
import { SortClient } from './sort/SortClient'
import type { SplatSequence } from './loaders/SplatSequence'
import { deformPosition, deformMorph } from './scenes/deform'
import { SCENES } from './scenes/registry'
import type { GaussianCloudData } from './scenes/generators'
import { createBackdrop } from './Backdrop'
import { GAUSSIAN_COUNT, LOOP_SECONDS } from './constants'
import type { CameraState } from '../share/deeplink'
import { sampleShot } from '../director/interpolate'
import type { Keyframe, ShotSample } from '../director/types'
import { AdaptiveQuality, type QualitySettings } from './perf/AdaptiveQuality'
import { uid } from '../util/uid'

/**
 * SplatViewer — the framework-agnostic 3D engine.
 *
 * Renders a cloud of time-varying ("4D") gaussian splats with correct
 * back-to-front compositing, and drives the timeline. The headline behavior:
 *   • playing  → deform every gaussian on GPU + re-sort by current depth (CPU)
 *   • frozen   → time held; orbiting only re-sorts (no re-deform) → cheap
 *   • grab-to-freeze → touching the scene mid-playback pauses time instantly
 */
export class SplatViewer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly composer: EffectComposer
  private bloomPass!: UnrealBloomPass
  private readonly backdrop: THREE.Group

  private readonly resizeObserver: ResizeObserver
  private gaussians!: GaussianCloud
  private sorter!: DepthSorter
  private deformed!: Float32Array // current-frame world positions for the sorter

  // Off-main-thread sort for big loaded clouds (>500k); null until first needed.
  private sortClient: SortClient | null = null
  private useWorkerSort = false
  private sortFrameId = 0
  // 4D sequence playback (per-frame captured clouds)
  private sequence: SplatSequence | null = null
  private seqFrame = -1

  private currentScene = -1
  private currentMode = 0
  private lastTime = -1
  private lastAmp = 1
  private lastActive = -1
  private deformDirty = true
  private needsSort = true
  private idleTimer = 0

  private lastFrameT = -1
  private storeWriteAccum = 0
  private frames = 0
  private fpsAccum = 0
  private capturing = false
  private disposed = false

  // Adaptive quality (M6)
  private readonly quality = new AdaptiveQuality(60, Math.min(window.devicePixelRatio, 2))
  private sceneJustChanged = false
  private appliedTier = 'auto'

  // Director Mode preview
  private previewActive = false
  private previewClock = 0
  private savedAutoRotate = false
  private previewSceneTime = 0
  private hasSampled = false
  private contextLost = false
  private readonly sample: ShotSample = {
    camPos: new THREE.Vector3(),
    camTarget: new THREE.Vector3(),
    fov: 50,
    sceneTime: 0,
  }

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // the splat falloff is its own anti-aliasing
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true, // lets PNG/clip capture read the frame reliably
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)

    this.scene = new THREE.Scene()

    this.backdrop = createBackdrop()
    this.scene.add(this.backdrop)

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100)
    this.camera.position.set(0, 2.2, 4.2) // 3/4 elevation — reveals the galaxy's spiral

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.075
    this.controls.rotateSpeed = 0.6
    this.controls.panSpeed = 0.6
    this.controls.zoomSpeed = 0.8
    this.controls.minDistance = 1.4
    this.controls.maxDistance = 12
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 0.16 // calm, gentle drift
    this.controls.addEventListener('start', this.onInteractStart)
    this.controls.addEventListener('end', this.onInteractEnd)
    this.controls.addEventListener('change', this.onCameraChange)
    canvas.addEventListener('webglcontextlost', this.onContextLost as EventListener, false)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored as EventListener, false)

    this.loadScene(useViewerStore.getState().scene)

    // Postprocessing: bloom gives the gaussian cores + stars their cinematic glow.
    this.composer = new EffectComposer(this.renderer)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.4, 0.85) // strength, radius, threshold
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass())
    this.applyQuality(this.quality.current)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()

    this.renderer.setAnimationLoop(this.tick)
    useViewerStore.getState().setReady(true)
  }

  /** Build (or rebuild) the gaussian cloud from raw data + a deform mode. */
  private buildCloud(data: GaussianCloudData, mode: number) {
    if (this.gaussians) {
      this.scene.remove(this.gaussians.mesh)
      this.gaussians.dispose()
    }
    this.gaussians = new GaussianCloud(data)
    if (!this.sorter || this.sorter.count !== data.count) {
      this.sorter = new DepthSorter(data.count)
      this.deformed = new Float32Array(data.count * 3)
    }
    this.gaussians.mesh.renderOrder = 1 // draw after the backdrop + stars
    this.scene.add(this.gaussians.mesh)
    this.currentMode = mode
    this.deformDirty = true
    this.needsSort = true
    this.sceneJustChanged = true
  }

  /** Build the gaussian cloud for a procedural scene index. */
  private loadScene(index: number) {
    const def = SCENES[index] ?? SCENES[0]
    this.sequence = null
    this.useWorkerSort = false // procedural scenes use the proven synchronous sort
    this.buildCloud(def.build(GAUSSIAN_COUNT), def.mode)
    this.currentScene = index
  }

  /** Load a REAL captured cloud (e.g. parsed from a .ply/.spz). Static + frozen. */
  loadGaussianData(data: GaussianCloudData) {
    const STATIC_MODE = 6
    this.sequence = null
    this.buildCloud(data, STATIC_MODE)
    this.currentScene = -1 // sentinel: not a procedural scene
    // Big captures (>500k) → offload deform+sort to the worker; small → sync.
    this.useWorkerSort = data.count > 500_000
    if (this.useWorkerSort) {
      if (!this.sortClient) this.sortClient = new SortClient()
      this.sortClient.setScene(data.count, STATIC_MODE, data.positions, data.seeds)
    }
    const st = useViewerStore.getState()
    st.setScene(-1) // keep tick from reloading a procedural scene
    st.setPlaying(false) // static capture has no animation → freeze
    st.setFieldParams({ palette: 0, amp: 1 }) // show real colors, no deform scaling
  }

  /** Load a 4D capture: an ordered set of per-frame clouds; the timeline drives frames. */
  loadSequence(seq: SplatSequence) {
    const STATIC_MODE = 6
    this.sequence = seq
    this.seqFrame = 0
    this.useWorkerSort = false // sequence motion = per-frame swaps → sync sort
    this.buildCloud(seq.frame(0), STATIC_MODE)
    this.currentScene = -1
    const st = useViewerStore.getState()
    st.setScene(-1)
    st.setTime(0)
    st.setPlaying(true) // play the captured motion
    st.setFieldParams({ palette: 0, amp: 1 })
  }

  /** Apply a quality setting: render scale (pixel ratio) + bloom resolution. */
  private applyQuality(q: QualitySettings) {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setPixelRatio(q.pixelRatio)
    this.composer.setPixelRatio(q.pixelRatio)
    this.composer.setSize(w, h)
    this.bloomPass.setSize(Math.max(1, w * q.bloomScale), Math.max(1, h * q.bloomScale))
  }

  /** Recompute the first `n` gaussians' current-frame positions for the depth sorter. */
  private applyDeform(tn: number, amp: number, n: number) {
    const base = this.gaussians.positions
    const seeds = this.gaussians.seeds
    const out = this.deformed
    const mode = this.currentMode

    if (mode === 5) {
      const A = this.gaussians.targetsA
      const B = this.gaussians.targetsB
      const morph = 3 * tn
      for (let i = 0; i < n; i++) {
        const j = i * 3
        deformMorph(
          out, j,
          base[j], base[j + 1], base[j + 2],
          A[j], A[j + 1], A[j + 2],
          B[j], B[j + 1], B[j + 2],
          seeds[i], tn, morph, amp,
        )
      }
    } else {
      for (let i = 0; i < n; i++) {
        const j = i * 3
        deformPosition(out, j, base[j], base[j + 1], base[j + 2], seeds[i], tn, mode, amp)
      }
    }
  }

  private onInteractStart = () => {
    this.controls.autoRotate = false
    this.idleTimer = 0
    // Grab-to-freeze: touching the scene mid-playback stops time instantly.
    const st = useViewerStore.getState()
    if (st.playing) {
      st.setPlaying(false)
      st.bumpFreeze()
    }
  }

  private onInteractEnd = () => {
    this.idleTimer = 0.0001 // begin counting toward idle auto-orbit resume
  }

  private onCameraChange = () => {
    this.needsSort = true
  }

  // WebGL context loss → stop the loop; on restore, rebuild GPU resources + resume.
  private onContextLost = (e: Event) => {
    e.preventDefault()
    this.contextLost = true
    this.renderer.setAnimationLoop(null)
    useViewerStore.getState().setReady(false)
  }

  private onContextRestored = () => {
    if (!this.contextLost) return
    this.contextLost = false
    this.loadScene(this.currentScene) // fresh textures/geometry on the new context
    this.applyQuality(this.quality.current)
    this.needsSort = true
    this.renderer.setAnimationLoop(this.tick)
    useViewerStore.getState().setReady(true)
  }

  /** Steady the camera (no auto-rotate / damping) for a seamless clip; returns a restore fn. */
  freezeCameraForCapture(): () => void {
    const a = this.controls.autoRotate
    const d = this.controls.enableDamping
    this.controls.autoRotate = false
    this.controls.enableDamping = false
    this.idleTimer = 0
    return () => {
      this.controls.autoRotate = a
      this.controls.enableDamping = d
    }
  }

  private resize() {
    if (this.capturing) return
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (this.composer) this.applyQuality(this.quality.current) // reasserts pixelRatio + composer/bloom size
    this.needsSort = true
  }

  private tick = (timeMs: number) => {
    const now = timeMs * 0.001
    if (this.lastFrameT < 0) this.lastFrameT = now
    let dt = now - this.lastFrameT
    this.lastFrameT = now
    dt = Math.min(dt, 0.1)

    const store = useViewerStore.getState()

    // Scene switch?
    if (store.scene !== this.currentScene) this.loadScene(store.scene)

    // Quality tier change?
    if (store.quality !== this.appliedTier) {
      this.applyQuality(this.quality.setTier(store.quality))
      this.appliedTier = store.quality
    }

    // Live field parameters × adaptive coverage → active gaussian count.
    const fp = store.fieldParams
    const activeCount = Math.max(
      1,
      Math.floor(this.gaussians.count * fp.density * this.quality.current.coverage),
    )
    if (fp.amp !== this.lastAmp || activeCount !== this.lastActive) {
      this.deformDirty = true
      this.lastAmp = fp.amp
      this.lastActive = activeCount
    }

    let t = store.time
    let sortDeformDirty = false // did the cloud's positions change this frame (for the worker)?
    const previewing =
      store.directorMode && store.isPreviewingShot && !!store.shot && store.shot.keyframes.length > 0

    if (previewing) {
      // ── Director preview: the shot drives the camera AND the world clock ──
      if (!this.previewActive) this.enterDirectorPreview()
      const shot = store.shot!
      if (store.shotPlaying) {
        this.previewClock += dt
        const dur = Math.max(0.1, shot.durationSec)
        let tShot = this.previewClock / dur
        if (tShot >= 1) {
          if (shot.loop) {
            this.previewClock %= dur
            tShot = this.previewClock / dur
          } else {
            tShot = 1
            store.setShotPlaying(false)
          }
        }
        this.storeWriteAccum += dt
        if (this.storeWriteAccum >= 0.033) {
          store.setShotTime(tShot)
          this.storeWriteAccum = 0
        }
        this.applyShotSample(shot, tShot)
      } else {
        this.applyShotSample(shot, store.shotTime) // paused/scrub
      }
      t = this.previewSceneTime
      if (t !== this.lastTime || this.deformDirty) {
        this.applyDeform(t, fp.amp, activeCount)
        this.lastTime = t
        this.deformDirty = false
      }
      store.setTime(t) // reflect world clock on the main timeline
      this.needsSort = true // camera moves every preview frame
      // NB: do NOT call controls.update() here — it would overwrite the authored pose.
    } else {
      if (this.previewActive) this.exitDirectorPreview()

      // Resume gentle auto-orbit ~2.5s after the user lets go.
      if (this.idleTimer > 0) {
        this.idleTimer += dt
        if (this.idleTimer > 2.5) {
          this.controls.autoRotate = true
          this.idleTimer = 0
        }
      }

      // Advance the timeline when playing (engine is authoritative during playback).
      if (store.playing) {
        t = (t + (dt * store.speed) / LOOP_SECONDS) % 1
        if (t < 0) t += 1
        this.storeWriteAccum += dt
        if (this.storeWriteAccum >= 0.033) {
          store.setTime(t)
          this.storeWriteAccum = 0
        }
      }

      // 4D sequence: map the timeline onto frames; swap the active frame's cloud.
      if (this.sequence) {
        const fc = this.sequence.frameCount
        const fi = Math.min(fc - 1, Math.max(0, Math.floor(t * fc)))
        if (fi !== this.seqFrame) {
          this.seqFrame = fi
          const fdata = this.sequence.frame(fi)
          if (!this.gaussians.updateFrame(fdata)) this.buildCloud(fdata, 6) // count changed → rebuild
          this.deformDirty = true
        }
      }

      // Re-deform when time advanced, the user scrubbed, params changed, or scene changed.
      const phaseChanged = store.playing || t !== this.lastTime || this.deformDirty
      if (phaseChanged) {
        if (!this.useWorkerSort) this.applyDeform(t, fp.amp, activeCount) // worker does its own deform
        this.lastTime = t
        this.deformDirty = false
        this.needsSort = true
      }
      sortDeformDirty = phaseChanged

      this.backdrop.rotation.y += dt * 0.01 // slow parallax drift
      this.controls.update()
    }

    this.gaussians.updateUniforms(this.renderer, this.camera)
    const morph = this.currentMode === 5 ? 3 * t : 0
    this.gaussians.setDynamics(t, this.currentMode, fp.amp, fp.palette, morph)
    this.gaussians.setActiveCount(activeCount)
    this.bloomPass.strength = fp.bloom

    if (this.useWorkerSort && this.sortClient) {
      // Off-main-thread: request a sort when something changed; apply the newest finished one.
      if (this.needsSort) {
        this.camera.updateMatrixWorld()
        this.sortClient.requestSort(
          this.sortFrameId++,
          t,
          this.currentMode,
          fp.amp,
          this.camera.matrixWorldInverse.elements,
          activeCount,
          sortDeformDirty,
        )
        this.needsSort = false
      }
      const order = this.sortClient.takeLatestOrder()
      if (order) {
        this.gaussians.setOrder(order)
        this.sortClient.recycle(order)
      }
    } else if (this.needsSort) {
      this.camera.updateMatrixWorld()
      const order = this.sorter.sort(this.deformed, this.camera.matrixWorldInverse, activeCount)
      this.gaussians.setOrder(order)
      this.needsSort = false
    }

    this.composer.render()

    // fps (throttled writes to the store)
    this.frames++
    this.fpsAccum += dt
    if (this.fpsAccum >= 0.5) {
      store.setFps(Math.round(this.frames / this.fpsAccum))
      this.frames = 0
      this.fpsAccum = 0
    }

    // Adaptive quality: measure this frame, adjust fidelity to hold the target FPS.
    const q = this.quality.update(dt, this.sceneJustChanged)
    this.sceneJustChanged = false
    if (q) this.applyQuality(q)
  }

  // ── Capture & sharing API (M5) ──────────────────────────────────────────

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  /** Snapshot the exact orbitable view: camera position + look-at target + fov. */
  getCameraState(): CameraState {
    this.controls.update()
    const p = this.camera.position
    const t = this.controls.target
    const r4 = (n: number) => Math.round(n * 1e4) / 1e4
    return {
      px: r4(p.x), py: r4(p.y), pz: r4(p.z),
      tx: r4(t.x), ty: r4(t.y), tz: r4(t.z),
      fov: r4(this.camera.fov),
    }
  }

  /** Restore an exact view. Set target+position THEN update() (OrbitControls derives orientation). */
  setCameraState(c: CameraState): void {
    if (![c.px, c.py, c.pz, c.tx, c.ty, c.tz, c.fov].every(Number.isFinite)) return // ignore poisoned input
    this.camera.position.set(c.px, c.py, c.pz)
    this.controls.target.set(c.tx, c.ty, c.tz)
    if (c.fov !== this.camera.fov) {
      this.camera.fov = c.fov
      this.camera.updateProjectionMatrix()
    }
    this.controls.autoRotate = false
    this.idleTimer = 0
    this.controls.update()
    this.camera.updateMatrixWorld()
    this.needsSort = true
  }

  /** Suspend the live loop + damping for deterministic single-frame capture. Returns a restore fn. */
  beginCapture(): () => void {
    this.renderer.setAnimationLoop(null)
    const prevAuto = this.controls.autoRotate
    const prevDamp = this.controls.enableDamping
    this.controls.autoRotate = false
    this.controls.enableDamping = false
    this.capturing = true
    return () => {
      this.controls.autoRotate = prevAuto
      this.controls.enableDamping = prevDamp
      this.capturing = false
      this.renderer.setAnimationLoop(this.tick)
    }
  }

  /** Render exactly normalized phase `tn` at the current camera (synchronous; frame on canvas on return). */
  renderAt(tn: number): void {
    const fp = useViewerStore.getState().fieldParams
    const activeCount = Math.max(1, Math.floor(this.gaussians.count * fp.density))
    this.applyDeform(tn, fp.amp, activeCount)
    this.camera.updateMatrixWorld()
    const order = this.sorter.sort(this.deformed, this.camera.matrixWorldInverse, activeCount)
    this.gaussians.setOrder(order)
    this.gaussians.setActiveCount(activeCount)
    this.gaussians.updateUniforms(this.renderer, this.camera)
    const morph = this.currentMode === 5 ? 3 * tn : 0
    this.gaussians.setDynamics(tn, this.currentMode, fp.amp, fp.palette, morph)
    this.composer.render()
  }

  // ── Director Mode API (M4) ──────────────────────────────────────────────

  /** Capture the current camera + world clock as a keyframe at shot position tShot. */
  captureKeyframe(tShot: number): Keyframe {
    const st = useViewerStore.getState()
    const p = this.camera.position
    const t = this.controls.target
    return {
      id: uid(),
      tShot,
      camPos: [p.x, p.y, p.z],
      camTarget: [t.x, t.y, t.z],
      fov: this.camera.fov,
      sceneTime: st.time,
      easing: 'easeInOut',
    }
  }

  private enterDirectorPreview() {
    if (this.previewActive) return
    this.previewActive = true
    this.previewClock = 0
    this.savedAutoRotate = this.controls.autoRotate
    this.controls.autoRotate = false
    this.controls.enabled = false // stop user input AND damping writes
    this.idleTimer = 0
    useViewerStore.getState().setPlaying(false)
  }

  private exitDirectorPreview() {
    if (!this.previewActive) return
    this.previewActive = false
    this.controls.enabled = true
    this.controls.autoRotate = this.savedAutoRotate
    // Only adopt the shot's final framing if a sample was actually produced
    // (avoids snapping to the (0,0,0) default when toggled on+off in one tick).
    if (this.hasSampled) {
      this.controls.target.copy(this.sample.camTarget)
      this.camera.lookAt(this.controls.target)
    }
    this.controls.update() // reconcile spherical internals → no pop on resume
    this.hasSampled = false
    this.needsSort = true
  }

  /** Write camera + world clock for shot position tShot (drives preview AND scrub). */
  private applyShotSample(shot: Parameters<typeof sampleShot>[0], tShot: number) {
    const s = sampleShot(shot, tShot, this.sample)
    this.camera.position.copy(s.camPos)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(s.camTarget)
    if (s.fov !== this.camera.fov) {
      this.camera.fov = s.fov
      this.camera.updateProjectionMatrix()
    }
    this.previewSceneTime = s.sceneTime
    this.hasSampled = true
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true

    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.controls.removeEventListener('start', this.onInteractStart)
    this.controls.removeEventListener('end', this.onInteractEnd)
    this.controls.removeEventListener('change', this.onCameraChange)
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost as EventListener)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored as EventListener)
    this.controls.dispose()

    this.sortClient?.dispose()
    this.gaussians.dispose()
    this.backdrop.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
    })
    this.composer.dispose()
    this.renderer.dispose()
    useViewerStore.getState().setReady(false)
  }
}
