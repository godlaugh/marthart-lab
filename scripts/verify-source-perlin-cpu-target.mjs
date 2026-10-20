import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const hash=x=>createHash('sha256').update(x).digest('hex');
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/core-4.5.0-acdf3bce2932985b9d091c284407a54.jar';
const report={at:new Date().toISOString(),scope:'Original Processing shaders in the same browser versus Perlin CPU target; shared geometry and camera inputs, separately covered by numerical fixtures.',nativeParity:'Not established; no JVM/JOGL frame comparison',unmeasured:['GPU memory','Process-family memory','Agent token cost','Native render timing']};
let server,browser;
try{
 const bytes=await readFile(jar);if(hash(bytes)!=='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a')throw Error('Processing artifact changed');
 const reference=JSON.parse(execFileSync('python3',['-c',"import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({n:z.read('processing/opengl/shaders/'+n+'.glsl').decode() for n in ['LineVert','LineFrag','PointVert','PointFrag']}))",jar],{encoding:'utf8'}));
 report.reference={jarSha256:hash(bytes),shaders:Object.fromEntries(Object.entries(reference).map(([k,v])=>[k,hash(v)]))};
 const paths=['src/engine/sourcePerlinCpuTarget.ts','src/engine/sourcePerlinDisplay.ts','src/engine/sourceProcessingMatrix.ts','src/engine/sourceProcessingStroke.ts','src/engine/sourceProcessingPoints.ts','src/engine/sourceProcessingTrig.ts','scripts/verify-source-perlin-cpu-target.mjs'];
 const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));
 const before=await hashes();
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/cpu-target-oracle',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.goto(server.resolvedUrls.local[0]+'cpu-target-oracle');
 const result=await page.evaluate(async reference=>{
  const {SourcePerlinCpuTarget}=await import('/src/engine/sourcePerlinCpuTarget.ts');
  const {prepareSourcePerlinCpuDisplay}=await import('/src/engine/sourcePerlinDisplay.ts');
  const {sourceProcessingOpenStrokeBuffers,forEachSourceProcessingOpenStrokeChunk}=await import('/src/engine/sourceProcessingStroke.ts');
  const {sourceProcessingRoundPointBuffers}=await import('/src/engine/sourceProcessingPoints.ts');
  const {SourcePerlinParticleMotion}=await import('/src/engine/sourcePerlinParticleMotion.ts');
  const {SourcePerlinParticleColors}=await import('/src/engine/sourcePerlinParticleColors.ts');
  const {SourcePerlinParticleTrails}=await import('/src/engine/sourcePerlinParticleTrails.ts');
  const check=(v,m)=>{if(!v)throw Error(m);};
  const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const live=new Set(),restores=[];
  for(const kind of ['Program','Shader','Buffer','VertexArray','Texture','Framebuffer','Renderbuffer'])for(const action of ['create','delete']){
   const name=action+kind,original=WebGL2RenderingContext.prototype[name];
   restores.push(()=>WebGL2RenderingContext.prototype[name]=original);
   WebGL2RenderingContext.prototype[name]=function(...args){const r=original.apply(this,args);if(action==='create'&&r)live.add(r);if(action==='delete')live.delete(args[0]);return r;};
  }
  const digest=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a))).map(v=>v.toString(16).padStart(2,'0')).join('');
  // Independent renderer: original uniform names and attribute locations,
  // six background vertices, independent attachments, upload and row conversion.
  function referenceTarget(o){
   const g=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,alpha:true,depth:false,premultipliedAlpha:false});check(g,'Reference context');
   const owned=[],own=(kind,v)=>{check(v,'Reference allocation '+kind);owned.push([kind,v]);return v;};
   function program(v,f){
    const p=own('Program',g.createProgram());
    for(const [kind,s] of [[g.VERTEX_SHADER,v],[g.FRAGMENT_SHADER,f]]){
     const shader=g.createShader(kind);check(shader,'Reference shader');
     const vertex=kind===g.VERTEX_SHADER;
     g.shaderSource(shader,'#version 300 es\nprecision '+(vertex?'highp':'mediump')+' float;\n'+s.replace(/\battribute\b/g,'in').replace(/\bvarying\b/g,vertex?'out':'in').replace(/\bgl_FragColor\b/g,'outputColor')+(vertex?'':'\nout vec4 outputColor;\n'));
     // Fragment output declaration must precede its function use.
     if(!vertex)g.shaderSource(shader,g.getShaderSource(shader).replace('\nout vec4 outputColor;\n','').replace('void main()', 'out vec4 outputColor;\nvoid main()'));
     g.compileShader(shader);check(g.getShaderParameter(shader,g.COMPILE_STATUS),g.getShaderInfoLog(shader));g.attachShader(p,shader);g.deleteShader(shader);
    }
    g.linkProgram(p);check(g.getProgramParameter(p,g.LINK_STATUS),g.getProgramInfoLog(p));return p;
   }
   const programs={lines:program(reference.LineVert,reference.LineFrag),points:program(reference.PointVert,reference.PointFrag),
    background:program('attribute vec2 position;void main(){gl_Position=vec4(position,0,1);}','uniform vec4 fill;void main(){gl_FragColor=fill;}')};
   const w=o.width*o.density,h=o.height*o.density,t=own('Texture',g.createTexture()),f=own('Framebuffer',g.createFramebuffer());
   g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);
   g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,w,h,0,g.RGBA,g.UNSIGNED_BYTE,null);g.bindFramebuffer(g.FRAMEBUFFER,f);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,t,0);
   let ms;
   if(o.samples){ms=own('Framebuffer',g.createFramebuffer());const rb=own('Renderbuffer',g.createRenderbuffer());g.bindRenderbuffer(g.RENDERBUFFER,rb);g.renderbufferStorageMultisample(g.RENDERBUFFER,o.samples,g.RGBA8,w,h);g.bindFramebuffer(g.FRAMEBUFFER,ms);g.framebufferRenderbuffer(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.RENDERBUFFER,rb);}
   check(g.checkFramebufferStatus(g.FRAMEBUFFER)===g.FRAMEBUFFER_COMPLETE,'Reference framebuffer');
   const vao=own('VertexArray',g.createVertexArray()),buffers=Array.from({length:4},()=>own('Buffer',g.createBuffer()));
   g.clearColor(...o.initialColor);g.clear(g.COLOR_BUFFER_BIT);
   return{
    draw(frame){
     g.bindFramebuffer(g.FRAMEBUFFER,ms??f);g.bindVertexArray(vao);g.viewport(0,0,w,h);g.disable(g.DEPTH_TEST);g.enable(g.DITHER);
     g.enable(g.BLEND);g.blendEquationSeparate(g.FUNC_ADD,g.FUNC_ADD);g.blendFuncSeparate(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA,g.ONE,g.ONE);
     const upload=(p,name,data,size)=>{const n=g.getAttribLocation(p,name);check(n>=0,'Reference attribute '+name);g.bindBuffer(g.ARRAY_BUFFER,buffers[name==='position'?0:name==='color'?1:2]);g.bufferData(g.ARRAY_BUFFER,data,g.STREAM_DRAW);g.enableVertexAttribArray(n);g.vertexAttribPointer(n,size,g.FLOAT,false,0,0);return n;};
     if(frame.accumulation){const p=programs.background;g.useProgram(p);g.uniform4fv(g.getUniformLocation(p,'fill'),frame.background);upload(p,'position',new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),2);g.drawArrays(g.TRIANGLES,0,6);}
     else{g.clearColor(...frame.background);g.clear(g.COLOR_BUFFER_BIT);}
     for(const primitive of frame.primitives){
      const p=programs[primitive.kind],b=primitive.buffers,line=primitive.kind==='lines',direction=line?'direction':'offset',size=line?4:2;
      g.useProgram(p);g.uniformMatrix4fv(g.getUniformLocation(p,'modelviewMatrix'),false,identity);g.uniformMatrix4fv(g.getUniformLocation(p,'projectionMatrix'),false,frame.projection);g.uniform4f(g.getUniformLocation(p,'viewport'),0,0,o.width,o.height);g.uniform1i(g.getUniformLocation(p,'perspective'),0);if(line)g.uniform3f(g.getUniformLocation(p,'scale'),1,1,Math.fround(.999));
      // Each cache gets independently sliced arrays and zero-based indices.
      for(const c of b.caches){
       upload(p,'position',b.positions.subarray(c.vertexOffset*4,(c.vertexOffset+c.vertexCount)*4),4);
       upload(p,'color',b.colors.subarray(c.vertexOffset*4,(c.vertexOffset+c.vertexCount)*4),4);
       upload(p,direction,b[line?'directions':'offsets'].subarray(c.vertexOffset*size,(c.vertexOffset+c.vertexCount)*size),size);
       g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,buffers[3]);g.bufferData(g.ELEMENT_ARRAY_BUFFER,b.indices.subarray(c.indexOffset,c.indexOffset+c.indexCount),g.STREAM_DRAW);g.drawElements(g.TRIANGLES,c.indexCount,g.UNSIGNED_SHORT,0);
      }
     }
     if(ms){g.bindFramebuffer(g.READ_FRAMEBUFFER,ms);g.bindFramebuffer(g.DRAW_FRAMEBUFFER,f);g.blitFramebuffer(0,0,w,h,0,0,w,h,g.COLOR_BUFFER_BIT,g.NEAREST);}
     g.bindFramebuffer(g.FRAMEBUFFER,f);const a=new Uint8Array(w*h*4),top=new Uint8Array(a.length);g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,a);check(g.getError()===g.NO_ERROR,'Reference GL error');
     for(let y=0;y<h;y++)top.set(a.subarray((h-1-y)*w*4,(h-y)*w*4),y*w*4);return top;
    },
    dispose(){for(const [k,v] of owned.reverse())g['delete'+k](v);g.getExtension('WEBGL_lose_context')?.loseContext();}
   };
  }
  const probe=new OffscreenCanvas(1,1).getContext('webgl2');check(probe,'MSAA probe');
  const supported=[...probe.getInternalformatParameter(probe.RENDERBUFFER,probe.RGBA8,probe.SAMPLES)];probe.getExtension('WEBGL_lose_context')?.loseContext();
  const results=[],failures=[];let preview;
  try{
   for(const samples of [0,...supported.filter(n=>[2,4,8].includes(n)).slice(0,1)])for(const density of [1,2]){
    const o={width:97,height:71,density,samples,initialColor:[.2,.3,.4,.25]},target=new SourcePerlinCpuTarget(o),streamed=new SourcePerlinCpuTarget(o),ref=referenceTarget(o);
    const display=prepareSourcePerlinCpuDisplay({width:o.width,height:o.height,sourceWidth:97,sourceHeight:71,sourcePixelDensity:density,target:'primary',lineWeight:3,dotSize:7});
    const xyz=new Float32Array([-30,-20,0,0,20,0,30,-10,0,30,-10,0,-20,15,0]),colors=new Float32Array([1,0,0,.3,0,1,0,.7,0,0,1,1,1,1,0,.5,1,0,1,.9]);
    const primitive=(kind,width=3,pos=xyz,col=colors)=>({kind,buffers:kind==='lines'?sourceProcessingOpenStrokeBuffers({positions:pos,colors:col,polygonOffsets:new Uint32Array([0,pos.length/3]),lineWidth:width,rowMajor:display.modelView.rowMajor}):sourceProcessingRoundPointBuffers({positions:pos,colors:col,width,rowMajor:display.modelView.rowMajor})});
    async function compare(label,primitives,accumulation=false,sourceStream){
     const frame={projection:display.projection.columnMajor,background:[.04,.08,.12,.2],accumulation,primitives};
     const start=performance.now();target.draw(frame);const a=target.readPixels(),elapsedMs=performance.now()-start,b=ref.draw(frame);
     streamed.draw({...frame,primitives:[],streamPrimitives:sourceStream??(consume=>{
      for(const p of primitives){const b=p.buffers,key=p.kind==='lines'?'directions':'offsets',components=p.kind==='lines'?4:2;
       for(const c of b.caches)consume({kind:p.kind,buffers:{positions:b.positions.subarray(c.vertexOffset*4,(c.vertexOffset+c.vertexCount)*4),colors:b.colors.subarray(c.vertexOffset*4,(c.vertexOffset+c.vertexCount)*4),[key]:b[key].subarray(c.vertexOffset*components,(c.vertexOffset+c.vertexCount)*components),indices:b.indices.subarray(c.indexOffset,c.indexOffset+c.indexCount),caches:[{vertexOffset:0,indexOffset:0,vertexCount:c.vertexCount,indexCount:c.indexCount}]}});
      }
     })});
     const streamedPixels=streamed.readPixels();check(streamedPixels.every((v,i)=>v===a[i]),`${label} streamed/full bytes differ`);
     let different=0,maxDelta=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])different++;maxDelta=Math.max(maxDelta,Math.abs(a[i]-b[i]));}
     check(different===0,`${label} d${density} MSAA${samples}: ${different} differing channels, delta ${maxDelta}`);
     check(target.readPixels().every((v,i)=>v===a[i]),'Readback changed render history');
     results.push({label,density,samples,different,maxDelta,elapsedMs,streamedMatch:true,sha256:await digest(a)});
     return a;
    }
    try{
     await compare('wide-open-repeated-vertex',[primitive('lines',5)]);
     await compare('thin-open',[primitive('lines',.4)]);
     await compare('round-points',[primitive('points',9)]);
     const first=await compare('accumulation-first',[primitive('points',9)],true);
     const faded=await compare('same-update-display-fade',[],true);check(first.some((v,i)=>v!==faded[i]),'Repeated display failed to fade');
     await compare('second-fade',[],true);await compare('clear-after-history',[]);
     await compare('nonfinite-clipping',[primitive('points',5,new Float32Array([NaN,0,0,0,0,0]),new Float32Array([1,0,0,1,0,1,0,1]))]);
     if(samples===0&&density===1){
      const count=6555,pos=new Float32Array(count*3),col=new Float32Array(count*4);
      for(let i=0;i<count;i++){pos[i*3]=Math.sin(i*.01)*30;pos[i*3+1]=Math.cos(i*.01)*20;col.set([i/count,.4,1-i/count,.1],i*4);}
      await compare('long-wide-cache-rollover',[primitive('lines',3,pos,col)],false,consume=>forEachSourceProcessingOpenStrokeChunk({positions:pos,colors:col,polygonOffsets:new Uint32Array([0,count]),lineWidth:3,rowMajor:display.modelView.rowMajor},buffers=>consume({kind:'lines',buffers})));
      preview=await compare('preview',[primitive('lines',3),primitive('points',4)]);
      const motion=new SourcePerlinParticleMotion({seed:'12345',count:256,width:97,height:71});
      const colors=new SourcePerlinParticleColors({count:256,palette:[0xff8657d6,0xffefa9e6]});
      const trails=new SourcePerlinParticleTrails({motion,packedColors:colors.packed,lifetime:4,fade:true,accumulation:false});
      for(let step=0;step<=60;step++){
       colors.runtime.update(1/60);
       motion.update({time:step/60,deltaTime:1/60,noiseScale:8,noiseOffset:0,stepSize:.45,timeScale:.18,respawnRate:.1,flowMode:'SWIRL_FIELD',angleMap:'LINEAR'});
       trails.afterMotion(step/60,true);
       if(step%15===0){
        const polygons=trails.snapshotPolygons(97,71),rgba=new Float32Array(polygons.alphas.length*4);
        for(let i=0;i<polygons.alphas.length;i++){rgba.set(polygons.colors.subarray(i*3,i*3+3),i*4);rgba[i*4+3]=polygons.alphas[i];}
        const buffers=sourceProcessingOpenStrokeBuffers({positions:polygons.positions,colors:rgba,polygonOffsets:polygons.polygonOffsets,rowMajor:display.modelView.rowMajor,lineWidth:.8});
        preview=await compare(`real-motion-trails-step${step}`,[{kind:'lines',buffers}]);
       }
      }
     }
    }finally{target.dispose();streamed.dispose();ref.dispose();}
    check(live.size===0,'Leaked successful target resources: '+live.size);
   }
   const options={width:31,height:27,density:1,samples:0,initialColor:[0,0,0,0]},frame={projection:identity,background:[0,0,0,.2],accumulation:true,primitives:[]};
   function failure(label,install,cancel){
    const target=new SourcePerlinCpuTarget(options),restore=install?.()??(()=>{});let first,retry;
    try{try{target.draw(frame,cancel);}catch(e){first=e.code;}}finally{restore();}
    try{target.draw(frame);}catch(e){retry=e.code;}target.dispose();target.dispose();
    check(first&&retry==='failed'&&live.size===0,`${label} failure/retry/leaks: ${first}/${retry}/${live.size}`);failures.push({label,first,retry,retained:live.size});
   }
   for(const [name,nth] of [['createShader',2],['createProgram',2],['createBuffer',3],['createTexture',1],['createFramebuffer',1],['createVertexArray',1]]){
    failure(name+nth,()=>{const old=WebGL2RenderingContext.prototype[name];let n=0;WebGL2RenderingContext.prototype[name]=function(...a){return ++n===nth?null:old.apply(this,a);};return()=>WebGL2RenderingContext.prototype[name]=old;});
   }
   failure('cancel-before-context',null,()=>true);
   failure('context-loss',()=>{const old=WebGL2RenderingContext.prototype.drawArrays;WebGL2RenderingContext.prototype.drawArrays=function(...a){old.apply(this,a);this.getExtension('WEBGL_lose_context').loseContext();};return()=>WebGL2RenderingContext.prototype.drawArrays=old;});
   const c=new OffscreenCanvas(97,71);c.getContext('2d').putImageData(new ImageData(preview,97,71),0,0);
   return{results,failures,supportedSamples:supported,preview:await new Promise(async resolve=>{const blob=await c.convertToBlob();resolve(Array.from(new Uint8Array(await blob.arrayBuffer())));})};
  }finally{restores.reverse().forEach(f=>f());}
 },reference);
 const after=await hashes();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Source changed during verification');
 report.sourceHashes=after;report.results=result.results;report.failures=result.failures;report.supportedSamples=result.supportedSamples;report.status='passed';
 await writeFile('.cache/source-perlin-cpu-target-preview.png',new Uint8Array(result.preview));
 await writeFile('.cache/v2-perlin-cpu-target-verification.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,cases:result.results.length,failures:result.failures.length,report:'.cache/v2-perlin-cpu-target-verification.json'}));
}catch(e){report.status='failed';report.error=e.stack;await writeFile('.cache/v2-perlin-cpu-target-verification.json',JSON.stringify(report,null,2)+'\n');throw e;}
finally{await browser?.close();await server?.close();}
