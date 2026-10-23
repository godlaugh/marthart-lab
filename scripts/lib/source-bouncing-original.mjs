import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
// Capture and comparison consume the same pinned packaged-preset identities.
const presets=Object.values(JSON.parse(readFileSync(new URL('../../tests/fixtures/source-bouncing-native-animation/presets.json',import.meta.url),'utf8')));
export function sourceBouncingOriginalPreset(bytes){
 const digest=createHash('sha256').update(bytes).digest('hex'),preset=presets.find(p=>p.sourceSha256===digest);
 if(!preset||JSON.parse(bytes).settings.particle_count!==preset.particleCount)throw Error('Original preset changed or unsupported');
 return{...preset};
}
