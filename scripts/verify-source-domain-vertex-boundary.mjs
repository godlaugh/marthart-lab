/** Replays recorded draw coordinates only; no original app, fragment, or product rendering. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/source-domain-draw-boundary/native.json', import.meta.url), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const attribute of fixture.attributes) {
  const bytes = Buffer.alloc(attribute.littleEndianFloat32Values.length * 4);
  attribute.littleEndianFloat32Values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  if (digest(bytes) !== attribute.rawSha256) throw new Error(`Recorded ${attribute.name} bytes changed`);
}
const indexBytes = Buffer.alloc(fixture.draw.indices.length * 2);
fixture.draw.indices.forEach((value, index) => indexBytes.writeUInt16LE(value, index * 2));
if (digest(indexBytes) !== fixture.draw.indexBytesSha256 || digest(fixture.vertexShader.source) !== fixture.vertexShader.sha256) {
  throw new Error('Recorded indices or original vertex shader changed');
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const report = await page.evaluate((fixture) => {
    const [width, height] = fixture.scope.pixels;
    const header = '#version 300 es\nprecision highp float;precision highp int;\n';
    // Original observed coordinate expressions, isolated from the unavailable native fragment execution.
    const fragment = `${header}
      in vec2 vUv;out vec4 result;
      uniform vec2 u_resolution,u_center;uniform float u_scale,u_rotation;
      void main(){vec2 plane=vUv*2.0-1.0;plane.x*=u_resolution.x/max(u_resolution.y,1.0);
        float c=cos(u_rotation),s=sin(u_rotation);
        vec2 rotated=vec2(plane.x*c-plane.y*s,plane.x*s+plane.y*c);
        result=vec4(vUv,u_center+rotated*u_scale);}`;
    const points = 'vec2 p[6]=vec2[6](vec2(-125.,-150.),vec2(125.,-150.),vec2(125.,150.),vec2(125.,150.),vec2(-125.,150.),vec2(-125.,-150.));';
    const explicit = 'vec2 uv[6]=vec2[6](vec2(0.,0.),vec2(1.,0.),vec2(1.,1.),vec2(1.,1.),vec2(0.,1.),vec2(0.,0.));vUv=uv[gl_VertexID];';
    const vertices = {
      captured: fixture.vertexShader.source.replace('#version 150', header.trimEnd()),
      clip: `${header}out vec2 vUv;void main(){const vec2 p[6]=vec2[6](vec2(-1.,1.),vec2(1.,1.),vec2(1.,-1.),vec2(1.,-1.),vec2(-1.,-1.),vec2(-1.,1.));vec2 q=p[gl_VertexID];vUv=vec2((q.x+1.)*.5,(1.-q.y)*.5);gl_Position=vec4(q,0.,1.);}`,
      generatedUv: `${header}uniform mat4 transform;out vec2 vUv;void main(){${points}vec2 q=p[gl_VertexID];vUv=q/vec2(250.,300.)+vec2(.5);gl_Position=transform*vec4(q,0.,1.);}`,
      explicitUv: `${header}uniform mat4 transform;out vec2 vUv;void main(){${points}${explicit}gl_Position=transform*vec4(p[gl_VertexID],0.,1.);}`,
    };
    const results = {};
    let device;
    for (const [name, vertex] of Object.entries(vertices)) {
      const gl = new OffscreenCanvas(width, height).getContext('webgl2', { antialias: false, premultipliedAlpha: false });
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 float framebuffer unavailable');
      const shaders = [], buffers = [];
      const program = gl.createProgram(), vao = gl.createVertexArray(), texture = gl.createTexture(), fbo = gl.createFramebuffer();
      try {
        for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
          const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        gl.useProgram(program); gl.bindVertexArray(vao);
        if (name === 'captured') {
          for (const attribute of fixture.attributes) {
            const buffer = gl.createBuffer(); buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(attribute.littleEndianFloat32Values), gl.STATIC_DRAW);
            const location = gl.getAttribLocation(program, attribute.name); if (location < 0) throw new Error(`Missing ${attribute.name}`);
            gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, attribute.size, attribute.type, attribute.normalized, attribute.stride, 0);
          }
          const buffer = gl.createBuffer(); buffers.push(buffer); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(fixture.draw.indices), gl.STATIC_DRAW);
        }
        for (const uniform of fixture.uniforms) {
          const location = gl.getUniformLocation(program, uniform.name), values = uniform.values[0];
          if (location === null) continue;
          if (uniform.type === gl.FLOAT) gl.uniform1f(location, values[0]);
          else if (uniform.type === gl.FLOAT_VEC2) gl.uniform2fv(location, values);
          else if (uniform.type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(location, false, values);
          else throw new Error(`Unsupported recorded uniform type ${uniform.type}`);
        }
        gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Float framebuffer incomplete');
        for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.DITHER, gl.CULL_FACE]) gl.disable(cap);
        gl.viewport(...fixture.draw.viewport);
        if (name === 'captured') gl.drawElements(fixture.draw.mode, fixture.draw.count, fixture.draw.indexType, 0);
        else gl.drawArrays(gl.TRIANGLES, 0, 6);
        const pixels = new Float32Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('GL readback error');
        results[name] = pixels;
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        device = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      } finally {
        for (const buffer of buffers) gl.deleteBuffer(buffer);
        for (const shader of shaders) gl.deleteShader(shader);
        gl.deleteProgram(program); gl.deleteVertexArray(vao); gl.deleteTexture(texture); gl.deleteFramebuffer(fbo);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }
    const comparisons = {};
    for (const name of ['clip', 'generatedUv', 'explicitUv']) {
      let changedPixels = 0, maxAbsoluteDifference = 0;
      for (let pixel = 0; pixel < width * height; pixel++) {
        let changed = false;
        for (let c = 0; c < 4; c++) {
          const index = pixel * 4 + c, a = results.captured[index], b = results[name][index];
          if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Non-finite coordinate');
          if (a !== b) changed = true;
          maxAbsoluteDifference = Math.max(maxAbsoluteDifference, Math.abs(a - b));
        }
        if (changed) changedPixels++;
      }
      comparisons[name] = { changedPixels, maxAbsoluteDifference };
    }
    return { device, pixels: width * height, comparisons };
  }, fixture);
  report.scope = 'Browser coordinate-only replay of recorded native draw inputs; not native color or family acceptance';
  report.originalRawPngSha256 = fixture.source.originalRawPngSha256;
  report.exactCoordinateChecksPassed = report.comparisons.clip.changedPixels === 0 && report.comparisons.explicitUv.changedPixels === 0;
  const output = fileURLToPath(new URL('../.cache/source-domain-vertex-boundary-verification.json', import.meta.url));
  await mkdir(new URL('../.cache/', import.meta.url), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.exactCoordinateChecksPassed) process.exitCode = 1;
} finally {
  await browser.close();
}
