import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultFormulas,formulaLabels,formulaPlacement,validateFormulas} from '../src/engine/formulas';
import {renderFormulaSvg} from '../src/engine/formulaSvg';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {symmetryFormula} from '../src/scenes/symmetryFormula';
describe('formula annotations',()=>{
  it('shares read-only symmetry template tokens with the actual exported main equation',()=>{
    const scene=createScene(definition('symmetry'));scene.formulas=defaultFormulas();scene.formulas.main.visible=true;
    const standard=formulaLabels(scene)[0].latex;
    expect(standard).toContain('\\operatorname{Re}(z_k^{n})');expect(standard).not.toContain('\\delta');
    expect(new Set(symmetryFormula(scene.settings).flatMap(t=>t.key?[t.key]:[]))).toEqual(new Set(['lambda','alpha','beta','degree','omega','gamma']));
    scene.settings.template='modified';const modified=formulaLabels(scene)[0].latex;
    expect(modified).toContain('\\delta|z_k|\\cos(n\\,p\\,\\arg z_k)');
    expect(symmetryFormula(scene.settings).find(t=>t.key==='deltaPower')?.target).toBe('control-deltaPower');
    for(const latex of [standard,modified])expect(renderFormulaSvg(latex,'#ffffff').source).toContain('<path');
    expect(()=>symmetryFormula({template:'unknown'})).toThrow();
  });
  it('renders real vector glyphs without remote resources',()=>{const out=renderFormulaSvg('\\frac{d x}{d t}=\\sigma(y-x) \\quad \\sum_{n=1}^{\\infty}n^{-2}=\\frac{\\pi^2}{6}','#43d9bd');expect(out.width).toBeGreaterThan(50);expect(out.height).toBeGreaterThan(10);expect(out.source).toContain('<path');expect(out.source).not.toMatch(/href="https?:|<foreignObject|<script/);expect(out.source).toContain('#43d9bd');});
  it('generates current main equations and preserves custom annotation layout',()=>{const scene=createScene(definition('surface'));scene.formulas=defaultFormulas();scene.formulas.main.visible=true;scene.formulas.additional.push({id:'identity',latex:'e^{i\\pi}+1=0',visible:true,x:400,y:300,scale:2,color:'#ff0000'});const restored=parseScene(JSON.stringify(scene)),labels=formulaLabels(restored);expect(labels).toHaveLength(2);expect(renderFormulaSvg(labels[0].latex,labels[0].color).source).toContain('<svg');expect(formulaPlacement(restored.formulas!,labels[1],2560,1440)).toEqual({x:800,y:600,scale:4});});
  it('rejects invalid LaTeX and invalid document geometry instead of dropping labels',()=>{expect(()=>renderFormulaSvg('\\frac{a}','#ffffff')).toThrow();expect(()=>renderFormulaSvg('\\href{https://example.com}{link}','#ffffff')).toThrow();const config=defaultFormulas();config.main.scale=Infinity;expect(()=>validateFormulas(config)).toThrow();expect(()=>renderFormulaSvg('x','red')).toThrow();});
  it('isolates annotation macro definitions and rejects expansion bombs',()=>{expect(renderFormulaSvg('\\newcommand{\\localtest}{x^2}\\localtest','#ffffff').source).toContain('<path');expect(()=>renderFormulaSvg('\\localtest','#ffffff')).toThrow();expect(()=>renderFormulaSvg('\\def\\loop{\\loop}\\loop','#ffffff')).toThrow();});
  it('renders common number sets with the bundled font and no asynchronous font loader',()=>{const svg=renderFormulaSvg('t_1,t_2\\in\\mathbb{C},\\quad x\\in\\mathbb{R},\\ n\\in\\mathbb{N},\\ k\\in\\mathbb{Z}','#ffffff');expect(svg.source).toContain('data-c="2124"');expect(svg.source).toContain('<path');expect(svg.source).not.toContain('NEWCM');});
  it('imports source formula text and centered placement through save/reload without changing the source',()=>{
    const original={config_version:'1.0.0',type:'SURFACE',name:'formula import',equations:{x:'u',y:'v',z:'0'},main_equation:{enabled:true,position:[0,160],scale:.25,color:'#FFFFFF',latex:'x=u'},formulas:[{position:[-50,170],scale:.3,color:'#ff8800',latex:'\\( |z|=1 \\)'}]};
    const imported=parseLegacyScene(JSON.stringify(original)),scene=parseScene(JSON.stringify(imported.scene)),labels=formulaLabels(scene);
    expect(imported.source).toEqual(original);expect(labels.map(l=>l.latex)).toEqual(['x=u','|z|=1']);expect(labels[0]).toMatchObject({x:640,y:520,scale:.625,anchor:'center'});
    expect(formulaPlacement(scene.formulas!,labels[0],1280,720,{width:200,height:40})).toEqual({x:577.5,y:507.5,scale:.625});
    for(const label of labels)expect(renderFormulaSvg(label.latex,label.color).source).toContain('<path');
    expect(imported.warnings.join(' ')).toContain('1280×720');expect(imported.warnings.join(' ')).not.toMatch(/尚未映射.*formulas/);
  });
});
