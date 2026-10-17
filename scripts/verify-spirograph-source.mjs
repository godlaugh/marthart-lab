import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceFixtures, sourcePoint, sourceClosure, sourceMotion, sourcePixel, sourceOracleLimits} from './spirograph-source-oracle.mjs';

const mode = process.env.SPIROGRAPH_VERIFY_MODE ?? 'functional';
if (!['functional', 'old-performance', 'current-performance'].includes(mode)) throw Error('Unknown verification mode');
const output = process.env.SPIROGRAPH_REPORT;
if (!output) throw Error('Explicit new SPIROGRAPH_REPORT path required; historical reports are never implicitly overwritten');
const baselineRoot = '.cache/domain-render-policy-baseline-1803';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['scripts/verify-spirograph-source.mjs', 'scripts/spirograph-source-oracle.mjs',
  '.cache/spirograph-source-next-audit.json', '.cache/spirograph-source-easings-bytecode.json', '.cache/spirograph-source-easing-2-bytecode.json', '.cache/spirograph-source-easing-3-bytecode.json', '.cache/spirograph-source-easing-4-bytecode.json', '.cache/measure-navigation-task.py',
  'src/engine/spirographModel.ts', 'src/engine/spirographAuthoring.ts', 'src/scenes/spirograph.ts', 'src/scenes/particles.ts',
  'src/scenes/spirographExamples.recipes.json', 'src/scenes/spirographExamples.generated.ts',
  'src/engine/timeline.ts', 'src/engine/temporal.ts', 'src/engine/document.ts', 'src/engine/legacyImport.ts',
  'src/engine/generate.worker.ts', 'src/engine/client.ts', 'src/engine/renderer.ts', 'src/engine/sceneCamera.ts',
  'src/engine/formulaCanvas.ts', 'src/engine/outputBuffers.ts', 'src/types.ts'];
const snapshot = () => Promise.all(paths.map(async path => ({path, sha256: digest(await readFile(path))})));
const manifestBytes = await readFile(`${baselineRoot}/manifest.json`), manifest = JSON.parse(manifestBytes);
for (const [path, expected] of Object.entries(manifest.sourceManifest)) {
  if (digest(await readFile(`${baselineRoot}/${path.replace(/^studio\//, '')}`)) !== expected) throw Error('Frozen 1803 baseline changed: ' + path);
}
const report = {startedAt: new Date().toISOString(), mode, sourceStart: await snapshot(),
  baseline: {path: baselineRoot, manifestSha256: digest(manifestBytes), verifiedFiles: Object.keys(manifest.sourceManifest).length},
  limits: [...sourceOracleLimits, 'Timing is completed production task wall time; separate process supervisor measures CPU and sampled family RSS. Tokens, tool fees, VRAM and unsampled short-process memory are unmeasured.',
    'Warm means the same Generator worker and its mathematical caches; each task creates a fresh ArtRenderer/context. Browser/OS caches are not cleared.',
    'completedWithRendererMs includes fresh renderer/context setup, GPU finish/readback, SHA hashing, PNG data-URL encoding and disposal; elapsedMs isolates the completed Generator request. These are not native performance measures.',
    'Renderer comparisons exercise current local WebGL presentation, not retained native Processing pixel parity.']};
const times = [0, .2, .201, .25, .6, 1.05, 3, 7, .25];
const cases = sourceFixtures.map(fixture => ({...fixture,
  coordinates: [0, 23, 90, 137, 270].map(phase => ({phase, points: fixture.layers.map(layer => sourcePoint(layer, phase))})),
  closure: fixture.layers.map(sourceClosure),
  motion: times.map(time => ({time, frame: sourceMotion(fixture.layers, fixture.settings, time)})),
  deadlines: [.2, 7].map(deadline => { const visual = sourceMotion(fixture.layers, fixture.settings, deadline).visualSeconds; return {deadline, expected: visual === null ? deadline : Math.min(deadline, visual)}; }),
  projected: [0, 23, 90, 137].map(phase => ({phase, point: sourcePixel(sourcePoint(fixture.layers[0], phase).pen, fixture.settings, 257, 193)})),
}));
const queueCases = [
  {id: 'early-completion', speed: 12, deadline: 7},
  {id: 'same-geometry-slower', speed: 6, deadline: 7},
  {id: 'short-deadline', speed: 6, deadline: .2},
  {id: 'paused-deadline', speed: 0, deadline: .7},
  {id: 'nonclosing-deadline', speed: 12, autoStopOnClosure: false, deadline: .7},
].map(input => {
  const layers = [{...sourceFixtures[0].layers[0], speed: input.speed, autoStopOnClosure: input.autoStopOnClosure !== false}];
  const frame = sourceMotion(layers, {}, input.deadline);
  return {...input, layers, rotationStart: frame.visualSeconds === null ? input.deadline : Math.min(input.deadline, frame.visualSeconds)};
});
// Dense independent geometry bounds are only used for single-layer, guide-free images.
for (const fixture of cases) for (const frame of fixture.motion) {
  if (fixture.layers.length !== 1 || fixture.layers[0].showGuides || !fixture.layers[0].visible || !fixture.layers[0].enabled || frame.frame.phases[0] <= 0) continue;
  const phase = frame.frame.phases[0], b = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= 8192; i++) {
    const p = sourcePixel(sourcePoint(fixture.layers[0], phase * i / 8192).pen, fixture.settings, 257, 193);
    b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]);
  }
  if (b[0] > 3 && b[1] > 3 && b[2] < 254 && b[3] < 190) frame.inkBounds = b;
}
let browser;
const server = await createServer({server: {host: '127.0.0.1', port: 0, hmr: false}, logLevel: 'error'});
try {
  await server.listen(); const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({channel: 'chrome', headless: true});
  const page = await browser.newPage({viewport: {width: 700, height: 500}, deviceScaleFactor: 1});
  await page.route(origin, route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Spirograph production verification</title><body style="margin:0;background:#222"></body>'}));
  await page.goto(origin);
  report.result = await page.evaluate(async ({cases, queueCases, mode, baselineRoot}) => {
    const {Generator} = await import('/src/engine/client.ts');
    const old = await import('/' + baselineRoot + '/src/engine/client.ts');
    const {createScene, parseScene, persistentScene} = await import('/src/engine/document.ts');
    const {definition} = await import('/src/scenes/index.ts');
    const {parseProjectFile} = await import('/src/engine/legacyImport.ts');
    const {sceneAtTime, clipDuration, resolveTimeline} = await import('/src/engine/timeline.ts');
    const {prepareSpirograph, samplePreparedSpirographLayer, generateLayeredSpirograph} = await import('/src/scenes/spirograph.ts');
    const {prepareSpirographProjection} = await import('/src/engine/spirographModel.ts');
    const {ArtRenderer} = await import('/src/engine/renderer.ts');
    const oldRenderer = await import('/' + baselineRoot + '/src/engine/renderer.ts');
    const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    const check = (value, reason) => { if (!value) throw Error(reason); };
    const close = (a, b, reason, tolerance = 2e-8) => check(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${reason}: ${a} != ${b}`);
    const arrays = (a, b, reason, tolerance = 2e-8) => { check(a.length === b.length, reason + ' length'); a.forEach((x, i) => x === null || b[i] === null ? check(x === b[i], reason + ' null') : close(x, b[i], reason, tolerance)); };
    const ctx = {time: 0, width: 257, height: 193, quality: 'export'};
    const make = fixture => {
      const scene = createScene(definition('spirograph')); scene.id = 'source-' + fixture.id;
      Object.assign(scene.settings, {spirographVersion: 'mathart-1.7.8-v1', layers: JSON.stringify(fixture.layers),
        spiroView: 'native', scale: 1, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, rotationSpeed: 0,
        background: '#000000', backgroundColor: '#000000', count: 1800, animate: true, finishTrace: false,
        startEaseEnabled: false, endEaseEnabled: false, fadeInStatorsOnStart: false, fadeOutStatorsOnFinish: false, ...fixture.settings});
      scene.timeline.tracks = []; return scene;
    };
    const signature = async out => out.type === 'raster' ? hash(out.pixels) : hash(new Uint8Array(out.positions.buffer, out.positions.byteOffset, out.positions.byteLength));
    const render = async (out, scene, Renderer = ArtRenderer, width = 257, height = 193) => {
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      let trackedGl; const objects = {}, getContext = canvas.getContext.bind(canvas);
      if (mode === 'functional') canvas.getContext = (...args) => {
        const gl = getContext(...args); if (args[0] !== 'webgl2' || !gl || trackedGl) return gl; trackedGl = gl;
        for (const kind of ['Texture', 'Framebuffer', 'Buffer', 'VertexArray', 'Program', 'Shader', 'Renderbuffer']) {
          objects[kind] = []; const create = gl['create' + kind].bind(gl);
          gl['create' + kind] = (...a) => { const handle = create(...a); if (handle) objects[kind].push(handle); return handle; };
        }
        return gl;
      };
      const renderer = new Renderer(canvas), presentation = {};
      try {
        renderer.setSize(width, height, 1); renderer.setOutput(out, scene, true); renderer.render();
        const gl = renderer.renderer.getContext(); gl.finish(); const rgba = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        check(gl.getError() === gl.NO_ERROR, 'renderer WebGL error');
        Object.assign(presentation, {sha256: await hash(rgba), bytes: rgba.length, image: canvas.toDataURL('image/png')});
        return presentation;
      } finally {
        renderer.dispose();
        if (trackedGl) presentation.afterProductionDispose = Object.fromEntries(Object.entries(objects).map(([kind, handles]) => [kind, handles.filter(h => trackedGl['is' + kind](h)).length]));
        // Test owns this context. Keep pre-loss counts; loss is not misreported as delete success.
        renderer.renderer.forceContextLoss(); presentation.testRequestedContextLoss = true; canvas.remove();
      }
    };
    const NativeWorker = globalThis.Worker; let activeWorkers = 0, createdWorkers = 0;
    globalThis.Worker = class extends NativeWorker { constructor(...args) { super(...args); activeWorkers++; createdWorkers++; this.alive = true; } terminate() { if (this.alive) { this.alive = false; activeWorkers--; } return super.terminate(); } };
    const result = {math: [], worker: [], compatibility: [], rotation: [], nullableRotation: [], deadlines: [], queue: [], guidePresets: [], costs: []};
    try {
      if (mode !== 'functional') {
        const side = mode.startsWith('old') ? 'old' : 'current', Constructor = side === 'old' ? old.Generator : Generator;
        const local = createScene(definition('spirograph'), definition('spirograph').presets.find(p => p.id === 'hypotrochoid'));
        local.id = 'spirograph-local-cost'; delete local.settings.spirographVersion; local.settings.count = 18000;
        const candidates = [{id: 'unchanged-local', scene: local}, ...(side === 'current' ? [{id: 'new-source', scene: make(cases[0])}] : [])];
        for (const candidate of candidates) for (let repeat = 0; repeat < 3; repeat++) {
          const g = new Constructor();
          try { for (const state of ['cold-new-worker', 'warm-same-worker']) {
            const request = {time: 7, width: 640, height: 360, quality: 'export'}, start = performance.now();
            const out = await g.generate(candidate.scene, request), elapsedMs = performance.now() - start;
            const presentation = await render(out, candidate.scene, side === 'old' ? oldRenderer.ArtRenderer : ArtRenderer, 640, 360);
            result.costs.push({side, fixture: candidate.id, repeat, state, request, elapsedMs, completedWithRendererMs: performance.now() - start,
              producerElapsedMs: out.stats.elapsedMs, type: out.type, backend: out.backend ?? 'CPU geometry/raster', mathHash: await signature(out), imageHash: presentation.sha256});
          } } finally { g.dispose(); }
        }
      } else {
        for (const fixture of cases) {
          const scene = make(fixture), plan = prepareSpirograph(scene.settings);
          arrays(plan.layers.map(x => x.closureTurns * 360), fixture.closure, fixture.id + ' closure');
          for (const vector of fixture.coordinates) for (let i = 0; i < plan.layers.length; i++) {
            const actual = samplePreparedSpirographLayer(plan.layers[i], vector.phase * Math.PI / 180), expected = vector.points[i];
            arrays([actual.pen[0], -actual.pen[1]], expected.pen, fixture.id + ' source point');
            actual.centers.forEach((p, j) => arrays([p[0], -p[1]], expected.centers[j], fixture.id + ' source center'));
          }
          const projection = prepareSpirographProjection(scene, 0, 257, 193, plan.bound);
          for (const vector of fixture.projected) {
            const actual = samplePreparedSpirographLayer(plan.layers[0], vector.phase * Math.PI / 180);
            arrays(projection.project(actual.pen), vector.point, fixture.id + ' native-pixel projection');
          }
          for (const sample of fixture.motion) {
            const actual = plan.sourceMotion.sample(sample.time), expected = sample.frame;
            for (const key of ['phases', 'startSeconds', 'endSeconds']) arrays(actual[key], expected[key], fixture.id + ' ' + key);
            for (const key of ['geometrySeconds', 'visualSeconds', 'guideOpacity']) expected[key] === null ? check(actual[key] === null, fixture.id + ' ' + key) : close(actual[key], expected[key], fixture.id + ' ' + key);
          }
          result.math.push({id: fixture.id, coordinatePhases: fixture.coordinates.length, projectedPhases: fixture.projected.length, motionQueries: fixture.motion.length, closure: fixture.closure});
          const g = new Generator(), seen = new Map();
          try { for (let i = 0; i < fixture.motion.length; i++) {
            const sample = fixture.motion[i], start = performance.now(), out = await g.generate(scene, {...ctx, time: sample.time});
            check(out.type === 'raster' && out.width === 257 && out.height === 193, 'source worker raster'); const sha256 = await signature(out);
            if (seen.has(sample.time)) check(sha256 === seen.get(sample.time), fixture.id + ' warm/backseek image changed'); seen.set(sample.time, sha256);
            let observedBounds;
            if (sample.inkBounds) {
              observedBounds = [Infinity, Infinity, -Infinity, -Infinity];
              for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
                const p = (y * out.width + x) * 4; if (out.pixels[p] <= 16) continue;
                observedBounds[0] = Math.min(observedBounds[0], x + .5); observedBounds[1] = Math.min(observedBounds[1], y + .5);
                observedBounds[2] = Math.max(observedBounds[2], x + .5); observedBounds[3] = Math.max(observedBounds[3], y + .5);
              }
              arrays(observedBounds, sample.inkBounds, fixture.id + ' independent raster ink bounds', 2);
            }
            result.worker.push({fixture: fixture.id, time: sample.time, elapsedMs: performance.now() - start, producerElapsedMs: out.stats.elapsedMs, sha256, observedBounds, expectedBounds: sample.inkBounds, stats: out.stats});
            if (fixture.id === 'guide-star' && sample.time === 7) { const presented = await render(out, scene); result.sourceImage = presented.image; result.sourceImageHash = presented.sha256; }
          }
          const saved = parseScene(JSON.stringify(persistentScene(scene))), reloaded = await g.generate(saved, {...ctx, time: .25});
          check(await signature(reloaded) === seen.get(.25), fixture.id + ' save/reload');
          const cold = new Generator(); try { check(await signature(await cold.generate(saved, {...ctx, time: .25})) === seen.get(.25), fixture.id + ' cold replay'); } finally { cold.dispose(); }
          } finally { g.dispose(); }
        }
        const animated = make(cases[0]); animated.settings.rotation = 37;
        const track = (id, start, duration, speeds) => ({id, type: 'animate', target: 'camera.actions', from: 0, to: 1, start, duration, easing: 'linear', pingPong: false, enabled: true,
          actions: speeds.map((speed, i) => ({id: id + '-' + i, method: 'spirographRotate', args: {speed}}))});
        animated.timeline.tracks = [track('rise', 0, 2, [.25, 1]), track('reverse', 3, 2, [-1])];
        const angle = t => t <= 2 ? t * t / 4 : t <= 3 ? 1 + t - 2 : t <= 5 ? 2 + (t - 3) - (t - 3) ** 2 / 2 : 2 - (t - 5);
        const rotationWorker = new Generator();
        try { for (const time of [0, .25, 1, 2, 3, 4, 5, 7, 1]) {
          const frame = sceneAtTime(animated, time), expected = angle(time);
          close(frame.evaluatedSpirographRotationRadians, expected, 'continuous source rate integral', 2e-7);
          check(frame.settings.rotation === 37, 'runtime mutated authored degrees');
          const independentFrame = {...frame, evaluatedSpirographRotationRadians: expected};
          const mathematical = generateLayeredSpirograph(independentFrame, {...ctx, time});
          const output = await rotationWorker.generate(animated, {...ctx, time});
          check(await signature(output) === await signature(mathematical), 'worker missed independent integrated angle');
          result.rotation.push({time, expected, actual: frame.evaluatedSpirographRotationRadians, sha256: await signature(output)});
        } } finally { rotationWorker.dispose(); }
        const raw = {config_version: '1.0.0', type: 'SPIROGRAPH', name: 'Nullable source rotation', settings: {layers: [{statorRadius: 60, penDistance: 27, rotors: [{radius: 20, mode: 'INSIDE'}], speed: 2, showGuides: false}]}, timeline: [
          {type: 'animate', duration: 1, easing: 'LINEAR', actions: [{method: 'spirographRotate', args: [2]}, {method: 'spirographRotate', args: []}]},
          {type: 'animate', duration: 1, easing: 'LINEAR', actions: [{method: 'spirographRotate'}, {method: 'unsupported'}]},
          {type: 'animate', duration: 1, easing: 'LINEAR', actions: [{method: 'spirographRotate', args: ['bad(']}]},
        ]};
        const imported = parseProjectFile(JSON.stringify(raw)).scene, nullableWorker = new Generator();
        check(imported.timeline.tracks[1].actions.length === 0, 'nullable target imported as explicit zero');
        try { for (const time of [0, 1, 1.5, 2, 2.5, 3, 4, 1.5]) {
          const expected = time <= 1 ? time * time : time <= 2 ? 1 + 2 * (time - 1) : time <= 3 ? 3 + 2 * (time - 2) - (time - 2) ** 2 : 4;
          const frame = sceneAtTime(imported, time); close(frame.evaluatedSpirographRotationRadians, expected, 'nullable source animation rate', 2e-7);
          const actual = await nullableWorker.generate(imported, {...ctx, time}), oracle = generateLayeredSpirograph({...frame, evaluatedSpirographRotationRadians: expected}, {...ctx, time});
          check(await signature(actual) === await signature(oracle), 'nullable target worker image');
          result.nullableRotation.push({time, expected, actual: frame.evaluatedSpirographRotationRadians, sha256: await signature(actual)});
        } } finally { nullableWorker.dispose(); }
        for (const fixture of cases) for (const {deadline, expected} of fixture.deadlines) {
          const scene = make(fixture), wait = {id: 'wait', type: 'spirograph_finish_wait', target: 'camera.actions', from: 0, to: 1, start: 0, duration: deadline, easing: 'linear', pingPong: false, enabled: true, spirographWait: 'visual-or-deadline-v1'};
          result.deadlines.push({fixture: fixture.id, deadline, actual: clipDuration(wait, scene), expected});
          close(result.deadlines.at(-1).actual, expected, 'visual-or-deadline ' + fixture.id);
        }
        const queueWorker = new Generator();
        try { for (const fixture of queueCases) {
          const scene = make({...cases[0], id: fixture.id, layers: fixture.layers});
          scene.id = 'same-document-geometry-edit';
          const common = {target: 'camera.actions', from: 0, to: 1, start: 0, easing: 'linear', pingPong: false, enabled: true};
          scene.timeline = {...scene.timeline, duration: .1, schedule: 'spirograph-sequence-v1', tracks: [
            {...common, id: 'finish', type: 'spirograph_finish_wait', duration: fixture.deadline, spirographWait: 'visual-or-deadline-v1'},
            {...common, id: 'disabled', type: 'wait', start: 10, duration: 10, enabled: false},
            {...track('queue-rotate', 0, 2, [1])},
            {...common, id: 'hold', type: 'wait', duration: 1},
          ]};
          const authored = JSON.stringify(scene), resolved = resolveTimeline(scene);
          close(resolved.tracks[2].start, fixture.rotationStart, 'queue rotation onset');
          close(resolved.duration, fixture.rotationStart + 3, 'queue resolved span');
          check(JSON.stringify(scene) === authored && !('schedule' in resolved), 'queue mutated authored or retained recursive schedule');
          const g = queueWorker, rows = [];
          for (const time of [Math.max(0, fixture.rotationStart - .01), fixture.rotationStart + 1, fixture.rotationStart + 2.5, fixture.rotationStart + 1]) {
            const u = Math.max(0, time - fixture.rotationStart), expected = u <= 2 ? u * u / 4 : 1 + u - 2;
            const frame = sceneAtTime(scene, time); close(frame.evaluatedSpirographRotationRadians, expected, 'queue integrated angle', 2e-7);
            const out = await g.generate(scene, {...ctx, time});
            const oracleFrameOutput = generateLayeredSpirograph({...frame, evaluatedSpirographRotationRadians: expected}, {...ctx, time});
            check(await signature(out) === await signature(oracleFrameOutput), 'queue worker did not consume resolved angle');
            rows.push({time, angle: expected, sha256: await signature(out)});
          }
          const saved = parseScene(JSON.stringify(persistentScene(scene))), cold = new Generator();
          try { const out = await cold.generate(saved, {...ctx, time: fixture.rotationStart + 1}); check(await signature(out) === rows[1].sha256, 'queue cold save/seek'); } finally { cold.dispose(); }
          result.queue.push({id: fixture.id, expectedStart: fixture.rotationStart, actualStart: resolved.tracks[2].start, span: resolved.duration, rows});
        } } finally { queueWorker.dispose(); }
        for (const id of ['guide-spirograph-rose', 'guide-spirograph-star', 'guide-spirograph-nested']) {
          const preset = definition('spirograph').presets.find(p => p.id === id); check(preset, 'missing official preset ' + id);
          const scene = createScene(definition('spirograph'), preset), g = new Generator();
          try { const out = await g.generate(scene, {...ctx, time: 5}), saved = parseScene(JSON.stringify(persistentScene(scene))), reloaded = await g.generate(saved, {...ctx, time: 5});
            check(await signature(out) === await signature(reloaded), id + ' persistent image'); result.guidePresets.push({id, sha256: await signature(out), version: scene.settings.spirographVersion});
          } finally { g.dispose(); }
        }
        const oldDef = await import('/' + baselineRoot + '/src/scenes/index.ts'), oldDoc = await import('/' + baselineRoot + '/src/engine/document.ts');
        const compatibilityScenes = oldDef.definition('spirograph').presets.map(preset => oldDoc.createScene(oldDef.definition('spirograph'), preset));
        const layered = make(cases[2]); delete layered.settings.spirographVersion; layered.settings.spiroView = 'fit'; compatibilityScenes.push(layered);
        for (const scene of compatibilityScenes) for (const time of [0, 2]) for (const size of [[129, 97], [257, 193]]) {
          scene.settings.count = 900; const request = {...ctx, time, width: size[0], height: size[1]}, a = new old.Generator(), b = new Generator();
          try { const before = await a.generate(scene, request), after = await b.generate(scene, request);
            check(before.type === after.type && await signature(before) === await signature(after), 'old output changed ' + scene.name);
            const oldImage = await render(before, scene, oldRenderer.ArtRenderer, ...size), newImage = await render(after, scene, ArtRenderer, ...size);
            check(oldImage.sha256 === newImage.sha256, 'old complete image changed ' + scene.name);
            result.compatibility.push({name: scene.name, time, size, type: before.type, outputHash: await signature(after), imageHash: newImage.sha256,
              oldAfterProductionDispose: oldImage.afterProductionDispose, newAfterProductionDispose: newImage.afterProductionDispose, testRequestedContextLoss: true});
          } finally { a.dispose(); b.dispose(); }
        }
        const g = new Generator();
        try { const pending = g.generate(make(cases[0]), {...ctx, width: 640, height: 360, time: 700}); g.cancel();
          let cancelled = false; try { await pending; } catch { cancelled = true; } check(cancelled, 'worker cancellation did not reject');
          const recovery = await g.generate(make(cases[0]), {...ctx, time: .25}); check(recovery.type === 'raster', 'worker cancellation recovery'); result.cancelRecovery = {cancellationPoint: 'immediately after dispatch, before awaiting the pending result', cancelled, sha256: await signature(recovery)};
        } finally { g.dispose(); }
      }
    } catch (error) { result.error = String(error.stack ?? error); }
    finally { globalThis.Worker = NativeWorker; }
    if (activeWorkers !== 0) result.error = (result.error ?? '') + '\nproduction worker leak'; result.workers = {createdWorkers, activeWorkers};
    return result;
  }, {cases, queueCases, mode, baselineRoot});
  if (report.result.error) throw Error(report.result.error);
  if (report.result.sourceImage) { const png = output.replace(/\.json$/, '.png'); await writeFile(png, Buffer.from(report.result.sourceImage.split(',')[1], 'base64')); report.result.sourceImage = {path: png, sha256: digest(await readFile(png))}; }
  report.browser = browser.version();
} catch (error) { report.error = String(error.stack ?? error); }
finally {
  await browser?.close(); await server.close(); report.sourceEnd = await snapshot();
  report.sourceStable = JSON.stringify(report.sourceStart) === JSON.stringify(report.sourceEnd);
  report.status = !report.error && report.sourceStable ? 'passed' : 'failed'; report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output, status: report.status, sourceStable: report.sourceStable, math: report.result?.math.length, worker: report.result?.worker.length, oldImages: report.result?.compatibility.length, costs: report.result?.costs.length, error: report.error}));
  if (report.status !== 'passed') process.exitCode = 1;
}
