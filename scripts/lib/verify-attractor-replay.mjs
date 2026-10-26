/** Fresh production worker/renderer replay checkpoints; local determinism, not an independent mathematical oracle. */
export async function verifyAttractorReplay(page,request,frames){
 return page.evaluate(async({request,frames})=>{
  const {Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sourceQueuePresentedScene}=await import('/src/engine/sourceQueuePresentation.ts'),{outputCamera}=await import('/src/engine/sceneCamera.ts'),{encodeSourceGeometryImage}=await import('/src/engine/sourceGeometryImage.ts');
  const generator=new Generator(),renderer=new ArtRenderer(document.createElement('canvas'),'source-offscreen-export'),rows=[];renderer.setSize(request.context.sourceViewport.logicalWidth,request.context.sourceViewport.logicalHeight,request.context.sourcePointPixelDensity??1);
  try{for(let i=0;i<frames;i++){
   const output=await generator.generate(request.scene,{...request.context,time:i/30});
   if([0,49,149,299].includes(i)){
    const scene=sourceQueuePresentedScene(request.scene,output);renderer.setOutput(output,scene,false,outputCamera(scene,output));
    const blob=await encodeSourceGeometryImage(renderer,scene,output,{signal:new AbortController().signal,purpose:'video-frame'}),png=new Uint8Array(await blob.arrayBuffer()),digest=await crypto.subtle.digest('SHA-256',png);
    rows.push({index:i,pngSha:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join(''),records:output.temporal.recordedPoints,frame:output.sourceCameraFrame.frameIndex});
   }
  }return rows;}finally{generator.dispose();renderer.dispose();}
 },{request,frames});
}
