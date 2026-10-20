/** Public browser workload diagnostic, not a native-image parity claim.
 * Run from studio: node scripts/benchmark-source-perlin-cpu-capacity.mjs
 * Optional: --root <archived studio tree> --report <json> --matrix focused
 * An archive must be prepared explicitly by the caller; this script never changes Git.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer as createSocketServer } from 'node:net';

const { values } = parseArgs({ options: {
  root: { type: 'string', default: '.' },
  report: { type: 'string', default: '.cache/mas-noi-008-capacity-current.json' },
  matrix: { type: 'string', default: 'full' },
  label: { type: 'string', default: 'current working source' },
} });
if (!['full', 'focused'].includes(values.matrix)) throw Error('--matrix must be full or focused');
const measuredRoot = resolve(values.root);
const destination = resolve(values.report);
const scriptPath = fileURLToPath(import.meta.url);
const studioRoot = resolve(dirname(scriptPath), '..');
const jar = resolve(studioRoot, '../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePaths = (await readdir(resolve(measuredRoot, 'src'), { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile()).map(entry => resolve(entry.parentPath, entry.name));
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(path))])));
const counts = values.matrix === 'full' ? [5000, 10000, 20000] : [5000];
const lifetimes = values.matrix === 'full' ? [1, 4, 8] : [4, 8];
const report = {
  at: new Date().toISOString(), measuredRoot, label: values.label, matrix: values.matrix,
  scope: 'Public TemporalGenerationSession CPU particles in actual headless Chrome WebGL. 320x240 density1, 30fps, original JSON with explicit particle_count and trail_lifetime derivatives; its sole wait clip is extended only when needed to keep updates active through the requested endpoint. Continuous requests and independent cold seek to lifetime+1 seconds. Each run stops at first failure; no budget increase or automatic workload reduction.',
  nativeParity: false,
  interpretation: 'Slow completed frames count as success. Frame-call durations include CPU work and synchronous WebGL readback, not actual app playback FPS. Device representation bytes are accounting, not measured GPU memory. Browser TaskDuration is main-thread task time, not process-family CPU. Failed cold requests expose no intermediate output; no internal completion is inferred.',
  unmeasured: ['Native JVM/JOGL behavior', 'Process-family CPU/peak RSS', 'GPU memory', 'Agent tokens'],
  fixedComparisonBaseline: '680b2b7840c57193be859694c16c8191fae48fd7 (separately archived and measured; not automatically checked out)',
  runtime: { node: process.version, scriptSha256: hash(await readFile(scriptPath)) }, runs: [],
};
let browser, server;
const start = performance.now();
await mkdir(dirname(destination), { recursive: true });
try {
  const artifact = await readFile(jar);
  if (hash(artifact) !== 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018') throw Error('Original artifact changed');
  const sourceBytes = execFileSync('python3', ['-c', "import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read('data/Noise/noise.json'))", jar]);
  const source = JSON.parse(sourceBytes);
  report.source = { jarSha256: hash(artifact), member: 'data/Noise/noise.json', memberSha256: hash(sourceBytes) };
  const before = await hashes();
  // Vite treats port:0 as its default port. Ask the OS for an unused explicit port.
  const socket = createSocketServer();
  await new Promise((ok, fail) => { socket.once('error', fail); socket.listen(0, '127.0.0.1', ok); });
  const port = socket.address().port;
  await new Promise((ok, fail) => socket.close(error => error ? fail(error) : ok()));
  server = await createServer({ root: measuredRoot, server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  report.runtime.browser = browser.version();
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.route('**/capacity', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto(server.resolvedUrls.local[0] + 'capacity');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
  for (const count of counts) for (const lifetime of lifetimes) for (const mode of ['continuous-through-expiry', 'cold-seek-through-expiry']) {
    if (values.matrix === 'focused' && lifetime === 8 && mode === 'cold-seek-through-expiry') continue;
    const metricBefore = await metrics();
    const run = await page.evaluate(async ({ source, count, lifetime, mode }) => {
      const { parseProjectFile } = await import('/src/engine/legacyImport.ts');
      const { generateScene, TemporalGenerationSession } = await import('/src/engine/temporal.ts');
      const input = structuredClone(source);
      input.name = `MAS-NOI-008 ${count}/${lifetime}`;
      Object.assign(input.settings, { particle_count: count, trail_lifetime: lifetime });
      if (input.timeline.length !== 1 || input.timeline[0].type !== 'wait') throw Error('Original timeline fixture changed');
      const originalWaitDuration = input.timeline[0].duration;
      input.timeline[0].duration = Math.max(originalWaitDuration, lifetime + 2);
      const scene = parseProjectFile(JSON.stringify(input)).scene;
      scene.timeline.fps = 30;
      if (scene.perlinCpuSource.particles.count !== count || scene.perlinCpuSource.display.trailLifetime !== lifetime) throw Error('Requested count/lifetime changed');
      const session = new TemporalGenerationSession();
      const frames = [], endTime = lifetime + 1;
      const times = mode === 'continuous-through-expiry' ? Array.from({ length: endTime * 30 + 1 }, (_, i) => i / 30) : [endTime];
      const result = { count, lifetime, endTime, mode, timelineDerivative: { originalWaitDuration, measuredWaitDuration: input.timeline[0].duration }, canonical: {
        count: scene.perlinCpuSource.particles.count, lifetime: scene.perlinCpuSource.display.trailLifetime,
        accumulation: scene.perlinCpuSource.display.accumulation, showTrails: scene.perlinCpuSource.display.showTrails, seed: scene.perlinCpuSource.seed,
      }, frames };
      let output, lastDiagnostics;
      const runStart = performance.now();
      try {
        for (const time of times) {
          const callStart = performance.now();
          try {
            output = generateScene(scene, { time, quality: 'preview', width: 320, height: 240,
              sourcePerlinViewport: { width: 320, height: 240, pixelDensity: 1 },
              sourceViewport: { logicalWidth: 320, logicalHeight: 240, referenceLogicalHeight: 240, target: 'primary', projectionPass: 'perspective' },
            }, session);
            lastDiagnostics = session.sourcePerlinCpu.diagnostics();
            const expectedFrame = Math.round(time * 30);
            if (output.sourcePerlinFrame.frameIndex !== expectedFrame || output.sourcePerlinFrame.updates !== expectedFrame + 1 || lastDiagnostics.model.updates !== expectedFrame + 1) {
              throw Error(`Requested ${time}s / frame ${expectedFrame} did not advance model: ${JSON.stringify(output.sourcePerlinFrame)}`);
            }
            frames.push({ requestedTime: time, elapsedMs: performance.now() - callStart,
              outputFrame: output.sourcePerlinFrame, draws: lastDiagnostics.model?.draws, updates: lastDiagnostics.model?.updates,
              records: lastDiagnostics.model?.trails?.records, trailRetainedBytes: lastDiagnostics.model?.trails?.retainedBytes,
              deviceRepresentationBytes: lastDiagnostics.target?.deviceRepresentationBytes,
            });
          } catch (error) {
            result.failure = { requestedTime: time, elapsedMs: performance.now() - callStart, name: error.name, code: error.code,
              message: error.message, stack: error.stack, lastSuccessfulDiagnostics: lastDiagnostics,
              afterFailureDiagnostics: session.sourcePerlinCpu.diagnostics(),
            };
            break;
          }
        }
        result.elapsedMs = performance.now() - runStart;
        const elapsed = frames.map(frame => frame.elapsedMs).sort((a, b) => a - b);
        result.completedFrameCosts = elapsed.length ? {
          meanMs: elapsed.reduce((a, b) => a + b, 0) / elapsed.length, minMs: elapsed[0],
          p50Ms: elapsed[Math.ceil(elapsed.length * .5) - 1], p95Ms: elapsed[Math.ceil(elapsed.length * .95) - 1],
          maxMs: elapsed.at(-1), above30fpsBudget: elapsed.filter(value => value > 1000 / 30).length,
        } : null;
        result.lastSuccessfulTime = frames.at(-1)?.requestedTime;
        result.status = result.failure ? 'failed' : 'passed';
        result.completedRequests = frames.length;
        result.finalDiagnostics = lastDiagnostics;
        if (output) {
          result.lastSuccessfulRgbaSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', output.pixels))).map(value => value.toString(16).padStart(2, '0')).join('');
          result.lastSuccessfulPixelBytes = output.pixels.byteLength;
        }
        return result;
      } finally {
        session.reset();
        result.afterResetDiagnostics = session.sourcePerlinCpu.diagnostics();
      }
    }, { source, count, lifetime, mode });
    const metricAfter = await metrics();
    run.browserMainThreadTaskSeconds = metricAfter.TaskDuration - metricBefore.TaskDuration;
    run.browserJsHeapUsedAfter = metricAfter.JSHeapUsedSize;
    report.runs.push(run);
    await writeFile(destination, JSON.stringify({ ...report, status: 'running' }, null, 2) + '\n');
    console.log(JSON.stringify({ count, lifetime, mode, status: run.status, completedRequests: run.completedRequests,
      lastSuccessfulTime: run.lastSuccessfulTime, elapsedMs: run.elapsedMs, failure: run.failure?.message }));
  }
  report.comparisons = [];
  for (const count of counts) for (const lifetime of lifetimes) {
    const runs = report.runs.filter(run => run.count === count && run.lifetime === lifetime);
    report.comparisons.push({ count, lifetime, continuous: runs[0].status, cold: runs[1]?.status ?? 'not-selected',
      finalRgbaEqual: runs.length === 2 && runs.every(run => run.status === 'passed') ? runs[0].lastSuccessfulRgbaSha256 === runs[1].lastSuccessfulRgbaSha256 : null,
    });
  }
  // Bind only actual transformed production dependencies, not unrelated UI/document edits.
  const loaded = [...server.moduleGraph.idToModuleMap.keys()].map(id => id.split('?')[0])
    .filter(path => path.startsWith(resolve(measuredRoot, 'src') + '/'));
  const usedPaths = [...new Set(loaded)].sort();
  if (!usedPaths.length) throw Error('No production dependency provenance was captured');
  const after = await hashes();
  report.sources = Object.fromEntries(usedPaths.map(path => [relative(measuredRoot, path), { before: before[path], after: after[path] }]));
  if (usedPaths.some(path => !before[path] || before[path] !== after[path])) throw Error('Loaded production source changed during observation');
  report.sourceStable = true;
  const expectedCapacityMessages = new Set([
    'Perlin trails exceed one million retained records.',
    'Perlin CPU shared device representations exceed 256 MiB.',
    'Perlin CPU 单次请求超过 2000 万处理项预算；请分段播放或减少轨迹规模',
  ]);
  report.validationFailures = [];
  for (const run of report.runs) {
    const name = `${run.count}/${run.lifetime}/${run.mode}`;
    const reset = run.afterResetDiagnostics;
    if (!reset || reset.constructions !== 0 || reset.model !== undefined || reset.target !== undefined) {
      report.validationFailures.push(`${name}: reset retained owned model/target state`);
    }
    if (run.status === 'failed' && !expectedCapacityMessages.has(run.failure?.message)) {
      report.validationFailures.push(`${name}: unexpected failure: ${run.failure?.message}`);
    }
  }
  for (const comparison of report.comparisons) {
    if (comparison.finalRgbaEqual === false) report.validationFailures.push(`${comparison.count}/${comparison.lifetime}: warm/cold RGBA mismatch`);
  }
  report.summary = {
    passed: report.runs.filter(run => run.status === 'passed').length,
    capacityRejected: report.runs.filter(run => expectedCapacityMessages.has(run.failure?.message)).length,
    rgbaPairsEqual: report.comparisons.filter(comparison => comparison.finalRgbaEqual === true).length,
  };
  if (report.validationFailures.length) throw Error(report.validationFailures.join('; '));
  report.status = 'measured';
} catch (error) {
  report.status = 'diagnostic-failed';
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([browser?.close(), server?.close()]);
  report.cleanup = cleanup.map((result, index) => ({ resource: ['browser', 'vite'][index], status: result.status,
    error: result.status === 'rejected' ? String(result.reason) : undefined }));
  if (cleanup.some(result => result.status === 'rejected')) {
    report.status = 'diagnostic-failed';
    report.cleanupFailed = true;
    process.exitCode = 1;
  }
  report.wallMs = performance.now() - start;
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, runs: report.runs.length, wallMs: report.wallMs, path: destination }));
}
