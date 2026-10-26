/** Effects execute in order; failures re-enter the owning generator so its
 * catch/finally blocks can perform required cleanup before returning. */
export function runGenerationEffects<Y,R,N>(iterator:Generator<Y,R,N>,perform:(effect:Y)=>N):R {
 let next=iterator.next();
 while(!next.done){
  let reply:N;
  try{
   reply=perform(next.value);
   if(reply!==null&&(typeof reply==='object'||typeof reply==='function')&&typeof (reply as {then?:unknown}).then==='function')throw Error('Synchronous generation effect returned a thenable; use the async driver');
  }catch(error){next=iterator.throw(error);continue;}
  next=iterator.next(reply);
 }
 return next.value;
}

export async function runGenerationEffectsAsync<Y,R,N>(iterator:Generator<Y,R,N>,perform:(effect:Y)=>N|PromiseLike<N>):Promise<R> {
 let next=iterator.next();
 while(!next.done){
  let reply:N;
  try{reply=await perform(next.value);}catch(error){next=iterator.throw(error);continue;}
  next=iterator.next(reply);
 }
 return next.value;
}
