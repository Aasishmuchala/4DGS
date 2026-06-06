import * as THREE from 'three'

/**
 * Raw per-gaussian data for a scene. Flat typed arrays, ready to pack into GPU
 * data textures. The "canonical" (time-zero) state — the shader's `deform()`
 * animates these in-shader; the base cloud is generated once on the CPU here.
 */
export interface GaussianCloudData {
  count: number
  positions: Float32Array // count * 3
  scales: Float32Array // count * 3  (per-axis std-devs)
  quats: Float32Array // count * 4  (x, y, z, w)
  colors: Float32Array // count * 3  (linear RGB)
  opacities: Float32Array // count
  seeds: Float32Array // count  (per-gaussian random ∈ [0,1) for phase decorrelation)
  targetsA?: Float32Array // count * 3  morph target 1 (defaults to positions)
  targetsB?: Float32Array // count * 3  morph target 2 (defaults to positions)
}

/** Deterministic PRNG so scenes are reproducible (matters for shareable Moments, M5). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const C = {
  lav: new THREE.Color('#c6bfff'),
  aqua: new THREE.Color('#6fe0ff'),
  rose: new THREE.Color('#ff8fd1'),
  amber: new THREE.Color('#ffd9a0'),
}

const _zAxis = new THREE.Vector3(0, 0, 1)

/**
 * A sphere shell of surface-flat gaussian disks. Under the "Pulse" deform it
 * breathes and undulates — freeze mid-ripple and orbit to read the 3D wobble.
 */
export function sphereCloud(count: number, radius = 1.15): GaussianCloudData {
  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3)
  const quats = new Float32Array(count * 4)
  const colors = new Float32Array(count * 3)
  const opacities = new Float32Array(count)
  const seeds = new Float32Array(count)

  const rand = mulberry32(42)
  const spacing = Math.sqrt((4 * Math.PI * radius * radius) / count)
  const sTangential = spacing * 0.95
  const sNormal = sTangential * 0.25

  const golden = Math.PI * (3 - Math.sqrt(5))
  const n = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const col = new THREE.Color()

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    const x = Math.cos(theta) * r
    const z = Math.sin(theta) * r

    n.set(x, y, z)
    positions[i * 3 + 0] = x * radius
    positions[i * 3 + 1] = y * radius
    positions[i * 3 + 2] = z * radius

    q.setFromUnitVectors(_zAxis, n)
    quats[i * 4 + 0] = q.x
    quats[i * 4 + 1] = q.y
    quats[i * 4 + 2] = q.z
    quats[i * 4 + 3] = q.w

    scales[i * 3 + 0] = sTangential
    scales[i * 3 + 1] = sTangential
    scales[i * 3 + 2] = sNormal

    const t = (y + 1) / 2
    col.copy(C.aqua).lerp(C.lav, THREE.MathUtils.smoothstep(t, 0, 1))
    col.lerp(C.rose, 0.12 * (0.5 + 0.5 * Math.sin(theta * 0.5)))
    colors[i * 3 + 0] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b

    opacities[i] = 0.9
    seeds[i] = rand()
  }

  return { count, positions, scales, quats, colors, opacities, seeds }
}

/**
 * A spiral galaxy: a flattened disk with arms and a bright bulge. Under the
 * "Galaxy" deform it rotates differentially (arms wind up) with a vertical
 * density wave — freeze mid-swirl and orbit to see the warped 3D spiral.
 */
export function galaxyCloud(count: number): GaussianCloudData {
  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3)
  const quats = new Float32Array(count * 4)
  const colors = new Float32Array(count * 3)
  const opacities = new Float32Array(count)
  const seeds = new Float32Array(count)

  const rand = mulberry32(1337)
  const arms = 4
  const maxR = 1.8
  const spiral = 2.4

  const q = new THREE.Quaternion().setFromUnitVectors(_zAxis, new THREE.Vector3(0, 1, 0))
  const col = new THREE.Color()

  const sTangential = 0.02
  const sNormal = 0.008

  for (let i = 0; i < count; i++) {
    const r = maxR * Math.pow(rand(), 0.5) // ~area-uniform with mild central bias
    const arm = i % arms
    const spread = (rand() - 0.5) * 0.5 * (0.2 + r)
    const ang = (arm / arms) * Math.PI * 2 + r * spiral + spread
    const x = Math.cos(ang) * r
    const z = Math.sin(ang) * r
    const thick = 0.28 * Math.exp(-r * 1.4) + 0.02
    const y = (rand() * 2 - 1) * thick * (rand() * 0.6 + 0.4)

    positions[i * 3 + 0] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z

    scales[i * 3 + 0] = sTangential
    scales[i * 3 + 1] = sTangential
    scales[i * 3 + 2] = sNormal

    quats[i * 4 + 0] = q.x
    quats[i * 4 + 1] = q.y
    quats[i * 4 + 2] = q.z
    quats[i * 4 + 3] = q.w

    const tr = Math.min(1, r / maxR)
    col.copy(C.amber).lerp(C.lav, THREE.MathUtils.smoothstep(tr, 0.0, 0.5))
    col.lerp(C.aqua, THREE.MathUtils.smoothstep(tr, 0.5, 1.0))
    const brighten = 1.0 + 0.6 * Math.exp(-r * 2.5) // hot core
    colors[i * 3 + 0] = col.r * brighten
    colors[i * 3 + 1] = col.g * brighten
    colors[i * 3 + 2] = col.b * brighten

    opacities[i] = 0.85
    seeds[i] = rand()
  }

  return { count, positions, scales, quats, colors, opacities, seeds }
}

/** A filled hot ball that blasts outward and re-collapses (the "Supernova" deform). */
export function supernovaCloud(count: number): GaussianCloudData {
  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3)
  const quats = new Float32Array(count * 4)
  const colors = new Float32Array(count * 3)
  const opacities = new Float32Array(count)
  const seeds = new Float32Array(count)

  const rand = mulberry32(909)
  const s = 0.02
  const hot = new THREE.Color('#fff1d0')
  const mid = new THREE.Color('#ff9d6f')
  const cool = new THREE.Color('#b98cff')
  const col = new THREE.Color()
  const golden = Math.PI * (3 - Math.sqrt(5))

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2
    const rad = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    const dx = Math.cos(theta) * rad
    const dy = y
    const dz = Math.sin(theta) * rad
    const r = Math.cbrt(rand()) * 0.7
    positions[i * 3 + 0] = dx * r
    positions[i * 3 + 1] = dy * r
    positions[i * 3 + 2] = dz * r

    scales[i * 3 + 0] = s
    scales[i * 3 + 1] = s
    scales[i * 3 + 2] = s
    quats[i * 4 + 3] = 1

    const tr = r / 0.7
    col.copy(hot).lerp(mid, THREE.MathUtils.smoothstep(tr, 0, 0.5))
    col.lerp(cool, THREE.MathUtils.smoothstep(tr, 0.5, 1))
    colors[i * 3 + 0] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b
    opacities[i] = 0.85
    seeds[i] = rand()
  }
  return { count, positions, scales, quats, colors, opacities, seeds }
}

/** A flat disk that ripples with traveling Gerstner-style waves (the "Wave" deform). */
export function waveCloud(count: number): GaussianCloudData {
  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3)
  const quats = new Float32Array(count * 4)
  const colors = new Float32Array(count * 3)
  const opacities = new Float32Array(count)
  const seeds = new Float32Array(count)

  const rand = mulberry32(220)
  const maxR = 1.7
  const q = new THREE.Quaternion().setFromUnitVectors(_zAxis, new THREE.Vector3(0, 1, 0))
  const lo = new THREE.Color('#5f6bff')
  const hi = new THREE.Color('#7ff0ff')
  const col = new THREE.Color()
  const st = 0.02
  const sn = 0.008

  for (let i = 0; i < count; i++) {
    const r = maxR * Math.sqrt(rand())
    const a = rand() * Math.PI * 2
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    positions[i * 3 + 0] = x
    positions[i * 3 + 1] = 0
    positions[i * 3 + 2] = z

    scales[i * 3 + 0] = st
    scales[i * 3 + 1] = st
    scales[i * 3 + 2] = sn
    quats[i * 4 + 0] = q.x
    quats[i * 4 + 1] = q.y
    quats[i * 4 + 2] = q.z
    quats[i * 4 + 3] = q.w

    col.copy(lo).lerp(hi, THREE.MathUtils.smoothstep(r / maxR, 0, 1))
    colors[i * 3 + 0] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b
    opacities[i] = 0.85
    seeds[i] = rand()
  }
  return { count, positions, scales, quats, colors, opacities, seeds }
}

/** A vertical curtain that sways and flows like an aurora (the "Aurora" deform). */
export function auroraCloud(count: number): GaussianCloudData {
  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3)
  const quats = new Float32Array(count * 4)
  const colors = new Float32Array(count * 3)
  const opacities = new Float32Array(count)
  const seeds = new Float32Array(count)

  const rand = mulberry32(515)
  const green = new THREE.Color('#5dffc4')
  const aqua = new THREE.Color('#5fd0ff')
  const violet = new THREE.Color('#c08bff')
  const col = new THREE.Color()
  const s = 0.016

  for (let i = 0; i < count; i++) {
    const x = (rand() * 2 - 1) * 1.7
    const yy = rand()
    const y = yy * 2.2 - 1.1
    const z = (rand() * 2 - 1) * 0.18
    positions[i * 3 + 0] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z

    scales[i * 3 + 0] = s
    scales[i * 3 + 1] = s * 1.8 // streak vertically
    scales[i * 3 + 2] = s
    quats[i * 4 + 3] = 1

    col.copy(green).lerp(aqua, THREE.MathUtils.smoothstep(yy, 0, 0.6))
    col.lerp(violet, THREE.MathUtils.smoothstep(yy, 0.6, 1))
    const fade = 0.5 + 0.5 * Math.sin(yy * Math.PI) // brighter mid-height
    colors[i * 3 + 0] = col.r * fade
    colors[i * 3 + 1] = col.g * fade
    colors[i * 3 + 2] = col.b * fade
    opacities[i] = 0.7
    seeds[i] = rand()
  }
  return { count, positions, scales, quats, colors, opacities, seeds }
}

/** Sphere ⟷ torus ⟷ cube, with corresponding points so it morphs cleanly. */
export function morphCloud(count: number): GaussianCloudData {
  const positions = new Float32Array(count * 3) // sphere (base)
  const targetsA = new Float32Array(count * 3) // torus
  const targetsB = new Float32Array(count * 3) // cube
  const scales = new Float32Array(count * 3)
  const quats = new Float32Array(count * 4)
  const colors = new Float32Array(count * 3)
  const opacities = new Float32Array(count)
  const seeds = new Float32Array(count)

  const rand = mulberry32(404)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const col = new THREE.Color()
  const a1 = new THREE.Color('#c6bfff')
  const a2 = new THREE.Color('#6fe0ff')
  const s = 0.018

  const R = 0.62
  const tube = 0.3
  const sphereR = 0.95
  const cubeR = 0.78

  for (let i = 0; i < count; i++) {
    // Shared direction → consistent correspondence across all three shapes.
    const uy = 1 - (i / Math.max(1, count - 1)) * 2
    const rad = Math.sqrt(Math.max(0, 1 - uy * uy))
    const theta = golden * i
    const dx = Math.cos(theta) * rad
    const dy = uy
    const dz = Math.sin(theta) * rad

    // sphere
    positions[i * 3 + 0] = dx * sphereR
    positions[i * 3 + 1] = dy * sphereR
    positions[i * 3 + 2] = dz * sphereR

    // torus (major angle from azimuth, minor angle from latitude)
    const ang = Math.atan2(dz, dx)
    const phi = Math.asin(Math.max(-1, Math.min(1, dy)))
    const cr = R + tube * Math.cos(phi)
    targetsA[i * 3 + 0] = Math.cos(ang) * cr
    targetsA[i * 3 + 1] = tube * Math.sin(phi)
    targetsA[i * 3 + 2] = Math.sin(ang) * cr

    // cube (project the direction onto the cube surface)
    const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) || 1
    targetsB[i * 3 + 0] = (dx / m) * cubeR
    targetsB[i * 3 + 1] = (dy / m) * cubeR
    targetsB[i * 3 + 2] = (dz / m) * cubeR

    scales[i * 3 + 0] = s
    scales[i * 3 + 1] = s
    scales[i * 3 + 2] = s
    quats[i * 4 + 3] = 1

    col.copy(a1).lerp(a2, (dy + 1) / 2)
    colors[i * 3 + 0] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b
    opacities[i] = 0.9
    seeds[i] = rand()
  }
  return { count, positions, scales, quats, colors, opacities, seeds, targetsA, targetsB }
}
