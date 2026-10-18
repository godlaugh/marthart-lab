import fs from 'node:fs';
const path='.cache/v2-symmetry-search-bytecode.json',raw=fs.readFileSync(path,'utf8'),evidence=JSON.parse(raw.replace(/:\s*Infinity/g,': "Infinity"'));
if(evidence.classSha256!=='1f69e0ba1954e520dadb0b4089910ec8cc07f26edf20dfdd8688a79dd88454bc')throw Error('Wrong reference class');
const methods=new Map(evidence.methods.map(m=>[m.name,{...m,index:new Map(m.instructions.map((x,i)=>[x.offset,i]))}]));
// Bounded interpreter for the two inspected JVM methods; actual artifact/JVM
// is not executed. Unsupported instructions or calls fail closed.
function run(name,args){
 const m=methods.get(name),types=name==='iterate'?['D','D','D','D','D','D','D','I','D','I']:['A','A'];
 const local=[{}],stack=[];let slot=1;args.forEach((a,i)=>{local[slot]=a;slot+=types[i]==='D'?2:1;});let ip=0,steps=0;
 while(ip<m.instructions.length){if(++steps>3000000)throw Error('Interpreter budget');const i=m.instructions[ip++],o=parseInt(i.opcode),arg=parseInt(i.args||'0',16),signed=(arg&32768)?arg-65536:arg,constant=i.reference==='Infinity'?Infinity:i.reference;const pop=()=>stack.pop(),jump=()=>{const to=m.index.get(i.offset+signed);if(to===undefined)throw Error('Invalid branch');ip=to;};
  if(o===0x00)continue;
  if(o===0x01){stack.push(null);continue;}
  if(o>=0x02&&o<=0x08){stack.push(o-3);continue;}
  if(o===0x0e||o===0x0f){stack.push(o-0x0e);continue;}
  if(o===0x10){stack.push(arg>127?arg-256:arg);continue;}if(o===0x11){stack.push(signed);continue;}
  if([0x12,0x13,0x14].includes(o)){stack.push(constant);continue;}
  if([0x15,0x18,0x19].includes(o)){stack.push(local[arg]);continue;}
  if(o>=0x1a&&o<=0x1d){stack.push(local[o-0x1a]);continue;}
  if(o>=0x26&&o<=0x29){stack.push(local[o-0x26]);continue;}
  if(o>=0x2a&&o<=0x2d){stack.push(local[o-0x2a]);continue;}
  if([0x31,0x32,0x33].includes(o)){const idx=pop(),a=pop();stack.push(a[idx]);continue;}
  if([0x36,0x39,0x3a].includes(o)){local[arg]=pop();continue;}
  if(o>=0x3b&&o<=0x3e){local[o-0x3b]=pop();continue;}
  if([0x52,0x53,0x54].includes(o)){const v=pop(),idx=pop(),a=pop();a[idx]=v;continue;}
  if(o===0x57){pop();continue;}if(o===0x59){stack.push(stack.at(-1));continue;}
  if([0x60,0x63,0x64,0x67,0x68,0x6b,0x6f].includes(o)){const b=pop(),a=pop();stack.push([0x60,0x63].includes(o)?a+b:[0x64,0x67].includes(o)?a-b:[0x68,0x6b].includes(o)?a*b:a/b);continue;}
  if(o===0x77){stack.push(-pop());continue;}if(o===0x84){const index=arg>>8,delta=(arg&255)>127?(arg&255)-256:arg&255;local[index]+=delta;continue;}
  if(o===0x87)continue;if(o===0x8e){const n=pop();stack.push(Number.isNaN(n)?0:Math.max(-2147483648,Math.min(2147483647,Math.trunc(n))));continue;}
  if(o===0x97||o===0x98){const b=pop(),a=pop();stack.push(Number.isNaN(a)||Number.isNaN(b)?o===0x97?-1:1:a>b?1:a<b?-1:0);continue;}
  if(o>=0x99&&o<=0x9e){const a=pop();if([a===0,a!==0,a<0,a>=0,a>0,a<=0][o-0x99])jump();continue;}
  if(o===0xa2){const b=pop(),a=pop();if(a>=b)jump();continue;}
  if(o===0xa7){jump();continue;}if(o===0xc6||o===0xc7){const a=pop();if(o===0xc6?a==null:a!=null)jump();continue;}
  if(o===0xb0)return{value:pop(),locals:local};
  if(o===0xb2){stack.push({});continue;}if(o===0xbb){stack.push({});continue;}
  if(o===0xbc||o===0xbd){stack.push(Array(pop()).fill(o===0xbc?0:null));continue;}if(o===0xbe){stack.push(pop().length);continue;}if(o===0xc0)continue;
  if([0xb6,0xb7,0xb8,0xb9].includes(o)){
   const ref=String(i.reference);
   if(ref.startsWith('java/util/Map get ')){const key=pop(),obj=pop();stack.push(obj[key]??null);continue;}
   if(ref.startsWith('java/lang/Double doubleValue '))continue;
   if(ref.includes('Intrinsics areEqual ')){const b=pop(),a=pop();stack.push(a===b?1:0);continue;}
   if(ref.startsWith('java/lang/Math ')){const method=ref.split(' ')[1],arity=['max','min','atan2'].includes(method)?2:1,values=Array.from({length:arity},pop).reverse();stack.push(Math[method](...values));continue;}
   if(ref.includes('RangesKt coerceIn ')){const high=pop(),low=pop(),value=pop();stack.push(Math.max(low,Math.min(high,value)));continue;}
   if(ref.includes('ParameterRandomizer iterate ')){const values=Array.from({length:10},pop).reverse();pop();stack.push(run('iterate',values).value);continue;}
   if(ref.includes('$EvalMetrics <init> ')){const accepted=pop(),score=pop(),obj=pop();Object.assign(obj,{score,accepted:!!accepted});continue;}
  }
  throw Error(`Unsupported ${name}:${i.offset} ${i.opcode} ${i.reference}`);
 }
 throw Error('No return');
}
const cases=[
 ['cloak', {lambda:-2.34,alpha:2,beta:.2,gamma:.2,omega:0,symmetry_degree:5}],
 ['sixfold',{lambda:-2.5,alpha:5,beta:-1.9,gamma:1,omega:0,symmetry_degree:6}],
 ['rotating',{lambda:-2.34,alpha:2,beta:.2,gamma:.2,omega:.02,symmetry_degree:5}],
 ['zero',{lambda:0,alpha:0,beta:0,gamma:0,omega:0,symmetry_degree:2}],
 ['identity',{lambda:1,alpha:0,beta:0,gamma:0,omega:0,symmetry_degree:2}],
 ['escape',{lambda:100,alpha:0,beta:0,gamma:0,omega:0,symmetry_degree:2}],
 ['samplingEscape',{lambda:1.05,alpha:0,beta:0,gamma:0,omega:0,symmetry_degree:2}],
 ['modifiedAccepted',{lambda:-2.34,alpha:2,beta:.2,gamma:.2,omega:0,symmetry_degree:5,delta:.001,delta_power:2},'modified'],
 ['modified',{lambda:-2.3,alpha:2,beta:.2,gamma:.3,omega:.04,symmetry_degree:5,delta:.7,delta_power:3},'modified']
];
const results=cases.map(([id,parameters,template='standard'])=>{const out=run('evaluateCandidate',[parameters,template]);return{id,parameters,template,expected:out.value};});
fs.writeFileSync('.cache/v2-symmetry-search-goldens.json',JSON.stringify({classSha256:evidence.classSha256,scope:'Independent bounded JavaScript interpretation of retained bytecode, not native JVM execution',cases:results},null,2)+'\n');console.log(JSON.stringify(results));
