import * as THREE from 'three'
import vertexShader from './shaders/splat.vert.glsl?raw'
import fragmentShader from './shaders/splat.frag.glsl?raw'
import type { GaussianCloudData } from '../scenes/generators'

const TEX_WIDTH = 2048
const _size = new THREE.Vector2()

function makeDataTexture(data: Float32Array, w: number, h: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

/**
 * A renderable cloud of gaussian splats.
 *
 * Gaussian attributes live in GPU data textures (one texel each); the geometry
 * is a single instanced unit-quad, one instance per gaussian. The only thing
 * that changes per frame is the small `aIndex` attribute (sorted draw order) and
 * a few uniforms (phase, mode, amplitude, palette, morph). The vertex shader
 * reads each gaussian, animates it, projects its covariance to a screen-space
 * conic, and sizes the quad.
 */
export class GaussianCloud {
  readonly mesh: THREE.Mesh
  readonly count: number
  /** Current-frame centers, used by the CPU deform mirror (count * 3). Reassigned by updateFrame(). */
  positions: Float32Array
  /** Per-gaussian random seeds for the deform phase (count). */
  seeds: Float32Array
  /** Morph target A (torus) — equals `positions` for non-morph scenes. */
  readonly targetsA: Float32Array
  /** Morph target B (cube) — equals `positions` for non-morph scenes. */
  readonly targetsB: Float32Array

  private readonly material: THREE.RawShaderMaterial
  private readonly geometry: THREE.InstancedBufferGeometry
  private readonly orderAttr: THREE.InstancedBufferAttribute
  private readonly orderF: Float32Array
  private readonly textures: THREE.DataTexture[]

  constructor(data: GaussianCloudData) {
    this.count = data.count
    this.positions = data.positions
    this.seeds = data.seeds
    this.targetsA = data.targetsA ?? data.positions
    this.targetsB = data.targetsB ?? data.positions

    const n = data.count
    const h = Math.ceil(n / TEX_WIDTH)
    const texels = TEX_WIDTH * h

    const posData = new Float32Array(texels * 4)
    const scaleData = new Float32Array(texels * 4)
    const quatData = new Float32Array(texels * 4)
    const colorData = new Float32Array(texels * 4)
    const morphAData = new Float32Array(texels * 4)
    const morphBData = new Float32Array(texels * 4)

    for (let i = 0; i < n; i++) {
      posData[i * 4 + 0] = data.positions[i * 3 + 0]
      posData[i * 4 + 1] = data.positions[i * 3 + 1]
      posData[i * 4 + 2] = data.positions[i * 3 + 2]
      posData[i * 4 + 3] = data.opacities[i]

      scaleData[i * 4 + 0] = data.scales[i * 3 + 0]
      scaleData[i * 4 + 1] = data.scales[i * 3 + 1]
      scaleData[i * 4 + 2] = data.scales[i * 3 + 2]
      scaleData[i * 4 + 3] = data.seeds[i] // seed rides in the scale texture's alpha

      quatData[i * 4 + 0] = data.quats[i * 4 + 0]
      quatData[i * 4 + 1] = data.quats[i * 4 + 1]
      quatData[i * 4 + 2] = data.quats[i * 4 + 2]
      quatData[i * 4 + 3] = data.quats[i * 4 + 3]

      colorData[i * 4 + 0] = data.colors[i * 3 + 0]
      colorData[i * 4 + 1] = data.colors[i * 3 + 1]
      colorData[i * 4 + 2] = data.colors[i * 3 + 2]

      morphAData[i * 4 + 0] = this.targetsA[i * 3 + 0]
      morphAData[i * 4 + 1] = this.targetsA[i * 3 + 1]
      morphAData[i * 4 + 2] = this.targetsA[i * 3 + 2]
      morphBData[i * 4 + 0] = this.targetsB[i * 3 + 0]
      morphBData[i * 4 + 1] = this.targetsB[i * 3 + 1]
      morphBData[i * 4 + 2] = this.targetsB[i * 3 + 2]
    }

    const texPos = makeDataTexture(posData, TEX_WIDTH, h)
    const texScale = makeDataTexture(scaleData, TEX_WIDTH, h)
    const texQuat = makeDataTexture(quatData, TEX_WIDTH, h)
    const texColor = makeDataTexture(colorData, TEX_WIDTH, h)
    const texMorphA = makeDataTexture(morphAData, TEX_WIDTH, h)
    const texMorphB = makeDataTexture(morphBData, TEX_WIDTH, h)
    this.textures = [texPos, texScale, texQuat, texColor, texMorphA, texMorphB]

    // Geometry: a unit quad, instanced once per gaussian.
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.instanceCount = n
    // prettier-ignore
    const corners = new Float32Array([
      -1, -1, 0,   1, -1, 0,   1, 1, 0,   -1, 1, 0,
    ])
    geometry.setAttribute('position', new THREE.BufferAttribute(corners, 3))
    geometry.setIndex([0, 1, 2, 0, 2, 3])

    this.orderF = new Float32Array(n)
    for (let i = 0; i < n; i++) this.orderF[i] = i
    this.orderAttr = new THREE.InstancedBufferAttribute(this.orderF, 1)
    this.orderAttr.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aIndex', this.orderAttr)

    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    this.geometry = geometry

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        uTexPos: { value: texPos },
        uTexScale: { value: texScale },
        uTexQuat: { value: texQuat },
        uTexColor: { value: texColor },
        uTexMorphA: { value: texMorphA },
        uTexMorphB: { value: texMorphB },
        uTexWidth: { value: TEX_WIDTH },
        uFocal: { value: new THREE.Vector2() },
        uViewport: { value: new THREE.Vector2() },
        uPhase: { value: 0 },
        uMode: { value: 0 },
        uAmp: { value: 1 },
        uMorph: { value: 0 },
        uPalette: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
  }

  /** Per-frame 4D + live-param uniforms. */
  setDynamics(phase: number, mode: number, amp: number, palette: number, morph: number): void {
    const u = this.material.uniforms
    u.uPhase.value = phase
    u.uMode.value = mode
    u.uAmp.value = amp
    u.uPalette.value = palette
    u.uMorph.value = morph
  }

  /** Live density: draw only the first `n` (≤ count) gaussians. */
  setActiveCount(n: number): void {
    this.geometry.instanceCount = Math.max(1, Math.min(this.count, n | 0))
  }

  /**
   * Swap in a new frame's gaussian attributes (4D sequence playback) without
   * rebuilding geometry/material/textures — re-packs the existing data-texture
   * buffers in place and flags them for re-upload. Requires the same count.
   * Returns false if the count differs (caller should rebuild the cloud instead).
   */
  updateFrame(data: GaussianCloudData): boolean {
    if (data.count !== this.count) return false
    const pos = this.textures[0].image.data as Float32Array
    const scl = this.textures[1].image.data as Float32Array
    const qt = this.textures[2].image.data as Float32Array
    const col = this.textures[3].image.data as Float32Array
    for (let i = 0; i < this.count; i++) {
      pos[i * 4 + 0] = data.positions[i * 3 + 0]
      pos[i * 4 + 1] = data.positions[i * 3 + 1]
      pos[i * 4 + 2] = data.positions[i * 3 + 2]
      pos[i * 4 + 3] = data.opacities[i]
      scl[i * 4 + 0] = data.scales[i * 3 + 0]
      scl[i * 4 + 1] = data.scales[i * 3 + 1]
      scl[i * 4 + 2] = data.scales[i * 3 + 2]
      scl[i * 4 + 3] = data.seeds[i]
      qt[i * 4 + 0] = data.quats[i * 4 + 0]
      qt[i * 4 + 1] = data.quats[i * 4 + 1]
      qt[i * 4 + 2] = data.quats[i * 4 + 2]
      qt[i * 4 + 3] = data.quats[i * 4 + 3]
      col[i * 4 + 0] = data.colors[i * 3 + 0]
      col[i * 4 + 1] = data.colors[i * 3 + 1]
      col[i * 4 + 2] = data.colors[i * 3 + 2]
    }
    this.textures[0].needsUpdate = true
    this.textures[1].needsUpdate = true
    this.textures[2].needsUpdate = true
    this.textures[3].needsUpdate = true
    this.positions = data.positions // keep the CPU sorter in sync with the current frame
    return true
  }

  /** Upload a new back-to-front draw order (from the depth sorter). */
  setOrder(order: Uint32Array): void {
    const f = this.orderF
    const n = Math.min(order.length, this.count)
    for (let i = 0; i < n; i++) f[i] = order[i]
    this.orderAttr.needsUpdate = true
  }

  /** Refresh the screen-dependent uniforms (focal length + viewport, in pixels). */
  updateUniforms(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    renderer.getDrawingBufferSize(_size)
    const fovY = THREE.MathUtils.degToRad(camera.fov)
    const focal = (_size.y * 0.5) / Math.tan(fovY * 0.5)
    this.material.uniforms.uFocal.value.set(focal, focal)
    this.material.uniforms.uViewport.value.set(_size.x, _size.y)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    for (const t of this.textures) t.dispose()
  }
}
