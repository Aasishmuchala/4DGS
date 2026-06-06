precision highp float;

in vec3 vColor;
in float vOpacity;
in vec2 vDelta; // pixel offset from the splat center
in vec3 vConic; // (a, b, c) of the inverse 2D covariance

out vec4 fragColor;

void main() {
  // Gaussian falloff:  exp(-½ · dᵀ Σ'⁻¹ d),  Σ'⁻¹ = [[a, b], [b, c]].
  float power = -0.5 * (vConic.x * vDelta.x * vDelta.x
                      + 2.0 * vConic.y * vDelta.x * vDelta.y
                      + vConic.z * vDelta.y * vDelta.y);
  if (power > 0.0) discard; // outside the ellipse (numerical guard)

  float alpha = vOpacity * exp(power);
  if (alpha < 0.00392) discard; // < 1/255 → invisible

  // Premultiplied alpha for back-to-front "over" compositing.
  fragColor = vec4(vColor * alpha, alpha);
}
