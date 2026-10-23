import {generateSourceBouncingSeeds} from './sourceBouncingSeeds';
self.onmessage=({data}:MessageEvent<unknown>)=>{
 try{const result=generateSourceBouncingSeeds(data);self.postMessage(result,result.ok?{transfer:[result.value.state.buffer]}:{});}
 catch(error){self.postMessage({ok:false,error:{kind:'input',path:[],reason:error instanceof Error?error.message:String(error)}});}
};
