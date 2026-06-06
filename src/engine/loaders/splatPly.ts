import type { GaussianCloudData } from '../scenes/generators'

/**
 * Parser for the standard INRIA 3D Gaussian Splatting `.ply` (the format Polycam,
 * Luma, Postshot, Nerfstudio/gsplat, Brush, etc. export). Produces the engine's
 * `GaussianCloudData` so it slots straight into the existing GaussianCloud.
 *
 * Decodes the real 3DGS conventions:
 *   • scale   = exp(scale_i)
 *   • opacity = sigmoid(opacity)
 *   • color   = clamp(0.5 + C0 · f_dc_i, 0, 1)   (spherical-harmonic DC term; higher
 *               SH bands `f_rest_*` are skipped → view-independent color, a known v1 limit)
 *   • quat    = normalize( rot_0..3 = (w, x, y, z) )  → three.js (x, y, z, w)
 *
 * Property order is read from the header (not assumed) so files with/without
 * normals or with any number of `f_rest_*` bands parse correctly.
 */

const SH_C0 = 0.28209479177387814
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

const TYPE_SIZE: Record<string, number> = {
  float: 4, float32: 4, double: 8, float64: 8,
  uchar: 1, uint8: 1, char: 1, int8: 1,
  ushort: 2, uint16: 2, short: 2, int16: 2,
  uint: 4, uint32: 4, int: 4, int32: 4,
}

interface Prop {
  name: string
  type: string
  offset: number
}

function decodeHeader(bytes: Uint8Array): { headerLines: string[]; dataOffset: number } {
  const max = Math.min(bytes.length, 1 << 17) // headers are tiny; cap the ascii scan
  let text = ''
  for (let i = 0; i < max; i++) text += String.fromCharCode(bytes[i])
  const idx = text.indexOf('end_header')
  if (idx < 0 || text.slice(0, 3) !== 'ply') throw new Error('Not a PLY file')
  const nl = text.indexOf('\n', idx)
  return { headerLines: text.slice(0, idx).split('\n'), dataOffset: nl + 1 }
}

export function parseSplatPly(buffer: ArrayBuffer): GaussianCloudData {
  const bytes = new Uint8Array(buffer)
  const { headerLines, dataOffset } = decodeHeader(bytes)

  let format = 'binary_little_endian'
  let count = 0
  let inVertex = false
  let stride = 0
  const props: Prop[] = []
  const map = new Map<string, Prop>()

  for (const raw of headerLines) {
    const tok = raw.trim().split(/\s+/)
    if (tok[0] === 'format') format = tok[1]
    else if (tok[0] === 'element') {
      inVertex = tok[1] === 'vertex'
      if (inVertex) count = parseInt(tok[2], 10)
    } else if (tok[0] === 'property' && inVertex) {
      if (tok[1] === 'list') continue // 3DGS vertices have no list props
      const type = tok[1]
      const name = tok[2]
      const size = TYPE_SIZE[type] ?? 4
      const p: Prop = { name, type, offset: stride }
      props.push(p)
      map.set(name, p)
      stride += size
    }
  }

  if (!count || !map.has('x') || !map.has('y') || !map.has('z')) {
    throw new Error('PLY missing vertex positions')
  }
  if (format !== 'binary_little_endian' && format !== 'binary_big_endian') {
    throw new Error(`Unsupported PLY format "${format}" (expected binary)`)
  }
  const le = format === 'binary_little_endian'
  const dv = new DataView(buffer, dataOffset)

  const reader = (p: Prop) => {
    switch (p.type) {
      case 'double':
      case 'float64':
        return (rec: number) => dv.getFloat64(rec * stride + p.offset, le)
      case 'uchar':
      case 'uint8':
        return (rec: number) => dv.getUint8(rec * stride + p.offset)
      case 'char':
      case 'int8':
        return (rec: number) => dv.getInt8(rec * stride + p.offset)
      case 'ushort':
      case 'uint16':
        return (rec: number) => dv.getUint16(rec * stride + p.offset, le)
      case 'short':
      case 'int16':
        return (rec: number) => dv.getInt16(rec * stride + p.offset, le)
      case 'uint':
      case 'uint32':
        return (rec: number) => dv.getUint32(rec * stride + p.offset, le)
      case 'int':
      case 'int32':
        return (rec: number) => dv.getInt32(rec * stride + p.offset, le)
      default:
        return (rec: number) => dv.getFloat32(rec * stride + p.offset, le)
    }
  }
  const acc = (name: string): ((rec: number) => number) | null => {
    const p = map.get(name)
    return p ? reader(p) : null
  }

  const rx = acc('x')!, ry = acc('y')!, rz = acc('z')!
  const rs0 = acc('scale_0'), rs1 = acc('scale_1'), rs2 = acc('scale_2')
  const rq0 = acc('rot_0'), rq1 = acc('rot_1'), rq2 = acc('rot_2'), rq3 = acc('rot_3')
  const rop = acc('opacity') ?? acc('alpha')
  const rfdc0 = acc('f_dc_0'), rfdc1 = acc('f_dc_1'), rfdc2 = acc('f_dc_2')
  const rred = acc('red'), rgreen = acc('green'), rblue = acc('blue') // converted .splat-style PLYs
  const colorIsByte = !!map.get('red') && TYPE_SIZE[map.get('red')!.type] === 1

  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3)
  const quats = new Float32Array(count * 4)
  const colors = new Float32Array(count * 3)
  const opacities = new Float32Array(count)
  const seeds = new Float32Array(count) // unused for loaded data

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = rx(i)
    positions[i * 3 + 1] = ry(i)
    positions[i * 3 + 2] = rz(i)

    // scale: 3DGS stores log-scale → exp; if absent, a tiny default.
    scales[i * 3 + 0] = rs0 ? Math.exp(rs0(i)) : 0.01
    scales[i * 3 + 1] = rs1 ? Math.exp(rs1(i)) : 0.01
    scales[i * 3 + 2] = rs2 ? Math.exp(rs2(i)) : 0.01

    // rotation: rot = (w, x, y, z) → three (x, y, z, w), normalized.
    if (rq0) {
      const w = rq0(i), x = rq1!(i), y = rq2!(i), z = rq3!(i)
      const n = Math.hypot(w, x, y, z) || 1
      quats[i * 4 + 0] = x / n
      quats[i * 4 + 1] = y / n
      quats[i * 4 + 2] = z / n
      quats[i * 4 + 3] = w / n
    } else {
      quats[i * 4 + 3] = 1 // identity
    }

    // color
    if (rfdc0) {
      colors[i * 3 + 0] = clamp01(0.5 + SH_C0 * rfdc0(i))
      colors[i * 3 + 1] = clamp01(0.5 + SH_C0 * rfdc1!(i))
      colors[i * 3 + 2] = clamp01(0.5 + SH_C0 * rfdc2!(i))
    } else if (rred) {
      const s = colorIsByte ? 1 / 255 : 1
      colors[i * 3 + 0] = clamp01(rred(i) * s)
      colors[i * 3 + 1] = clamp01(rgreen!(i) * s)
      colors[i * 3 + 2] = clamp01(rblue!(i) * s)
    } else {
      colors[i * 3 + 0] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0.8
    }

    // opacity: 3DGS stores logit → sigmoid; byte-alpha → /255; else opaque.
    opacities[i] = rop ? (colorIsByte && !acc('f_dc_0') ? clamp01(rop(i) / 255) : sigmoid(rop(i))) : 1
  }

  return { count, positions, scales, quats, colors, opacities, seeds }
}
