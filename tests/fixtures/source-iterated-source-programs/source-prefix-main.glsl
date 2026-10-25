void main() {
  vec4 current = oldState;
  vec3 pos = current.xyz;
  float stepMetric = current.w;

  int stepCount = clamp(steps, 1, 16);
  for (int i = 0; i < 16; i++) {
    if (i >= stepCount) break;
    vec3 nextPos = pos;
    float metric = stepMetric;
    calculate_next(pos, nextPos, metric);
    if (dimension == 2) {
      nextPos.z = 0.0;
    }
    pos = nextPos;
    stepMetric = metric;
  }

  newState = vec4(pos, stepMetric);
  gl_Position=vec4(0.);
}
