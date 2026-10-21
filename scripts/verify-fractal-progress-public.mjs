// Real App controls/presentation/export. Local workflow consistency, not native MathArt parity.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { createServer as tcp } from 'node:net';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { createExportServer } from '../server/index.mjs';
import { configureDesktopGraphics } from '../desktop/graphics.mjs';

const sourceGpu = process.argv.includes('--source-gpu');
const directory = process.argv.slice(2).filter(value => value !== '--source-gpu')[0] ?? '.cache/fractal-progress-public';
const graphics = new Map();
configureDesktopGraphics({ getSwitchValue: name => graphics.get(name) ?? '', appendSwitch: (name, value) => graphics.set(name, value) });
const check = (value, message) => { if (!value) throw Error(message); };
const sha = value => createHash('sha256').update(value).digest('hex');
await mkdir(directory, { recursive: true });
const hashes = async () => {
  const files = (await Promise.all(['src', 'server'].map(async root =>
    (await readdir(root, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => `${e.parentPath}/${e.name}`)))).flat();
  files.push('scripts/verify-fractal-progress-public.mjs', 'desktop/graphics.mjs');
  return Object.fromEntries(await Promise.all(files.sort().map(async file => [file, sha(await readFile(file))])));
};
const report = { status: 'running', sourceGpu, graphicsPolicy: Object.fromEntries(graphics), sourceBefore: await hashes(), cases: {}, errors: [], limits: [
  'Actual App controls and connected ArtRenderer canvas are observed; no native JVM/JOGL or original-window parity claim.',
  'Natural Multi Pass delivery is not delayed. Canvas capture/RAF observation adds instrumentation overhead, so elapsed time is not a performance benchmark.',
  'Cancellation/replacement inject delayed delivery of real computed Worker progress/final messages; no fabricated pixels or modified production module.',
  'PNG expected is a fresh production One Pass generation and renderer, independent of the actual export request. This verifies local integration, not independent original mathematics.',
  'Wall time only. CPU time, peak process-family memory, GPU memory and task token cost unmeasured.',
] };
let browser, page, vite, service;
const started = performance.now();
try {
  const port = await new Promise((resolve, reject) => {
    const server = tcp(); server.once('error', reject); server.listen(0, '127.0.0.1', () => {
      const port = server.address().port; server.close(error => error ? reject(error) : resolve(port));
    });
  });
  service = await createExportServer({ root: directory + '/exports', allowedOrigins: [`http://127.0.0.1:${port}`] });
  const address = await service.listen(0);
  vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false,
    proxy: { '/api': `http://127.0.0.1:${address.port}` } }, logLevel: 'error' });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...graphics].map(([name, value]) => `--${name}=${value}`) });
  report.browserVersion = browser.version();
  page = await browser.newPage({ viewport: { width: 1360, height: 920 }, acceptDownloads: true });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(() => {
    const audit = window.__fractalPublic = { requests: [], messages: [], renders: [], frames: [], held: [], workers: 0,
      outputIds: new WeakMap(), captured: new Map(), capture: false, gate: false, release() { const held = this.held.splice(0); this.gate = false; held.forEach(item => item.deliver()); return held.length; } };
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args) { super(...args); this.auditId = ++audit.workers; }
      set onmessage(handler) {
        super.onmessage = event => {
          const data = event.data, key = `${this.auditId}:${data.id}`;
          if (data.output) {
            const fact = { key, operation: data.operation, width: data.output.width, height: data.output.height, backend: data.output.backend,
              warnings: data.output.warnings, receivedAt: performance.now() };
            audit.outputIds.set(data.output, fact); audit.messages.push(fact);
            if (data.operation === 'generate') audit.latestOutput = data.output;
            if (audit.gate && (data.operation === 'generate-progress' || data.operation === 'generate')) {
              if (!audit.gateKey) audit.gateKey = key;
              if (audit.gateKey === key && ++audit.gatedMessages > 1) {
                audit.held.push({ key, operation: data.operation, deliver: () => handler.call(this, event) }); return;
              }
            }
          }
          handler.call(this, event);
        };
      }
      postMessage(message, ...args) {
        if (message.operation === 'generate') audit.requests.push({ ...structuredClone(message), key: `${this.auditId}:${message.id}` });
        return super.postMessage(message, ...args);
      }
      terminate() { audit.terminated = (audit.terminated ?? 0) + 1; return super.terminate(); }
    };
  });
  // Execute before React mounts; wrap the real renderer without replacing its result.
  await page.route('**/src/main.tsx', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `
const {ArtRenderer:AuditRenderer}=await import('/src/engine/renderer.ts');
const auditSetOutput=AuditRenderer.prototype.setOutput;
AuditRenderer.prototype.setOutput=function(output,scene,...args){
 const value=auditSetOutput.call(this,output,scene,...args),canvas=this.renderer.domElement,audit=window.__fractalPublic;
 if(canvas.isConnected&&canvas.matches('[data-testid="art-canvas"]')&&output.type==='raster'){
  const meta=audit.outputIds.get(output),row={...meta,index:audit.renders.length,sceneId:scene.id,sceneName:scene.name,method:scene.settings.renderMethod,width:output.width,height:output.height,at:performance.now()};
  audit.renders.push(row);audit.current={row,canvas,renderer:this};
  if(audit.capture)audit.captured.set(row.index,{output:structuredClone(output),scene:structuredClone(scene),optics:structuredClone(args[1])});
 }return value;
};
let auditLast=-1;
function auditFrame(time){const current=window.__fractalPublic.current;if(current&&current.row.index!==auditLast){auditLast=current.row.index;window.__fractalPublic.frames.push({...current.row,frameAt:time,observedAt:performance.now(),canvasWidth:current.canvas.width,canvasHeight:current.canvas.height,logicalSize:[...current.renderer.size],pixelRatio:current.renderer.renderer.getPixelRatio(),png:current.canvas.toDataURL('image/png')});}requestAnimationFrame(auditFrame);}requestAnimationFrame(auditFrame);
` + await response.text() });
  });
  const origin = vite.resolvedUrls.local[0];
  await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto(origin + 'fixture');
  const initial = await page.evaluate(async sourceGpu => {
    const { createScene, saveWorkspace } = await import('/src/engine/document.ts');
    const { definition } = await import('/src/scenes/index.ts');
    const scene = createScene(definition('fractal'));
    scene.name = 'Fractal progressive public';
    Object.assign(scene.settings, { fractalBackend: 'cpu', renderMethod: 'one-pass', iterations: 900,
      centerX: -.65, centerY: 0, zoom: 1, transparentBackground: false });
    if (sourceGpu) {
      const { createDefaultFractalSourceColorConfiguration } = await import('/src/engine/fractalSourceColor.ts');
      Object.assign(scene.settings, { formula: 'newton', power: 3, powerImag: 0, startReal: 1, startImag: 0,
        tolerance: .001, fractalBackend: 'webgl2', perturbationPrecision: 'medium',
        fractalNumericProfile: 'mathart-1.7.8-newton-nova-v1', fractalColorProfile: 'mathart-1.7.8-v1' });
      scene.fractalSourceColor = createDefaultFractalSourceColorConfiguration();
    }
    scene.projectResolution = { width: 640, height: 480 };
    if (scene.formulas) { scene.formulas.main.visible = false; scene.formulas.additional = []; }
    saveWorkspace(localStorage, { scenes: [scene], active: scene.id, theme: 'dark', language: 'en', render: { quality: 'low', frameRate: 30 } });
    return scene;
  }, sourceGpu);
  await page.goto(origin);
  const ready = async method => {
    await page.waitForFunction(method => {
      const a = window.__fractalPublic, request = a.requests.filter(r => r.context.quality !== 'export').at(-1);
      return request && (!method || request.scene.settings.renderMethod === method) && a.renders.some(row => row.key === request.key && row.operation === 'generate') &&
        !document.querySelector('.rendering-badge') && !document.querySelector('.error-card');
    }, method, { timeout: 60000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const methodControl = () => page.getByRole('combobox', { name: 'Rendering method', exact: true });
  const request = () => page.evaluate(() => window.__fractalPublic.requests.filter(r => r.context.quality !== 'export').at(-1));
  const arm = () => page.evaluate(() => { const a = window.__fractalPublic; a.gate = true; a.gateKey = undefined; a.gatedMessages = 0; });
  await ready('one-pass');
  await page.evaluate(() => { window.__fractalPublic.capture = true; });
  await methodControl().selectOption('multi-pass');
  await ready('multi-pass');
  const progressive = await page.evaluate(async () => {
    const { ArtRenderer } = await import('/src/engine/renderer.ts');
    const a = window.__fractalPublic, req = a.requests.filter(r => r.context.quality !== 'export').at(-1);
    a.capture = false;
    const frames = a.frames.filter(row => row.key === req.key);
    for (const frame of frames) {
      const item = a.captured.get(frame.index), renderer = new ArtRenderer(document.createElement('canvas'));
      if (!item) throw Error('Missing actual output associated with presented canvas');
      try { renderer.setSize(...frame.logicalSize, frame.pixelRatio); renderer.setOutput(item.output, item.scene, true, item.optics); frame.expectedPng = renderer.renderer.domElement.toDataURL('image/png'); }
      finally { renderer.dispose(); }
    }
    a.captured.clear();
    return { request: req, messages: a.messages.filter(row => row.key === req.key), renders: a.renders.filter(row => row.key === req.key), frames };
  });
  const last = progressive.renders.at(-1), expected = [8, 4, 2].map(divisor => [Math.ceil(last.width / divisor), Math.ceil(last.height / divisor)]);
  check(progressive.messages.every(row => row.backend === (sourceGpu ? 'webgl2' : 'cpu')), 'Requested rendering path was not exercised');
  check(JSON.stringify(progressive.renders.map(row => [row.width, row.height])) === JSON.stringify([...expected, [last.width, last.height]]), 'Canvas passes missing, repeated or out of order');
  check(progressive.renders.slice(0, 3).every(row => row.operation === 'generate-progress') && last.operation === 'generate', 'Unexpected pass operations');
  check(progressive.frames.every((row, index, frames) => !index || row.index > frames[index - 1].index), 'Presented frame order reversed');
  check(progressive.frames.some(row => row.operation === 'generate-progress'), 'No intermediate canvas survived to an animation frame');
  for (const [index, frame] of progressive.frames.entries()) {
    const bytes = Buffer.from(frame.png.split(',')[1], 'base64');
    const expectedPng = Buffer.from(frame.expectedPng.split(',')[1], 'base64');
    await writeFile(`${directory}/multi-pass-${index}.png`, bytes); await writeFile(`${directory}/multi-pass-${index}-expected.png`, expectedPng);
    const actual = decodePng(bytes), expectedFrame = decodePng(expectedPng);
    check(actual.width === expectedFrame.width && actual.height === expectedFrame.height && actual.rgba.equals(expectedFrame.rgba), 'Canvas pixels do not match the output presented at this pass');
    frame.colors = colorCount(actual.rgba); check(frame.colors > 1, 'Progressive canvas is blank or single-color');
    frame.rgbaSha256 = sha(actual.rgba); frame.matchesOutput = true; delete frame.png; delete frame.expectedPng;
    frame.path = `${directory}/multi-pass-${index}.png`; frame.sha256 = sha(bytes); await writeFile(frame.path, bytes);
  }
  check(new Set(progressive.frames.map(frame => frame.rgbaSha256)).size > 1, 'Progressive canvas content never changes');
  report.cases.multiPass = progressive;
  await methodControl().selectOption('one-pass'); await ready('one-pass');
  await arm(); await methodControl().selectOption('multi-pass');
  await page.waitForFunction(() => window.__fractalPublic.held.some(item => item.operation === 'generate'));
  await page.getByRole('button', { name: 'Cancel calculation', exact: true }).click();
  const cancelBefore = await page.evaluate(() => ({ renders: window.__fractalPublic.renders.length, key: window.__fractalPublic.current.row.key, terminated: window.__fractalPublic.terminated }));
  const released = await page.evaluate(() => window.__fractalPublic.release());
  await page.waitForTimeout(200);
  const cancelAfter = await page.evaluate(() => ({ renders: window.__fractalPublic.renders.length, key: window.__fractalPublic.current.row.key, badge: document.querySelector('.rendering-badge')?.textContent }));
  check(released >= 3 && cancelAfter.renders === cancelBefore.renders && cancelAfter.key === cancelBefore.key, 'Late canceled progress/completion replaced canvas');
  await page.getByRole('button', { name: 'Calculate again', exact: true }).click(); await ready('multi-pass');
  report.cases.cancel = { before: cancelBefore, after: cancelAfter, released, recalculated: true };
  await methodControl().selectOption('one-pass'); await ready('one-pass');
  await arm(); await methodControl().selectOption('multi-pass');
  await page.waitForFunction(() => window.__fractalPublic.held.some(item => item.operation === 'generate'));
  const replacement = structuredClone(initial); replacement.id = 'fractal-public-replacement'; replacement.name = 'Replacement fractal';
  Object.assign(replacement.settings, { renderMethod: 'one-pass', centerX: -.3, iterations: 100 });
  await page.locator('input[type=file]').setInputFiles({ name: 'replacement.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) });
  await ready('one-pass');
  const replacementBefore = await page.evaluate(() => ({ renders: window.__fractalPublic.renders.length, sceneId: window.__fractalPublic.current.row.sceneId }));
  const replacementReleased = await page.evaluate(() => window.__fractalPublic.release()); await page.waitForTimeout(200);
  const replacementAfter = await page.evaluate(() => ({ renders: window.__fractalPublic.renders.length, sceneId: window.__fractalPublic.current.row.sceneId }));
  check(replacementReleased >= 3 && replacementBefore.sceneId === replacement.id && JSON.stringify(replacementBefore) === JSON.stringify(replacementAfter), 'Late old-scene progress/completion replaced new scene');
  report.cases.replacement = { before: replacementBefore, after: replacementAfter, released: replacementReleased };
  await methodControl().selectOption('guessing'); await ready('guessing');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload(); await ready('guessing');
  const saved = await request();
  check(saved.scene.settings.renderMethod === 'guessing', 'Guessing lost on reopen');
  const preview = await page.evaluate(async saved => {
    const output = structuredClone(window.__fractalPublic.latestOutput);
    const { Generator } = await import('/src/engine/client.ts'); const generator = new Generator();
    try {
      const scene = structuredClone(saved.scene); scene.settings.renderMethod = 'one-pass';
      const exact = await generator.generate(scene, saved.context);
      if (output.width !== exact.width || output.height !== exact.height) throw Error('Preview comparison dimensions differ');
      let changedChannels = 0; for (let i = 0; i < output.pixels.length; i++) changedChannels += output.pixels[i] !== exact.pixels[i] ? 1 : 0;
      return { width: output.width, height: output.height, backend: output.backend, warnings: output.warnings, stats: output.stats, onePassStats: exact.stats, changedChannels };
    } finally { generator.dispose(); }
  }, saved);
  const prediction = preview.warnings?.join('\n').match(/Guessing 独立块预测：(\d+) 个像素/);
  check(prediction && Number(prediction[1]) > 0 && preview.changedChannels > 0, 'Guessing preview lacks a distinguishable predicted-pixel witness');
  check(preview.backend === (sourceGpu ? 'webgl2' : 'cpu'), 'Guessing preview used wrong backend');
  preview.predictedPixels = Number(prediction[1]);
  const projectPending = page.waitForEvent('download'); await page.getByTitle('Export project JSON', { exact: true }).click();
  const projectPath = directory + '/guessing-project.json'; await (await projectPending).saveAs(projectPath);
  const project = JSON.parse(await readFile(projectPath)); check(project.settings.renderMethod === 'guessing', 'Saved project lost method');
  await page.getByRole('button', { name: 'Export artwork', exact: true }).click();
  await page.getByRole('button', { name: 'Still image', exact: true }).click();
  await page.getByRole('combobox', { name: 'Export resolution', exact: true }).selectOption('custom');
  await page.getByRole('spinbutton', { name: 'Export width', exact: true }).fill('257');
  await page.getByRole('spinbutton', { name: 'Export height', exact: true }).fill('193');
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Start export', exact: true }).click();
  const pngPath = directory + '/guessing-export.png'; await (await pending).saveAs(pngPath);
  const actualExport = await page.evaluate(() => window.__fractalPublic.requests.filter(row => row.context.quality === 'export').at(-1));
  check(actualExport.scene.settings.renderMethod === 'guessing', 'Export did not start from the saved Guessing scene');
  const exported = decodePng(await readFile(pngPath));
  const expectedPixels = await page.evaluate(async scene => {
    const { Generator } = await import('/src/engine/client.ts'); const { ArtRenderer } = await import('/src/engine/renderer.ts');
    const generator = new Generator(), renderer = new ArtRenderer(document.createElement('canvas'));
    try {
      scene.settings.renderMethod = 'one-pass';
      const output = await generator.generate(scene, { time: 0, width: 257, height: 193, quality: 'export', fractalViewport: { logicalWidth: 257, logicalHeight: 193, target: 'offscreen' } });
      renderer.setSize(257, 193, 1); renderer.setOutput(output, scene, true); renderer.render();
      const gl = renderer.renderer.getContext(), raw = new Uint8Array(257 * 193 * 4), top = new Uint8Array(raw.length);
      gl.readPixels(0, 0, 257, 193, gl.RGBA, gl.UNSIGNED_BYTE, raw); if (gl.getError()) throw Error('Expected canvas readback failed');
      for (let y = 0; y < 193; y++) top.set(raw.subarray((192 - y) * 257 * 4, (193 - y) * 257 * 4), y * 257 * 4);
      return Array.from(top);
    } finally { generator.dispose(); renderer.dispose(); }
  }, saved.scene);
  const expectedBytes = Buffer.from(expectedPixels);
  check(colorCount(exported.rgba) > 1, 'Exported image is blank or single-color');
  check(exported.width === 257 && exported.height === 193 && exported.rgba.equals(expectedBytes), 'Guessing PNG differs from actual One Pass render');
  report.cases.guessing = { preview, savedAndReopened: true, projectPath, pngPath, actualExport, width: 257, height: 193, exactRgba: true,
    rgbaSha256: sha(exported.rgba), pngSha256: sha(await readFile(pngPath)) };
  check(report.errors.length === 0, 'App page errors'); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1;
  if (page) await writeFile(directory + '/failure-dom.txt', await page.locator('body').innerText().catch(() => 'unavailable'));
} finally {
  report.cleanup = (await Promise.allSettled([browser?.close(), vite?.close(), service?.close()])).map((result, index) => ({ resource: ['browser', 'vite', 'export-service'][index], status: result.status, ...(result.status === 'rejected' ? { error: String(result.reason) } : {}) }));
  report.sourceAfter = await hashes(); report.sourceStable = JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
  if (!report.sourceStable || report.cleanup.some(item => item.status !== 'fulfilled')) { report.status = 'failed'; process.exitCode = 1; }
  report.elapsedMs = performance.now() - started;
  await writeFile(directory + '/report.json', JSON.stringify(report, null, 2));
  await writeFile(directory + '/report.md', `# Fractal 实际界面验证\n\n${report.status}；${(report.elapsedMs / 1000).toFixed(2)} 秒；源码稳定 ${report.sourceStable}。\n\n已完成：${Object.keys(report.cases).join('、')}。\n\n${report.error ?? ''}\n\n${report.limits.map(value => '- ' + value).join('\n')}\n`);
  console.log(JSON.stringify({ status: report.status, directory, cases: Object.keys(report.cases), elapsedMs: report.elapsedMs, error: report.error }));
}

// PNG decoder follows below: validates CRCs and reads raw RGBA without canvas premultiplication.
function decodePng(bytes){
 check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'not a PNG');
 let width=0,height=0,ended=false;const compressed=[];
 for(let at=8;at<bytes.length;){
  check(at+12<=bytes.length,'truncated PNG chunk');const length=bytes.readUInt32BE(at),end=at+length+12;
  check(end<=bytes.length,'truncated PNG payload');const type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,end-4);
  let crc=-1;for(const value of bytes.subarray(at+4,end-4)){crc^=value;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
  check(((crc^-1)>>>0)===bytes.readUInt32BE(end-4),'PNG CRC mismatch');
  if(type==='IHDR'){check(length===13&&!width,'invalid PNG header');width=data.readUInt32BE(0);height=data.readUInt32BE(4);check(data.subarray(8).equals(Buffer.from([8,6,0,0,0])),'expected non-interlaced RGBA8 PNG');}
  else if(type==='IDAT')compressed.push(data);
  else if(type==='IEND'){check(length===0&&end===bytes.length,'invalid PNG end');ended=true;}
  at=end;
 }
 check(width>0&&height>0&&ended&&compressed.length,'incomplete PNG');const stride=width*4,raw=inflateSync(Buffer.concat(compressed));check(raw.length===(stride+1)*height,'invalid PNG row length');const rgba=Buffer.alloc(stride*height);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];check(filter<=4,'invalid PNG row filter');for(let x=0;x<stride;x++){const a=x>=4?rgba[y*stride+x-4]:0,b=y?rgba[(y-1)*stride+x]:0,c=y&&x>=4?rgba[(y-1)*stride+x-4]:0;rgba[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 return{width,height,rgba};
}

function colorCount(rgba) { const colors = new Set(); for (let i = 0; i < rgba.length; i += 4) colors.add(rgba.readUInt32BE(i)); return colors.size; }
