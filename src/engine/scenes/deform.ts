/**
 * CPU mirror of the in-shader `deform()` (see splat.vert.glsl).
 *
 * The vertex shader animates gaussian positions on the GPU for *rendering*; this
 * identical math runs on the CPU to produce the positions the depth sorter needs
 * (premultiplied blending must be sorted by the *current* depth). The two
 * implementations MUST stay in lock-step — same modes, constants, and the `amp`
 * (motion amplitude) scaling.
 *
 * Motion is parameterized by the **normalized loop phase** `tn ∈ [0,1)`; every
 * time term is an integer harmonic of `TAU·tn`, so the loop is seamless.
 */
const TAU = 6.283185307179586

function smooth(u: number): number {
  return u * u * (3 - 2 * u)
}

/**
 * Write the deformed world position of one gaussian into `out[o..o+2]`
 * for the analytic modes (0–4). `amp` scales displacement magnitude.
 */
export function deformPosition(
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
  // Static loaded data (real captures): no animation, no turbulence — identity.
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

/**
 * Morph mode (5): blend sphere → torus → cube → sphere by `morph ∈ [0,3)`,
 * then add the shared turbulence. Kept separate because it needs the per-gaussian
 * target positions. MUST match `morphBlend()` + `turbulence()` in the shader.
 */
export function deformMorph(
  out: Float32Array,
  o: number,
  sx: number,
  sy: number,
  sz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  seed: number,
  tn: number,
  morph: number,
  amp: number,
): void {
  const m = Math.min(2.999999, morph)
  const seg = Math.floor(m)
  const f = smooth(m - seg)
  let px: number
  let py: number
  let pz: number
  if (seg < 0.5) {
    px = sx + (ax - sx) * f
    py = sy + (ay - sy) * f
    pz = sz + (az - sz) * f
  } else if (seg < 1.5) {
    px = ax + (bx - ax) * f
    py = ay + (by - ay) * f
    pz = az + (bz - az) * f
  } else {
    px = bx + (sx - bx) * f
    py = by + (sy - by) * f
    pz = bz + (sz - bz) * f
  }

  const ph = TAU * tn
  px += amp * 0.045 * Math.sin(sy * 3.0 + ph * 2.0 + seed * TAU)
  py += amp * 0.045 * Math.sin(sz * 3.0 + ph * 2.0 + 1.7)
  pz += amp * 0.045 * Math.sin(sx * 3.0 + ph * 2.0 + 3.3)

  out[o] = px
  out[o + 1] = py
  out[o + 2] = pz
}
