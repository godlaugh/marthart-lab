import {usesSourceSymmetryConfiguration} from './sourceSymmetryConfig';
import type {SceneDocument,ControlSpec} from '../types';
import {SYMMETRY_DEFAULT_PARAMETERS,SYMMETRY_DEFAULT_SETTINGS} from '../scenes/symmetryParameters';
import {hasSymmetryCustom,prepareSymmetryCustomSource,symmetryCustomCompileDegree} from './symmetryCustom';

/** Prepare one authored edit without changing caller-selected rendering settings.
 * Language/type validity is subsequently checked by the real worker/GPU before
 * the UI commits this document. The parser alone is not a GLSL compiler. */
export function withSymmetryCustomSource(scene:SceneDocument,source:string):SceneDocument {
 if(scene.kind!=='symmetry')throw new Error('只有 Symmetry 支持对称模板');
 prepareSymmetryCustomSource(source,symmetryCustomCompileDegree(scene));
 return {...scene,equations:{...scene.equations,glsl:source}};
}

/** Custom math has independent metrics and compile-time degree. Built-in-only
 * exploration and polynomial correction controls do not describe that source. */
export function symmetryAuthoringControls(scene:SceneDocument,controls:ControlSpec[]):ControlSpec[] {
 if(usesSourceSymmetryConfiguration(scene))controls=controls.map(c=>c.key==='seed'?{...c,label:'本地颜色随机种子',help:'只影响本地随机颜色；初始粒子种子由场景参数自动计算。'}:c);
 if(!hasSymmetryCustom(scene))return controls;
 const labels:Record<string,string>={degree:'编译阶数 N',stepMetricMin:'颜色指标下限',stepMetricMax:'颜色指标上限',stepMetricNormalize:'颜色指标归一化'};
 return controls.filter(c=>!['deltaPower','explorationProfile','lockDegree'].includes(c.key)).map(c=>({
  ...c,...(labels[c.key]?{label:labels[c.key]}:{}),...(c.key==='degree'?{max:2147483647}:{}),
  ...(c.key==='iteratedColor'?{options:c.options?.map(o=>o.value==='step'?{...o,label:'自定义 stepMetric'}:o)}:{}),
 }));
}

export function symmetryTemplateSelectionError(scene:SceneDocument):string|undefined {
 if(usesSourceSymmetryConfiguration(scene))return undefined;
 const degree=scene.settings.degree??SYMMETRY_DEFAULT_SETTINGS.degree;
 if(typeof degree!=='number'||!Number.isInteger(degree)||degree<2||degree>50)return '内置模板支持 2 至 50 的整数阶数；请先调整编译阶数，当前自定义源码保持不变。';
 const power=scene.settings.deltaPower??SYMMETRY_DEFAULT_SETTINGS.deltaPower;
 if(typeof power!=='number'||!Number.isInteger(power)||power<1||power>6)return '内置模板需要 1 至 6 的整数修正幂次；项目中的设置无效，当前自定义源码保持不变。';
}

/** One undoable template transaction. The source document and its parameter
 * values stay untouched; only the new document stops selecting custom GLSL.
 * Extra parameters and display-only formula text remain authored data. */
export function withSymmetryTemplate(scene:SceneDocument,template:unknown):SceneDocument {
 if(scene.kind!=='symmetry')throw new Error('只有 Symmetry 支持对称模板');
 if(template!=='standard'&&template!=='modified')throw new Error('未知对称模板');
 const error=symmetryTemplateSelectionError(scene);if(error)throw new Error(error);
 const equations={...scene.equations};delete equations.glsl;
 return {...scene,equations,parameters:usesSourceSymmetryConfiguration(scene)?{...scene.parameters,...(template==='modified'?{delta:scene.parameters.delta??0,delta_power:scene.parameters.delta_power??1}:{})}:{...SYMMETRY_DEFAULT_PARAMETERS,...scene.parameters},settings:{...scene.settings,template}};
}
