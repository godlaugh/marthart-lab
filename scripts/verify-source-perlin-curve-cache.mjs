import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/core-4.5.0-acdf3bce2932985b9d091c284407a54.jar';
const report={at:new Date().toISOString(),scope:'Real headless Chrome, original Processing Line/Tex shaders in an independent GL context. Geometry tessellation and display matrices are shared inputs; this isolates render, cache and image composition.',nativeParity:'Not established: no JVM/JOGL matched frame',unmeasured:['GPU memory','Process-family peak memory','Agent token cost','Native render timing']};
let server,browser;const wallStart=performance.now(),cpuStart=process.cpuUsage();
try{
 const jarBytes=await readFile(jar);if(hash(jarBytes)!=='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a')throw Error('Processing artifact changed');
 const original=JSON.parse(execFileSync('python3',['-c',"import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({n:z.read('processing/opengl/shaders/'+n+'.glsl').decode() for n in ['LineVert','LineFrag','TexVert','TexFrag']}))",jar],{encoding:'utf8'}));
 report.reference={jarSha256:hash(jarBytes),shaders:Object.fromEntries(Object.entries(original).map(([k,v])=>[k,hash(v)]))};
 const paths=['src/engine/sourcePerlinCurveDisplay.ts','src/engine/sourcePerlinCpuTarget.ts','src/engine/sourcePerlinDisplay.ts','src/engine/sourceProcessingStroke.ts','src/engine/sourcePerlinCurveGeometry.ts','src/engine/sourcePerlinCurveColors.ts','src/engine/sourcePerlinAngleField.ts','src/engine/sourcePerlinColorRuntime.ts','src/engine/sourceProcessingNoise.ts','src/engine/sourceProcessingMatrix.ts','scripts/verify-source-perlin-curve-cache.mjs'];
 const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));const before=await hashes();
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/curve-cache-oracle',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'curve-cache-oracle');
 const result=await page.evaluate(async original=>{
  const {SourcePerlinCpuTarget}=await import('/src/engine/sourcePerlinCpuTarget.ts');
  const {SourcePerlinCurveDisplay,sourcePerlinCurveStrokeBuffers}=await import('/src/engine/sourcePerlinCurveDisplay.ts');
  const {prepareSourcePerlinCpuDisplay}=await import('/src/engine/sourcePerlinDisplay.ts');
  const {SourcePerlinCurveGeometry}=await import('/src/engine/sourcePerlinCurveGeometry.ts');
  const {SourcePerlinCurveColors}=await import('/src/engine/sourcePerlinCurveColors.ts');
  const {SourcePerlinAngleField}=await import('/src/engine/sourcePerlinAngleField.ts');
  const {SourcePerlinColorRuntime}=await import('/src/engine/sourcePerlinColorRuntime.ts');
  const {SourceProcessingNoise}=await import('/src/engine/sourceProcessingNoise.ts');
  const check=(v,m)=>{if(!v)throw Error(m);};const F=Math.fround,identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const live=new Set(),restores=[];
  for(const kind of ['Program','Shader','Buffer','VertexArray','Texture','Framebuffer','Renderbuffer'])for(const action of ['create','delete']){
   const name=action+kind,old=WebGL2RenderingContext.prototype[name];restores.push(()=>WebGL2RenderingContext.prototype[name]=old);
   WebGL2RenderingContext.prototype[name]=function(...args){const r=old.apply(this,args);if(action==='create'&&r)live.add(r);if(action==='delete')live.delete(args[0]);return r;};
  }
  const digest=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a))).map(v=>v.toString(16).padStart(2,'0')).join('');
  function referenceDevice(){
   const g=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,alpha:true,depth:false,premultipliedAlpha:false});check(g,'Reference context');
   const owned=[],own=(kind,v)=>{check(v,'Reference allocation '+kind);owned.push([kind,v]);return v;};
   function program(v,f){
    const p=own('Program',g.createProgram());
    for(const [kind,source]of[[g.VERTEX_SHADER,v],[g.FRAGMENT_SHADER,f]]){
     const shader=own('Shader',g.createShader(kind)),vertex=kind===g.VERTEX_SHADER;
     // GLSL ES 3 reserves texture() as a function, so preserve the original
     // sampler semantics under a different uniform name when porting GLSL 1.
     let s=source.replace(/\battribute\b/g,'in').replace(/\bvarying\b/g,vertex?'out':'in').replace(/\btexture\b/g,'sourceTexture').replace(/\btexture2D\b/g,'texture').replace(/\bgl_FragColor\b/g,'outputColor');
     if(!vertex)s=s.replace('void main()', 'out vec4 outputColor;\nvoid main()');
     g.shaderSource(shader,'#version 300 es\nprecision '+(vertex?'highp':'mediump')+' float;\n'+s);g.compileShader(shader);check(g.getShaderParameter(shader,g.COMPILE_STATUS),g.getShaderInfoLog(shader));g.attachShader(p,shader);
    }
    g.linkProgram(p);check(g.getProgramParameter(p,g.LINK_STATUS),g.getProgramInfoLog(p));return p;
   }
   const line=program(original.LineVert,original.LineFrag),image=program(original.TexVert,original.TexFrag),bg=program('attribute vec2 position;void main(){gl_Position=vec4(position,0,1);}','uniform vec4 fill;void main(){gl_FragColor=fill;}');
   const vao=own('VertexArray',g.createVertexArray()),buffers=Array.from({length:4},()=>own('Buffer',g.createBuffer()));
   const uniform=(p,n)=>g.getUniformLocation(p,n);
   function attribute(p,name,data,size,index){const loc=g.getAttribLocation(p,name);check(loc>=0,'Reference attribute '+name);g.bindBuffer(g.ARRAY_BUFFER,buffers[index]);g.bufferData(g.ARRAY_BUFFER,data,g.STREAM_DRAW);g.enableVertexAttribArray(loc);g.vertexAttribPointer(loc,size,g.FLOAT,false,0,0);}
   function attachment(o){
    const w=o.width*o.density,h=o.height*o.density,texture=own('Texture',g.createTexture()),resolved=own('Framebuffer',g.createFramebuffer());
    g.bindTexture(g.TEXTURE_2D,texture);for(const pname of[g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,pname,g.LINEAR);for(const pname of[g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,pname,g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,w,h,0,g.RGBA,g.UNSIGNED_BYTE,null);g.bindFramebuffer(g.FRAMEBUFFER,resolved);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,texture,0);let draw=resolved;
    if(o.samples){draw=own('Framebuffer',g.createFramebuffer());const rb=own('Renderbuffer',g.createRenderbuffer());g.bindRenderbuffer(g.RENDERBUFFER,rb);g.renderbufferStorageMultisample(g.RENDERBUFFER,o.samples,g.RGBA8,w,h);g.bindFramebuffer(g.FRAMEBUFFER,draw);g.framebufferRenderbuffer(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.RENDERBUFFER,rb);}
    check(g.checkFramebufferStatus(g.FRAMEBUFFER)===g.FRAMEBUFFER_COMPLETE,'Reference framebuffer');g.clearColor(...o.initialColor);g.clear(g.COLOR_BUFFER_BIT);return{...o,w,h,texture,resolved,draw};
   }
   function render(t,{projection,background,accumulation,buffers:stroke,images=[]}){
    g.bindFramebuffer(g.FRAMEBUFFER,t.draw);g.bindVertexArray(vao);g.viewport(0,0,t.w,t.h);g.disable(g.DEPTH_TEST);g.disable(g.CULL_FACE);g.enable(g.DITHER);g.enable(g.BLEND);g.blendEquationSeparate(g.FUNC_ADD,g.FUNC_ADD);g.blendFuncSeparate(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA,g.ONE,g.ONE);
    if(accumulation){g.useProgram(bg);g.uniform4fv(uniform(bg,'fill'),background);attribute(bg,'position',new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),2,0);g.drawArrays(g.TRIANGLES,0,6);}else{g.clearColor(...background);g.clear(g.COLOR_BUFFER_BIT);}
    if(stroke){g.useProgram(line);g.uniformMatrix4fv(uniform(line,'modelviewMatrix'),false,identity);g.uniformMatrix4fv(uniform(line,'projectionMatrix'),false,projection);g.uniform4f(uniform(line,'viewport'),0,0,t.width,t.height);g.uniform1i(uniform(line,'perspective'),0);g.uniform3f(uniform(line,'scale'),1,1,F(.999));
     for(const c of stroke.caches){for(const [name,data,n,i]of[['position',stroke.positions,4,0],['color',stroke.colors,4,1],['direction',stroke.directions,4,2]])attribute(line,name,data.subarray(c.vertexOffset*n,(c.vertexOffset+c.vertexCount)*n),n,i);g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,buffers[3]);g.bufferData(g.ELEMENT_ARRAY_BUFFER,stroke.indices.subarray(c.indexOffset,c.indexOffset+c.indexCount),g.STREAM_DRAW);g.drawElements(g.TRIANGLES,c.indexCount,g.UNSIGNED_SHORT,0);}
    }
    for(const source of images){
     g.useProgram(image);g.uniformMatrix4fv(uniform(image,'transformMatrix'),false,identity);
     // Original imageImpl top-left UVs, then original PShader invertedY
     // texture matrix. Six vertices represent source QUADS triangulation.
     const texMatrix=new Float32Array(identity);texMatrix[5]=-1;texMatrix[13]=1;g.uniformMatrix4fv(uniform(image,'texMatrix'),false,texMatrix);
     attribute(image,'position',new Float32Array([-1,1,0,1,-1,-1,0,1,1,-1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1]),4,0);
     attribute(image,'texCoord',new Float32Array([0,0,0,1,1,1,0,0,1,1,1,0]),2,2);attribute(image,'color',new Float32Array(24).fill(1),4,1);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,source.texture);g.uniform1i(uniform(image,'sourceTexture'),0);g.drawArrays(g.TRIANGLES,0,6);
    }
    if(t.draw!==t.resolved){g.bindFramebuffer(g.READ_FRAMEBUFFER,t.draw);g.bindFramebuffer(g.DRAW_FRAMEBUFFER,t.resolved);g.blitFramebuffer(0,0,t.w,t.h,0,0,t.w,t.h,g.COLOR_BUFFER_BIT,g.NEAREST);}check(g.getError()===g.NO_ERROR,'Reference draw error');
   }
   return{attachment,render,read(t){g.bindFramebuffer(g.FRAMEBUFFER,t.resolved);const raw=new Uint8Array(t.w*t.h*4),top=new Uint8Array(raw.length);g.readPixels(0,0,t.w,t.h,g.RGBA,g.UNSIGNED_BYTE,raw);for(let y=0;y<t.h;y++)top.set(raw.subarray((t.h-y-1)*t.w*4,(t.h-y)*t.w*4),y*t.w*4);return top;},dispose(){for(const[k,v]of owned.reverse())g['delete'+k](v);g.getExtension('WEBGL_lose_context')?.loseContext();}};
  }
  const probe=new OffscreenCanvas(1,1).getContext('webgl2'),supported=[...probe.getInternalformatParameter(probe.RENDERBUFFER,probe.RGBA8,probe.SAMPLES)];probe.getExtension('WEBGL_lose_context')?.loseContext();
  const results=[],lifecycle=[],hostLifecycle=[],hostFailures=[];let preview,previewWidth,previewHeight;
  const synthetic={count:3,length:4,xs:new Float32Array([-37,-20,15,34,-30,0,0,35,-20,-20,0,22]),ys:new Float32Array([-22,-18,-9,-6,20,5,-20,-18,-15,12,12,5]),colors:new Uint32Array([0x12ff5000,0x8000eeaa,0xff895cff])};
  try{
   for(const samples of [0,...supported.filter(n=>[2,4,8].includes(n))])for(const[targetDensity,cacheDensity]of[[1,1],[2,1],[1,2],[2,2]]){
    const o={width:97,height:71,density:targetDensity,samples,initialColor:[.2,.3,.4,.25]},target=new SourcePerlinCpuTarget(o),host=new SourcePerlinCurveDisplay(samples),ref=referenceDevice(),rt=ref.attachment(o),rc=ref.attachment({...o,density:cacheDensity,initialColor:[0,0,0,0]});
    const displayInput={width:97,height:71,sourceWidth:97,sourceHeight:71,sourcePixelDensity:cacheDensity,target:'primary',lineWeight:5,dotSize:2};let display=prepareSourcePerlinCpuDisplay(displayInput),data=synthetic,snapshotCount=0;const curves={get count(){return data.count;},rebuildIfNeeded:()=>false,snapshot(){snapshotCount++;return data;}};
    const background=[.04,.08,.12,.16],base={target,display:displayInput,curves,curveAlpha:.37,background,accumulation:false,animating:false};
    let referenceCacheDirty=true;
    async function compare(label,change={}){
     const frame={...base,...change},start=performance.now();host.draw(frame);const actual=target.readPixels(),elapsedMs=performance.now()-start;
     const stroke=()=>sourcePerlinCurveStrokeBuffers(data,display,frame.curveAlpha);
     if(frame.animating)ref.render(rt,{projection:display.projection.columnMajor,background,accumulation:frame.accumulation,buffers:stroke()});
     else{if(referenceCacheDirty){ref.render(rc,{projection:display.projection.columnMajor,background:[0,0,0,0],accumulation:false,buffers:stroke()});referenceCacheDirty=false;}ref.render(rt,{background,accumulation:frame.accumulation,images:[rc]});}
     const expected=ref.read(rt);let different=0,maxDelta=0;for(let i=0;i<actual.length;i++){if(actual[i]!==expected[i])different++;maxDelta=Math.max(maxDelta,Math.abs(actual[i]-expected[i]));}
     check(different===0,`${label} targetDensity${targetDensity} cacheDensity${cacheDensity} MSAA${samples}: ${different} channels delta ${maxDelta}`);
     check(target.readPixels().every((v,i)=>v===actual[i]),'Readback changed image history');results.push({label,targetDensity,cacheDensity,samples,different,maxDelta,elapsedMs,sha256:await digest(actual)});return actual;
    }
    try{
     const staticImage=await compare('transparent-overlap-cache');const firstSnapshots=snapshotCount;
     await compare('cache-reuse');check(snapshotCount===firstSnapshots,'Static cache reuse unexpectedly snapshots geometry');
     const direct=await compare('direct-animation',{animating:true});check(staticImage.some((v,i)=>v!==direct[i]),'Cache/direct double blend distinction absent');
     await compare('return-cache');const first=await compare('repeated-image-fade',{accumulation:true});const second=await compare('second-image-fade',{accumulation:true});check(first.some((v,i)=>v!==second[i]),'Repeated image display did not update history');
     data={...synthetic,colors:new Uint32Array([0xff40aaff,0xffef1345,0xffaabbcc])};host.invalidate();referenceCacheDirty=true;await compare('palette-invalidates-transparent-cache');
     lifecycle.push({samples,targetDensity,cacheDensity,...host.diagnostics(),snapshotCount});
     if(samples===0&&targetDensity===1&&cacheDensity===1){
      const noise=new SourceProcessingNoise(7365n),geometry=new SourcePerlinCurveGeometry({seed:'12345',count:24,length:72,width:320,height:240,sampling:'jittered-grid',stepSize:1.2,noiseOffset:.3,angleField:new SourcePerlinAngleField({width:320,height:240,fieldCellSize:8,textureSeed:7365,curveNoiseScale:2,curveNoiseOctaves:3,curveNoiseOffset:.3,curveAngleScale:1.1,noise})});
      const coordinates=geometry.snapshot(),runtime=new SourcePerlinColorRuntime({palette:[0xff5577ff,0xffff9955,0xff33bbcc]}),colorOwner=new SourcePerlinCurveColors({seed:'12345',width:320,height:240,seedSpaceCircleCount:3,minRadius:20,maxRadius:80,colors:runtime,noise});
      data={...coordinates,colors:Uint32Array.from({length:coordinates.count},(_,index)=>colorOwner.resolve({mode:'position',index,count:coordinates.count,x:coordinates.seedXs[index],y:coordinates.seedYs[index],curveNoiseScale:2,curveNoiseOctaves:3}))};
      // Explicit source dimensions exercise the source display's independent
      // xy scale and transformScale while retaining the real curve owners.
      displayInput.sourceWidth=320;displayInput.sourceHeight=240;display=prepareSourcePerlinCpuDisplay(displayInput);
      host.invalidate();referenceCacheDirty=true;preview=await compare('real-source-geometry-colors');previewWidth=o.width;previewHeight=o.height;
     }
    }finally{host.dispose();target.dispose();ref.dispose();}check(live.size===0,'Leaked cache/context resources: '+live.size);
   }
   // Direct shared-device image API: unlike the host's single same-size cache,
   // these siblings use different dimensions and sample counts. Images must
   // preserve explicit order and remain live when an unrelated sibling closes.
   {
    const o={width:53,height:41,density:2,samples:0,initialColor:[0,0,0,0]},target=new SourcePerlinCpuTarget(o),a=target.createSibling({...o,width:29,height:23,density:1}),b=target.createSibling({...o,width:37,height:31,density:2,samples:supported.includes(4)?4:0}),ref=referenceDevice(),rt=ref.attachment(o),ra=ref.attachment({...o,width:29,height:23,density:1}),rb=ref.attachment({...o,width:37,height:31,density:2,samples:supported.includes(4)?4:0});
    const fill=(color)=>({projection:identity,background:color,accumulation:false,primitives:[]});
    try{
     a.draw(fill([.9,.1,.2,.3]));b.draw(fill([.1,.7,.9,.6]));ref.render(ra,fill([.9,.1,.2,.3]));ref.render(rb,fill([.1,.7,.9,.6]));
     let previous;
     for(const[label,images,referenceImages]of[['siblings-a-b',[a,b],[ra,rb]],['siblings-b-a',[b,a],[rb,ra]],['duplicate-image',[a,a],[ra,ra]]]){
      target.draw({...fill([.02,.04,.08,.2]),images});ref.render(rt,{...fill([.02,.04,.08,.2]),images:referenceImages});const actual=target.readPixels(),expected=ref.read(rt);check(actual.every((v,i)=>v===expected[i]),label+' mismatch');if(previous)check(actual.some((v,i)=>v!==previous[i]),label+' failed to preserve image order');previous=actual;results.push({label,different:0,maxDelta:0,sha256:await digest(actual)});
     }
     a.dispose();target.draw({...fill([0,0,0,0]),images:[b]});ref.render(rt,{...fill([0,0,0,0]),images:[rb]});const actual=target.readPixels(),expected=ref.read(rt);check(actual.every((v,i)=>v===expected[i]),'Sibling disposal damaged retained target');results.push({label:'sibling-disposal-retains-live-images',different:0,maxDelta:0,sha256:await digest(actual)});
    }finally{a.dispose();b.dispose();target.dispose();ref.dispose();}check(live.size===0,'Leaked multi-image resources: '+live.size);
   }
   // Selected real-WebGL host lifecycle transitions. These are explicit
   // behavioral checks, not consumption of every static event-oracle case.
   {
    const o={width:97,height:71,density:1,samples:0,initialColor:[0,0,0,0]},target=new SourcePerlinCpuTarget(o),other=target.createSibling(o),resized=target.createSibling({...o,width:103,height:73}),host=new SourcePerlinCurveDisplay(0);
    const display={width:97,height:71,sourceWidth:97,sourceHeight:71,sourcePixelDensity:1,target:'primary',lineWeight:5,dotSize:2};
    let count=0,rebuildCalls=0,snapshotCalls=0,rebuild=false,data=synthetic;
    const curves={get count(){return count;},rebuildIfNeeded(){rebuildCalls++;const value=rebuild;rebuild=false;return value;},snapshot(){snapshotCalls++;return data;}};
    const base={target,display,curves,curveAlpha:.37,background:[.04,.08,.12,.16],accumulation:false,animating:false};
    const textureSet=()=>new Set([...live].filter(v=>v instanceof WebGLTexture));
    try{
     host.draw(base);check(rebuildCalls===0&&snapshotCalls===0&&host.diagnostics().builds===0,'Empty static curves reached rebuild/snapshot');
     const cleared=target.readPixels();check(cleared.every((v,i)=>v===cleared[i%4]),'Empty static curves did not draw uniform Scene background');hostLifecycle.push({label:'empty-static-before-rebuild',rebuildCalls,snapshotCalls,draws:target.diagnostics().draws});
     other.readPixels();resized.readPixels();const prior=textureSet();count=synthetic.count;host.draw(base);const cacheTexture=[...textureSet()].filter(v=>!prior.has(v));check(cacheTexture.length===1,'Cannot isolate host cache texture');
     const firstCache=cacheTexture[0];check(host.diagnostics().builds===1,'Initial static cache not built');
     data={...synthetic,xs:Float32Array.from(synthetic.xs,v=>v+3)};rebuild=true;host.draw({...base,animating:true});check(host.diagnostics().dirty&&host.diagnostics().builds===1&&host.diagnostics().directDraws===1,'Direct geometry rebuild lost deferred cache dirty state');hostLifecycle.push({label:'direct-rebuild-preserves-cache-dirty',diagnostics:host.diagnostics()});
     host.draw(base);check(!host.diagnostics().dirty&&host.diagnostics().builds===2&&live.has(firstCache),'Returning static failed to rebuild existing cache');
     host.invalidate();host.draw(base);check(host.diagnostics().builds===3&&live.has(firstCache),'Same-size invalidation replaced attachments');hostLifecycle.push({label:'same-size-invalidations-reuse-attachments',builds:host.diagnostics().builds,originalTextureLive:live.has(firstCache)});
     const same=target.readPixels(),snapshotsBefore=snapshotCalls;display.sourcePixelDensity=2;host.draw(base);check(host.diagnostics().builds===3&&snapshotCalls===snapshotsBefore&&host.diagnostics().cache.physicalWidth===97,'Source density alone changed cache key');check(target.readPixels().every((v,i)=>v===same[i]),'Density-only reuse changed pixels');hostLifecycle.push({label:'source-density-excluded-from-cache-key',builds:3,cachePhysicalWidth:host.diagnostics().cache.physicalWidth});
     host.draw({...base,target:other});check(host.diagnostics().builds===3&&snapshotCalls===snapshotsBefore&&live.has(firstCache),'Sibling target identity alone rebuilt cache');check(other.readPixels().every((v,i)=>v===same[i]),'Same-sized target identity changed image');hostLifecycle.push({label:'target-identity-excluded-from-cache-key',builds:3});
     host.draw({...base,target:resized,display:{...display,width:103,height:73}});check(host.diagnostics().builds===4&&!live.has(firstCache)&&host.diagnostics().cache.physicalWidth===206&&host.diagnostics().cache.physicalHeight===146,'Resize did not replace/release old cache with parent density');hostLifecycle.push({label:'resize-replaces-and-releases-cache',diagnostics:host.diagnostics(),previousTextureLive:live.has(firstCache)});
    }finally{host.dispose();target.dispose();other.dispose();resized.dispose();}check(live.size===0,'Leaked host lifecycle resources: '+live.size);
   }
   for(const mode of ['cancel-before-draw','cancel-during-prepare','snapshot-exception']){
    const o={width:97,height:71,density:1,samples:0,initialColor:[0,0,0,0]},target=new SourcePerlinCpuTarget(o),sibling=target.createSibling(o),host=new SourcePerlinCurveDisplay(0);
    const display={width:97,height:71,sourceWidth:97,sourceHeight:71,sourcePixelDensity:1,target:'primary',lineWeight:5,dotSize:2};
    let failing=false,cancel=false;const curves={count:synthetic.count,rebuildIfNeeded:()=>false,snapshot(){if(failing&&mode==='snapshot-exception')throw Error('Intentional snapshot failure');if(failing&&mode==='cancel-during-prepare')cancel=true;return synthetic;}};
    const frame={target,display,curves,curveAlpha:.37,background:[.04,.08,.12,.16],accumulation:false,animating:false};
    try{
     host.draw(frame);sibling.draw({projection:identity,background:[.1,.2,.3,.4],accumulation:false,primitives:[]});const countBefore=target.diagnostics().deviceTargets;host.invalidate();failing=true;if(mode==='cancel-before-draw')cancel=true;
     let first,retry;try{host.draw(frame,()=>cancel);}catch(error){first=error.code??error.message;}
     try{host.draw(frame);}catch(error){retry=error.code;}
     check(first&&retry==='failed','Host failure did not poison cache owner: '+mode);check(target.diagnostics().deviceTargets===countBefore-1,'Host failure retained cache attachment');
     // Both caller-owned targets must still accept real drawing, even after
     // host cancellation or a producer snapshot exception released the cache.
     sibling.draw({projection:identity,background:[.7,.3,.2,.6],accumulation:false,primitives:[]});target.draw({projection:identity,background:[.1,.2,.3,.4],accumulation:false,primitives:[],images:[sibling]});const actual=target.readPixels();check(actual.length===97*71*4&&actual.every((v,i)=>v===actual[i%4]),'Caller targets unusable after host failure');hostFailures.push({label:mode,first,retry,remainingDeviceTargets:target.diagnostics().deviceTargets,sha256:await digest(actual)});
    }finally{host.dispose();sibling.dispose();target.dispose();}check(live.size===0,'Leaked failed host resources: '+live.size);
   }
   const canvas=new OffscreenCanvas(previewWidth,previewHeight);canvas.getContext('2d').putImageData(new ImageData(preview,previewWidth,previewHeight),0,0);const png=Array.from(new Uint8Array(await(await canvas.convertToBlob()).arrayBuffer()));
   return{results,lifecycle,hostLifecycle,hostFailures,supportedSamples:supported,retainedResources:live.size,preview:png};
  }finally{restores.reverse().forEach(f=>f());}
 },original);
 const after=await hashes();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Source changed during verification; rerun frozen inputs');
 report.sourceHashes=after;report.results=result.results;report.lifecycle=result.lifecycle;report.hostLifecycle=result.hostLifecycle;report.hostFailures=result.hostFailures;report.supportedSamples=result.supportedSamples;report.retainedResources=result.retainedResources;report.status='passed';report.wallMs=performance.now()-wallStart;report.nodeCpuMicros=process.cpuUsage(cpuStart);report.nodeMaxRssKiB=process.resourceUsage().maxRSS;
 await writeFile('.cache/source-perlin-curve-cache-preview.png',new Uint8Array(result.preview));await writeFile('.cache/v2-perlin-curve-cache-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:result.results.length,hostLifecycle:result.hostLifecycle.length,hostFailures:result.hostFailures.length,retainedResources:result.retainedResources,wallMs:report.wallMs,report:'.cache/v2-perlin-curve-cache-verification.json'}));
}catch(error){report.status='failed';report.error=error.stack;await writeFile('.cache/v2-perlin-curve-cache-verification.json',JSON.stringify(report,null,2)+'\n');throw error;}finally{await browser?.close();await server?.close();}
