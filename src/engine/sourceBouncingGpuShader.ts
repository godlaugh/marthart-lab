/** Pinned MathArt 1.7.8 collision kernel, JAR SHA256
 * a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018.
 * Only #version and highp declarations differ from retained GLSL 410.
 * No exact-ballistic repair, coordinate normalization or extra collisions. */
// quad_attrib.vert SHA256 6fb3b800bf875cd150753deaf7a7ae894a367f051495add8e8a65613a688982b
export const sourceBouncingQuad=`#version 300 es
precision highp float;
precision highp int;

in vec2 quadPosition;
out vec2 texCoord;

void main() {
  float x = quadPosition.x;
  float y = quadPosition.y;
  gl_Position = vec4(x, y, 0.0, 1.0);
  texCoord = vec2((x + 1.0) * 0.5, (y + 1.0) * 0.5);
}
`;
// bouncing_particles_update.frag SHA256 eb716d5dd721f791efbc8e1db9e976ebf7cd91aab2ac33625329f9407fbf484b
export const sourceBouncingUpdateFragment=`#version 300 es
precision highp float;
precision highp int;

#define MAX_POLYGON_VERTICES 64
#define MAX_COLLISIONS_PER_SUBSTEP 4

uniform sampler2D stateTex;
uniform int subSteps;
uniform float timeStep;
uniform float particleRadius;
uniform int containerShape; // 0 = convex polygon, 1 = circle, 2 = ellipse
uniform vec2 circleCenter;
uniform float circleRadius;
uniform vec2 ellipseCenter;
uniform float ellipseA;
uniform float ellipseB;
uniform int polygonVertexCount;
uniform vec2 polygonVertices[MAX_POLYGON_VERTICES];

in vec2 texCoord;
out vec4 newState;

float cross2(vec2 a, vec2 b) {
  return a.x * b.y - a.y * b.x;
}

float polygonSignedArea() {
  float area = 0.0;
  for (int i = 0; i < MAX_POLYGON_VERTICES; i++) {
    if (i >= polygonVertexCount) break;
    vec2 a = polygonVertices[i];
    vec2 b = polygonVertices[(i + 1) % polygonVertexCount];
    area += cross2(a, b);
  }
  return area * 0.5;
}

bool isInsidePolygon(vec2 p) {
  bool inside = false;
  for (int i = 0; i < MAX_POLYGON_VERTICES; i++) {
    if (i >= polygonVertexCount) break;
    int j = (i + polygonVertexCount - 1) % polygonVertexCount;
    vec2 pi = polygonVertices[i];
    vec2 pj = polygonVertices[j];
    float denom = pj.y - pi.y;
    if (abs(denom) < 1.0e-12) {
      denom = denom < 0.0 ? -1.0e-12 : 1.0e-12;
    }
    bool intersects = ((pi.y > p.y) != (pj.y > p.y)) &&
        (p.x < (pj.x - pi.x) * (p.y - pi.y) / denom + pi.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

vec2 closestPointOnPolygon(vec2 p, out vec2 normalOut) {
  float minDistSq = 1.0e20;
  vec2 closest = p;
  vec2 bestNormal = vec2(0.0, 1.0);
  float area = polygonSignedArea();
  for (int i = 0; i < MAX_POLYGON_VERTICES; i++) {
    if (i >= polygonVertexCount) break;
    vec2 a = polygonVertices[i];
    vec2 b = polygonVertices[(i + 1) % polygonVertexCount];
    vec2 e = b - a;
    float lenSq = max(dot(e, e), 1.0e-12);
    float t = clamp(dot(p - a, e) / lenSq, 0.0, 1.0);
    vec2 q = a + e * t;
    vec2 d = p - q;
    float distSq = dot(d, d);
    if (distSq < minDistSq) {
      minDistSq = distSq;
      closest = q;
      vec2 rightNormal = normalize(vec2(e.y, -e.x));
      bestNormal = area >= 0.0 ? rightNormal : -rightNormal;
    }
  }
  normalOut = bestNormal;
  return closest;
}

void solveCircle(inout vec2 pos, inout vec2 vel, vec2 move) {
  float limitRadius = max(circleRadius - particleRadius, 1.0e-6);
  vec2 remainingMove = move;

  for (int iter = 0; iter < MAX_COLLISIONS_PER_SUBSTEP; iter++) {
    vec2 next = pos + remainingMove;
    vec2 rel = pos - circleCenter;
    vec2 nextRel = next - circleCenter;
    if (dot(nextRel, nextRel) <= limitRadius * limitRadius) {
      pos = next;
      return;
    }

    float a = dot(remainingMove, remainingMove);
    if (a < 1.0e-14) {
      return;
    }
    float b = 2.0 * dot(rel, remainingMove);
    float c = dot(rel, rel) - limitRadius * limitRadius;
    float h = b * b - 4.0 * a * c;
    float t = 0.0;
    if (h >= 0.0) {
      float root = sqrt(h);
      float t0 = (-b - root) / (2.0 * a);
      float t1 = (-b + root) / (2.0 * a);
      if (t0 >= 0.0 && t0 <= 1.0) {
        t = t0;
      } else if (t1 >= 0.0 && t1 <= 1.0) {
        t = t1;
      } else {
        t = clamp(-b / (2.0 * a), 0.0, 1.0);
      }
    }

    vec2 hit = pos + remainingMove * max(t - 1.0e-5, 0.0);
    vec2 n = normalize(hit - circleCenter);
    pos = circleCenter + n * (limitRadius - 1.0e-5);
    vel = reflect(vel, n);
    remainingMove = reflect(remainingMove * (1.0 - t), n);
  }
}

void solveConvexPolygon(inout vec2 pos, inout vec2 vel, vec2 move) {
  vec2 remainingMove = move;
  float area = polygonSignedArea();

  for (int iter = 0; iter < MAX_COLLISIONS_PER_SUBSTEP; iter++) {
    vec2 next = pos + remainingMove;
    float bestT = 2.0;
    vec2 bestNormal = vec2(0.0, 1.0);

    for (int i = 0; i < MAX_POLYGON_VERTICES; i++) {
      if (i >= polygonVertexCount) break;
      vec2 a = polygonVertices[i];
      vec2 b = polygonVertices[(i + 1) % polygonVertexCount];
      vec2 e = b - a;
      float lenSq = dot(e, e);
      if (lenSq < 1.0e-12) continue;
      vec2 rightNormal = normalize(vec2(e.y, -e.x));
      vec2 outward = area >= 0.0 ? rightNormal : -rightNormal;
      float d0 = dot(pos - a, outward) + particleRadius;
      float d1 = dot(next - a, outward) + particleRadius;
      if (d1 > 0.0 && d1 > d0) {
        float denom = d1 - d0;
        if (abs(denom) > 1.0e-12) {
          float t = clamp(-d0 / denom, 0.0, 1.0);
          if (t < bestT) {
            bestT = t;
            bestNormal = outward;
          }
        }
      }
    }

    if (bestT > 1.0) {
      pos = next;
      if (!isInsidePolygon(pos)) {
        vec2 normalOut;
        vec2 closest = closestPointOnPolygon(pos, normalOut);
        pos = closest - normalOut * (particleRadius + 1.0e-5);
        if (dot(vel, normalOut) > 0.0) {
          vel = reflect(vel, normalOut);
        }
      }
      return;
    }

    pos = pos + remainingMove * max(bestT - 1.0e-5, 0.0);
    vel = reflect(vel, bestNormal);
    remainingMove = reflect(remainingMove * (1.0 - bestT), bestNormal);
  }
}

void solveEllipse(inout vec2 pos, inout vec2 vel, vec2 move) {
  float a = max(ellipseA, 1.0e-6);
  float b = max(ellipseB, 1.0e-6);
  float limitA = max(a - particleRadius, 1.0e-6);
  float limitB = max(b - particleRadius, 1.0e-6);
  vec2 remainingMove = move;

  for (int iter = 0; iter < MAX_COLLISIONS_PER_SUBSTEP; iter++) {
    vec2 next = pos + remainingMove;

    vec2 rel = pos - ellipseCenter;
    vec2 nextRel = next - ellipseCenter;

    float distSq0 = (rel.x * rel.x) / (limitA * limitA) + (rel.y * rel.y) / (limitB * limitB);
    float distSq1 = (nextRel.x * nextRel.x) / (limitA * limitA) + (nextRel.y * nextRel.y) / (limitB * limitB);

    if (distSq1 <= 1.0) {
      pos = next;
      return;
    }

    if (distSq0 > 1.0) {
      vec2 sRelOuter = rel / vec2(a, b);
      float sLenOuter = length(sRelOuter);
      if (sLenOuter < 1.0e-12) {
        sLenOuter = 1.0e-12;
      }
      vec2 sNormalOuter = sRelOuter / sLenOuter;
      vec2 normalOuter = vec2(sNormalOuter.x / a, sNormalOuter.y / b);
      float nLenOuter = length(normalOuter);
      if (nLenOuter < 1.0e-12) {
        nLenOuter = 1.0e-12;
      }
      normalOuter = normalOuter / nLenOuter;

      vec2 sClosestOuter = sRelOuter / sLenOuter * (1.0 - 1.0e-5);
      vec2 closestOuter = ellipseCenter + sClosestOuter * vec2(limitA, limitB);

      pos = closestOuter;
      if (dot(vel, normalOuter) > 0.0) {
        vel = reflect(vel, normalOuter);
      }
      remainingMove = reflect(remainingMove, normalOuter);
      continue;
    }

    vec2 sRelInner = rel / vec2(limitA, limitB);
    vec2 sMoveInner = remainingMove / vec2(limitA, limitB);

    float lenSqInner = dot(sMoveInner, sMoveInner);
    if (lenSqInner < 1.0e-14) {
      return;
    }

    float aaInner = lenSqInner;
    float bbInner = 2.0 * dot(sRelInner, sMoveInner);
    float ccInner = dot(sRelInner, sRelInner) - 1.0;
    float hhInner = bbInner * bbInner - 4.0 * aaInner * ccInner;

    if (hhInner < 0.0) {
      pos = next;
      return;
    }

    float rootInner = sqrt(hhInner);
    float t0Inner = (-bbInner - rootInner) / (2.0 * aaInner);
    float t1Inner = (-bbInner + rootInner) / (2.0 * aaInner);

    float tInner = 0.0;
    if (t0Inner >= 0.0 && t0Inner <= 1.0) {
      tInner = t0Inner;
    } else if (t1Inner >= 0.0 && t1Inner <= 1.0) {
      tInner = t1Inner;
    } else {
      pos = next;
      return;
    }

    vec2 sHitInner = sRelInner + sMoveInner * max(tInner - 1.0e-5, 0.0);
    float sHitLenInner = length(sHitInner);
    if (sHitLenInner < 1.0e-12) {
      sHitLenInner = 1.0e-12;
    }

    vec2 sClosestInner = sHitInner / sHitLenInner * (1.0 - 1.0e-5);
    vec2 closestInner = ellipseCenter + sClosestInner * vec2(limitA, limitB);

    vec2 normalInner = vec2(sClosestInner.x / a, sClosestInner.y / b);
    float nLenInner = length(normalInner);
    if (nLenInner < 1.0e-12) {
      nLenInner = 1.0e-12;
    }
    normalInner = normalInner / nLenInner;

    pos = closestInner;

    vel = reflect(vel, normalInner);
    remainingMove = reflect(remainingMove * (1.0 - tInner), normalInner);
  }
}

void main() {
  vec4 state = texture(stateTex, texCoord);
  vec2 pos = state.xy;
  vec2 vel = state.zw;

  int safeSubSteps = clamp(subSteps, 1, 16);
  float dt = timeStep / float(safeSubSteps);

  for (int i = 0; i < 16; i++) {
    if (i >= safeSubSteps) break;
    vec2 move = vel * dt;
    if (containerShape == 1) {
      solveCircle(pos, vel, move);
    } else if (containerShape == 2) {
      solveEllipse(pos, vel, move);
    } else {
      solveConvexPolygon(pos, vel, move);
    }
  }

  newState = vec4(pos, vel);
}
`;

// Retained bouncing_particles_render.vert SHA256 9fe1cd5e0ef63f82e27350d9cce8edf52adb0ce3dd78ff8f4756aabfce56a92a.
export const sourceBouncingRenderVertex=`#version 300 es
precision highp float;
precision highp int;

uniform mat4 projection;
uniform mat4 modelview;
uniform sampler2D stateTex;
uniform int texSize;
uniform vec3 scale;
uniform vec3 offset;
uniform float radius;
uniform int particleCount;

out float vSpeed;
out float vColorT;

void main() {
  int x = gl_VertexID % texSize;
  int y = gl_VertexID / texSize;
  vec4 state = texelFetch(stateTex, ivec2(x, y), 0);
  vec3 world = vec3(state.xy, 0.0) * scale + offset;
  gl_Position = projection * modelview * vec4(world, 1.0);
  gl_PointSize = max(radius, 1.0);
  vSpeed = length(state.zw);
  vColorT = float(gl_VertexID) / float(max(particleCount - 1, 1));
}
`;

// Retained bouncing_particles_render.frag SHA256 d8e8bdb55e7fcfecd2bd35f2b3a6645985237c2defb5048f3f63e50930456c30.
export const sourceBouncingRenderFragment=`#version 300 es
precision highp float;
precision highp int;

const int MAX_PALETTE_COLORS = 25;

uniform int paletteCount;
uniform vec3 palette[MAX_PALETTE_COLORS];
uniform float speedScale;

in float vSpeed;
in float vColorT;
out vec4 fragColor;

vec3 samplePalette(float t) {
  int count = clamp(paletteCount, 1, MAX_PALETTE_COLORS);
  if (count <= 1) {
    return palette[0];
  }
  float scaled = clamp(t, 0.0, 1.0) * float(count - 1);
  int i0 = int(floor(scaled));
  int i1 = min(i0 + 1, count - 1);
  return mix(palette[i0], palette[i1], fract(scaled));
}

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) {
    discard;
  }
  float speedTint = clamp(vSpeed * speedScale, 0.0, 1.0);
  vec3 rgb = samplePalette(vColorT);
  rgb = mix(rgb * 0.72, rgb, 0.55 + speedTint * 0.45);
  float alpha = 1.0 - smoothstep(0.72, 1.0, r2);
  fragColor = vec4(rgb, alpha);
}
`;
