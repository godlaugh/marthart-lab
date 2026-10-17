import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ledgerPath=path.join(root,'studio/coverage/feature-status.json');
const publicPath=path.join(root,'.cache/mathart-investigation/public-features.json');
const packagePath=path.join(root,'.cache/mathart-investigation/package-features.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const statuses=['implemented','partial','missing','unknown'];
const count=items=>items.reduce((a,f)=>(a[f.status]=(a[f.status]??0)+1,a),Object.fromEntries(statuses.map(s=>[s,0])));

/** Read-only structural/provenance gate. It never infers or changes completion. */
export function checkCoverage(ledger,publicCatalog,packageCatalog,{checkFiles=true}={}){
 const errors=[],warnings=[],expected=new Map(publicCatalog.features.map(f=>[f.id,f]));
 const fail=message=>errors.push(message);
 if(ledger.schemaVersion!==1)fail('Unsupported feature ledger schemaVersion');
 const ids=new Set();
 for(const entry of ledger.features??[]){
  if(ids.has(entry.id))fail(`Duplicate public feature: ${entry.id}`);ids.add(entry.id);
  const source=expected.get(entry.id);
  if(!source)fail(`Unknown public feature: ${entry.id}`);
  else for(const key of ['module','feature','acceptance','sources'])if(JSON.stringify(entry[key])!==JSON.stringify(source[key]))fail(`${entry.id}: source ${key} was lost or changed`);
  validateEntry(entry);
  if(entry.reviewed!==true)fail(`${entry.id}: explicit manual review missing`);
 }
 for(const id of expected.keys())if(!ids.has(id))fail(`Missing public feature: ${id}`);
 function validateEntry(entry){
  if(!statuses.includes(entry.status))fail(`${entry.id}: invalid status ${entry.status}`);
  for(const key of ['owner','currentBehavior','nextAction'])if(typeof entry[key]!=='string'||!entry[key].trim())fail(`${entry.id}: ${key} required`);
  if(!Array.isArray(entry.gaps))fail(`${entry.id}: explicit gaps array required`);
  else if(entry.status!=='implemented'&&!entry.gaps.length)fail(`${entry.id}: incomplete item needs a concrete gap`);
  if(!Array.isArray(entry.tests)||!Array.isArray(entry.evidence)||!entry.evidence.length)fail(`${entry.id}: explicit tests/evidence required (tests may be empty)`);
  for(const ref of entry.evidence??[])if(!Object.hasOwn(ledger.evidence??{},ref))fail(`${entry.id}: unknown evidence ${ref}`);
  for(const file of entry.tests??[])if(!Object.hasOwn(ledger.tests??{},file))fail(`${entry.id}: unknown test source ${file}`);
  if(entry.verification?.originalRuntime!=='not_run')fail(`${entry.id}: original runtime claim needs a separately reviewed evidence contract`);
 }
 const packageIds=new Set();
 for(const entry of ledger.packageFeatures??[]){if(packageIds.has(entry.id))fail(`Duplicate package requirement ${entry.id}`);packageIds.add(entry.id);validateEntry(entry);}
 const expectedPackageIds=[];
 for(const [name,entry]of Object.entries(packageCatalog.declaration_catalogs))for(const value of Array.isArray(entry.values)?entry.values:Object.keys(entry.values))expectedPackageIds.push(`PKG-${name}-${value}`);
 for(const entry of packageCatalog.cross_cutting_findings)expectedPackageIds.push(`PKG-cross-${entry.id}`);
 for(const id of expectedPackageIds)if(!packageIds.has(id))fail(`Missing package declaration: ${id}`);
 for(const id of packageIds)if(!expectedPackageIds.includes(id))fail(`Unexpected package declaration: ${id}`);
 const keyId=e=>`${e.artifact}\0${e.key}`;
 const expectedKeys=Object.entries(packageCatalog.config_key_candidates).flatMap(([artifact,keys])=>keys.map(key=>keyId({artifact,key})));
 const actualKeys=(ledger.packageConfigCandidates??[]).map(keyId);
 if(new Set(actualKeys).size!==actualKeys.length)fail('Duplicate config candidate');
 if(expectedKeys.length!==actualKeys.length||expectedKeys.some(k=>!actualKeys.includes(k)))fail('Configuration candidate inventory is incomplete');
 for(const [sceneType,fields]of Object.entries(packageCatalog.observed_preset_schema)){
  const recorded=ledger.packageSchemaInventory?.find(s=>s.sceneType===sceneType);
  if(!recorded||JSON.stringify(recorded.fields)!==JSON.stringify(fields)||recorded.fieldCount!==Object.keys(fields).length)fail(`Preset schema inventory differs: ${sceneType}`);
 }
 const summary=ledger.summary??{};
 if(summary.publicFeatures!==expected.size||summary.publicFeatures!==ledger.features?.length)fail('Public summary count differs');
 if(JSON.stringify(summary.publicStatus)!==JSON.stringify(count(ledger.features??[])))fail('Public status summary is stale');
 const modules=[...new Set((ledger.features??[]).map(f=>f.module))];
 if(Object.keys(summary.publicByModule??{}).length!==modules.length||modules.some(module=>JSON.stringify(summary.publicByModule?.[module])!==JSON.stringify(count(ledger.features.filter(f=>f.module===module)))))fail('Public per-module summary is stale');
 if(summary.packageBehavioralDeclarations!==packageIds.size||JSON.stringify(summary.packageStatus)!==JSON.stringify(count(ledger.packageFeatures??[])))fail('Package status summary is stale');
 if(summary.noOverallCompletionClaim!==true)fail('Ledger must not imply complete reproduction');
 for(const item of ledger.priorityQueue??[])for(const id of item.featureIds??[])if(!ids.has(id))fail(`Priority ${item.id} references absent ${id}`);
 if(checkFiles){
  for(const [name,source]of Object.entries(ledger.sources??{}))checkSnapshot(source,`source ${name}`,true);
  for(const [name,evidence]of Object.entries(ledger.evidence??{}))if(evidence.path)checkSnapshot(evidence,`evidence ${name}`,false);
  for(const snapshot of ledger.implementationSnapshots??[])checkSnapshot(snapshot,'implementation',false);
  function checkSnapshot(snapshot,label,requiredMatch){
   const file=path.resolve(root,snapshot.path);
   if(!file.startsWith(root+path.sep)){fail(`${label}: path outside repository`);return;}
   if(!fs.existsSync(file)){(requiredMatch?errors:warnings).push(`${label} missing local file: ${snapshot.path}`);return;}
   if(digest(file)!==snapshot.sha256)(requiredMatch?errors:warnings).push(`${label} changed since review: ${snapshot.path}`);
  }
  for(const entry of [...ledger.features,...ledger.packageFeatures])for(const file of [...entry.implementation,...entry.tests])if(!fs.existsSync(path.join(root,file)))fail(`${entry.id}: missing implementation/test file ${file}`);
 }
 return {ok:errors.length===0,publicFeatures:expected.size,publicStatus:count(ledger.features??[]),packageDeclarations:packageIds.size,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}

function main(){
 const ledger=read(ledgerPath),publicCatalog=read(publicPath),packageCatalog=read(packagePath);
 if(process.argv.includes('--self-test')){
  const check=value=>checkCoverage(value,publicCatalog,packageCatalog,{checkFiles:false});
  assert.equal(check(ledger).ok,true);
  let broken=structuredClone(ledger);broken.features.pop();assert.match(check(broken).errors.join('\n'),/Missing public feature/);
  broken=structuredClone(ledger);broken.features.push(broken.features[0]);assert.match(check(broken).errors.join('\n'),/Duplicate public feature/);
  broken=structuredClone(ledger);broken.features[0].evidence=['not-a-proof'];assert.match(check(broken).errors.join('\n'),/unknown evidence/);
  broken=structuredClone(ledger);broken.features[0].acceptance=[];assert.match(check(broken).errors.join('\n'),/source acceptance/);
  broken=structuredClone(ledger);broken.packageFeatures.pop();assert.match(check(broken).errors.join('\n'),/Missing package declaration/);
  broken=structuredClone(ledger);broken.summary.publicByModule.fractal.missing++;assert.match(check(broken).errors.join('\n'),/per-module summary is stale/);
  console.log('Coverage gate self-test passed (missing, duplicate, lost acceptance, invalid evidence and package omission).');
 }
 const result=checkCoverage(ledger,publicCatalog,packageCatalog);
 if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2));
 else{
  console.log(`${result.publicFeatures} public features: ${Object.entries(result.publicStatus).map(([s,n])=>`${s}=${n}`).join(', ')}; ${result.packageDeclarations} package declarations.`);
  for(const error of result.errors)console.error('ERROR: '+error);
  for(const warning of result.warnings)console.warn('REVIEW: '+warning);
  console.log(result.ok?'Coverage structure complete; this does not mean features are complete.':'Coverage ledger validation failed.');
 }
 process.exitCode=result.ok&&(!process.argv.includes('--strict-freshness')||!result.warnings.length)?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
