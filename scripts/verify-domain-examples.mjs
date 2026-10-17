import { chromium } from 'playwright/test';
import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const output = process.env.DOMAIN_EXAMPLES_REPORT ?? '.cache/domain-examples-browser-attempt1.json';
const baseline = '.cache/domain-examples-baseline-1525';
const paths = ['scripts/verify-domain-examples.mjs', baseline + '/manifest.json', '.cache/domain-param-example-oracle.json',
  'src/scenes/complex.ts', 'src/scenes/domainExamples.recipes.json', 'src/scenes/domainExamples.generated.ts',
  'src/engine/document.ts', 'src/types.ts', 'src/engine/client.ts', 'src/engine/oscillation.ts', 'src/engine/legacyImport.ts',
  'src/engine/generate.worker.ts', 'src/engine/temporal.ts', 'src/engine/timeline.ts',
  'src/engine/domain.ts', 'src/engine/domainModel.ts', 'src/engine/domainGpu.ts',
  'src/engine/domainGpuRaster.ts', 'src/engine/domainGpuColor.ts', 'src/engine/domainExpressions.ts',
  'src/engine/domainNativeArithmetic.ts', 'src/engine/domainNativeParser.ts', 'src/engine/domainNativeConstants.ts',
  'src/engine/domainNativeParameters.ts', 'src/engine/domainSourceIteration.ts', 'src/engine/domainViewport.ts',
  'src/engine/domainSourceColor.ts', 'src/engine/domainSourcePalette.ts', 'src/engine/domainSourceGpuColor.ts',
  'src/engine/domainGradient.ts', 'src/engine/gradientOffsets.ts'];
const snapshot = () => Promise.all(paths.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
const parameterOracle = JSON.parse(await readFile('.cache/domain-param-example-oracle.json', 'utf8'));
const baselineManifest = JSON.parse(await readFile(baseline + '/manifest.json', 'utf8'));
const baselineChecks = await Promise.all(Object.entries(baselineManifest.sourceManifest).map(async ([path, expected]) => {
  const actual = createHash('sha256').update(await readFile(baseline + '/' + path.replace(/^studio\//, ''))).digest('hex');
  if (actual !== expected) throw new Error('Frozen1525 baseline identity mismatch: ' + path);
  return path;
}));
const report = {
  startedAt: new Date().toISOString(), sourceStart: await snapshot(), baseline: { directory: baseline, verifiedFiles: baselineChecks.length }, parameterOracle,
  limits: [
    'Actual production Generator workers, complete small rasters, document parse and browser localStorage save/reload. This is not a GUI interaction or a performance measurement.',
    'CPU and GPU requests preserve each official example execution/color/viewport version. Actual backends and warnings are recorded; their different arithmetic is not required to produce equal images.',
    'The eight documents use the authored official-example API. Completion of guide omissions is separately documented by the catalog owner. The example named Newton is not asserted to be the standard Newton recurrence.',
    'Same-device repeat/save/backseek and frozen1525 old-preset comparisons establish only the tested compatibility scope; original application and cross-device parity remain unverified.',
  ],
};
let browser;
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
try {
  await server.listen(); const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.route(origin, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Domain official examples</title>' }));
  await page.goto(origin);
  report.result = await page.evaluate(async parameterOracle => {
    const { Generator } = await import('/src/engine/client.ts');
    const { createScene, parseScene, persistentScene, saveWorkspace, loadWorkspace } = await import('/src/engine/document.ts');
    const { definition } = await import('/src/scenes/index.ts');
    const { parseProjectFile } = await import('/src/engine/legacyImport.ts');
    const { sceneAtTime } = await import('/src/engine/timeline.ts');
    const { parseDomainModel } = await import('/src/engine/domainModel.ts');
    const { Generator: OldGenerator } = await import('/.cache/domain-examples-baseline-1525/src/engine/client.ts');
    const { createScene: oldCreateScene } = await import('/.cache/domain-examples-baseline-1525/src/engine/document.ts');
    const { definition: oldDefinition } = await import('/.cache/domain-examples-baseline-1525/src/scenes/index.ts');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join('');
    const stable = value => JSON.stringify(value, (key, v) => key === 'id' && typeof v === 'string' ? '<identity>' : v);
    const fingerprint = scene => stable({ equations: scene.equations, parameters: scene.parameters, settings: scene.settings, palette: scene.palette,
      domainSourcePalette: scene.domainSourcePalette, camera: scene.camera, timeline: scene.timeline, formulas: scene.formulas, provenance: scene.provenance });
    const def = definition('domain');
    const official = def.presets.filter(p => p.id.startsWith('guide-domain-'));
    check(official.length === 8 && new Set(official.map(p => p.id)).size === 8, 'Expected exactly eight official examples');
    const rows = [], documents = [];
    let requestCount = 0;
    for (const preset of official) {
      const authored = createScene(def, preset), original = fingerprint(authored);
      check(preset.document && Object.keys(authored.equations).length > 0, 'Official example must use complete persisted document');
      const saved = parseScene(JSON.stringify(persistentScene(authored)));
      check(fingerprint(saved) === original, preset.id + ' parse/save changed authored fields');
      documents.push({ id: preset.id, name: preset.name, equations: authored.equations, parameters: authored.parameters,
        settings: authored.settings, timeline: authored.timeline, domainSourcePalette: authored.domainSourcePalette, provenance: authored.provenance });
      const duration = authored.timeline.duration;
      const times = [...new Set([0, duration / 4, duration / 2, duration])];
      for (const requestedBackend of ['cpu', 'gpu']) {
        const scene = { ...saved, settings: { ...saved.settings, domainBackend: requestedBackend } };
        const g = new Generator(), observed = new Map(), samples = [];
        const run = async (time, label, generator = g, input = scene) => {
          const requestedAt = performance.now();
          const result = await generator.generate(input, { width: 97, height: 65, time, quality: 'export' }); requestCount++;
          const requestWallMs = performance.now() - requestedAt;
          check(result.type === 'raster' && result.width === 97 && result.height === 65, 'Complete raster required ' + preset.id);
          check(result.stats.generated + result.stats.invalid === 97 * 65, 'Incomplete pixel accounting ' + preset.id);
          if (requestedBackend === 'cpu') check(result.backend === 'cpu', 'Explicit CPU request ignored');
          const evaluated = sceneAtTime(input, time), model = parseDomainModel(evaluated, time);
          const independent = parameterOracle.examples.find(example => preset.id === 'guide-domain-' + example.number);
          if (independent && Object.hasOwn(independent.values, String(time))) {
            const target = independent.number === 3 ? 't' : 'a', expected = independent.values[String(time)];
            check(Math.abs(evaluated.parameters[target] - expected) < 1e-12, 'Independent source parameter phase mismatch ' + preset.id + ' at ' + time);
          }
          if (requestedBackend === 'gpu' && model.execution.arithmetic === 'native-gpu' && model.view.version !== 'mathart-1.7.8-cpu')
            check(result.backend === 'webgl2', 'Official example GPU path silently fell back: ' + preset.id + ' ' + result.warnings?.join('; '));
          const digest = await hash(result.pixels);
          const row = { label, time, sha256: digest, actualBackend: result.backend, requestWallMs, stats: result.stats, warnings: result.warnings,
            parameters: evaluated.parameters, iteration: model.iterationVersion, color: model.colorVersion, viewport: model.view.version };
          samples.push(row); return digest;
        };
        try {
          for (const time of times) observed.set(time, await run(time, 'forward'));
          for (const time of [times[1], 0]) check(await run(time, 'backseek') === observed.get(time), 'Backseek mismatch ' + preset.id);
          g.dispose(); const cold = new Generator();
          try { check(await run(times[1], 'cold-serialized', cold, parseScene(JSON.stringify(scene))) === observed.get(times[1]), 'Cold serialized mismatch ' + preset.id); }
          finally { cold.dispose(); }
          const moving = samples.slice(0, times.length).some(row => JSON.stringify(row.parameters) !== JSON.stringify(samples[0].parameters));
          if (['guide-domain-3', 'guide-domain-4'].includes(preset.id)) {
            check(moving, 'Official parameter animation inactive ' + preset.id);
            check(new Set(samples.slice(0, times.length).map(row => row.sha256)).size > 1, 'Animated parameter does not affect image ' + preset.id);
          }
          rows.push({ id: preset.id, requestedBackend, samples, parametersMoved: moving });
        } finally { g.dispose(); }
      }
      check(fingerprint(authored) === original && fingerprint(createScene(def, preset)) === original, 'Example generation mutated catalog document');
    }
    const workspaceScenes = official.map(p => createScene(def, p));
    saveWorkspace(localStorage, { scenes: workspaceScenes, active: workspaceScenes[3].id, theme: 'dark', language: 'en' });
    const workspace = loadWorkspace(localStorage);
    check(workspace && workspace.scenes.length === 8 && workspace.active === workspaceScenes[3].id, 'Workspace save/load incomplete');
    check(workspace.scenes.every((s, i) => fingerprint(s) === fingerprint(workspaceScenes[i])), 'Workspace roundtrip changed example');
    // Independent same-clip source regression: both starts synchronize from
    // authored a=8, before either synthetic t=0 value is written. The second
    // range [-3,3], negative step starts at +3; neutral edge easing gives this
    // closed cosine. This is intentionally outside the eight guide recipes.
    const groupBaselineRegression = [];
    const action = (min, max, step) => ({ method: 'paramStart', args: [{ edgeEasing: { window: .5, floor: 1, easing: 'LINEAR' }, parameters: { a: { min, max, step, enable: true } } }] });
    const rawGroup = { config_version: '1.0.0', type: 'DOMAIN_COLORING', name: 'Independent same-clip initialization',
      settings: { render_mode: 'GPU' }, parameters: { a: 8 }, domainColoring: { formula: 'z+a' },
      timeline: [{ type: 'animate', duration: 0, easing: 'LINEAR', actions: [action(-2, 2, .02), action(-3, 3, -.02)] }, { type: 'wait', duration: 2 }] };
    const grouped = parseProjectFile(JSON.stringify(rawGroup)).scene;
    for (const backend of ['cpu', 'gpu']) {
      const scene = { ...grouped, settings: { ...grouped.settings, domainBackend: backend } }, generator = new Generator(), hashes = new Map();
      const samples = [];
      try {
        for (const time of [0, 1, 2, 1]) {
          const expected = 3 * Math.cos(Math.fround(.02) * 60 / 3 * time), evaluated = sceneAtTime(scene, time);
          check(Math.abs(evaluated.parameters.a - expected) < 1e-12, 'Same-clip initialization differs from independent source scalar');
          const reference = { ...scene, parameters: { ...scene.parameters, a: expected }, timeline: { ...scene.timeline, tracks: [] } };
          const context = { width: 47, height: 31, time, quality: 'export' };
          const start = performance.now(), out = await generator.generate(scene, context), requestWallMs = performance.now() - start;
          const expectedStart = performance.now(), direct = await generator.generate(reference, context), referenceRequestWallMs = performance.now() - expectedStart; requestCount += 2;
          check(out.type === 'raster' && direct.type === 'raster', 'Same-clip result missing');
          const actualHash = await hash(out.pixels), expectedHash = await hash(direct.pixels);
          check(actualHash === expectedHash && out.backend === direct.backend, 'Worker ignored grouped source scalar');
          if (hashes.has(time)) check(hashes.get(time) === actualHash, 'Same-clip backseek changed'); else hashes.set(time, actualHash);
          samples.push({ time, expected, actual: evaluated.parameters.a, actualHash, expectedHash, actualBackend: out.backend, requestWallMs, referenceRequestWallMs });
        }
        generator.dispose(); const cold = new Generator();
        try { const start = performance.now(), restored = await cold.generate(parseScene(JSON.stringify(scene)), { width: 47, height: 31, time: 1, quality: 'export' }); requestCount++;
          check(restored.type === 'raster' && await hash(restored.pixels) === hashes.get(1), 'Same-clip cold reload changed');
          samples.push({ label: 'cold-reload', time: 1, actualHash: await hash(restored.pixels), actualBackend: restored.backend, requestWallMs: performance.now() - start });
        } finally { cold.dispose(); }
        groupBaselineRegression.push({ backend, samples });
      } finally { generator.dispose(); }
    }
    const compatibility = [], oldDef = oldDefinition('domain');
    check(oldDef.presets.length === 6, 'Frozen old preset inventory changed');
    for (const oldPreset of oldDef.presets) {
      const preset = def.presets.find(p => p.id === oldPreset.id);
      check(preset && JSON.stringify(preset) === JSON.stringify(oldPreset), 'Existing preset metadata changed ' + oldPreset.id);
      for (const backend of ['cpu', 'gpu']) {
        const before = oldCreateScene(oldDef, oldPreset), after = createScene(def, preset);
        before.settings.domainBackend = backend; after.settings.domainBackend = backend;
        check(fingerprint(before) === fingerprint(after), 'Existing preset document changed ' + oldPreset.id);
        const a = new OldGenerator(), b = new Generator();
        try {
          for (const time of [0, 1.05]) {
            const context = { width: 79, height: 53, time, quality: 'export' };
            const oldStarted = performance.now(), old = await a.generate(before, context), oldRequestWallMs = performance.now() - oldStarted;
            const currentStarted = performance.now(), current = await b.generate(after, context), currentRequestWallMs = performance.now() - currentStarted; requestCount += 2;
            check(old.type === 'raster' && current.type === 'raster', 'Old preset not raster');
            const oldHash = await hash(old.pixels), currentHash = await hash(current.pixels);
            check(oldHash === currentHash && old.backend === current.backend, 'Old preset pixels/backend changed ' + oldPreset.id);
            check(old.stats.samples === current.stats.samples && old.stats.generated === current.stats.generated && old.stats.invalid === current.stats.invalid, 'Old preset statistics changed');
            compatibility.push({ id: oldPreset.id, backend, time, oldHash, currentHash, actualBackend: current.backend,
              oldRequestWallMs, currentRequestWallMs, oldProducerMs: old.stats.elapsedMs, currentProducerMs: current.stats.elapsedMs, samples: current.stats.samples });
          }
        } finally { a.dispose(); b.dispose(); }
      }
    }
    return { documents, rows, compatibility, groupBaselineRegression, workspace: { count: workspace.scenes.length, active: workspace.active }, requestCount };
  }, parameterOracle);
  report.browser = browser.version();
} catch (error) { report.error = String(error.stack ?? error); }
finally { await browser?.close(); await server.close(); }
report.sourceEnd = await snapshot(); report.sourceStable = JSON.stringify(report.sourceStart) === JSON.stringify(report.sourceEnd);
report.finishedAt = new Date().toISOString(); report.status = !report.error && report.sourceStable ? 'passed' : 'failed';
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, error: report.error, official: report.result?.documents.length,
  compatibility: report.result?.compatibility.length, requests: report.result?.requestCount, output }));
if (report.status !== 'passed') process.exitCode = 1;
