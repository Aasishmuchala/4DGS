precision highp float;
precision highp int;

// --- Built-in uniforms (populated by three for every mesh) ---
uniform mat4 modelViewMatrix;   // world -> view  (mesh is at identity, so = viewMatrix)
uniform mat4 projectionMatrix;  // view  -> clip

// --- Gaussian attribute textures (one texel per gaussian) ---
uniform sampler2D uTexPos;     // rgb = center,  a = opacity
uniform sampler2D uTexScale;   // rgb = scale (std-dev per axis),  a = seed
uniform sampler2D uTexQuat;    // xyzw = rotation quaternion
uniform sampler2D uTexColor;   // rgb = linear color
uniform sampler2D uTexMorphA;  // rgb = morph target 1 (torus)
uniform sampler2D uTexMorphB;  // rgb = morph target 2 (cube)
uniform int uTexWidth;

uniform vec2 uFocal;     // focal length in pixels (fx, fy)
uniform vec2 uViewport;  // drawing-buffer size in pixels

// --- 4D + live params ---
uniform float uPhase;    // normalized loop phase 0..1 (seamless)
uniform int uMode;       // deform mode (matches scenes/deform.ts)
uniform float uAmp;      // motion amplitude multiplier
uniform float uMorph;    // morph blend position 0..3 (mode 5)
uniform int uPalette;    // palette id (0 = scene default)

in vec3 position;   // unit quad corner in [-1,1]^2, z = 0
in float aIndex;    // gaussian index for this instance (sorted order)

out vec3 vColor;
out float vOpacity;
out vec2 vDelta;    // pixel offset from the splat center
out vec3 vConic;    // (a, b, c) of the inverse 2D covariance

const float TAU = 6.283185307179586;

mat3 quatToMat3(vec4 q) {
  q = normalize(q);
  float x = q.x, y = q.y, z = q.z, w = q.w;
  float xx = x * x, yy = y * y, zz = z * z;
  return mat3(
    1.0 - 2.0 * (yy + zz), 2.0 * (x * y + w * z),  2.0 * (x * z - w * y),
    2.0 * (x * y - w * z), 1.0 - 2.0 * (xx + zz),  2.0 * (y * z + w * x),
    2.0 * (x * z + w * y), 2.0 * (y * z - w * x),  1.0 - 2.0 * (xx + yy)
  );
}

// Shared organic turbulence (curl-ish, seamless, scaled by amplitude).
vec3 turbulence(vec3 p, float seed, float ph) {
  return uAmp * 0.045 * vec3(
    sin(p.y * 3.0 + ph * 2.0 + seed * TAU),
    sin(p.z * 3.0 + ph * 2.0 + 1.7),
    sin(p.x * 3.0 + ph * 2.0 + 3.3)
  );
}

// Mode-specific motion (without turbulence). MUST match scenes/deform.ts.
vec3 deformCore(vec3 p, float seed, float ph) {
  if (uMode == 0) {
    // Galaxy
    float r = length(p.xz);
    float ang = ph * 2.0 + (0.5 * sin(ph)) / (1.0 + 0.9 * r);
    float ca = cos(ang), sa = sin(ang);
    return vec3(ca * p.x - sa * p.z, p.y + uAmp * 0.14 * sin(ph * 2.0 + r * 3.0 + seed * TAU), sa * p.x + ca * p.z);
  } else if (uMode == 1) {
    // Pulse
    float ca = cos(ph), sa = sin(ph);
    vec3 pr = vec3(ca * p.x - sa * p.z, p.y, sa * p.x + ca * p.z);
    vec3 n = pr / (length(pr) + 1e-5);
    float breathe = 1.0 + 0.14 * sin(ph);
    float ripple = uAmp * (0.10 * sin(ph * 2.0 + pr.y * 7.0 + seed * TAU)
                 + 0.07 * sin(ph + pr.x * 5.0)
                 + 0.05 * sin(ph * 3.0 + pr.z * 6.0));
    return pr * breathe + n * ripple;
  } else if (uMode == 2) {
    // Supernova — radial blast that swells and re-collapses each loop.
    float e = 0.5 * (1.0 - cos(ph));
    vec3 n = p / (length(p) + 1e-5);
    return p + n * (uAmp * e * (0.7 + 0.9 * seed));
  } else if (uMode == 3) {
    // Wave — traveling vertical ripples on a flat disk.
    float h = uAmp * (0.14 * sin(p.x * 2.0 + ph * 2.0)
            + 0.10 * sin(p.z * 2.3 + ph * 2.0)
            + 0.07 * sin((p.x + p.z) * 1.7 - ph * 2.0));
    return vec3(p.x, p.y + h, p.z);
  } else {
    // Aurora — a swaying, flowing curtain.
    return vec3(
      p.x + uAmp * 0.25 * sin(p.y * 1.5 + ph * 2.0 + seed * TAU),
      p.y + uAmp * 0.10 * sin(p.x * 1.2 + ph * 2.0),
      p.z + uAmp * 0.15 * sin(p.y * 2.0 - ph * 2.0)
    );
  }
}

// 3-way morph: sphere ⟶ torus ⟶ cube ⟶ sphere (mode 5).
vec3 morphBlend(vec3 sphere, vec3 torus, vec3 cube, float m) {
  m = min(2.999999, m);
  float seg = floor(m);
  float f = smoothstep(0.0, 1.0, m - seg);
  if (seg < 0.5) return mix(sphere, torus, f);
  if (seg < 1.5) return mix(torus, cube, f);
  return mix(cube, sphere, f);
}

void main() {
  int idx = int(aIndex + 0.5);
  ivec2 uv = ivec2(idx % uTexWidth, idx / uTexWidth);

  vec4 pPos = texelFetch(uTexPos, uv, 0);
  vec4 pScale = texelFetch(uTexScale, uv, 0);
  vec4 quat = texelFetch(uTexQuat, uv, 0);
  vec3 color = texelFetch(uTexColor, uv, 0).rgb;

  vec3 base = pPos.xyz;
  vec3 scale = pScale.xyz;
  float seed = pScale.w;
  float opacity = pPos.w;
  float ph = TAU * uPhase;

  // 4D: evaluate the gaussian's current-frame center.
  vec3 center;
  if (uMode == 6) {
    center = base; // static loaded data (real capture) — no animation
  } else if (uMode == 5) {
    vec3 torus = texelFetch(uTexMorphA, uv, 0).xyz;
    vec3 cube = texelFetch(uTexMorphB, uv, 0).xyz;
    center = morphBlend(base, torus, cube, uMorph) + turbulence(base, seed, ph);
  } else {
    center = deformCore(base, seed, ph) + turbulence(base, seed, ph);
  }

  // 3D covariance  Σ = R S Sᵀ Rᵀ = M Mᵀ,  M = R·S (scale the rotation columns).
  mat3 R = quatToMat3(quat);
  mat3 M = mat3(R[0] * scale.x, R[1] * scale.y, R[2] * scale.z);
  mat3 Sigma = M * transpose(M);

  // View-space center; cull if behind the camera.
  vec4 viewC = modelViewMatrix * vec4(center, 1.0);
  if (viewC.z > -0.02) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float tz = viewC.z;
  float tz2 = tz * tz;

  // EWA splatting: project Σ to a 2D screen-space covariance via the Jacobian J.
  mat3 W = mat3(modelViewMatrix);
  vec3 Jr0 = vec3(uFocal.x / tz, 0.0, -uFocal.x * viewC.x / tz2);
  vec3 Jr1 = vec3(0.0, uFocal.y / tz, -uFocal.y * viewC.y / tz2);
  vec3 T0 = Jr0 * W;
  vec3 T1 = Jr1 * W;

  vec3 ST0 = Sigma * T0;
  vec3 ST1 = Sigma * T1;
  float c00 = dot(T0, ST0) + 0.3;
  float c01 = dot(T0, ST1);
  float c11 = dot(T1, ST1) + 0.3;

  float det = c00 * c11 - c01 * c01;
  if (det <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float invDet = 1.0 / det;
  vConic = vec3(c11 * invDet, -c01 * invDet, c00 * invDet);

  float mid = 0.5 * (c00 + c11);
  float lambda = mid + sqrt(max(0.1, mid * mid - det));
  float radius = ceil(3.0 * sqrt(lambda));

  vec4 clip = projectionMatrix * viewC;
  vec2 cornerPx = position.xy * radius;
  vec2 ndcOffset = 2.0 * cornerPx / uViewport;
  gl_Position = vec4(clip.xy / clip.w + ndcOffset, clip.z / clip.w, 1.0);

  // Live palette remap (id 0 = scene default, untouched). Maps brightness through
  // a two-stop gradient so structure is preserved while the mood changes.
  if (uPalette > 0) {
    float lum = clamp(dot(color, vec3(0.299, 0.587, 0.114)) * 1.3, 0.0, 1.0);
    float h = lum * 2.0;
    if (uPalette == 1) {          // Ember
      color = lum < 0.5
        ? mix(vec3(0.12, 0.02, 0.05), vec3(0.95, 0.28, 0.10), h)
        : mix(vec3(0.95, 0.28, 0.10), vec3(1.00, 0.85, 0.55), h - 1.0);
    } else if (uPalette == 2) {   // Aurora
      color = lum < 0.5
        ? mix(vec3(0.02, 0.30, 0.18), vec3(0.25, 0.95, 0.60), h)
        : mix(vec3(0.25, 0.95, 0.60), vec3(0.60, 0.50, 1.00), h - 1.0);
    } else {                      // Mono (lavender)
      color = mix(vec3(0.06, 0.05, 0.12), vec3(0.82, 0.78, 1.00), lum);
    }
  }
  // Pulse: a gentle brightness shimmer (shader-only, no resort).
  if (uMode == 1) {
    color *= 1.0 + 0.18 * sin(ph + length(center) * 3.0);
  }

  vDelta = cornerPx;
  vColor = color;
  vOpacity = opacity;
}
