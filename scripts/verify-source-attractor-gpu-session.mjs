// Same-browser regression against a pinned production baseline, not a native
// JVM/JOGL oracle. Run separately from performance measurements.
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {build} from 'esbuild';
import {readFile, writeFile, readdir, mkdtemp, mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const baselineCommit = '4690a5f69a259bbe628bc2c5acd91b0ec2046d70';
const script = 'scripts/verify-source-attractor-gpu-session.mjs';
const reportPath = '.cache/v2-source-attractor-gpu-session.json';
const sha = data => createHash('sha256').update(data).digest('hex');
const hashes = async () => Object.fromEntries(await Promise.all([
  ...(await readdir('src', {recursive:true})).filter(p => /\.(ts|tsx|json)$/.test(p)).map(p => 'src/' + p), script,
].sort().map(async p => [p, sha(await readFile(p))])));
const report = {
  at:new Date().toISOString(), baselineCommit, nativeParity:'0/11 unchanged',
  scope:'Real headless Chrome WebGL2; full RGBA8 and complete camera frame equality against the pinned prior implementation. Sparse tracking, variable/fixed dt, forward/same/reverse/resize and actual texture deletion failure/recovery. No original JVM/JOGL execution or performance claims.',
  unmeasured:['native JVM/JOGL full-frame parity', 'performance and process-family memory', 'driver-internal memory reclamation'],
};
let server, browser, page;
try {
  await mkdir('.cache', {recursive:true});
  report.sourcesBefore = await hashes();
  const dir = await mkdtemp('.cache/attractor-gpu-session-');
  const baseline = resolve(dir, 'baseline');
  await mkdir(baseline);
  // This run owns its archive; no dependency on another task's temporary path.
  const archive = spawnSync('git', ['archive', baselineCommit, 'src'], {maxBuffer:32 * 1024 * 1024});
  if (archive.status !== 0) throw Error(String(archive.stderr));
  report.baselineArchiveSha256 = sha(archive.stdout);
  const unpack = spawnSync('tar', ['-x', '-C', baseline], {input:archive.stdout});
  if (unpack.status !== 0) throw Error(String(unpack.stderr));
  const common = `
    export {parseProjectFile} from './src/engine/legacyImport';
    export {parseScene,serializeScene} from './src/engine/document';
    export {generateScene,TemporalGenerationSession} from './src/engine/temporal';
    export {sceneAtTime} from './src/engine/timeline';
    export {prepareSourceAttractorScene} from './src/engine/sourceAttractorDocument';
    export {replaySourceAttractorGpu,disposeSourceAttractorGpuRequests} from './src/engine/sourceAttractorGpuReplay';
  `;
  report.bundles = {};
  for (const variant of ['before', 'after']) {
    const outfile = resolve(dir, variant + '.mjs');
    await build({stdin:{contents:common + (variant === 'after' ? "export {SourceAttractorGpuReplaySession} from './src/engine/sourceAttractorGpuReplay';" : ''), resolveDir:variant === 'before' ? baseline : process.cwd(), loader:'ts'}, bundle:true, platform:'browser', format:'esm', outfile});
    report.bundles[variant] = {path:outfile, sha256:sha(await readFile(outfile))};
  }
  server = await createServer({server:{host:'127.0.0.1', port:0, hmr:false}, logLevel:'error'});
  await server.listen();
  browser = await chromium.launch({channel:'chrome', headless:true});
  report.browserVersion = browser.version();
  report.nodeVersion = process.version;
  page = await browser.newPage({viewport:{width:320, height:240}, deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/gpu-session', route => route.fulfill({contentType:'text/html', body:'<!doctype html>'}));
  for (const variant of ['before', 'after']) await page.route('**/' + variant + '.mjs', route => route.fulfill({contentType:'text/javascript', path:report.bundles[variant].path}));
  await page.goto(server.resolvedUrls.local[0] + 'gpu-session');
  report.browserChecks = await page.evaluate(async () => {
    const before = await import('/before.mjs'), after = await import('/after.mjs');
    const result = window.__gpuSessionReport = {cases:[], cleanup:[]};
    const assert = (value, message) => { if (!value) throw Error(message); };
    const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
    // Preserve signed zero/nonfinite distinctions in camera comparisons.
    const exact = value => JSON.stringify(value, (_key, v) => typeof v === 'number' ? {number:Object.is(v, -0) ? '-0' : String(v)} : v);
    const live = new Map(), originals = [], events = [];
    let failDelete = false, injected = 0;
    const groupsFor = gl => {
      if (!live.has(gl)) live.set(gl, new Map());
      return live.get(gl);
    };
    const countFor = gl => [...(live.get(gl)?.values() ?? [])].reduce((n, set) => n + set.size, 0);
    const outstanding = () => [...live.keys()].reduce((n, gl) => n + countFor(gl), 0);
    for (const kind of ['Program', 'Shader', 'Buffer', 'Texture', 'VertexArray', 'Framebuffer', 'Renderbuffer']) {
      for (const operation of ['create', 'delete']) {
        const name = operation + kind, original = WebGL2RenderingContext.prototype[name];
        originals.push([name, original]);
        WebGL2RenderingContext.prototype[name] = function(...args) {
          const groups = groupsFor(this);
          if (!groups.has(kind)) groups.set(kind, new Set());
          if (name === 'deleteTexture' && failDelete) {
            failDelete = false; injected++;
            events.push({operation:'injected-delete-failure', gl:this, object:args[0]});
            throw Error('Verifier injected one real WebGL deleteTexture failure');
          }
          const value = original.apply(this, args);
          if (operation === 'create' && value) groups.get(kind).add(value);
          if (operation === 'delete') groups.get(kind).delete(args[0]);
          events.push({operation:name, gl:this, object:operation === 'create' ? value : args[0]});
          return value;
        };
      }
    }
    const owners = new Set();
    const own = owner => { owners.add(owner); return owner; };
    const release = owner => { owner.reset(); owners.delete(owner); };
    const source = variable => ({
      config_version:'1.0.0', type:'ATTRACTOR', name:'Pinned GPU persistent replay verification',
      equations:{dx:'10*(y-x)', dy:'x*(28-z)-y', dz:'x*y-8/3*z'},
      settings:{render_mode:'GPU', particle_count_gpu:257, sub_steps:3, scale_x:4, scale_y:5, scale_z:3, offset_x:7, offset_y:-3, offset_z:-90,
        ...(variable ? {time_step_min:.002, time_step_max:.006} : {time_step:.004})},
      initialization:{warmup_steps:103, warmup_stagger_min:2, warmup_stagger_max:7,
        bounds:{min_x:-1, max_x:2, min_y:-2, max_y:1, min_z:.5, max_z:2}},
      camera:{phi:Math.PI / 2, theta:.1, gamma:.05},
      timeline:[
        {type:'animate', duration:.5, easing:'LINEAR', actions:[{method:'track', args:[256]}, {method:'track', args:[1]}, {method:'track', args:[256]}, {method:'rotatePhi', args:[.15]}]},
        {type:'animate', duration:.5, easing:'LINEAR', actions:[{method:'track', args:[1]}, {method:'track', args:[999]}, {method:'rotateTheta', args:[-.2]}]},
        {type:'animate', duration:.5, easing:'LINEAR', actions:[{method:'track', args:[17]}, {method:'track', args:[256]}, {method:'track', args:[17]}]},
        {type:'wait', duration:.5},
      ],
    });
    const sceneFor = (api, raw) => {
      const scene = api.parseScene(api.serializeScene(api.parseProjectFile(JSON.stringify(raw)).scene));
      scene.timeline.fps = 8;
      return scene;
    };
    const optionsFor = (api, scene) => ({...api.prepareSourceAttractorScene(scene), tracks:scene.timeline.tracks, fps:scene.timeline.fps, time:0});
    const context = (time, width = 160, height = 120) => ({time, width, height, quality:'export',
      sourceViewport:{logicalWidth:width, logicalHeight:height, referenceLogicalHeight:120, target:'offscreen', projectionPass:'perspective'}});
    const display = (options, c) => ({time:c.time, width:c.width, height:c.height, viewport:c.sourceViewport, backgroundColor:options.backgroundColor});
    const compare = async (expected, actual, label) => {
      assert(expected.type === 'raster' && actual.type === 'raster' && actual.backend === 'webgl2', label + ': missing GPU raster');
      assert(actual.width === expected.width && actual.height === expected.height && actual.pixels.length === expected.width * expected.height * 4, label + ': incomplete raster');
      assert(actual.stats.generated === 257 && expected.stats.generated === 257, label + ': particle count');
      for (let i = 0; i < expected.pixels.length; i++) if (actual.pixels[i] !== expected.pixels[i]) throw Error(`${label}: RGBA byte ${i}: ${actual.pixels[i]} != ${expected.pixels[i]}`);
      assert(exact(actual.sourceCameraFrame) === exact(expected.sourceCameraFrame), label + ': complete camera mismatch');
      return {bytes:actual.pixels.byteLength, pixelsSha256:await digest(actual.pixels), cameraSha256:await digest(new TextEncoder().encode(exact(actual.sourceCameraFrame)))};
    };
    try {
      for (const variable of [true, false]) {
        const raw = source(variable), oldScene = sceneFor(before, raw), scene = sceneFor(after, raw);
        const oldOptions = optionsFor(before, oldScene), owner = own(new after.TemporalGenerationSession());
        const row = {name:variable ? 'variable-dt-four-RNG-draws' : 'fixed-dt-three-RNG-draws', frames:[]};
        result.cases.push(row);
        const sequence = [[0], [.125], [.375], [.375], [.375, 197, 113], [.75], [1.125], [1.625], [2.25], [2.25, 128, 96], [.25], [.25], [.625], [1.25]];
        let previousTime = -1, constructions = 1, readbackBytes = 0;
        for (const [time, width = 160, height = 120] of sequence) {
          if (time < previousTime) { constructions++; readbackBytes = 0; }
          const c = context(time, width, height);
          const expected = before.generateScene(oldScene, c);
          const actual = after.generateScene(scene, c, owner);
          const compared = await compare(expected, actual, row.name + '@' + time);
          const independentCamera = before.sceneAtTime(oldScene, time).evaluatedSourceCamera;
          assert(exact(independentCamera.camera) === exact(actual.sourceCameraFrame.camera), 'Separate baseline camera query disagrees');
          const expectedUpdates = before.replaySourceAttractorGpu({...oldOptions, time}).updates;
          const d = owner.diagnostics().sourceAttractor.gpu;
          readbackBytes += actual.pixels.byteLength;
          assert(d.constructions === constructions, 'Unexpected retained GPU reconstruction');
          assert(d.trackingBytes === 36, 'Sparse tracking must retain exactly three unique XYZ slots');
          assert(d.updates === expectedUpdates && d.engine.updatePasses === expectedUpdates, 'GPU update count differs from pinned queue');
          assert(d.engine.readbackBytes === readbackBytes, 'Normal presentation performed extra readback');
          row.frames.push({time, width, height, frameIndex:actual.sourceCameraFrame.frameIndex, expectedUpdates, ...compared, diagnostics:d});
          previousTime = time;
        }
        release(owner);
        assert(outstanding() === 0, 'Public session left live GL handles');
      }
      // Test the true cleanup boundary directly: an outer public owner's catch
      // could immediately retry its child and hide the pending ticket state.
      const raw = source(true), oldScene = sceneFor(before, raw), scene = sceneFor(after, raw);
      const options = optionsFor(after, scene), owner = own(new after.SourceAttractorGpuReplaySession(options));
      const c = context(.75), expected = before.generateScene(oldScene, c);
      await compare(expected, owner.generate(display(options, c)), 'pre-failure');
      const oldContexts = [...live.keys()].filter(gl => countFor(gl) > 0);
      assert(oldContexts.length === 1, 'Expected exactly one owned live GPU context');
      const oldContext = oldContexts[0];
      let ticket;
      failDelete = true;
      try { owner.reset(); } catch (error) { ticket = error; }
      assert(injected === 1 && ticket?.cleanupPending === true, 'Failed deletion lost cleanup ownership');
      assert(owner.diagnostics().engine?.contextOwned === true && owner.diagnostics().engine.handles > 0 && countFor(oldContext) > 0, 'Failed deletion erased resource ownership');
      result.cleanupFailure = {name:ticket.name, cleanupPending:true, retained:owner.diagnostics()};
      const eventStart = events.length;
      const recovered = owner.generate(display(options, c));
      result.cleanupFailure.recovered = await compare(expected, recovered, 'cleanup recovery');
      assert(ticket.cleanupPending === false && countFor(oldContext) === 0, 'Next request did not finish old cleanup');
      const recoveryEvents = events.slice(eventStart), firstNew = recoveryEvents.findIndex(e => e.operation.startsWith('create') && e.gl !== oldContext);
      const lastOld = recoveryEvents.reduce((last, e, i) => e.operation.startsWith('delete') && e.gl === oldContext ? i : last, -1);
      assert(lastOld >= 0 && firstNew > lastOld, 'New GPU allocation preceded retirement of old handles');
      const newContexts = [...live.keys()].filter(gl => countFor(gl) > 0);
      assert(newContexts.length === 1 && newContexts[0] !== oldContext, 'Recovery did not own a distinct generation');
      const previousEvents = events.length, previousHandles = outstanding();
      ticket.retryCleanup();
      assert(events.length === previousEvents && outstanding() === previousHandles, 'Old cleanup ticket affected the new generation');
      result.cleanupFailure.oldTicketInert = true;
      await compare(expected, owner.generate(display(options, c)), 'after stale ticket');
      const expectedNext = before.generateScene(oldScene, context(1.125));
      await compare(expectedNext, owner.generate(display(options, context(1.125))), 'advance after recovery');
      release(owner);
      result.cleanupFailure.injectedDeletes = injected;
      result.cleanupFailure.cleanupPendingAfterRecovery = ticket.cleanupPending;
      result.fullFramesCompared = result.cases.reduce((n, row) => n + row.frames.length, 0) + 4;
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed'; result.error = String(error); result.stack = error.stack;
    } finally {
      failDelete = false;
      for (const owner of owners) {
        try { owner.reset(); result.cleanup.push({owner:owner.constructor.name, status:'fulfilled'}); }
        catch (error) { result.cleanup.push({owner:owner.constructor.name, status:'rejected', error:String(error)}); result.status = 'failed'; }
      }
      for (const [name, api] of [['before', before], ['after', after]]) {
        try { api.disposeSourceAttractorGpuRequests(); result.cleanup.push({owner:name + '-pending', status:'fulfilled'}); }
        catch (error) { result.cleanup.push({owner:name + '-pending', status:'rejected', error:String(error)}); result.status = 'failed'; }
      }
      result.remainingGLHandles = outstanding();
      if (result.remainingGLHandles) { result.status = 'failed'; result.cleanup.push({error:'Live GL resources remain'}); }
      for (const [name, original] of originals) WebGL2RenderingContext.prototype[name] = original;
    }
    return result;
  });
  if (errors.length) throw Error(errors.join('; '));
  if (report.browserChecks.status !== 'passed') throw Error(report.browserChecks.error ?? 'Browser cleanup verification failed');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); report.stack = error.stack; process.exitCode = 1;
  if (page && !report.browserChecks) try { report.browserChecks = await page.evaluate(() => window.__gpuSessionReport); } catch { /* Browser may already have failed. */ }
} finally {
  report.cleanup = [];
  for (const [name, resource] of [['browser', browser], ['vite', server]]) if (resource) {
    try { await resource.close(); report.cleanup.push({name, status:'fulfilled'}); }
    catch (error) { report.cleanup.push({name, status:'rejected', error:String(error)}); report.status = 'failed'; process.exitCode = 1; }
  }
  report.sources = await hashes();
  report.sourceStable = JSON.stringify(report.sourcesBefore) === JSON.stringify(report.sources);
  if (!report.sourceStable) { report.status = 'failed'; report.error ??= 'Sources changed during verification'; process.exitCode = 1; }
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({status:report.status, error:report.error, reportPath, sourceStable:report.sourceStable,
    fullFramesCompared:report.browserChecks?.fullFramesCompared, remainingGLHandles:report.browserChecks?.remainingGLHandles,
    cleanupFailure:report.browserChecks?.cleanupFailure, nativeParity:report.nativeParity}, null, 2));
}
