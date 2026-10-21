/** Public App acceptance of the nine documented Map/Symmetry parameter sets.
 * This verifies local authoring/replay/export, not original-app pixel parity.
 * Run from studio: node scripts/verify-guide-density-examples.mjs <new-directory> [time-seconds]
 */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const check = (value, message) => { if (!value) throw Error(message); };
const sha = value => createHash('sha256').update(value).digest('hex');
const clifford = { x: 'sin(a*y)+c*cos(a*x)', y: 'sin(b*x)+d*cos(b*y)' };
const cases = [
  { id: 'map-clifford', name: 'Clifford', kind: 'map', equations: clifford, parameters: { a: -1.7, b: 1.8, c: 1.6, d: .9 }, settings: { dimension: 2 } },
  { id: 'map-de-jong', name: 'Peter de Jong', kind: 'map', equations: { x: 'sin(a*y)-cos(b*x)', y: 'sin(c*x)-cos(d*y)' }, parameters: { a: -2.24, b: .43, c: -.65, d: -2.43 }, settings: { dimension: 2 } },
  { id: 'map-cascade', name: '级联', kind: 'map', equations: { ...clifford, y: 'sin(b*nx)+d*cos(b*y)' }, parameters: { a: -1.4, b: 1.6, c: 1, d: .7 }, settings: { dimension: 2 } },
  { id: 'map-3d', name: '3D Clifford', kind: 'map', equations: { ...clifford, z: 'sin(e*x)+f*cos(e*z)' }, parameters: { a: -1.7, b: 1.8, c: 1.6, d: .9, e: -.5, f: 1.2 }, settings: { dimension: 3 } },
  { id: 'symmetry-shield', name: '盾形', kind: 'symmetry', parameters: { lambda: 2, alpha: -2.43, beta: 1, gamma: .05, omega: 0, delta: 0 }, settings: { template: 'standard', degree: 3, deltaPower: 1 } },
  { id: 'symmetry-cloak', name: '披风', kind: 'symmetry', parameters: { lambda: -1.5, alpha: 1.8, beta: .8, gamma: .3, omega: .1, delta: 0 }, settings: { template: 'standard', degree: 5, deltaPower: 1 } },
  { id: 'symmetry-pinwheel', name: '风车', kind: 'symmetry', parameters: { lambda: 1.8, alpha: -2, beta: .5, gamma: .2, omega: .6, delta: 0 }, settings: { template: 'standard', degree: 4, deltaPower: 1 } },
  { id: 'symmetry-ribbed', name: '肋星', kind: 'symmetry', parameters: { lambda: 2, alpha: -2.43, beta: 1, gamma: .05, omega: 0, delta: .5 }, settings: { template: 'modified', degree: 5, deltaPower: 3 } },
  { id: 'symmetry-wings', name: '双翼', kind: 'symmetry', parameters: { lambda: 1.5, alpha: -1.8, beta: .6, gamma: .3, omega: .2, delta: 0 }, settings: { template: 'standard', degree: 2, deltaPower: 1 } },
];
const directory = process.argv[2];
check(directory, 'Supply a new output directory');
const time = Number(process.argv[3] ?? 0);
check(Number.isFinite(time) && time >= 0 && time <= 5, 'Time must be between 0 and 5 seconds');
await mkdir(directory); // Preserve previous evidence; never overwrite a run.
const report = {
  at: new Date().toISOString(), status: 'running', cases: [], nativeParity: false,
  workload: { batchSize: 50000, burnIn: 50, iterationsPerFrame: 1, seed: 1, width: 512, height: 384, time },
  limits: [
    'Guide equations/parameters, local document defaults and mathematical viewport; not original JSON camera/render defaults.',
    'One fixed-time output at exploration workload, with fixed 60 Hz accumulation up to that time. No high-quality, video, long-running or original whole-window parity claim.',
    'PNG export is browser-local; the optional video export service is not started or tested.',
    'Labels name guide examples; visual morphology is recorded, not assumed from those names.',
    'CPU/GPU floating-point trajectories may differ; exact comparisons here use fresh instances of the same GPU implementation.',
    'Wall times include instrumentation. GPU memory and token cost are not measured.',
  ],
};
const snapshots = async () => {
  const files = (await readdir('src', { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => entry.parentPath + '/' + entry.name);
  files.push('scripts/verify-guide-density-examples.mjs');
  return Object.fromEntries(await Promise.all(files.sort().map(async path => [path, sha(await readFile(path))])));
};
report.sourceBefore = await snapshots();
// Link the measured parameter sets to the retained guide evidence if available.
report.guideEvidence = {};
for (const family of ['map-attractor', 'symmetry-chaos']) {
  const path = `../.cache/mathart-investigation/public-docs/guide__${family}.txt`;
  try { report.guideEvidence[family] = { path, sha256: sha(await readFile(path)) }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; report.guideEvidence[family] = { unavailable: true }; }
}
let server, browser, page;
const errors = [], started = performance.now();
function auditWorkers() {
  const Native = window.Worker;
  window.__guideAudit = { completed: [], errors: [], pending: new Map(), rendered: [], owners: new WeakMap(), pixels: new Map(), nextWorker: 0 };
  const audit = window.__guideAudit;
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args); this.workerId = ++audit.nextWorker;
      this.addEventListener('message', ({ data }) => {
        if (data.operation !== 'generate' || data.progress) return;
        const key = this.workerId + ':' + data.id, request = audit.pending.get(key);
        if (!request) return;
        audit.pending.delete(key);
        if (data.error) { audit.errors.push({ request, error: data.error }); return; }
        if (!data.output) return;
        const { pixels, positions, colors, ...output } = data.output;
        audit.owners.set(data.output, key);
        if (pixels) audit.pixels.set(key, pixels.slice());
        while (audit.pixels.size > 6) audit.pixels.delete(audit.pixels.keys().next().value);
        audit.completed.push({ key, request, output });
      });
    }
    postMessage(message, ...args) {
      if (message.operation === 'generate') audit.pending.set(this.workerId + ':' + message.id, structuredClone(message));
      return super.postMessage(message, ...args);
    }
  };
}
async function installRendererAudit() {
  await page.evaluate(async () => {
    const { ArtRenderer } = await import('/src/engine/renderer.ts');
    const original = ArtRenderer.prototype.setOutput;
    ArtRenderer.prototype.setOutput = function (output, ...args) {
      const result = original.call(this, output, ...args);
      window.__guideAudit.rendered.push(window.__guideAudit.owners.get(output));
      return result;
    };
  });
}
async function ready(name) {
  await page.waitForFunction(name => {
    const a = window.__guideAudit, last = a.completed.at(-1);
    return last?.request.scene.name === name && !a.pending.size &&
      document.querySelector('.status-bar')?.textContent.includes('Ready') &&
      !document.querySelector('.rendering-badge') && !document.querySelector('.error-card');
  }, name);
  return page.evaluate(() => window.__guideAudit.completed.at(-1));
}
async function seek(name) {
  if (time === 0) return ready(name);
  await page.getByRole('slider', { name: 'Time position', exact: true }).evaluate((element, time) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, String(time));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, time);
  await page.waitForFunction(time => window.__guideAudit.completed.at(-1)?.request.context.time === time, time);
  return ready(name);
}
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(auditWorkers);
  const origin = server.resolvedUrls.local[0];
  await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto(origin + 'fixture');
  const documents = await page.evaluate(async ({ cases, workload }) => {
    const { createScene, serializeScene, saveWorkspace } = await import('/src/engine/document.ts');
    const { definition } = await import('/src/scenes/index.ts');
    const { initializeNormalizedDensity } = await import('/src/engine/densityNormalization.ts');
    const initial = createScene(definition('surface'));
    Object.assign(initial.settings, { uSegments: 3, vSegments: 3 });
    saveWorkspace(localStorage, { scenes: [initial], active: initial.id, theme: 'dark', language: 'en', render: { quality: 'standard', frameRate: 30 } });
    return cases.map(spec => {
      const scene = createScene(definition(spec.kind));
      scene.name = spec.name;
      scene.parameters = spec.parameters;
      if (spec.equations) scene.equations = spec.equations;
      Object.assign(scene.settings, { iteratedMode: 'continuous', iteratedBackend: 'gpu', batchSize: workload.batchSize, burnIn: workload.burnIn, iterationsPerFrame: workload.iterationsPerFrame, seed: workload.seed }, spec.settings);
      scene.settings = initializeNormalizedDensity(spec.kind, scene.settings, workload.width, workload.height);
      scene.timeline.tracks = []; scene.timeline.duration = 6;
      return serializeScene(scene);
    });
  }, { cases, workload: report.workload });
  await page.goto(origin);
  await page.waitForFunction(() => window.__guideAudit.completed.length > 0);
  await installRendererAudit();
  for (const [index, spec] of cases.entries()) {
    const row = { ...spec, status: 'running' }, caseStarted = performance.now();
    report.cases.push(row);
    console.log(JSON.stringify({ stage: 'import', id: spec.id }));
    await page.locator('input[type=file]').setInputFiles({ name: spec.id + '.json', mimeType: 'application/json', buffer: Buffer.from(documents[index]) });
    await ready(spec.name);
    const imported = await seek(spec.name);
    check(imported.output.backend === 'webgl2', spec.id + ' did not use GPU');
    await page.waitForFunction(key => window.__guideAudit.rendered.includes(key), imported.key);
    await page.screenshot({ path: `${directory}/${spec.id}-preview.png` });
    row.preview = { backend: imported.output.backend, stats: imported.output.stats, context: imported.request.context };
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const projectDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export project JSON', exact: true }).click();
    const projectPath = `${directory}/${spec.id}.mathart.json`;
    await (await projectDownload).saveAs(projectPath);
    const saved = JSON.parse(await readFile(projectPath, 'utf8'));
    check(JSON.stringify(saved.parameters) === JSON.stringify(spec.parameters), spec.id + ' parameters changed');
    if (spec.equations) check(JSON.stringify(saved.equations) === JSON.stringify(spec.equations), spec.id + ' equations changed');
    for (const [key, value] of Object.entries(spec.settings)) check(saved.settings[key] === value, spec.id + ' setting changed: ' + key);
    await page.reload();
    const reopened = await ready(spec.name);
    check(JSON.stringify(reopened.request.scene.parameters) === JSON.stringify(saved.parameters), spec.id + ' reopen parameters changed');
    row.saveReopen = true;
    await installRendererAudit();
    await seek(spec.name);
    await page.getByRole('button', { name: 'Export artwork', exact: true }).click();
    await page.getByRole('combobox', { name: 'Export resolution', exact: true }).selectOption('custom');
    await page.getByRole('spinbutton', { name: 'Export width', exact: true }).fill(String(report.workload.width));
    await page.getByRole('spinbutton', { name: 'Export height', exact: true }).fill(String(report.workload.height));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Start export', exact: true }).click();
    const imagePath = `${directory}/${spec.id}.png`;
    await (await download).saveAs(imagePath);
    const png = await readFile(imagePath);
    row.image = await page.evaluate(async ({ encoded, name, width, height, time }) => {
      const a = window.__guideAudit, row = a.completed.findLast(r => r.request.context.quality === 'export');
      if (row?.request.scene.name !== name || row.output.backend !== 'webgl2') throw Error('wrong export output');
      if (row.request.context.time !== time) throw Error('export time changed');
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      if (bitmap.width !== width || bitmap.height !== height) throw Error('PNG dimensions');
      const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const rgba = ctx.getImageData(0, 0, width, height).data, expected = a.pixels.get(row.key);
      if (!expected || !rgba.every((v, i) => v === expected[i])) throw Error('PNG differs from complete Worker RGBA');
      const { Generator } = await import('/src/engine/client.ts');
      const generator = new Generator();
      try {
        const cold = await generator.generate(row.request.scene, row.request.context);
        if (cold.backend !== 'webgl2' || !cold.pixels || !rgba.every((v, i) => v === cold.pixels[i])) throw Error('cold replay differs');
      } finally { generator.dispose(); }
      const counts = new Map();
      for (let i = 0; i < rgba.length; i += 4) { const color = rgba.slice(i, i + 4).join(','); counts.set(color, (counts.get(color) ?? 0) + 1); }
      const nonModalPixels = width * height - Math.max(...counts.values());
      return { width, height, fullWorkerRgbaEqual: true, coldReplayRgbaEqual: true, distinctColors: counts.size, nonModalPixels, stats: row.output.stats, density: row.output.density, warnings: row.output.warnings, context: row.request.context };
    }, { encoded: png.toString('base64'), name: spec.name, ...report.workload });
    row.image.pngSha256 = sha(png);
    // Record degeneration separately: matching bytes alone is not visual success.
    row.visualStatus = row.image.nonModalPixels > 100 ? 'nonuniform-output-needs-native-comparison' : 'sparse-or-uniform-needs-investigation';
    await page.getByRole('button', { name: 'Close export', exact: true }).click();
    check(!(await page.evaluate(() => window.__guideAudit.errors.length)), spec.id + ' Worker errors');
    row.status = 'passed'; row.elapsedMs = performance.now() - caseStarted;
    await writeFile(directory + '/progress.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ id: spec.id, status: row.status, colors: row.image.distinctColors, nonModalPixels: row.image.nonModalPixels, elapsedMs: row.elapsedMs }));
  }
  check(!errors.length, 'App errors');
  report.sourceAfter = await snapshots();
  report.sourceStable = JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
  check(report.sourceStable, 'Production source changed');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1;
  if (page) {
    await page.screenshot({ path: directory + '/failure.png' }).catch(() => {});
    report.failure = await page.evaluate(() => ({ body: document.body.innerText, completed: window.__guideAudit?.completed.slice(-2), errors: window.__guideAudit?.errors })).catch(() => null);
  }
} finally {
  report.errors = errors; report.elapsedMs = performance.now() - started;
  report.cleanup = (await Promise.allSettled([browser?.close(), server?.close()])).map((result, i) => ({ resource: ['browser', 'vite'][i], status: result.status, ...(result.status === 'rejected' ? { error: String(result.reason) } : {}) }));
  if (report.cleanup.some(r => r.status === 'rejected')) { report.status = 'failed'; process.exitCode = 1; }
  await writeFile(directory + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, directory, error: report.error, elapsedMs: report.elapsedMs }));
}
