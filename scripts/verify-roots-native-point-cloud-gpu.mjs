import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output=process.argv[2]??'.cache/roots-native-point-cloud-gpu-attempt1.json';
const files=['src/engine/rootsNativePointCloudGpu.ts','src/engine/rootsPointCloudRing.ts','src/engine/rootsProjection.ts','src/engine/rootsPresentationConfig.ts','src/engine/rootsDensityColor.ts','src/engine/rootsGpuFailure.ts','tests/roots-native-point-cloud-gpu.test.ts','scripts/verify-roots-native-point-cloud-gpu.mjs'];
const hash=b=>createHash('sha256').update(b).digest('hex'),hashes=async()=>Object.fromEntries(await Promise.all(files.map(async p=>[p,hash(await readFile(p))])));
const shaderRoot='../.cache/mathart-investigation/MathArt.app/Contents/app/data/shader/';
const pinned={'complex_roots_point_cloud.vert':'cd6226bd6f5ec8538b9b9ac90d8f795b370db779550f22c413c7e96e2df111be','complex_roots_point_cloud.frag':'04874c4cebdc7ac605eaa8001ab4bb55dd25cfbedeae44120c8939bcc9266f55'};
const retained={};const retainedHashes={};for(const name of ['complex_roots_point_cloud.vert','complex_roots_point_cloud.frag']){const s=await readFile(shaderRoot+name,'utf8');retainedHashes[name]=hash(s);if(retainedHashes[name]!==pinned[name])throw Error('Retained shader drift: '+name);retained[name]=s.replace('#version 410','#version 300 es\nprecision highp float;\nprecision highp int;');}
const report={status:'running',at:new Date().toISOString(),sourceStart:await hashes(),retained:{root:shaderRoot,sha256:retainedHashes,adaptation:'Version and ES precision only; original shader bodies are otherwise verbatim.'},pageErrors:[]};
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true,hmr:false},logLevel:'error'});let browser,page;
try{await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));await page.route('**/point-cloud-verifier',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Source Roots point-cloud</title>'}));await page.goto(server.resolvedUrls.local[0]+'point-cloud-verifier');
 report.results=await page.evaluate(async({retained})=>{
  const {RootsNativePointCloudGpu}=await import('/src/engine/rootsNativePointCloudGpu.ts');
  const {RootsPointCloudRing}=await import('/src/engine/rootsPointCloudRing.ts');
  const {prepareRootsProjection}=await import('/src/engine/rootsProjection.ts');
  const {defaultRootsPresentationConfiguration}=await import('/src/engine/rootsPresentationConfig.ts');
  const {prepareRootsDensityColor,ROOTS_DENSITY_COLOR_VERSION}=await import('/src/engine/rootsDensityColor.ts');
  const check=(v,m)=>{if(!v)throw Error(m);};
  const digest=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength)))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const result=globalThis.__pointCloudResult={browser:navigator.userAgent,cases:[],boundaries:[],contexts:[]};
  const pgl=WebGL2RenderingContext.prototype,original={},contexts=new Map();let label='';
  const state=g=>{if(!contexts.has(g))contexts.set(g,{label,objects:[],deleteCalls:0,beforeLoss:null});return contexts.get(g);};
  for(const kind of ['Texture','Framebuffer','VertexArray','Buffer','Program','Shader'])for(const prefix of ['create','delete']){const name=prefix+kind,fn=pgl[name];original[name]=fn;pgl[name]=function(...a){const out=fn.apply(this,a),s=state(this);if(prefix==='create'&&out)s.objects.push({value:out,is:'is'+kind});if(prefix==='delete')s.deleteCalls++;return out;};}
  original.getExtension=pgl.getExtension;pgl.getExtension=function(name){const ext=original.getExtension.call(this,name);if(name!=='WEBGL_lose_context'||!ext)return ext;const gl=this;return{loseContext(){state(gl).beforeLoss=state(gl).objects.filter(v=>gl[v.is](v.value)).length;return ext.loseContext();},restoreContext(){return ext.restoreContext();}};};
  const HEADER='#version 300 es\nprecision highp float;precision highp int;\n';
  const fillVertex=HEADER+'void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}';
  const fillFragment=HEADER+'uniform vec4 fillColor;out vec4 pixel;void main(){pixel=fillColor;}';
  // Independent wrapper transcription from retained PGraphics.colorCalc and
  // packed fillColor; does not call production background/renderer helpers.
  function bg(packed,alpha){const f=Math.fround,gray=(packed>>>24)===0&&packed<=255;const b=gray?[packed,packed,packed,255]:[(packed>>>16)&255,(packed>>>8)&255,packed&255,packed>>>24];if(alpha!==undefined)b[3]=Math.trunc(f(b[3]*f(Math.min(255,Math.max(0,f(alpha)))/255)));return b.map(v=>f(v/255));}
  function oracle(w,h){
   const gl=new OffscreenCanvas(1,1).getContext('webgl2',{alpha:true,depth:false,antialias:false,premultipliedAlpha:false});check(gl,'No oracle WebGL2');const programs=[],shaders=[],textures=[];let buffer,vao,fb;
   const cleanup=()=>{gl.useProgram(null);gl.bindVertexArray(null);for(const[p,s]of shaders){gl.detachShader(p,s);gl.deleteShader(s);}for(const p of programs)gl.deleteProgram(p);if(buffer)gl.deleteBuffer(buffer);if(vao)gl.deleteVertexArray(vao);if(fb)gl.deleteFramebuffer(fb);for(const t of textures)gl.deleteTexture(t);gl.getExtension('WEBGL_lose_context').loseContext();};
   try{
    const program=(v,f)=>{const p=gl.createProgram();programs.push(p);for(const[type,text]of[[gl.VERTEX_SHADER,v],[gl.FRAGMENT_SHADER,f]]){const s=gl.createShader(type);shaders.push([p,s]);gl.shaderSource(s,text);gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);check(gl.getProgramParameter(p,gl.LINK_STATUS),gl.getProgramInfoLog(p));return p;};
    const p=program(retained['complex_roots_point_cloud.vert'],retained['complex_roots_point_cloud.frag']),fill=program(fillVertex,fillFragment);
    const texture=(width,height,filter)=>{const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,filter);for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);return t;};
    const target=texture(w,h,gl.NEAREST),lut=texture(256,1,gl.LINEAR);fb=gl.createFramebuffer();buffer=gl.createBuffer();vao=gl.createVertexArray();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Oracle FBO');
    const bind=()=>{gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.viewport(0,0,w,h);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);gl.disable(gl.RASTERIZER_DISCARD);gl.colorMask(true,true,true,true);gl.bindVertexArray(vao);};
    return{clear(packed){bind();gl.clearBufferfv(gl.COLOR,0,Float32Array.from(bg(packed)));},fade(packed,alpha){bind();gl.useProgram(fill);gl.uniform4fv(gl.getUniformLocation(fill,'fillColor'),bg(packed,alpha));gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE);gl.drawArrays(gl.TRIANGLES,0,3);},draw(plan,color,raw){bind();gl.useProgram(p);const loc=n=>gl.getUniformLocation(p,n);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.uniformMatrix4fv(loc('projection'),false,plan.projection.columnMajor);gl.uniformMatrix4fv(loc('modelview'),false,plan.modelView.columnMajor);gl.uniform1f(loc('pointSize'),plan.pointCloudUniformSize);gl.uniform1f(loc('rotationDegrees'),plan.transform.rotationDegrees);gl.uniform3fv(loc('scaleVec'),plan.transform.scale);gl.uniform3fv(loc('offsetVec'),plan.transform.offset);for(const k of ['brightness','contrast','gamma','dynamicRange','saturation','paletteOffset'])gl.uniform1f(loc(k),color[k]);gl.uniform3fv(loc('backgroundRgb'),color.backgroundRGB);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,lut);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,1,gl.RGBA,gl.UNSIGNED_BYTE,color.lut);gl.uniform1i(loc('paletteTex'),0);
     const data=Float32Array.from(raw);for(let i=3;i<data.length;i+=4)data[i]=data[i]<0?0:data[i]>1?1:data[i];gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STREAM_DRAW);const xyz=gl.getAttribLocation(p,'rootPosition'),metric=gl.getAttribLocation(p,'pointMetric');gl.enableVertexAttribArray(xyz);gl.enableVertexAttribArray(metric);gl.vertexAttribPointer(xyz,3,gl.FLOAT,false,16,0);gl.vertexAttribPointer(metric,1,gl.FLOAT,false,16,12);gl.drawArrays(gl.POINTS,0,data.length/4);check(gl.getError()===gl.NO_ERROR,'Oracle draw');},read(){const b=new Uint8Array(w*h*4),a=new Uint8Array(b.length);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b);check(gl.getError()===gl.NO_ERROR,'Oracle read');for(let y=0;y<h;y++)a.set(b.subarray((h-1-y)*w*4,(h-y)*w*4),y*w*4);return a;},dispose:cleanup};
   }catch(error){cleanup();throw error;}
  }
  const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],mat=a=>({rowMajor:a.map(Math.fround),columnMajor:Float32Array.from(Array.from({length:16},(_,i)=>a[(i%4)*4+Math.floor(i/4)]))});
  function plan(w,h,size=4,o={}){const c=defaultRootsPresentationConfiguration();c.mode='point-cloud';c.camera.phi=0;Object.assign(c.camera,o.camera);c.accumulation.enabled=!!o.ortho;const p=prepareRootsProjection(c,{width:w,height:h,viewport:{logicalWidth:w,logicalHeight:h,referenceLogicalHeight:h,target:'primary'}});if(o.sourcePlan)return p;const d=Math.fround(size/.01);return{...p,densityDiameter:d,pointsDiameter:Math.max(d,1),quadDiameter:Math.max(Math.fround(d*Math.fround(.6)),Math.fround(.8)),pointCloudUniformSize:Math.fround(d*Math.fround(.01)),transform:{...p.transform,scale:o.scale??[1,1,1],offset:o.offset??[0,0,0],rotationDegrees:o.rotation??0},projection:mat(o.projection??I),modelView:mat(o.modelView??I)};}
  function color(o={}){return prepareRootsDensityColor({settings:{rootDensityColorVersion:ROOTS_DENSITY_COLOR_VERSION,background:o.background??'#102030',...o.tone},rootsSourcePalette:{colors:o.colors??['#FF0000','#0000FF']}});}
  const fixtures=[
   {id:'raw-full-z-and-no-depth-sort',raw:[0,0,-.5,0,0,0,.5,.9],size:7},
   {id:'reverse-arrival',raw:[0,0,.5,.9,0,0,-.5,0],size:7},
   {id:'subpixel005',raw:[0,0,0,.3],size:.005},{id:'subpixel010',raw:[0,0,0,.3],size:.01},{id:'subpixel125',raw:[0,0,0,.3],size:.125},
   {id:'circle-antialias',raw:[-.3,.2,0,.1,.3,-.2,0,.8],size:8.3},
   {id:'shader-rotation-scale-offset',raw:[.2,.3,.1,.1,-.1,-.2,-.5,.9],options:{rotation:73.13,scale:[2,.5,1.2],offset:[.05,-.3,.2]}},
   {id:'large-glsl-angle',raw:[.3,.2,.1,.1,-.2,-.3,0,.9],options:{rotation:1e7}},
   {id:'noncommuting-mvp',raw:[.3,.1,-.5,.2,-.3,.2,-1,.8],options:{modelView:[0,-1,0,.1,1,0,0,-.2,0,0,1,0,0,0,0,1],projection:[1,0,0,0,0,1,0,0,0,0,-1,-.2,0,0,-1,0]}},
   {id:'clipped-and-behind',raw:[0,0,-1,.2,3,2,-1,.7,0,0,1,.9],options:{projection:[1,0,0,0,0,1,0,0,0,0,-1,-.2,0,0,-1,0]}},
   {id:'metric-infinity-clamp',raw:[-.2,0,0,-Infinity,.2,0,0,Infinity]},
   {id:'tone-low-exposure',raw:[0,0,0,.5],color:{tone:{rootSourceBrightness:-.5,rootSourceContrast:.1,rootSourceGamma:.1,rootSourceDynamicRange:.1,rootSourceSaturation:0}}},
   {id:'tone-high-saturation-offset',raw:[-.2,0,0,.2,.2,0,0,.8],color:{tone:{rootSourceBrightness:1.5,rootSourceContrast:2,rootSourceGamma:10,rootSourceSaturation:1,rootSourcePaletteOffset:-.3}}},
   {id:'empty-white-palette',raw:[0,0,0,.8],color:{colors:[]}},
   {id:'transparent-argb-background',raw:[0,0,0,.8],color:{background:'#80112233',colors:['#80FF0000']}},
   {id:'numeric-gray-background',raw:[0,0,0,.8],color:{background:'1'}},
   {id:'source-perspective',raw:[0,0,0,.2,.04,.02,.3,.8],options:{sourcePlan:true,camera:{phi:.31,theta:.4,gamma:-.2}}},
   {id:'source-ortho',raw:[0,0,0,.2,.04,.02,.3,.8],options:{sourcePlan:true,ortho:true,camera:{phi:.31,theta:.4,gamma:-.2}}},
  ];
  const compare=async(id,a,b,extra={})=>{let different=0,maxDifference=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])different++;maxDifference=Math.max(maxDifference,Math.abs(a[i]-b[i]));}check(different===0,id+' mismatch '+different+'/'+maxDifference);result.cases.push({id,bytesCompared:a.length,different,maxDifference,sha256:await digest(a),...extra});};
  let primaryFailure;
  try{
   for(const f of fixtures){const w=37,h=29,p=plan(w,h,f.size??5,f.options),c=color(f.color),r=new RootsPointCloudRing({capacityPoints:32,recentWindowPoints:32}),g=new RootsNativePointCloudGpu();let o;
    try{r.append(Float32Array.from(f.raw));label='production:'+f.id;g.initialize(w,h);g.clear(c.backgroundPacked);g.draw(p,c,r);const actual=g.readback();label='retained:'+f.id;o=oracle(w,h);o.clear(c.backgroundPacked);o.draw(p,c,f.raw);await compare(f.id,actual,o.read(),{facts:g.diagnostics()});}finally{o?.dispose();g.dispose();r.dispose();}
   }
   check(result.cases[0].sha256!==result.cases[1].sha256,'Arrival order did not affect alpha-over result');
   // Wrapped small ring has independent expected tail order, unrelated to its
   // own window implementation. Read/fade/draw persist the same target.
   label='history';const g=new RootsNativePointCloudGpu(),r=new RootsPointCloudRing({capacityPoints:5,recentWindowPoints:3}),p=plan(19,17,7),c=color({background:'#80112233'});let o;
   try{g.initialize(19,17);label='retained:history';o=oracle(19,17);const all=[];for(let i=0;i<8;i++){all.push(0,0,(i-4)/10,i/8);r.append(Float32Array.from(all.slice(-4)));}const expected=all.slice(-12);g.clear(c.backgroundPacked);o.clear(c.backgroundPacked);
    for(const [i,alpha]of [0,6.9,255,0].entries()){if(i){g.fade(c.backgroundPacked,alpha);o.fade(c.backgroundPacked,alpha);}g.draw(p,c,r);o.draw(p,c,expected);await compare('wrapped-history-frame'+i,g.readback(),o.read(),{fadeAlpha:i?alpha:null});}
    const old=await digest(g.readback());c.lut[0]^=127;g.clear(c.backgroundPacked);o.clear(c.backgroundPacked);g.draw(p,c,r);o.draw(p,c,expected);await compare('lut-in-place-change',g.readback(),o.read(),{previousHistoryDigest:old});
   }finally{o?.dispose();g.dispose();r.dispose();}
   // A completed native-size 3M window, not only initialization. All omitted
   // 2,999,999 points are analytically clipped by identity; newest point is kept.
   label='native-3m';const large=new RootsPointCloudRing(),largeGpu=new RootsNativePointCloudGpu();let oracleLarge;
   try{large.append(Float32Array.of(0,0,0,0));const chunk=new Float32Array(65536*4);for(let i=0;i<65536;i++)chunk.set([3,3,0,.1],i*4);let left=2_999_999;while(left){const n=Math.min(left,65536);large.append(chunk,{pointCount:n});left-=n;}large.append(Float32Array.of(0,0,0,.9));const pp=plan(7,7,3),cc=color();largeGpu.initialize(7,7);largeGpu.clear(cc.backgroundPacked);largeGpu.draw(pp,cc,large);const a=largeGpu.readback();check(largeGpu.diagnostics().drawnPoints===3_000_000&&largeGpu.diagnostics().completedFrames===1,'3M window not completed');label='retained:3m-survivor';oracleLarge=oracle(7,7);oracleLarge.clear(cc.backgroundPacked);oracleLarge.draw(pp,cc,[0,0,0,.9]);await compare('native-3m-completed-window',a,oracleLarge.read(),{facts:largeGpu.diagnostics(),ringBytes:large.facts.allocatedBytes,expected:'Independent identity clip: only the newest center point survives; the oldest center point is outside recent3M.'});}finally{oracleLarge?.dispose();largeGpu.dispose();large.dispose();}
   label='boundaries';const q=new RootsNativePointCloudGpu(),rr=new RootsPointCloudRing({capacityPoints:8}),pp=plan(11,9),cc=color();rr.append(Float32Array.of(0,0,0,.5));
   try{q.initialize(11,9);let n=0,e;try{q.draw(pp,cc,rr,{isCancelled:()=>++n===4});}catch(x){e=x;}check(e?.name==='AbortError'&&q.diagnostics().handles===0,'Cancel not propagated');result.boundaries.push({id:'cancel-and-release',checks:n});q.initialize(11,9);q.clear(cc.backgroundPacked);q.draw(pp,cc,rr);q.readback();result.boundaries.push({id:'cancel-recovery'});
    const lost=q.gl;lost.getExtension('WEBGL_lose_context').loseContext();let loss;try{q.readback();}catch(x){loss=x;}check(loss?.failureKind==='device'&&q.diagnostics().handles===0,'Real context loss');q.initialize(11,9);q.clear(cc.backgroundPacked);q.draw(pp,cc,rr);q.readback();result.boundaries.push({id:'real-context-loss-and-recovery'});
    const read=pgl.readPixels;try{pgl.readPixels=function(x,y,w,h,format,type,data){return read.call(this,x,y,w,h-1,format,type,data);};let short;try{q.readback();}catch(x){short=x;}check(short?.failureKind==='device'&&q.diagnostics().handles===0,'Partial RGBA8 read accepted');result.boundaries.push({id:'controlled-short-read-detected'});}finally{pgl.readPixels=read;}
    const draw=pgl.drawArrays;try{pgl.drawArrays=function(mode,first,count){return draw.call(this,mode,first,0);};let empty;try{q.initialize(11,9);}catch(x){empty=x;}check(empty?.failureKind==='device'&&empty.message.includes('fallback is unavailable'),'Unsupported point silently fell back');result.boundaries.push({id:'real-zero-probe-no-shape-fallback'});}finally{pgl.drawArrays=draw;}
   }finally{q.dispose();rr.dispose();}
   return result;
  }catch(e){primaryFailure=e;throw e;}finally{
   result.contexts=Array.from(contexts.values()).map((s,index)=>({index,label:s.label,created:s.objects.length,deleteCalls:s.deleteCalls,liveImmediatelyBeforeContextLoss:s.beforeLoss}));
   for(const[name,fn]of Object.entries(original))pgl[name]=fn;
   result.cleanup={valid:result.contexts.every(s=>s.liveImmediatelyBeforeContextLoss!==null)&&result.contexts.filter(s=>s.liveImmediatelyBeforeContextLoss>0).every(s=>s.label==='boundaries'),intentionalExternalLoss:result.contexts.filter(s=>s.liveImmediatelyBeforeContextLoss>0)};
   if(!primaryFailure)check(result.cleanup.valid,'Unreleased GL resources');
  }
 },{retained});
 report.sourceEnd=await hashes();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);if(!report.sourceStable)throw Error('Source drift');if(report.pageErrors.length)throw Error(report.pageErrors.join(';'));report.status='passed';
}catch(error){report.status='failed';report.error={name:error.name,message:error.message,stack:error.stack};report.partial=await page?.evaluate(()=>globalThis.__pointCloudResult).catch(()=>undefined);report.sourceEnd=await hashes();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);process.exitCode=1;}
finally{await browser?.close();await server.close();report.closed={browser:true,vite:true};report.limitations=['No original app/JVM/class execution. Independent retained shader ES300 adaptation proves this WebGL2 fixture scope, not original GL410/driver/MSAA equivalence.','RGBA8 explicit target is a local display representation; alpha bytes are preserved and wrapper/order semantics are independently compared. Original platform framebuffer format and multisampling differ potentially.','Prepared color LUT and ancillary source-plan facts are shared contracts; manual matrix cases isolate shader paths, not a complete independent camera proof.','3M complete-window case uses independent identity clipping and survivor oracle; it is a functional task, not a performance benchmark. CPU/RSS/tokens were not measured.','NaN metric is an explicit local input error; raw XYZ is not CPU-filtered. Shader nonfinite positions/transcendentals remain driver-dependent.','Native-PShape fallback is not implemented or substituted. Device failure is explicit.'];await mkdir('.cache',{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,status:report.status,cases:report.results?.cases.length,boundaries:report.results?.boundaries.length,sourceStable:report.sourceStable,error:report.error?.message}));}
