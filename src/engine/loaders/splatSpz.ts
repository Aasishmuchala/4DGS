import type { GaussianCloudData } from '../scenes/generators'

/**
 * Parser for Niantic's `.spz` gaussian-splat format (Scaniverse, Niantic Spatial,
 * and anything using the `nianticlabs/spz` reference codec). About 10× smaller than
 * the equivalent INRIA `.ply`. Produces the engine's `GaussianCloudData` so it slots
 * straight into GaussianCloud alongside `parseSplatPly`.
 *
 * Format (verified against nianticlabs/spz `src/cc/load-spz.cc`):
 *   • The whole file is GZIP-compressed. Decompress natively via DecompressionStream.
 *   • 16-byte little-endian header, then attribute arrays in a FIXED order:
 *         positions → alphas → colors → scales → rotations → (sh)
 *     (note: NOT the per-gaussian interleaving used by `.splat`).
 *
 * Decode formulas (exact, from the reference unpackGaussians):
 *   • position[c] = signExtend24(3 LE bytes) / 2^fractionalBits         (world units)
 *   • scale[c]    = exp(byte/16 − 10)                                   (world-space std-dev)
 *   • rotation    : v1/v2 → 3 bytes "first three"  xyz = byte/127.5 − 1, w = √(1−|xyz|²)
 *                   v3+   → 4 bytes "smallest three" (2-bit largest idx + 3×10-bit signed)
 *                   stored normalized as three.js (x, y, z, w)
 *   • opacity     = byte/255                                            (0..1; reference stores
 *                   invSigmoid(byte/255) as logit, a viewer re-applies sigmoid → cancels out)
 *   • color (DC)  = clamp(0.5 + C0·dc, 0, 1),  dc = (byte/255 − 0.5)/0.15
 *                   (same SH DC → RGB convention as the PLY loader; 0.15 is spz's colorScale)
 *
 * Only SH degree 0 (the DC term) is used for color; higher SH bands are skipped
 * (view-independent color, matching the PLY loader's v1 limitation). `seeds` is zeroed.
 *
 * Dependency-free: DecompressionStream / Blob / Response are native browser APIs.
 */

const NGSP_MAGIC = 0x5053474e // 'NGSP' little-endian
const SH_C0 = 0.28209479177387814 // SH band-0 basis: 0.5 + C0·dc → linear RGB
const COLOR_SCALE = 0.15 // spz `colorScale`: DC byte ↦ coefficient
const SQRT1_2 = 0.7071067811865476 // 1/√2, magnitude bound for smallest-three quats
const SH_MIN_SMALLEST_THREE_VERSION = 3 // versions ≥3 use 4-byte quaternions

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** SH coefficients per channel for a given degree (spz `dimForDegree`). */
function dimForDegree(degree: number): number {
  switch (degree) {
    case 0: return 0
    case 1: return 3
    case 2: return 8
    case 3: return 15
    default: return 24 // degree 4 (max)
  }
}

/** GZIP-decompress an ArrayBuffer using the native streams API. */
async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

export async function parseSplatSpz(buffer: ArrayBuffer): Promise<GaussianCloudData> {
  const raw = await gunzip(buffer)
  const bytes = new Uint8Array(raw)
  const dv = new DataView(raw)

  if (raw.byteLength < 16) throw new Error('SPZ: file too short for header')

  // --- 16-byte header (little-endian) ---
  const magic = dv.getUint32(0, true)
  if (magic !== NGSP_MAGIC) {
    throw new Error(`SPZ: bad magic 0x${magic.toString(16)} (expected NGSP)`)
  }
  const version = dv.getUint32(4, true)
  const count = dv.getUint32(8, true)
  const shDegree = dv.getUint8(12)
  const fractionalBits = dv.getUint8(13)
  const flags = dv.getUint8(14)
  // byte 15 = reserved

  if (count <= 0) throw new Error(`SPZ: invalid point count ${count}`)
  if (version < 1 || version > 4) throw new Error(`SPZ: unsupported version ${version}`)

  const usesFloat16 = (flags & 0x1) !== 0 ? false : false // positions float16 is detected by size, not flag
  // The reference detects float16 positions via packed size; the GZIP path here always
  // ships 24-bit fixed-point positions (9 bytes/pt). float16 has never been emitted by
  // the legacy serializer, so we treat positions as fixed-point. (kept explicit for clarity)
  void usesFloat16

  const usesSmallestThree = version >= SH_MIN_SMALLEST_THREE_VERSION
  const posBytes = 9 // 3 coords × 3 bytes (24-bit fixed point)
  const rotBytes = usesSmallestThree ? 4 : 3
  const shPerPoint = dimForDegree(shDegree) * 3 // RGB-interleaved

  // --- section offsets, in spz's serialization order ---
  let off = 16
  const posOff = off; off += count * posBytes
  const alphaOff = off; off += count * 1
  const colorOff = off; off += count * 3
  const scaleOff = off; off += count * 3
  const rotOff = off; off += count * rotBytes
  const shOff = off; off += count * shPerPoint // sh skipped, but bounds-checked below

  if (off > raw.byteLength) {
    throw new Error(
      `SPZ: truncated payload — need ${off} bytes, have ${raw.byteLength} ` +
      `(count=${count}, v=${version}, sh=${shDegree})`,
    )
  }
  void shOff

  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3)
  const quats = new Float32Array(count * 4)
  const colors = new Float32Array(count * 3)
  const opacities = new Float32Array(count)
  const seeds = new Float32Array(count) // zeros — unused for loaded data

  const posScale = 1 / (1 << fractionalBits)

  for (let i = 0; i < count; i++) {
    // positions: 3× signed 24-bit little-endian fixed point
    const pBase = posOff + i * posBytes
    for (let c = 0; c < 3; c++) {
      const b = pBase + c * 3
      let fixed = bytes[b] | (bytes[b + 1] << 8) | (bytes[b + 2] << 16)
      if (fixed & 0x800000) fixed |= ~0xffffff // sign-extend bit 23 → negative
      positions[i * 3 + c] = fixed * posScale
    }

    // scales: log-encoded byte → world-space std-dev
    const sBase = scaleOff + i * 3
    scales[i * 3 + 0] = Math.exp(bytes[sBase] / 16 - 10)
    scales[i * 3 + 1] = Math.exp(bytes[sBase + 1] / 16 - 10)
    scales[i * 3 + 2] = Math.exp(bytes[sBase + 2] / 16 - 10)

    // rotation → three.js (x, y, z, w), normalized
    const rBase = rotOff + i * rotBytes
    let x: number, y: number, z: number, w: number
    if (usesSmallestThree) {
      // 4 bytes: bits 30-31 = index of largest (implicit) component;
      // remaining three 10-bit fields = (9-bit magnitude, 1 sign bit) each.
      const comp =
        (bytes[rBase] |
          (bytes[rBase + 1] << 8) |
          (bytes[rBase + 2] << 16) |
          (bytes[rBase + 3] << 24)) >>> 0
      const cMask = (1 << 9) - 1
      const iLargest = comp >>> 30
      const q = [0, 0, 0, 0]
      let rest = comp
      let sumSq = 0
      for (let k = 3; k >= 0; k--) {
        if (k !== iLargest) {
          const mag = rest & cMask
          const neg = (rest >>> 9) & 0x1
          rest = rest >>> 10
          let v = (SQRT1_2 * mag) / cMask
          if (neg === 1) v = -v
          q[k] = v
          sumSq += v * v
        }
      }
      q[iLargest] = Math.sqrt(Math.max(0, 1 - sumSq))
      x = q[0]; y = q[1]; z = q[2]; w = q[3]
    } else {
      // 3 bytes: xyz in [-1, 1], w reconstructed (w ≥ 0 by construction)
      x = bytes[rBase] / 127.5 - 1
      y = bytes[rBase + 1] / 127.5 - 1
      z = bytes[rBase + 2] / 127.5 - 1
      w = Math.sqrt(Math.max(0, 1 - (x * x + y * y + z * z)))
    }
    const n = Math.hypot(x, y, z, w) || 1
    quats[i * 4 + 0] = x / n
    quats[i * 4 + 1] = y / n
    quats[i * 4 + 2] = z / n
    quats[i * 4 + 3] = w / n

    // opacity: stored byte ÷ 255 (the reference's invSigmoid/sigmoid round-trips to this)
    opacities[i] = bytes[alphaOff + i] / 255

    // color: DC term → linear RGB (same convention as the PLY loader)
    const cBase = colorOff + i * 3
    const dc0 = (bytes[cBase] / 255 - 0.5) / COLOR_SCALE
    const dc1 = (bytes[cBase + 1] / 255 - 0.5) / COLOR_SCALE
    const dc2 = (bytes[cBase + 2] / 255 - 0.5) / COLOR_SCALE
    colors[i * 3 + 0] = clamp01(0.5 + SH_C0 * dc0)
    colors[i * 3 + 1] = clamp01(0.5 + SH_C0 * dc1)
    colors[i * 3 + 2] = clamp01(0.5 + SH_C0 * dc2)
  }

  return { count, positions, scales, quats, colors, opacities, seeds }
}
