import * as THREE from 'three'

/**
 * The cinematic stage: a dark gradient sky dome with a faint lavender horizon
 * glow, plus a far starfield. Rendered inside the scene (not via CSS) so the
 * bloom pass has something to glow against and the splats sit *in* space.
 */
export function createBackdrop(): THREE.Group {
  const group = new THREE.Group()

  // --- Gradient sky dome ---
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color('#0a0a16') },
      uBottom: { value: new THREE.Color('#040408') },
      uGlow: { value: new THREE.Color('#1d1640') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform vec3 uGlow;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y * 0.5 + 0.5;
        vec3 c = mix(uBottom, uTop, h);
        float glow = pow(max(0.0, 1.0 - abs(d.y)), 3.0); // soft equatorial band
        c += uGlow * glow * 0.6;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(45, 32, 16), skyMat)
  sky.frustumCulled = false
  sky.renderOrder = -2
  group.add(sky)

  // --- Starfield ---
  const N = 1600
  const positions = new Float32Array(N * 3)
  const colors = new Float32Array(N * 3)
  const c = new THREE.Color()
  for (let i = 0; i < N; i++) {
    const u = Math.random()
    const v = Math.random()
    const theta = 2 * Math.PI * u
    const phi = Math.acos(2 * v - 1)
    const r = 16 + Math.random() * 22
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.cos(phi)
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    const b = 0.4 + Math.random() * 0.6
    c.setHSL(0.58 + Math.random() * 0.12, 0.45, 0.72).multiplyScalar(b)
    colors[i * 3 + 0] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      size: 0.09,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  stars.frustumCulled = false
  stars.renderOrder = -1
  group.add(stars)

  return group
}
