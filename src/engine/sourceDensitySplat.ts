/** Scene.render -> Mobject.display -> Map/Symmetry splatParticles.
 * The display multiplier is logical export height / primary logical height;
 * unlike Samila's radius it does not depend on primary physical height. */
export interface SourceDensitySplatFacts {
 model:'symmetry-splat-1.7.8'|'map-splat-1.7.8';dotSize:number;displayScale:number;radius:number;
 path:'points'|'quad';encoding:'rgb-mass';
}
export function prepareSourceDensitySplat(family:'map'|'symmetry',dotSize:number,displayScale=1):SourceDensitySplatFacts {
 const dot=Math.fround(dotSize),scale=Math.fround(displayScale),radius=Math.max(1,Math.fround(dot*scale));
 if(!['map','symmetry'].includes(family)||!Number.isFinite(dot)||!Number.isFinite(scale)||scale<=0||!Number.isFinite(radius))throw Error('源密度 点尺寸或画布比例超出有限 Float32');
 return{model:`${family}-splat-1.7.8`,dotSize:dot,displayScale:scale,radius,path:'points',encoding:'rgb-mass'};
}
export function sourceDensityPointDiameter(facts:SourceDensitySplatFacts):number {
 // The source CGL point rasterizer rounds the submitted diameter. ANGLE Metal
 // retains fractions, so share the source footprint between drawing and stats.
 // Keep the consumed Float32 radius intact for authoring and the quad kernel.
 return facts.path==='points'?Math.round(facts.radius):Math.max(Math.fround(facts.radius*Math.fround(.6)),Math.fround(.8));
}
/** Conservative before driver probe: native points are wider than quad fallback.
 * ceil(radius) also bounds the rounded point diameter. The session accumulates
 * this bound across all frames of one request. */
export function sourceDensitySplatPixelTests(facts:SourceDensitySplatFacts,count:number):number {
 const tests=count*(Math.ceil(facts.radius)+2)**2;
 if(!Number.isSafeInteger(tests)||tests>2_000_000_000)throw Error('源密度 散点绘制超过 20 亿次像素测试；请减少点尺寸、批次或导出比例');
 return tests;
}
