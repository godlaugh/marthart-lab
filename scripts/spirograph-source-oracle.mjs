// Independent transcription of retained 1.7.8 classfile contracts. No production imports.
// Source evidence: .cache/spirograph-source-next-audit.json and
// .cache/spirograph-source-easings-bytecode.json. No original JVM/application executes.
export const f32 = Math.fround;
const PI_F = f32(Math.PI);
const cap = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x));
const radians = degrees => degrees * Math.PI / 180;
export const sourceSineIn = x => f32(1 - f32(Math.cos(f32(f32(f32(cap(x)) * PI_F) / 2))));
export const sourceSineOut = x => f32(Math.sin(f32(f32(f32(cap(x)) * PI_F) / 2)));
export const sourceSineInOut = x => f32(-f32(f32(Math.cos(f32(PI_F * f32(cap(x))))) - 1) / 2);

export function sourceChain(layer) {
  const segments = [];
  let parent = layer.statorRadius, previousSpin = 0, previousMode, previousDirection = 1;
  for (const rotor of layer.rotors) {
    const inside = rotor.mode.toUpperCase() === 'INSIDE';
    const segment = {
      radius: rotor.radius, inside,
      centerRadius: inside ? parent - rotor.radius : parent + rotor.radius,
      drawPitch: segments.length ? previousSpin : 1,
      spinPitch: inside ? parent / rotor.radius - 1 : parent / rotor.radius + 1,
      direction: segments.length ? previousMode === 'INSIDE' ? previousDirection : -previousDirection : 1,
    };
    segments.push(segment);
    parent = rotor.radius; previousSpin = segment.spinPitch;
    previousMode = inside ? 'INSIDE' : 'OUTSIDE'; previousDirection = segment.direction;
  }
  if (!segments.length) throw Error('Independent fixture requires a rotor');
  return {segments, penDistance: layer.penDistance};
}

export function sourcePoint(layer, phaseDegrees) {
  const {segments, penDistance} = sourceChain(layer);
  let x = 0, y = 0, drawSum = 0, spinSum = 0, penFrequency = 0;
  const centers = [];
  for (const segment of segments) {
    const drawFrequency = (segment.drawPitch + drawSum) * segment.direction;
    drawSum += segment.drawPitch;
    const spinBase = segment.spinPitch + spinSum;
    spinSum += segment.spinPitch;
    penFrequency = spinBase * segment.direction * (segment.inside ? -1 : 1);
    const angle = radians(phaseDegrees * drawFrequency);
    x += segment.centerRadius * Math.cos(angle);
    y -= segment.centerRadius * Math.sin(angle);
    centers.push([x, y]);
  }
  const penAngle = radians(phaseDegrees * penFrequency);
  return {centers, pen: [x + penDistance * Math.cos(penAngle), y - penDistance * Math.sin(penAngle)]};
}

function denominator(value) {
  const absolute = Math.abs(value);
  let a0 = 0, b0 = 1, a1 = 1, b1 = 0, fraction = absolute;
  for (let work = 0; work < 100; work++) {
    const term = Math.floor(fraction), a2 = term * a1 + a0, b2 = term * b1 + b0;
    if (b2 > 10000) break;
    a0 = a1; b0 = b1; a1 = a2; b1 = b2;
    if (Math.abs(a2 / b2 - absolute) <= 1e-9) break;
    const remain = fraction - term;
    if (remain <= 1e-9) break;
    fraction = 1 / remain;
  }
  return b1 || 1;
}
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return Math.abs(a) || 1; };
export function sourceClosure(layer) {
  let draw = 0, spin = 0, pen = 0, multiple = 1;
  for (const segment of sourceChain(layer).segments) {
    const frequency = (segment.drawPitch + draw) * segment.direction;
    draw += segment.drawPitch;
    const spinBase = segment.spinPitch + spin; spin += segment.spinPitch;
    pen = spinBase * segment.direction * (segment.inside ? -1 : 1);
    const d = denominator(frequency); multiple = multiple / gcd(multiple, d) * d;
  }
  const d = denominator(pen); multiple = multiple / gcd(multiple, d) * d;
  if (!Number.isSafeInteger(multiple)) throw Error('Oracle fixtures exceed exact integer denominator capacity');
  return 360 * multiple;
}

export function sourceEaseProfile(speed, closure) {
  const s = Math.max(1e-9, speed), v = s * 60, q = s / 1.65;
  const adaptive = q >= 1
    ? cap(.85 * (1 + .2 * Math.log(q)), .6, cap(1 + .6 * Math.log(q), 1, 3))
    : cap(.85 * (1 + .75 * Math.log(1 / q)), .6, 1);
  const duration = Math.min(adaptive, Math.max(0, .45 * closure / v));
  return {duration, endWindow: Math.min(closure, v * duration * .3633802276324186)};
}

// 60 Hz is the declared local replay clock, not evidence of native live-frame timing.
// Fresh state on every call makes back-seek correctness independent of production caching.
export function sourceMotion(layers, settings, seconds) {
  const frames = Math.floor(Math.max(0, seconds) * 60), dt = f32(1 / 60);
  const states = layers.map(layer => ({phase: 0, elapsed: 0, closed: false, start: null, end: null,
    closure: sourceClosure(layer), profile: sourceEaseProfile(layer.speed, sourceClosure(layer))}));
  const runnable = i => layers[i].visible && layers[i].enabled && !states[i].closed;
  const next = start => { while (start < layers.length && !runnable(start)) start++; return start; };
  let active = next(0), geometry = active === layers.length ? 0 : null, visual = null;
  let fade = 0, fadeInTime = 0, finished = false;
  const finishAt = Number.isFinite(settings.traceFinishTime) && settings.traceFinishTime >= (settings.traceStartTime ?? 0)
    ? settings.traceFinishTime - (settings.traceStartTime ?? 0) : undefined;
  // A declared local timestamped event invokes native finish semantics between fixed ticks.
  // Native finish closes eligible layers and parks the active cursor even if an infinite layer remains.
  const finish = () => {
    for (let i = active; i < layers.length; i++) if (runnable(i) && layers[i].autoStopOnClosure) {
      states[i].phase = states[i].closure; states[i].closed = true;
      states[i].start ??= finishAt; states[i].end = finishAt;
    }
    active = layers.length; finished = true; fade = 0;
    geometry = next(0) === layers.length ? finishAt : null;
    visual = geometry !== null && !fadeRequired ? finishAt : null;
  };
  const fadeRequired = settings.fadeOutStatorsOnFinish === true && layers.some(layer => layer.visible && layer.showGuides);
  if (geometry === 0 && !fadeRequired) visual = 0;
  for (let frame = 1; frame <= frames; frame++) {
    fadeInTime = Math.min(.6, fadeInTime + dt);
    if (finishAt !== undefined && !finished && finishAt < frame / 60) finish();
    if (active < layers.length) {
      const state = states[active], layer = layers[active], profile = state.profile;
      if (state.start === null) state.start = (frame - 1) / 60;
      const elapsed = state.elapsed + dt;
      const startScale = settings.startEaseEnabled === true && profile.duration > 1e-9
        ? sourceSineIn(f32(cap(elapsed / profile.duration))) : 1;
      const delta = (layer.speed * 60) * dt * startScale;
      let phase = state.phase + delta;
      if (layer.autoStopOnClosure) {
        const remaining = state.closure - phase;
        const endScale = settings.endEaseEnabled !== true || profile.endWindow <= 1e-9 || remaining >= profile.endWindow
          ? 1 : Math.max(.05, 1 - sourceSineOut(f32(cap(1 - remaining / profile.endWindow))));
        if (endScale < 1) phase = state.phase + delta * endScale;
        phase = Math.min(state.closure, phase);
        if (phase >= state.closure) { state.closed = true; state.end = frame / 60; active = next(active + 1); if (active === layers.length) geometry = frame / 60; }
      }
      state.phase = phase; state.elapsed = elapsed;
    }
    if (active === layers.length) {
      if (fadeRequired) fade = Math.min(.6, fade + dt);
      if (geometry !== null && visual === null && (!fadeRequired || fade >= .6)) visual = frame / 60;
    }
  }
  if (finishAt !== undefined && !finished && seconds >= finishAt) finish();
  const inAlpha = settings.fadeInStatorsOnStart === true ? sourceSineInOut(f32(fadeInTime / .6)) : 1;
  const outAlpha = fadeRequired ? f32(1 - sourceSineInOut(f32(fade / .6))) : 1;
  return {frame: frames, phases: states.map(x => x.phase), startSeconds: states.map(x => x.start), endSeconds: states.map(x => x.end),
    geometrySeconds: geometry, visualSeconds: visual, guideOpacity: f32(inAlpha * outAlpha)};
}

// Source screen convention, using already negative-sine source coordinates.
// Float input boundaries are retained; intermediate Processing matrix/raster is not reproduced.
export function sourcePixel(point, settings, width, height, runtimeRadians = 0) {
  const factor = f32(settings.scale ?? 1), a = f32((settings.rotation ?? 0) * Math.PI / 180), b = f32(runtimeRadians);
  const x = f32(point[0]) * factor, y = f32(point[1]) * factor;
  const dynamicX = x * Math.cos(b) - y * Math.sin(b), dynamicY = x * Math.sin(b) + y * Math.cos(b);
  return [width / 2 + dynamicX * Math.cos(a) - dynamicY * Math.sin(a) + f32(settings.offsetX ?? 0),
    height / 2 + dynamicX * Math.sin(a) + dynamicY * Math.cos(a) + f32(settings.offsetY ?? 0)];
}

export function sourceLayer(id, overrides = {}) {
  return {id, name: id, statorRadius: 60, statorColor: '#b4b4b4', rotors: [{radius: 20, mode: 'inside'}], penDistance: 27,
    speed: 2, showGuides: false, autoStopOnClosure: true, strokeColor: '#ffffff', palette: ['#ffffff'], strokeWidth: 1,
    visible: true, enabled: true, repeatGradient: false, phase: 0, direction: 1, opacity: 1, turns: 12, ...overrides};
}

export const sourceFixtures = [
  {id: 'asymmetric-inside', layers: [sourceLayer('inside')], settings: {}},
  {id: 'outside-negative-offset', layers: [sourceLayer('outside', {rotors: [{radius: 20, mode: 'outside'}]})], settings: {offsetX: -13, offsetY: 19, rotation: 37}},
  {id: 'mixed-chain', layers: [sourceLayer('chain', {statorRadius: 72, rotors: [{radius: 36, mode: 'inside'}, {radius: 12, mode: 'outside'}], penDistance: 17})], settings: {rotation: -90, scale: .75}},
  {id: 'guide-rose', layers: [sourceLayer('rose', {statorRadius: 150, rotors: [{radius: 75, mode: 'inside'}], penDistance: 75})], settings: {scale: .4}},
  {id: 'guide-star', layers: [sourceLayer('star', {statorRadius: 150, rotors: [{radius: 50, mode: 'inside'}], penDistance: 60})], settings: {scale: .4}},
  {id: 'guide-nested', layers: [sourceLayer('nested', {statorRadius: 150, rotors: [{radius: 75, mode: 'inside'}, {radius: 30, mode: 'outside'}], penDistance: 40})], settings: {scale: .35}},
  {id: 'two-layers-fade', layers: [sourceLayer('first', {speed: 12, showGuides: true}), sourceLayer('second', {speed: 9, showGuides: true, penDistance: 15})], settings: {startEaseEnabled: true, endEaseEnabled: true, fadeInStatorsOnStart: true, fadeOutStatorsOnFinish: true}},
  {id: 'nonclosing-first', layers: [sourceLayer('forever', {autoStopOnClosure: false}), sourceLayer('blocked')], settings: {fadeOutStatorsOnFinish: true}},
  {id: 'paused-first', layers: [sourceLayer('paused', {speed: 0}), sourceLayer('blocked')], settings: {}},
  {id: 'disabled-visible-guides', layers: [sourceLayer('disabled', {enabled: false, showGuides: true})], settings: {fadeOutStatorsOnFinish: true}},
  {id: 'finish-finite-with-disabled-guide', layers: [sourceLayer('finite-a'), sourceLayer('finite-b'), sourceLayer('disabled', {enabled: false, showGuides: true})], settings: {traceFinishTime: .201, fadeOutStatorsOnFinish: true}},
  {id: 'finish-infinite-held', layers: [sourceLayer('infinite', {autoStopOnClosure: false, showGuides: true}), sourceLayer('later-finite')], settings: {traceFinishTime: .201, fadeOutStatorsOnFinish: true}},
  {id: 'hidden-guides', layers: [sourceLayer('hidden', {visible: false, showGuides: true})], settings: {fadeOutStatorsOnFinish: true}},
];

export const sourceOracleLimits = [
  'Static classfile transcription plus a declared local deterministic 60 Hz clock; original application/JVM never executed.',
  'Source double/float stages are represented with JS Number/Math.fround; Java versus JS transcendental last-bit equivalence is not asserted.',
  'Source projection preserves sign/order and float inputs, not complete Processing matrix/antialias/DPI or original image equality.',
  'Whole-image old/current checks use frozen 1803 production and are independent compatibility checks, not independent source mathematics.',
  'Rotation uses the separately declared local continuous integral; it is not tested against native variable-frame F32 accumulated angles.',
];
