// Completed identical sparse workloads before/after a raster-owner change.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { configureDesktopGraphics } from '../desktop/graphics.mjs';
const directory = process.argv[2];
if (!directory) throw Error('Supply a fresh report directory');
await mkdir(directory, { recursive: true });
const switches = new Map();
configureDesktopGraphics({ getSwitchValue: n => switches.get(n) ?? '', appendSwitch: (n, v) => switches.set(n, v) });
const source = await readFile('src/engine/fractalNativeNewtonGpu.ts');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { status: 'running', sourceSha256: sha(source), graphics: Object.fromEntries(switches), limits: ['Local before/after equivalence, not native-window parity.', 'Browser workload wall times; external process monitor records sampled family CPU and memory. GPU memory and task token cost unmeasured.'] };
let vite, browser;
try {
  vite = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' }); await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...switches].map(([k, v]) => `--${k}=${v}`) });
  const page = await browser.newPage();
  await page.route('**/batch-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto(vite.resolvedUrls.local[0] + 'batch-fixture');
  report.browser = browser.version();
  report.runs = await page.evaluate(async () => {
    const { FractalSourceNewtonGpu } = await import('/src/engine/fractalNativeNewtonGpu.ts');
    const { prepareFractalSourcePlan } = await import('/src/engine/fractalSourcePrecision.ts');
    const { prepareFractalSourceColor, createDefaultFractalSourceColorConfiguration } = await import('/src/engine/fractalSourceColor.ts');
    const { createScene } = await import('/src/engine/document.ts');
    const { definitions, fractalConfig } = await import('/src/scenes/complex.ts');
    const scene = createScene(definitions.find(d => d.kind === 'fractal'));
    Object.assign(scene.settings, { formula: 'newton', power: 3, powerImag: 0, startReal: 1, startImag: 0, iterations: 100, tolerance: .001, fractalNumericProfile: 'mathart-1.7.8-newton-nova-v1' });
    const c = fractalConfig(scene.settings), view = { centerX: -.3, centerXLow: 0, centerY: 0, centerYLow: 0, zoom: 1, rotation: 0 };
    const prepared = prepareFractalSourcePlan(c, view, { logicalWidth: 64, logicalHeight: 16, provenance: 'requested-output-local' }, { precision: 'medium' });
    if (!prepared.ok) throw Error(JSON.stringify(prepared));
    const plan = prepared.value, color = prepareFractalSourceColor({ configuration: createDefaultFractalSourceColorConfiguration(), formulaPower: plan.reference.power, bailout: plan.bailout });
    const seeds = [];
    for (let y = 0; y < 16; y += 4) for (let x = 0; x < 64; x += 4) for (const [dx, dy] of [[0, 0], [3, 0], [0, 3], [3, 3], [1, 1]]) seeds.push(x + dx, y + dy);
    // Also retain duplicates, reversed ordering and holes; returned records must follow callers.
    seeds.push(63, 15, 0, 0, 63, 15);
    const points = Float32Array.from(seeds), gpu = new FractalSourceNewtonGpu(), rows = [];
    const hash = async array => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength)))).map(x => x.toString(16).padStart(2, '0')).join('');
    try {
      for (let round = 0; round < 3; round++) {
        const before = gpu.diagnostics(), started = performance.now();
        const batch = gpu.sample(points, 64, 16, view, c, plan, undefined, undefined, color);
        const elapsedMs = performance.now() - started, after = gpu.diagnostics();
        const hashes = {}; for (const [name, value] of Object.entries(batch)) if (ArrayBuffer.isView(value)) hashes[name] = await hash(value);
        rows.push({ kind: round === 0 ? 'cold-owner' : 'warm-owner', elapsedMs, samples: points.length / 2, draws: after.draws - before.draws, hashes, diagnostics: after });
      }
      return rows;
    } finally { gpu.dispose(); }
  });
  if (!report.runs.every(row => JSON.stringify(row.hashes) === JSON.stringify(report.runs[0].hashes))) throw Error('Cold/warm output differs');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  report.cleanup = (await Promise.allSettled([browser?.close(), vite?.close()])).map(r => r.status);
  report.sourceStable = sha(await readFile('src/engine/fractalNativeNewtonGpu.ts')) === report.sourceSha256;
  if (!report.sourceStable || report.cleanup.includes('rejected')) { report.status = 'failed'; process.exitCode = 1; }
  await writeFile(directory + '/report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
