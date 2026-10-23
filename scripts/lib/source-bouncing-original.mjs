import {createHash} from 'node:crypto';
// Exact original bytes select the fixture, never a self-reported count.
const presets={
 '2110d387e9afa680ec1102dc892f3c6e3975c4f0654f6c00232826980326f480':{member:'data/Bouncing/bouncing1.json',particleCount:2000000},
 '9de55d50efb24bab3ced5ca17483256b782e916c9221a219e4df06e82b9e2537':{member:'data/Bouncing/bouncing2.json',particleCount:5000000},
};
export function sourceBouncingOriginalPreset(bytes){
 const digest=createHash('sha256').update(bytes).digest('hex'),preset=presets[digest];
 if(!preset||JSON.parse(bytes).settings.particle_count!==preset.particleCount)throw Error('Original preset changed or unsupported');
 return{...preset,sourceSha256:digest};
}
