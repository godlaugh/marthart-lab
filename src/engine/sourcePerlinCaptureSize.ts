/** MathArt.ensureRenderBuffer(1): Java float division and Math.round, followed
 * by inherited Processing density. Requested render dimensions are physical;
 * rounding can change the actual base image by one pixel. Upscale is separate. */
export function prepareSourcePerlinCaptureSize(size:{width:number;height:number},density:number){
 if(!size||![size.width,size.height,density].every(Number.isSafeInteger)||size.width<1||size.height<1||density<1)throw new Error('Perlin 暂停截图需要正整数尺寸与像素密度');
 const logicalWidth=Math.floor(Math.fround(Math.fround(size.width)/density)+.5),logicalHeight=Math.floor(Math.fround(Math.fround(size.height)/density)+.5);
 const width=logicalWidth*density,height=logicalHeight*density;
 if(logicalWidth<1||logicalHeight<1||width>16384||height>16384||width*height>16777216)throw new Error('Perlin 暂停截图超过物理像素预算或小于一个逻辑像素');
 return{logicalWidth,logicalHeight,width,height,density};
}
