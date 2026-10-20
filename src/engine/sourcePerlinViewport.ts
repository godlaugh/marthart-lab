/** Browser display DPR can be fractional. Processing pixelDensity is an
 * integer; the local preview explicitly chooses the nearest 1x/2x canvas.
 * Display resampling still uses the renderer's original continuous ratio. */
export function sourcePerlinPreviewViewport(width:number,height:number,displayPixelRatio:number){
 if(!Number.isFinite(displayPixelRatio)||displayPixelRatio<=0)throw new Error('Perlin 显示像素比例无效');
 return{width,height,pixelDensity:Math.max(1,Math.min(2,Math.round(displayPixelRatio)))};
}
