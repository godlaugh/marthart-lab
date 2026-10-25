// Diagnostic adapter for the real retained compute/drawing owners. Uses a
// bounded length-prefixed JSON command stream to exercise SourceIteratedSession
// before adding drawing operations to the browser wire protocol. No GUI/window.
#define main source_renderer_main
#include "SourceCglRenderer.m"
#undef main
#include "SourceCglIteratedInk.h"

static void workflowReply(NSDictionary *value){NSData *b=[NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];RUNTIME(b&&b.length<=65536,@"Diagnostic reply exceeds capacity");uint32_t n=CFSwapInt32HostToLittle((uint32_t)b.length);RUNTIME(fwrite(&n,1,4,stdout)==4&&fwrite(b.bytes,1,b.length,stdout)==b.length&&fflush(stdout)==0,@"Diagnostic reply failed");}
static uint64_t workflowRetained(SourceCglIteratedState *state,NSArray *inkOwners){uint64_t n=state?state.retainedBytes:0;for(SourceCglIteratedInk *v in inkOwners)n+=v.retainedBytes;return n;}
static void workflowWrite(NSString *path,NSData *bytes){INPUT([path isKindOfClass:NSString.class]&&[path isAbsolutePath]&&![[NSFileManager defaultManager]fileExistsAtPath:path],@"Diagnostic output must be a new absolute file");RUNTIME([bytes writeToFile:path options:NSDataWritingWithoutOverwriting error:NULL],@"Diagnostic output failed");}
int main(void){@autoreleasepool{
 CGLContextObj ctx=NULL;SourceCglIteratedState *state=nil;SourceCglIteratedInk *ink=nil;NSMutableArray *owners=[NSMutableArray new];NSDictionary *programs=nil;int result=1;
 @try{createContext(&ctx);
  while(YES){@autoreleasepool{
   uint32_t wireLength=0;size_t got=fread(&wireLength,1,4,stdin);if(!got&&feof(stdin))break;INPUT(got==4,@"Truncated workflow header");uint32_t length=CFSwapInt32LittleToHost(wireLength);INPUT(length>0&&length<=8*1024*1024,@"Workflow message exceeds capacity");iteratedStateBudget(workflowRetained(state,owners),length,0);NSMutableData *raw=[NSMutableData dataWithLength:length];INPUT(fread(raw.mutableBytes,1,length,stdin)==length,@"Truncated workflow command");NSDictionary *c=[NSJSONSerialization JSONObjectWithData:raw options:0 error:NULL];INPUT([c isKindOfClass:NSDictionary.class],@"Invalid workflow JSON");NSString *kind=c[@"kind"];if(![kind isEqual:@"create"]&&![kind isEqual:@"release"])INPUT(state!=nil,@"Workflow compute state is absent");if([kind isEqual:@"present"]||[kind isEqual:@"ink"])INPUT(ink!=nil,@"Workflow ink is absent");NSMutableDictionary *response=[@{@"ok":@YES}mutableCopy];
   if([kind isEqual:@"create"]){INPUT(!state&&!owners.count,@"Workflow state already exists");NSMutableDictionary *op=[c[@"compute"]mutableCopy];op[@"programBytes"]=@(([op[@"vertex"]lengthOfBytesUsingEncoding:NSUTF8StringEncoding]+[op[@"fragment"]lengthOfBytesUsingEncoding:NSUTF8StringEncoding])*3);state=[[SourceCglIteratedState alloc]initWithOperation:op];[state prepare:op];programs=c[@"programs"];}
   else if([kind isEqual:@"upload"]){NSMutableDictionary *op=[c mutableCopy];NSData *values=[[NSData alloc]initWithBase64EncodedString:c[@"base64"] options:0];INPUT(values&&values.length>0&&values.length<=65536*16&&values.length%16==0,@"Invalid seed block");samilaFloatBlock(values,values.length);op[@"positions"]=values;[state upload:op retained:workflowRetained(state,owners) packetBytes:length];}
   else if([kind isEqual:@"advance"]){[state advance:c retained:workflowRetained(state,owners) packetBytes:length];}
   else if([kind isEqual:@"draw"]||[kind isEqual:@"resize"]){uint32_t width=iteratedStateWord(c,@"width"),height=iteratedStateWord(c,@"height");
    if(!ink||ink.width!=width||ink.height!=height){SourceCglIteratedInk *next=[[SourceCglIteratedInk alloc]initWithState:state programs:programs width:width height:height];uint64_t prior=workflowRetained(state,owners);[owners addObject:next];[next prepareWithRetained:prior];if(ink){[ink dispose];[owners removeObjectIdenticalTo:ink];}ink=next;}
    if([kind isEqual:@"draw"]){NSMutableDictionary *plan=[c[@"plan"]mutableCopy],*palette=[plan[@"palette"]mutableCopy];palette[@"bytes"]=[[NSData alloc]initWithBase64EncodedString:palette[@"base64"] options:0];plan[@"palette"]=palette;plan[@"noise"]=[[NSData alloc]initWithBase64EncodedString:plan[@"noiseBase64"] options:0];response[@"facts"]=[ink accumulateAtIndex:iteratedStateWord(c,@"index") plan:plan clear:[c[@"clear"]boolValue] decay:[c[@"decay"]floatValue] record:[c[@"record"]boolValue] retained:workflowRetained(state,owners)];}
   }
   else if([kind isEqual:@"present"]){NSData *rgba=[ink present:c[@"plan"] retained:workflowRetained(state,owners)];workflowWrite(c[@"path"],rgba);response[@"facts"]=ink.lastFacts;}
   else if([kind isEqual:@"ink"]){workflowWrite(c[@"path"],[ink readInkWithRetained:workflowRetained(state,owners)]);}
   else if([kind isEqual:@"state"]){NSMutableData *all=[NSMutableData data];iteratedStateBudget(workflowRetained(state,owners),length,(uint64_t)state.count*24+65536*48);for(uint32_t at=0;at<state.count;at+=65536){NSData *part=[state read:@{@"index":@(state.index),@"offset":@(at),@"count":@(MIN(65536,state.count-at))} retained:workflowRetained(state,owners)+(uint64_t)state.count*24 packetBytes:length];[all appendData:part];}workflowWrite(c[@"path"],all);}
   else if([kind isEqual:@"release"]){for(SourceCglIteratedInk *v in [owners copy]){[v dispose];[owners removeObjectIdenticalTo:v];}ink=nil;[state dispose];state=nil;programs=nil;}
   else INPUT(NO,@"Unknown workflow operation");
   response[@"index"]=@(state?state.index:0);response[@"retainedBytes"]=@(workflowRetained(state,owners));response[@"renderer"]=@((const char*)glGetString(GL_RENDERER));response[@"version"]=@((const char*)glGetString(GL_VERSION));workflowReply(response);
  }}result=0;
 }@catch(NSException *e){workflowReply(@{@"ok":@NO,@"error":@{@"kind":e.name,@"message":e.reason?:@"native workflow failed"}});}
 @finally{for(SourceCglIteratedInk *v in owners)@try{[v dispose];}@catch(NSException *e){fprintf(stderr,"Ink cleanup: %s\n",e.reason.UTF8String);result=1;}@try{[state dispose];}@catch(NSException *e){fprintf(stderr,"State cleanup: %s\n",e.reason.UTF8String);result=1;}@try{destroyContext(&ctx);}@catch(NSException *e){fprintf(stderr,"Context cleanup: %s\n",e.reason.UTF8String);result=1;}}
 return result;
}}
