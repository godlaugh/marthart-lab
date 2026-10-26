import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {inflateSync} from 'node:zlib';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// Chrome's Canvas PNG may be RGB8, whereas the exact RGBA encoder emits RGBA8.
// Compare decoded pixels, not compression choices. This small verifier is
// bounded to its own <= 1 MP fixtures and validates every chunk's CRC.
export function pngFacts(bytes){
 assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PNG signature');
 let width=0,height=0,channels=0,ended=false;const compressed=[];
 for(let at=8;at<bytes.length;){
  assert.ok(at+12<=bytes.length,'PNG chunk header');const length=bytes.readUInt32BE(at),end=at+length+12;
  assert.ok(end<=bytes.length,'PNG chunk bounds');const type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,end-4);
  let crc=-1;for(const value of bytes.subarray(at+4,end-4)){crc^=value;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
  assert.equal(((crc^-1)>>>0),bytes.readUInt32BE(end-4),'PNG CRC');
  if(type==='IHDR'){
   assert.equal(length,13);assert.equal(width,0);width=data.readUInt32BE(0);height=data.readUInt32BE(4);
   assert.ok(width>0&&height>0&&width*height<=1_000_000,'Verifier PNG pixel bound');
   assert.equal(data[8],8);assert.ok([2,6].includes(data[9]));assert.ok(data.subarray(10).equals(Buffer.from([0,0,0])));channels=data[9]===6?4:3;
  }else if(type==='IDAT')compressed.push(data);
  else if(type==='IEND'){assert.equal(length,0);assert.equal(end,bytes.length);ended=true;}
  at=end;
 }
 assert.ok(ended&&channels&&compressed.length,'Complete PNG');
 const stride=width*channels,raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:(stride+1)*height});
 assert.equal(raw.length,(stride+1)*height);const rows=Buffer.alloc(stride*height),rgba=Buffer.alloc(width*height*4);
 const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
 for(let y=0;y<height;y++){
  const filter=raw[y*(stride+1)];assert.ok(filter<=4,'PNG filter');
  for(let x=0;x<stride;x++){const a=x>=channels?rows[y*stride+x-channels]:0,b=y?rows[(y-1)*stride+x]:0,c=y&&x>=channels?rows[(y-1)*stride+x-channels]:0;rows[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}
 }
 const colors=new Set();for(let i=0;i<width*height;i++){for(let c=0;c<3;c++)rgba[i*4+c]=rows[i*channels+c];rgba[i*4+3]=channels===4?rows[i*channels+3]:255;colors.add(rgba.readUInt32LE(i*4));}
 return{width,height,rgbaSha256:sha(rgba),colors:colors.size};
}

function native(output,label){
 assert.equal(output.type,'raster',label+': raster');assert.equal(output.backend,'native',label+': backend');
 assert.equal(output.domainRender?.effective.backend,'native',label+': completed Domain route');
 assert.equal(output.pixelRenderer?.backend,'native',label+': acknowledged renderer');
 assert.match(output.pixelRenderer.identity,/^[a-f0-9]{64}$/i,label+': renderer identity');
 assert.ok(Number.isSafeInteger(output.pixelRenderer.generation)&&output.pixelRenderer.generation>0);
 assert.ok(Number.isSafeInteger(output.pixelRenderer.sequence)&&output.pixelRenderer.sequence>0);
 assert.equal(output.stats.generated,output.width*output.height,label+': complete opaque layer coverage');
 assert.ok(output.formulas,label+': actual frame formula presentation');
}
function sameClock(before,after,label){
 for(const key of ['sessionId','revision','sceneTime','queueIndex','updateOrdinal'])assert.equal(after[key],before[key],label+': '+key);
}

/** Actual public App controls, Generator completions, ArtRenderer delivery and
 * downloaded files. No original application or original display timing oracle.
 * The caller owns the browser/Vite/export service and the sole GPU run window.
 */
export async function verifyDomainNativeUi(browser,origin,root,input){
 assert.equal(input?.type,'DOMAIN_COLORING','Expected original Domain JSON');
 assert.equal(input.domainColoring?.formula,'z','This fixture derives from zero_linear_demo');
 assert.equal(input.domainColoring?.iteration?.nextFormula.replace(/\s/g,''),'sin(w+z^2)','Preserve the known input formula before declaring the test variation');
 await mkdir(root,{recursive:true});
 const source=structuredClone(input);source.name='Native Domain application acceptance';
 source.domainColoring.formulaParams={...source.domainColoring.formulaParams,a:1};source.parameters={...source.parameters,a:1};
 source.domainColoring.iteration.nextFormula='sin(w + a*z^2)';
 source.timeline=[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'domainRotate',args:[.3]}]}];
 const result={status:'running',scope:'Product UI native Domain import, playback, hot parameter, navigation, PNG and short recording. No original application frame-timing or whole-window parity claim.',
  limits:['Passive public-return hashing adds observation overhead; it does not measure original or uninstrumented frame timing.','One explicitly modified zero_linear_demo configuration and small exports, not arbitrary formula/load coverage.','Video encoding is lossy: uploaded PNG pixels are exact, decoded MP4 is checked for dimensions, frame count, rate and animation.','Opaque-layer coverage statistics do not measure invalid numerical orbits.'],
  inputSha256:sha(Buffer.from(JSON.stringify(input))),source,
  testConfiguration:{originalName:input.name,originalNextFormula:input.domainColoring.iteration.nextFormula,nextFormula:source.domainColoring.iteration.nextFormula,parameter:'a',initialValue:1,hotValue:.7,timeline:source.timeline,explanation:'Explicit UI test variation: the existing a parameter now multiplies z^2 (a=1 keeps the original initial recurrence); a one-second rotation makes short recording visibly change. Other original formula, iteration, palette and display settings are retained.'}};
 await writeFile(root+'/app-domain-input.json',JSON.stringify(source,null,2)+'\n');
 const page=await browser.newPage({viewport:{width:1120,height:760},deviceScaleFactor:1,acceptDownloads:true});page.setDefaultTimeout(60000);
 const pageErrors=[],consoleErrors=[],requestFailures=[],exports=[],uploads=[];let phase='setup';
 page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 page.on('requestfailed',r=>requestFailures.push({url:r.url(),failure:r.failure()}));
 page.on('request',r=>{
  const url=new URL(r.url());if(r.method()!=='POST')return;
  if(url.pathname==='/api/exports')exports.push(JSON.parse(r.postData()));
  if(/^\/api\/exports\/[^/]+\/frames$/.test(url.pathname))uploads.push({url:r.url(),index:Number(url.searchParams.get('index')),bytes:r.postDataBuffer()});
 });
 const stage=name=>{phase=name;console.log(JSON.stringify({uiStage:'domain-'+name}));};
 const button=name=>page.getByRole('button',{name,exact:true});
 const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
 const sequence=()=>page.evaluate(()=>window.__nativeDomainUi.sequence);
 const latest=()=>page.evaluate(()=>{const a=window.__nativeDomainUi;for(let i=a.rendered.length-1;i>=0;i--){const d=a.deliveries.find(d=>d.id===a.rendered[i].delivery);if(d?.output.live?.target==='primary')return d;}throw Error('No actual primary renderer delivery');});
 const primaryAfter=async after=>{
  await page.waitForFunction(after=>{const a=window.__nativeDomainUi;return a.deliveries.some(d=>d.sequence>after&&d.output.live?.target==='primary'&&a.rendered.some(r=>r.delivery===d.id));},after);
  await ready();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return latest();
 };
 const pause=async()=>{
  if(await button('Pause').count()){
   const after=await sequence();await button('Pause').click();await button('Play').waitFor();
   await page.waitForFunction(after=>window.__nativeDomainUi.calls.some(c=>c.sequence>after&&c.operation==='pause'&&c.paused&&c.completed),after);
  }
  await ready();return latest();
 };
 const expected=async key=>{
  const encoded=await page.evaluate(key=>window.__nativeDomainExpectedPng(key),key),bytes=Buffer.from(encoded,'base64');
  const file=root+'/app-domain-expected-'+key.replace(':','-')+'.png';await writeFile(file,bytes);
  return{file,pngSha256:sha(bytes),decoded:pngFacts(bytes)};
 };
 try{
  await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'fixture');
  await page.evaluate(async()=>{
   const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');
   const scene=createScene(definition('surface'));Object.assign(scene.settings,{uSegments:3,vSegments:3,showTrails:false});
   saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:20}});
  });
  await page.goto(origin);await ready();
  await page.evaluate(async()=>{
   const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts');
   const originals=Object.fromEntries(['generate','setDomainPaused','updateDomainParameters','navigateDomainPaused','captureDomainPaused','beginSourceRecording','nextSourceRecordingFrame','finishSourceRecording'].map(k=>[k,Generator.prototype[k]]));
   const set=ArtRenderer.prototype.setOutput,owners=new WeakMap(),recordings=new WeakSet(),outputs=new Map();
   const audit=window.__nativeDomainUi={sequence:0,calls:[],deliveries:[],rendered:[],errors:[]};
   const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
   const facts=async output=>({type:output.type,width:output.width,height:output.height,backend:output.backend,pixelRenderer:structuredClone(output.sourcePixelRenderer),domainRender:structuredClone(output.domainRender),sourceClock:structuredClone(output.sourceClock),live:structuredClone(output.domainLive),image:structuredClone(output.sourceCurrentImage),pausedImage:structuredClone(output.sourcePausedImage),formulas:structuredClone(output.formulaPresentation),stats:structuredClone(output.stats),pixelSha256:await hash(output.pixels)});
   const call=(operation,details={})=>{const row={sequence:++audit.sequence,operation,...details};audit.calls.push(row);return row;};
   const publish=async(output,row,role)=>{const d={id:audit.deliveries.length+1,sequence:row.sequence,role,output:await facts(output)};audit.deliveries.push(d);owners.set(output,d.id);return d.id;};
   const fail=(row,error)=>{row.error={name:error?.name,message:String(error),kind:error?.kind};if(error?.name!=='AbortError')audit.errors.push({sequence:row.sequence,...row.error});};
   window.__nativeDomainExpectedPng=async key=>{
    const output=outputs.get(key);if(!output)throw Error('No actual completed output for '+key);
    const{encodeFormulaRaster}=await import('/src/engine/formulaCanvas.ts');const bytes=new Uint8Array(await(await encodeFormulaRaster(output)).arrayBuffer());
    if(bytes.length>8*1024*1024)throw Error('Verifier PNG limit');let binary='';for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(binary);
   };
   Generator.prototype.generate=async function(scene,context,...args){
    if(scene.kind!=='domain')return originals.generate.call(this,scene,context,...args);
    const row=call('generate',{scene:structuredClone(scene),context:structuredClone(context)});
    try{const output=await originals.generate.call(this,scene,context,...args);row.delivery=await publish(output,row,'generate');if(!context.domainLive&&context.quality==='export')outputs.set('replay',output);row.completed=true;return output;}catch(error){fail(row,error);throw error;}
   };
   Generator.prototype.setDomainPaused=async function(output,paused,...args){
    const row=call('pause',{source:owners.get(output),paused});
    try{const result=await originals.setDomainPaused.call(this,output,paused,...args);row.completed=true;return result;}catch(error){fail(row,error);throw error;}
   };
   Generator.prototype.updateDomainParameters=async function(output,scene,writes,...args){
    const row=call('parameters',{source:owners.get(output),writes:structuredClone(writes)});
    try{const result=await originals.updateDomainParameters.call(this,output,scene,writes,...args);row.completed=true;return result;}catch(error){fail(row,error);throw error;}
   };
   Generator.prototype.navigateDomainPaused=async function(output,event,...args){
    const row=call('navigation',{source:owners.get(output),event:structuredClone(event)});
    try{const result=await originals.navigateDomainPaused.call(this,output,event,...args);row.delivery=await publish(result,row,'navigation');row.completed=true;return result;}catch(error){fail(row,error);throw error;}
   };
   Generator.prototype.captureDomainPaused=async function(output,...args){
    const row=call('capture',{source:owners.get(output),input:structuredClone(args)});
    try{const result=await originals.captureDomainPaused.call(this,output,...args);row.capture=await publish(result.capture,row,'capture');row.preview=await publish(result.preview,row,'capture-preview');outputs.set('current',result.capture);row.completed=true;return result;}catch(error){fail(row,error);throw error;}
   };
   Generator.prototype.beginSourceRecording=async function(output,options,...args){
    if(!output.domainLive)return originals.beginSourceRecording.call(this,output,options,...args);
    const row=call('recording-begin',{source:owners.get(output),options:structuredClone(options)});
    try{const result=await originals.beginSourceRecording.call(this,output,options,...args);recordings.add(result.handle);row.clock=structuredClone(result.clock);row.warmup=await publish(result.warmup,row,'warmup');row.completed=true;return result;}catch(error){fail(row,error);throw error;}
   };
   Generator.prototype.nextSourceRecordingFrame=async function(handle,displayFrame,actualFrameRate,...args){
    if(!recordings.has(handle))return originals.nextSourceRecordingFrame.call(this,handle,displayFrame,actualFrameRate,...args);
    const row=call('recording-frame',{displayFrame,actualFrameRate});
    try{const output=await originals.nextSourceRecordingFrame.call(this,handle,displayFrame,actualFrameRate,...args);row.delivery=await publish(output,row,'recording-frame');outputs.set('frame:'+displayFrame,output);row.completed=true;return output;}catch(error){fail(row,error);throw error;}
   };
   Generator.prototype.finishSourceRecording=async function(handle,...args){
    if(!recordings.has(handle))return originals.finishSourceRecording.call(this,handle,...args);
    const row=call('recording-finish');
    try{const result=await originals.finishSourceRecording.call(this,handle,...args);row.preview=await publish(result.preview,row,'recording-preview');row.completed=true;return result;}catch(error){fail(row,error);throw error;}
   };
   ArtRenderer.prototype.setOutput=function(output,...args){
    const result=set.call(this,output,...args),delivery=owners.get(output);
    if(delivery)audit.rendered.push({delivery,canvasWidth:this.renderer.domElement.width,canvasHeight:this.renderer.domElement.height});return result;
   };
  });
  stage('import');
  await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'native-domain.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
  let current=await primaryAfter(0);native(current.output,'import');
  assert.equal(current.output.live.clockSource,'page-wall-clock');assert.equal(current.output.live.paused,true);assert.equal(current.output.live.updateOrdinal,0);
  result.preview=current;await page.screenshot({path:root+'/app-native-domain.png'});
  const canvas=page.locator('canvas[data-testid="art-canvas"]:not([data-native-hidden="true"]):visible');
  result.presentedCanvas=await canvas.evaluate(async el=>{
   const gl=el.getContext('webgl2');if(!gl||gl.isContextLost())throw Error('No actual presented WebGL2 canvas');
   const pixels=new Uint8Array(el.width*el.height*4);gl.readPixels(0,0,el.width,el.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError()!==gl.NO_ERROR)throw Error('Canvas readback failed');
   let nonuniform=0;for(let i=4;i<pixels.length;i+=4)if(pixels[i]!==pixels[0]||pixels[i+1]!==pixels[1]||pixels[i+2]!==pixels[2])nonuniform++;
   return{width:el.width,height:el.height,nonuniformPixels:nonuniform,rgbaSha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).map(v=>v.toString(16).padStart(2,'0')).join('')};
  });assert.ok(result.presentedCanvas.nonuniformPixels>0,'Actual displayed canvas contains nonuniform artwork');

  stage('play-pause');const playAfter=await sequence();await button('Play').click();
  await page.waitForFunction(after=>window.__nativeDomainUi.deliveries.some(d=>d.sequence>after&&d.output.live?.sceneTime>.15&&!d.output.live.paused),playAfter);
  current=await pause();native(current.output,'play-pause');assert.ok(current.output.live.sceneTime>0);assert.equal(current.output.live.clockSource,'page-wall-clock');result.playPause=current;

  stage('hot-parameter');const beforeHot=current,hotAfter=await sequence();await page.locator('#param-a').fill('.7');await page.locator('#param-a').press('Enter');
  current=await primaryAfter(hotAfter);native(current.output,'hot parameter');sameClock(beforeHot.output.live,current.output.live,'Hot parameter retains clock');
  assert.equal(current.output.live.presentation.parameters.a,.7);assert.notEqual(current.output.pixelSha256,beforeHot.output.pixelSha256,'Used hot parameter changes actual pixels');
  assert.ok(await page.evaluate(after=>window.__nativeDomainUi.calls.some(c=>c.sequence>after&&c.operation==='parameters'&&c.completed&&c.writes.some(([name,value])=>name==='a'&&value===.7)),hotAfter),'Hot parameter used public retained update');result.hotParameter=current;

  stage('navigation');const beforePan=current,panAfter=await sequence(),bounds=await canvas.boundingBox();assert.ok(bounds);
  await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.5+32,bounds.y+bounds.height*.5+12);await page.mouse.up();
  current=await primaryAfter(panAfter);native(current.output,'pan');sameClock(beforePan.output.live,current.output.live,'Pan retains clock');
  assert.notEqual(current.output.live.presentation.settings.centerX,beforePan.output.live.presentation.settings.centerX);result.pan=current;
  const beforeWheel=current,wheelAfter=await sequence();await page.mouse.wheel(0,160);current=await primaryAfter(wheelAfter);native(current.output,'wheel');sameClock(beforeWheel.output.live,current.output.live,'Wheel retains clock');
  assert.notEqual(current.output.live.presentation.settings.scale,beforeWheel.output.live.presentation.settings.scale);
  const navigation=await page.evaluate(after=>window.__nativeDomainUi.calls.filter(c=>c.sequence>after&&c.operation==='navigation'&&c.completed),panAfter);
  assert.ok(navigation.some(c=>c.event.kind==='pan'));assert.ok(navigation.some(c=>c.event.kind==='wheel'&&Number.isInteger(c.event.count)));result.wheel=current;

  for(const mode of ['current','replay']){
   stage(mode+'-png');const prior=await latest(),after=await sequence();await button('Export artwork').click();
   await page.getByRole('combobox',{name:'Domain image source',exact:true}).selectOption(mode);
   if(mode==='current')await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('1');
   await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
   await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('96');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('80');
   const[download]=await Promise.all([page.waitForEvent('download'),button('Start export').click()]);const file=root+'/app-domain-'+mode+'.png';await download.saveAs(file);
   const bytes=await readFile(file),decoded=pngFacts(bytes),reference=await expected(mode);
   assert.equal(decoded.width,96);assert.equal(decoded.height,80);assert.ok(decoded.colors>1);
   assert.deepEqual(decoded,reference.decoded,'Downloaded '+mode+' PNG pixels equal encodeFormulaRaster of its actual completed output');
   const actual=await page.evaluate(({after,mode})=>{const a=window.__nativeDomainUi,c=a.calls.findLast(c=>c.sequence>after&&(mode==='current'?c.operation==='capture'&&c.completed:c.operation==='generate'&&c.completed&&!c.context.domainLive&&c.context.quality==='export'));if(!c)throw Error('Missing public export completion');return{call:c,output:a.deliveries.find(d=>d.id===(mode==='current'?c.capture:c.delivery)).output,preview:mode==='current'?a.deliveries.find(d=>d.id===c.preview).output:undefined};},{after,mode});
   native(actual.output,mode+' PNG');assert.ok(actual.output.formulas.labels.length>0,'Original enabled formula metadata retained');
   if(mode==='current'){
    assert.equal(actual.output.image.scale,1);assert.equal(actual.output.live.target,'offscreen');sameClock(prior.output.live,actual.output.live,'Capture retains clock');sameClock(prior.output.live,actual.preview.live,'Capture restores clock');
    assert.equal(actual.preview.pixelSha256,prior.output.pixelSha256,'Current PNG restores exact prior primary pixels');
    await page.waitForFunction(id=>window.__nativeDomainUi.rendered.some(r=>r.delivery===id),actual.call.preview);
   }else{assert.equal(actual.output.image,undefined);assert.equal(actual.output.live,undefined);}
   result[mode]={file,pngSha256:sha(bytes),decoded,reference,...actual};await button('Close export').click();await ready();
  }

  // Rebuild through the real Apply button so recording starts at a documented
  // zero-time paused state even when the preceding replay export used time=1.
  stage('recording-apply');const applyAfter=await sequence();await page.getByTestId('domain-apply').click();current=await primaryAfter(applyAfter);
  assert.equal(current.output.live.sceneTime,0);assert.equal(current.output.live.updateOrdinal,0);assert.equal(current.output.live.paused,true);assert.equal(current.output.live.presentation.parameters.a,.7);
  stage('recording');const recordingAfter=await sequence(),uploadsBefore=uploads.length,exportsBefore=exports.length;
  await button('Record').click();await page.getByRole('dialog',{name:'Domain recording',exact:true}).waitFor();
  for(const[name,value]of [['Export width','64'],['Export height','48'],['Export frame rate','4']])await page.getByRole('spinbutton',{name,exact:true}).fill(value);
  const[download]=await Promise.all([page.waitForEvent('download',{timeout:90000}),button('Start recording').click()]);
  const videoFile=root+'/app-domain-recording.mp4';await download.saveAs(videoFile);
  await page.waitForFunction(after=>window.__nativeDomainUi.calls.some(c=>c.sequence>after&&c.operation==='recording-finish'&&c.completed),recordingAfter);
  const recording=await page.evaluate(after=>{
   const a=window.__nativeDomainUi,calls=a.calls.filter(c=>c.sequence>after&&c.completed),begin=calls.find(c=>c.operation==='recording-begin'),stop=calls.find(c=>c.operation==='recording-finish');
   const delivered=id=>a.deliveries.find(d=>d.id===id).output;
   return{begin,warmup:delivered(begin.warmup),frames:calls.filter(c=>c.operation==='recording-frame').map(call=>({call,output:delivered(call.delivery)})),stop,preview:delivered(stop.preview)};
  },recordingAfter);
  assert.equal(recording.begin.clock.encodedFrames,3,'One-second 4 FPS queue has one warmup and three encoded frames');assert.equal(recording.frames.length,3);
  native(recording.warmup,'recording warmup');assert.equal(recording.warmup.live.recording.warmup,true);assert.equal(recording.warmup.live.clockSource,'fixed-step');
  const actualUploads=uploads.slice(uploadsBefore);assert.equal(actualUploads.length,3,'Only encoded frames uploaded');assert.equal(exports.length-exportsBefore,1);
  for(let i=0;i<recording.frames.length;i++){
   const frame=recording.frames[i],live=frame.output.live;native(frame.output,'recording frame '+i);
   assert.equal(frame.call.displayFrame,i+1);assert.equal(live.clockSource,'fixed-step');assert.equal(live.rawDt,.25);assert.equal(live.recording.simulationFps,4);assert.equal(live.updateOrdinal,i+1);
   assert.ok(Number.isFinite(frame.call.actualFrameRate));assert.ok(Object.is(live.actualFrameRate,Math.fround(frame.call.actualFrameRate)),'Observed FPS preserved separately from simulation FPS');
   const upload=actualUploads[i];assert.equal(upload.index,i);const reference=await expected('frame:'+(i+1)),decoded=pngFacts(upload.bytes);
   assert.deepEqual(decoded,reference.decoded,'Uploaded video PNG equals composition of actual public frame');
   const file=root+'/app-domain-upload-'+i+'.png';await writeFile(file,upload.bytes);frame.upload={file,index:i,pngSha256:sha(upload.bytes),decoded,reference};
  }
  native(recording.preview,'recording stop preview');sameClock(recording.frames.at(-1).output.live,recording.preview.live,'Stop preserves last recorded clock');
  assert.equal(recording.preview.live.target,'primary');assert.equal(recording.preview.live.clockSource,'page-wall-clock');assert.equal(recording.preview.live.paused,false);
  await page.waitForFunction(id=>window.__nativeDomainUi.rendered.some(r=>r.delivery===id),recording.stop.preview);
  const exportRequest=exports.at(-1);assert.equal(exportRequest.profile,'mathart');assert.equal(exportRequest.inputWidth,recording.frames[0].output.width);assert.equal(exportRequest.inputHeight,recording.frames[0].output.height);
  const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,pix_fmt','-of','json',videoFile],{encoding:'utf8',timeout:30000})).streams[0];
  assert.equal(metadata.width,64);assert.equal(metadata.height,48);assert.equal(Number(metadata.nb_read_frames),3);assert.equal(metadata.r_frame_rate,'4/1');
  const raw=execFileSync('ffmpeg',['-v','error','-i',videoFile,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:8*1024*1024,timeout:30000});
  assert.equal(raw.length,64*48*3*3);assert.ok(!raw.subarray(0,64*48*3).equals(raw.subarray(-64*48*3)),'Actual decoded video changes');
  result.recording={...recording,file:videoFile,sha256:sha(await readFile(videoFile)),exportRequest,metadata,decodedRgbSha256:sha(raw)};
  await button('Close export').click();await pause();await page.screenshot({path:root+'/app-native-domain-after.png'});
  result.audit=await page.evaluate(()=>window.__nativeDomainUi);assert.deepEqual(result.audit.errors,[]);assert.deepEqual(pageErrors,[]);
  result.consoleErrors=consoleErrors;result.requestFailures=requestFailures;result.status='passed';
  await writeFile(root+'/app-domain-ui.json',JSON.stringify(result,null,2)+'\n');stage('passed');return result;
 }catch(error){
  result.status='failed';result.phase=phase;result.error=error.stack??String(error);result.pageErrors=pageErrors;result.consoleErrors=consoleErrors;result.requestFailures=requestFailures;
  result.audit=await page.evaluate(()=>window.__nativeDomainUi).catch(()=>null);
  await page.screenshot({path:root+'/app-domain-failed.png'}).catch(()=>{});
  await writeFile(root+'/app-domain-failed.json',JSON.stringify({...result,body:await page.locator('body').innerText().catch(()=>null)},null,2)+'\n');throw error;
 }finally{await page.close();}
}
