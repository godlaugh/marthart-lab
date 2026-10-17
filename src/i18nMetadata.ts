import {definitions} from './scenes';
import {CLIP_TYPES,ACTIONS} from './engine/timeline';
import {DOMAIN_TEMPLATES} from './engine/explore';
import {ROOT_EXPLORER_STYLES,DOMAIN_FORMULA_FAMILIES} from './engine/complexExplore';
import {PALETTES} from './engine/palette';
import {geometryColorControls} from './engine/geometryColor';
/** Every built-in display string from the current semantic owners, never saved user data. */
export function builtInTranslationSources(){
 const rows:{source:string;path:string}[]=[];
 const add=(source:string|undefined,path:string)=>{if(source&&/[\u3400-\u9fff]/.test(source))rows.push({source,path});};
 for(const d of definitions){
  add(d.name,`${d.kind}.name`);add(d.description,`${d.kind}.description`);
  for(const e of d.equations)add(e.label,`${d.kind}.equation.${e.key}`);
  for(const c of [...d.controls,...geometryColorControls({kind:d.kind,settings:d.defaults.settings})]){add(c.label,`${d.kind}.control.${c.key}`);add(c.group,`${d.kind}.group.${c.key}`);add(c.help,`${d.kind}.help.${c.key}`);for(const o of c.options??[])add(o.label,`${d.kind}.option.${c.key}.${o.value}`);}
  for(const p of d.presets){add(p.name,`${d.kind}.preset.${p.id}`);add(p.description,`${d.kind}.presetDescription.${p.id}`);}
 }
 for(const[group,labels]of [['clips',CLIP_TYPES.map(c=>c.label)],['actions',ACTIONS.map(c=>c[1])],['domainTemplates',DOMAIN_TEMPLATES.map(c=>c[1])],['rootsExplore',ROOT_EXPLORER_STYLES.map(c=>c[1])],['domainExplore',DOMAIN_FORMULA_FAMILIES.map(c=>c[1])],['palettes',PALETTES.map(c=>c.name)]] as const)for(const label of labels)add(label,group);
 return rows;
}
