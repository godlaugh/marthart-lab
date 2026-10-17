import {prepareRootsVariableLabel} from './rootsVariableLabel';
import type {RootsMathConfiguration} from '../types';
import {isJavaBlank,javaTrim} from './sourceJavaText';
import {prepareRootsSourceCoefficients,type RootsSourceJsonStringFacts} from './rootsSourceOrder';
import {prepareRootsNativeExpression,RootsNativeError,rootsNativeAttempt,rootsNativeCapacity,rootsNativeCheck,type PreparedRootsNativeExpression,type RootsNativeResult,type RootsNativeScope,type RootsNativeWorkHooks} from './rootsNativeExpression';

/** Local memory budget for dense coefficient and evaluator workspaces, not a
 * native polynomial degree limit. At 16 bytes/slot it rejects sparse enormous
 * exponents before creating a dense array. Instruction count separately bounds
 * retained JS metadata; its bytes are an estimate, not measured heap size. */
export const ROOTS_NATIVE_POLYNOMIAL_LIMITS=Object.freeze({workspaceBytes:64*1024*1024,totalNodes:262144,totalCharacters:4*1024*1024});
export interface RootsNativeCoefficients {readonly real:Float64Array;readonly imag:Float64Array;readonly declaredDegree:number;}
export interface PreparedRootsNativePolynomial {
 readonly source:Readonly<RootsMathConfiguration['polynomial']>;
 readonly variable:string|undefined;readonly variableFacts:RootsSourceJsonStringFacts;readonly declaredDegree:number;readonly maxRootCount:number;
 readonly nodeCount:number;readonly workspaceBytes:number;
 /** Borrowed coefficient arrays, invalidated by the next evaluate or dispose. */
 evaluate(scope:RootsNativeScope,hooks?:RootsNativeWorkHooks):RootsNativeResult<RootsNativeCoefficients>;
 dispose():void;
}
export function prepareRootsNativePolynomial(source:RootsMathConfiguration['polynomial'],hooks:RootsNativeWorkHooks={}):RootsNativeResult<PreparedRootsNativePolynomial>{return rootsNativeAttempt(()=>{
 rootsNativeCheck(hooks);if(!source||!Array.isArray(source.coefficients))throw new RootsNativeError('input','Invalid native polynomial table');
 const variableResult=prepareRootsVariableLabel(source.variable,ROOTS_NATIVE_POLYNOMIAL_LIMITS.totalCharacters);
 if(!variableResult.ok)throw variableResult.error;
 const variableFacts=variableResult.value.facts;
 const variable=variableFacts.status==='known'?(isJavaBlank(variableFacts.value)?'x':javaTrim(variableFacts.value)):undefined;
 let characters=variableResult.value.characters;
 for(const row of source.coefficients){
  rootsNativeCheck(hooks,1);if(!row||typeof row.exponent!=='string'||typeof row.expression!=='string')throw new RootsNativeError('input','Native coefficient rows require exponent and expression text');
  characters+=row.exponent.length+row.expression.length;if(characters>ROOTS_NATIVE_POLYNOMIAL_LIMITS.totalCharacters)rootsNativeCapacity('polynomial characters',characters,ROOTS_NATIVE_POLYNOMIAL_LIMITS.totalCharacters);
  rootsNativeCheck(hooks,row.exponent.length);
 }
 // The source table owner resolves integer aliases once. Its input is already
 // in canonical source map order; it is not reordered as a JavaScript object.
 const table=prepareRootsSourceCoefficients(source.coefficients);
 if(!table.ok){const e=table.error;if(e.kind==='capacity')rootsNativeCapacity(e.resource,e.actual,e.limit);throw new RootsNativeError(e.kind==='invalid-exponent'?'syntax':'input','Invalid native coefficient table: '+e.kind,'raw' in e?{exponent:e.raw}:{});}
 let degree=0;
 for(const row of table.value){rootsNativeCheck(hooks,1);if(row.exponent<0)throw new RootsNativeError('input','Polynomial exponent must not be negative',{exponent:row.exponent});degree=Math.max(degree,row.exponent);}
 let bytes=(degree+1)*16,nodes=0;if(bytes>ROOTS_NATIVE_POLYNOMIAL_LIMITS.workspaceBytes)rootsNativeCapacity('polynomial workspace bytes',bytes,ROOTS_NATIVE_POLYNOMIAL_LIMITS.workspaceBytes);
 const expressions:{degree:number;program:PreparedRootsNativeExpression}[]=[];
 try{
  for(const row of table.value){const degree=row.exponent;const result=prepareRootsNativeExpression(row.expression,hooks);if(!result.ok)throw result.error;expressions.push({degree,program:result.value});nodes+=result.value.nodeCount;bytes+=result.value.workspaceBytes;if(nodes>ROOTS_NATIVE_POLYNOMIAL_LIMITS.totalNodes)rootsNativeCapacity('polynomial nodes',nodes,ROOTS_NATIVE_POLYNOMIAL_LIMITS.totalNodes);if(bytes>ROOTS_NATIVE_POLYNOMIAL_LIMITS.workspaceBytes)rootsNativeCapacity('polynomial workspace bytes',bytes,ROOTS_NATIVE_POLYNOMIAL_LIMITS.workspaceBytes);}
 }catch(error){for(const e of expressions)e.program.dispose();throw error;}
 let real=new Float64Array(degree+1),imag=new Float64Array(degree+1),disposed=false;
 const authored={variable:structuredClone(source.variable),coefficients:source.coefficients.map(row=>({...row}))};
 return{source:authored,variable,variableFacts,declaredDegree:degree,maxRootCount:degree,nodeCount:nodes,workspaceBytes:bytes,
  evaluate(scope,h={}){return rootsNativeAttempt(()=>{
   rootsNativeCheck(h);if(disposed)throw new RootsNativeError('input','Native polynomial has been disposed');
   // Chunk the clearing work for cancellation and request work accounting.
   for(let start=0;start<real.length;start+=1024){const end=Math.min(real.length,start+1024);rootsNativeCheck(h,end-start);real.fill(0,start,end);imag.fill(0,start,end);}
   for(const {degree,program} of expressions){const result=program.evaluate(scope,h);if(!result.ok)throw result.error;real[degree]=result.value[0];imag[degree]=result.value[1];}
   return{real,imag,declaredDegree:degree};
  });},
  dispose(){if(disposed)return;disposed=true;real=new Float64Array();imag=new Float64Array();for(const e of expressions)e.program.dispose();expressions.length=0;}
 };
});}
