import { chromium } from 'playwright/test';
import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { retainedNativeOrbitFragment, retainedNativeShaderSha256 } from '../.cache/domain-native-retained-oracle.mjs';
import { officialFormulaMacros } from './verify-domain-examples-oracles.mjs';

const output = process.env.DOMAIN_EXAMPLES_MATH_REPORT ?? '.cache/domain-examples-math-attempt1.json';
const imageDirectory = process.env.DOMAIN_EXAMPLES_IMAGES ?? '.cache/domain-examples-math-images-attempt1';
const paths = ['scripts/verify-domain-examples-math.mjs', 'scripts/verify-domain-examples-oracles.mjs',
  '.cache/domain-native-retained-oracle.mjs', '.cache/domain-examples-next-audit.json', '.cache/domain-param-example-oracle.json',
  'src/scenes/complex.ts', 'src/scenes/domainExamples.recipes.json', 'src/scenes/domainExamples.generated.ts',
  'src/engine/document.ts', 'src/engine/client.ts', 'src/engine/generate.worker.ts', 'src/engine/temporal.ts',
  'src/engine/timeline.ts', 'src/engine/oscillation.ts', 'src/engine/complexMath.ts',
  'src/engine/domain.ts', 'src/engine/domainModel.ts', 'src/engine/domainGpu.ts', 'src/engine/domainGpuRaster.ts',
  'src/engine/domainGpuColor.ts', 'src/engine/domainExpressions.ts', 'src/engine/domainNativeArithmetic.ts',
  'src/engine/domainNativeParser.ts', 'src/engine/domainNativeConstants.ts', 'src/engine/domainNativeParameters.ts',
  'src/engine/domainSourceIteration.ts', 'src/engine/domainViewport.ts', 'src/engine/domainSourceColor.ts',
  'src/engine/domainSourcePalette.ts', 'src/engine/domainSourceGpuColor.ts', 'src/engine/domainGradient.ts', 'src/engine/palette.ts'];
const snapshot = () => Promise.all(paths.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
const audit = JSON.parse(await readFile('.cache/domain-examples-next-audit.json', 'utf8'));
const parameterOracle = JSON.parse(await readFile('.cache/domain-param-example-oracle.json', 'utf8'));
const fixtures = audit.examples.map(e => ({ number: e.number, formula: e.formula, iteration: e.iteration,
  phaseExpectation: parameterOracle.examples.find(example => example.number === e.number)?.values,
  macro: officialFormulaMacros[e.number], oracle: retainedNativeOrbitFragment({ ...officialFormulaMacros[e.number], texturePoints: true }) }));
const report = { startedAt: new Date().toISOString(), sourceStart: await snapshot(), retainedNativeShaderSha256,
  limits: [
    'Official-example orbit expected values come from retained shipped shader arithmetic and 256-loop with independently handwritten formula macros, not production lowering or its CPU reference. Original application was not run.',
    'The orbit probe intentionally uses CPU running-color selection to capture every actual GPU final value. This changes presentation only for this diagnostic; full unmodified official images are tested by the separate Generator verifier.',
    'MAS-DOM-032 analytic checks use Cartesian cubic/reciprocal and principal polar square root, plus independent HSV conversion and local pixel recipe. They cover this finite matrix, not all branch cuts, devices or palettes.',
    'Local sqrt at either signed-zero side of the cut uses the established upper-side convention. Nonzero points above/below the cut are checked separately. Native epsilon division and native general powers are not asserted to be exact analytic complex arithmetic.',
    'Full-image CPU/GPU byte thresholds, where present, are empirical acceptance criteria for these explicit 8-bit fixtures, not a universal numerical error bound.',
  ] };
let browser;
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
try {
  await server.listen(); const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage();
  await page.route(origin, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Independent Domain mathematics</title>' })); await page.goto(origin);
  const result = await page.evaluate(async fixtures => {
    const { createScene } = await import('/src/engine/document.ts');
    const { definition } = await import('/src/scenes/index.ts');
    const { sceneAtTime } = await import('/src/engine/timeline.ts');
    const { parseDomainModel, domainEvaluator } = await import('/src/engine/domainModel.ts');
    const { DomainGpu } = await import('/src/engine/domainGpu.ts');
    const { Generator } = await import('/src/engine/client.ts');
    const { analyticValue, independentAnalyticImage, winding } = await import('/scripts/verify-domain-examples-oracles.mjs');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join('');
    const compare = (actual, expected) => {
      let maxAbs = 0, maxRelative = 0, changed = 0, classificationMismatch = 0;
      for (let i = 0; i < actual.length; i++) {
        const a = actual[i], e = expected[i];
        if (!Number.isFinite(a) || !Number.isFinite(e)) { if (!(Number.isNaN(a) && Number.isNaN(e)) && a !== e) classificationMismatch++; continue; }
        const d = Math.abs(a - e); if (d) changed++; maxAbs = Math.max(maxAbs, d); maxRelative = Math.max(maxRelative, d / Math.max(1, Math.abs(a), Math.abs(e)));
      }
      return { maxAbs, maxRelative, changed, classificationMismatch };
    };
    const imageDifference = (a, b) => {
      check(a.length === b.length, 'Image size mismatch'); const histogram = new Uint32Array(256); let changed = 0, maxByte = 0, sum = 0;
      for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); histogram[d]++; if (d) changed++; maxByte = Math.max(maxByte, d); sum += d; }
      let cumulative = 0, p99 = 0; for (let i = 0; i < histogram.length; i++) { cumulative += histogram[i]; if (cumulative >= a.length * .99) { p99 = i; break; } }
      return { maxByte, changedChannels: changed, mean: sum / a.length, p99 };
    };
    const png = (pixels, width, height) => { const c = document.createElement('canvas'); c.width = width; c.height = height; c.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0); return c.toDataURL('image/png').split(',')[1]; };
    const images = [], analyticRows = [], orbitRows = [], identityRows = [], def = definition('domain');

    // A distinct analytic oracle for zeros, a pole and a principal branch.
    for (const formula of ['z^3-1', '1/z', 'sqrt(z)']) {
      const scene = createScene(def); scene.equations = { f: formula, next: '' }; scene.parameters = {}; scene.timeline.tracks = [];
      Object.assign(scene.settings, { domainIterationVersion: 'local-v1', domainViewportVersion: 'local-v1', domainColorVersion: 'local-v1',
        iterationEnabled: false, scale: 1, centerX: 0, centerY: 0, rotation: 0, curveMode: 'NONE', curveMix: 0, curveBias: 0, paletteOffset: 0,
        complexGrid: false, background: '#111317' });
      scene.palette = { name: 'Independent phase oracle', mode: 'hsv', stops: ['#ff0000', '#00ff00'], offset: 0, cycles: 1 };
      const evaluator = domainEvaluator(parseDomainModel(scene, 0));
      const values = []; let maxRelative = 0;
      const points = [[0, 0], [1, 0], [-1, 0], [-1, -0], [-1, 1e-6], [-1, -1e-6], [.2, .3], [-.7, 1.2], [2, -3], [1e-6, 0], [0, -1e-6]];
      if (formula === 'z^3-1') points.push([-.5, Math.sqrt(3) / 2], [-.5, -Math.sqrt(3) / 2]);
      for (const point of points) {
        const actual = evaluator(point), expected = analyticValue(formula, point), difference = compare(actual, expected);
        check(difference.classificationMismatch === 0 && difference.maxRelative < 2e-10, 'Analytic point mismatch ' + formula + ' ' + JSON.stringify(point));
        maxRelative = Math.max(maxRelative, difference.maxRelative); values.push({ point, actual: actual.map(v => Number.isFinite(v) ? v : String(v)), expected: expected.map(v => Number.isFinite(v) ? v : String(v)), difference });
      }
      const topology = [];
      if (formula === 'z^3-1') for (const center of [[1, 0], [-.5, Math.sqrt(3) / 2], [-.5, -Math.sqrt(3) / 2]]) {
        const loop = Array.from({ length: 96 }, (_, i) => evaluator([center[0] + .01 * Math.cos(i * 2 * Math.PI / 96), center[1] + .01 * Math.sin(i * 2 * Math.PI / 96)]));
        const phaseWinding = winding(loop); check(Math.abs(phaseWinding - 1) < 1e-12, 'Cubic zero winding');
        check(Math.hypot(...evaluator(center)) < 2e-15, 'Cubic root not zero'); topology.push({ center, samples: 96, phaseWinding });
      }
      if (formula === '1/z') for (const radius of [.5, .05, .005]) {
        const loop = Array.from({ length: 96 }, (_, i) => evaluator([radius * Math.cos(i * 2 * Math.PI / 96), radius * Math.sin(i * 2 * Math.PI / 96)]));
        const phaseWinding = winding(loop), magnitudeError = Math.max(...loop.map(v => Math.abs(Math.hypot(...v) * radius - 1)));
        check(Math.abs(phaseWinding + 1) < 1e-12 && magnitudeError < 1e-14, 'Reciprocal pole structure'); topology.push({ radius, samples: 96, phaseWinding, magnitudeError });
      }
      if (formula === 'sqrt(z)') {
        const upper = evaluator([-1, 1e-6]), lower = evaluator([-1, -1e-6]);
        check(upper[0] >= 0 && lower[0] >= 0 && upper[1] > 0 && lower[1] < 0 && Math.abs(upper[1] + lower[1]) < 1e-14, 'Square-root principal cut');
        topology.push({ upper, lower, phaseJump: Math.atan2(upper[1], upper[0]) - Math.atan2(lower[1], lower[0]) });
      }
      const imageRows = [];
      for (const ss of [1, 3]) {
        scene.settings.supersampling = ss; const expected = independentAnalyticImage(formula, 129, 97, 1, ss);
        images.push({ name: formula.replace(/\W/g, '_') + '-ss' + ss + '-independent.png', png: png(expected.pixels, 129, 97) });
        for (const backend of ['cpu', 'gpu']) {
          const g = new Generator(); try {
            const out = await g.generate({ ...scene, settings: { ...scene.settings, domainBackend: backend } }, { width: 129, height: 97, time: 0, quality: 'export' });
            check(out.type === 'raster' && out.width === 129 && out.height === 97, 'Analytic full image missing');
            const difference = imageDifference(out.pixels, expected.pixels);
            check(difference.maxByte <= (backend === 'cpu' ? 1 : 2), 'Independent analytic image mismatch ' + formula + ' ' + backend + ' ' + JSON.stringify(difference));
            check(out.stats.invalid === expected.invalidPixels, 'Analytic invalid-pixel classification changed');
            images.push({ name: formula.replace(/\W/g, '_') + '-ss' + ss + '-' + backend + '.png', png: png(out.pixels, 129, 97) });
            imageRows.push({ ss, requestedBackend: backend, actualBackend: out.backend, difference, actualHash: await hash(out.pixels), expectedHash: await hash(expected.pixels), stats: out.stats, warnings: out.warnings });
          } finally { g.dispose(); }
        }
      }
      analyticRows.push({ formula, pointCount: points.length, maxRelative, values, topology, images: imageRows });
    }

    const gl = new OffscreenCanvas(1, 1).getContext('webgl2'); check(gl && gl.getExtension('EXT_color_buffer_float'), 'Independent oracle WebGL2 float target unavailable');
    let cleanupChecks = 0;
    const oracle = (source, points, facts) => {
      const count = points.length / 2, width = Math.min(count, 512), height = Math.ceil(count / width), handles = { shaders: [], textures: [] };
      try {
        const program = gl.createProgram(); handles.program = program;
        for (const [type, code] of [[gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}'], [gl.FRAGMENT_SHADER, source]]) {
          const shader = gl.createShader(type); handles.shaders.push(shader); gl.shaderSource(shader, code); gl.compileShader(shader); check(gl.getShaderParameter(shader, gl.COMPILE_STATUS), gl.getShaderInfoLog(shader)); gl.attachShader(program, shader);
        }
        gl.linkProgram(program); check(gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program)); gl.useProgram(program);
        const texture = data => { const t = gl.createTexture(); handles.textures.push(t); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data); return t; };
        const input = new Float32Array(width * height * 4); for (let i = 0; i < count; i++) { input[i * 4] = points[i * 2]; input[i * 4 + 1] = points[i * 2 + 1]; }
        gl.activeTexture(gl.TEXTURE0); const inputTexture = texture(input), outputTexture = texture(null); gl.bindTexture(gl.TEXTURE_2D, inputTexture);
        const loc = name => gl.getUniformLocation(program, name);
        gl.uniform1i(loc('peerPoints'), 0); gl.uniform1i(loc('u_iter_steps'), facts.steps); gl.uniform1i(loc('u_iter_seed_mode'), facts.seed === 'PIXEL_Z' ? 0 : facts.seed === 'ZERO' ? 1 : 2); gl.uniform1f(loc('u_iter_escape_radius'), facts.bailout); gl.uniform2f(loc('u_constant'), ...facts.constant);
        for (const [name, value] of Object.entries(facts.uniforms ?? {})) gl.uniform1f(loc(name), value);
        const framebuffer = gl.createFramebuffer(); handles.framebuffer = framebuffer; gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0); check(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, 'Oracle framebuffer incomplete');
        handles.vao = gl.createVertexArray(); gl.bindVertexArray(handles.vao); gl.disable(gl.BLEND); gl.disable(gl.DITHER); gl.viewport(0, 0, width, height); gl.drawArrays(gl.TRIANGLES, 0, 3);
        const packed = new Float32Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, packed); check(gl.getError() === 0, 'Oracle GL error');
        const values = new Float32Array(count * 2); for (let i = 0; i < count; i++) { values[2 * i] = packed[4 * i]; values[2 * i + 1] = packed[4 * i + 1]; } return values;
      } finally {
        gl.useProgram(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null); gl.bindTexture(gl.TEXTURE_2D, null);
        for (const t of handles.textures) gl.deleteTexture(t);
        for (const s of handles.shaders) { if (handles.program) gl.detachShader(handles.program, s); gl.deleteShader(s); }
        gl.deleteProgram(handles.program); gl.deleteFramebuffer(handles.framebuffer); gl.deleteVertexArray(handles.vao);
        check(handles.textures.every(t => !gl.isTexture(t)) && !gl.isProgram(handles.program) && !gl.isFramebuffer(handles.framebuffer) && !gl.isVertexArray(handles.vao) && handles.shaders.every(s => !gl.isShader(s)), 'Oracle object cleanup failed'); cleanupChecks++;
      }
    };
    try {
      for (const fixture of fixtures) {
        const preset = def.presets.find(p => p.id === 'guide-domain-' + fixture.number); check(preset, 'Official API missing');
        const authored = createScene(def, preset);
        check(authored.equations.f.replace(/\s/g, '') === fixture.formula.replace(/\s/g, ''), 'Independent macro does not match source recipe');
        for (const time of fixture.number === 3 || fixture.number === 4 ? [0, 5, 10, 20] : [0]) {
          const evaluated = sceneAtTime(authored, time);
          // Presentation override only, to inspect every raw native result.
          const captureScene = { ...evaluated, settings: { ...evaluated.settings, domainColorVersion: 'mathart-1.7.8-cpu', domainBackend: 'gpu' }, evaluatedDomainGradient: { running: true, interpolation: 'oklch' } };
          const model = parseDomainModel(captureScene, time); check(model.execution.arithmetic === 'native-gpu', 'Official input must actually execute native GPU for orbit oracle');
          const width = 31, height = 23, count = width * height * model.supersampling ** 2;
          const points = new Float32Array(count * 2), values = new Float32Array(count * 2), gpu = new DomainGpu();
          let callbacks = 0;
          try {
            const facts = gpu.render(model, width, height, new Uint8ClampedArray(width * height * 4), (index, captured) => {
              check(captured?.kind === 'native-gpu-result', 'Native terminal value not captured'); callbacks++;
              const length = model.supersampling ** 2 * 2;
              points.set(captured.values.subarray(captured.offset, captured.offset + length), index * length);
              values.set(captured.finalValues.subarray(captured.valueOffset, captured.valueOffset + length), index * length); return model.supersampling ** 2;
            });
            const sourceFacts = { steps: fixture.iteration?.steps ?? 1, seed: fixture.iteration?.seedMode ?? 'PIXEL_Z', bailout: fixture.iteration?.escapeRadius ?? 1e6,
              // Only #5 mentions c. Its raw main z preserves formulaParams a/b;
              // other examples keep the fresh GPU u_constant at zero.
              constant: fixture.number === 5 ? [1, 0] : [0, 0],
              uniforms: { peer_t: fixture.number === 3 ? fixture.phaseExpectation[String(time)] : 0,
                peer_a: fixture.number === 4 ? fixture.phaseExpectation[String(time)] : 0 } };
            check(model.constant.every((value, index) => Object.is(value, sourceFacts.constant[index])), 'Native constant upload disagrees with independent source facts');
            if (fixture.number === 5) check(authored.settings.constantReal === 1 && authored.settings.constantImag === 0, 'Imported source formulaParams a/b changed');
            if (fixture.phaseExpectation) check(Math.abs(evaluated.parameters[fixture.number === 3 ? 't' : 'a'] - fixture.phaseExpectation[String(time)]) < 1e-12, 'Source parameter phase differs from independent fixed-clock oracle');
            check(model.steps === sourceFacts.steps && model.seed === sourceFacts.seed, 'Official iteration differs from retained guide');
            const expected = oracle(fixture.oracle, points, sourceFacts), difference = compare(values, expected);
            check(difference.classificationMismatch === 0 && difference.changed === 0, 'Official retained-shader orbit mismatch #' + fixture.number + ' ' + JSON.stringify(difference));
            check(callbacks === width * height && facts.valueCaptureSamples >= count && facts.colorFallbackReason, 'Full official terminal capture not exercised');
            orbitRows.push({ example: fixture.number, time, sourceFacts, samples: count, callbacks, difference, actualValueHash: await hash(values), expectedValueHash: await hash(expected), facts });
          } finally { gpu.dispose(); }
        }
      }
      // Source identity means the seed itself, not an initial f(z) evaluation.
      for (const seed of ['PIXEL_Z', 'ZERO', 'CONSTANT_C']) for (const enabled of [false, true]) {
        const s = createScene(def); s.equations = { f: '2*z+1', next: 'w' }; s.parameters = {}; s.timeline.tracks = [];
        Object.assign(s.settings, { domainIterationVersion: 'mathart-1.7.8-gpu', iterationEnabled: enabled, iterationSteps: 8, iterationMaxSteps: 64, seedMode: seed, constantReal: 9, constantImag: 3 });
        const model = parseDomainModel(s, 0), gpu = new DomainGpu(), points = new Float32Array([2, 3, -.5, .25]);
        try {
          const actual = gpu.sample(model, points).values, expected = new Float32Array(points.length);
          for (let i = 0; i < points.length; i += 2) { const start = seed === 'PIXEL_Z' ? [points[i], points[i + 1]] : [0, 0]; expected[i] = enabled ? start[0] : 2 * start[0] + 1; expected[i + 1] = enabled ? start[1] : 2 * start[1]; }
          const difference = compare(actual, expected); check(!difference.changed && !difference.classificationMismatch, 'Identity seed contract');
          identityRows.push({ seed, enabled, actual: [...actual], expected: [...expected], sourceConstantUpload: model.sourceConstantUpload });
        } finally { gpu.dispose(); }
      }
    } finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
    return { analyticRows, orbitRows, identityRows, cleanupChecks, images };
  }, fixtures);
  await mkdir(imageDirectory, { recursive: true });
  report.images = [];
  for (const entry of result.images) { const path = imageDirectory + '/' + entry.name, data = Buffer.from(entry.png, 'base64'); await writeFile(path, data); report.images.push({ path, sha256: createHash('sha256').update(data).digest('hex') }); }
  delete result.images; report.result = result; report.browser = browser.version();
} catch (error) { report.error = String(error.stack ?? error); }
finally { await browser?.close(); await server.close(); }
report.sourceEnd = await snapshot(); report.sourceStable = JSON.stringify(report.sourceStart) === JSON.stringify(report.sourceEnd);
report.finishedAt = new Date().toISOString(); report.status = !report.error && report.sourceStable ? 'passed' : 'failed';
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, error: report.error, analytic: report.result?.analyticRows.length, orbits: report.result?.orbitRows.length, identities: report.result?.identityRows.length, output }));
if (report.status !== 'passed') process.exitCode = 1;
