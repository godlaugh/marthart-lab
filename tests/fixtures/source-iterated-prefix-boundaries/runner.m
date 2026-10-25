// Real CGL owner boundary test. KVC places the observation interval near its
// integer limit instead of submitting billions of GPU updates. It is not a
// production escape hatch and does not simulate a renderer.
#define main source_renderer_main
#include "SourceCglRenderer.m"
#undef main
int main(int argc,const char **argv){@autoreleasepool{
 CGLContextObj context=NULL;SourceCglIteratedState *state=nil;int result=1;
 @try{
  INPUT(argc==2,@"Expected encoded create-source packet");NSData *packet=[NSData dataWithContentsOfFile:@(argv[1])];NSDictionary *frame=parseWithRetained(packet,NO,0),*create=frame[@"iterated"];INPUT([create[@"kind"]unsignedIntValue]==6&&[create[@"count"]unsignedIntValue]==2,@"Expected two source particles");
  createContext(&context);state=[[SourceCglIteratedState alloc]initWithOperation:create];[state prepare:create];
  const float seed[]={1,2,3,4,5,6,7,8};NSData *initial=[NSData dataWithBytes:seed length:sizeof(seed)];[state upload:@{@"index":@0,@"offset":@0,@"positions":initial} retained:state.retainedBytes packetBytes:initial.length];
  NSMutableDictionary *advance=[@{@"index":@0,@"reset":@0,@"dimension":@3,@"steps":@2,@"uniforms":@{}}mutableCopy];
  [state setValue:@((uint64_t)UINT32_MAX-1) forKey:@"observationSteps"];
  BOOL rejected=NO;@try{[state advance:advance retained:state.retainedBytes packetBytes:128];}@catch(NSException *e){rejected=[e.name isEqual:@"input"];}RUNTIME(rejected&&state.index==0,@"Overflow was not rejected before mutation");
  NSData *before=[state read:@{@"index":@0,@"offset":@0,@"count":@2} retained:state.retainedBytes packetBytes:100];RUNTIME(memcmp(before.bytes,seed,16)==0&&memcmp((const uint8_t*)before.bytes+24,seed+4,16)==0,@"Rejected overflow changed positions");
  advance[@"steps"]=@1;[state advance:advance retained:state.retainedBytes packetBytes:128];RUNTIME(state.index==1&&[[state valueForKey:@"observationSteps"]unsignedLongLongValue]==UINT32_MAX,@"Maximum observation interval not reached exactly");
  advance[@"index"]=@1;rejected=NO;@try{[state advance:advance retained:state.retainedBytes packetBytes:128];}@catch(NSException *e){rejected=[e.name isEqual:@"input"];}RUNTIME(rejected&&state.index==1,@"Maximum interval wrapped");
  advance[@"steps"]=@0;[state advance:advance retained:state.retainedBytes packetBytes:128];RUNTIME(state.index==2,@"Zero-step at maximum interval failed");
  advance[@"index"]=@2;advance[@"resetCounter"]=@1;[state advance:advance retained:state.retainedBytes packetBytes:128];RUNTIME([[state valueForKey:@"observationSteps"]unsignedLongLongValue]==0,@"Counter-only reset did not reopen the interval");
  advance[@"index"]=@3;advance[@"resetCounter"]=@0;advance[@"steps"]=@16;[state advance:advance retained:state.retainedBytes packetBytes:128];RUNTIME(state.index==4&&[[state valueForKey:@"observationSteps"]unsignedLongLongValue]==16,@"Reopened interval cannot advance");
  // A failure after control admission poisons this exact owner. Disposal must
  // still release both programs and every buffer, rather than dropping it.
  glEnable(0xdeadc0de);advance[@"index"]=@4;rejected=NO;@try{[state advance:advance retained:state.retainedBytes packetBytes:128];}@catch(NSException *e){rejected=[e.name isEqual:@"runtime"];}RUNTIME(rejected&&state.index==4,@"GL failure published a partial checkpoint");
  rejected=NO;@try{[state advance:advance retained:state.retainedBytes packetBytes:128];}@catch(NSException *e){rejected=[e.name isEqual:@"runtime"];}RUNTIME(rejected&&state.retainedBytes>0,@"Failed owner was silently retried or forgotten");
  [state dispose];RUNTIME(state.retainedBytes==0&&glGetError()==GL_NO_ERROR,@"Source owner cleanup failed");[state dispose];state=nil;destroyContext(&context);result=0;puts("{\"overflowPreflight\":true,\"zeroAtLimit\":true,\"counterReset\":true,\"poisonedOwnerRetained\":true,\"cleanup\":true}");
 }@catch(NSException *e){fprintf(stderr,"%s: %s\n",e.name.UTF8String,e.reason.UTF8String);}
 @finally{if(state)@try{[state dispose];}@catch(NSException *e){fprintf(stderr,"dispose: %s\n",e.reason.UTF8String);result=1;}if(context)@try{destroyContext(&context);}@catch(NSException *e){fprintf(stderr,"context: %s\n",e.reason.UTF8String);result=1;}}
 return result;
}}
