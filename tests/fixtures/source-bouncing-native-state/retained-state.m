// Real CGL owner test; uses the production parser, framebuffer and typed uniforms.
#define main sourceFrameRendererMain
#include "../../../server/render/SourceCglRenderer.m"
#undef main
static NSData *file(NSString *path){NSError *error=nil;NSData *data=[NSData dataWithContentsOfFile:path options:0 error:&error];RUNTIME(data!=nil,error.description?:@"Missing fixture");return data;}
static NSUInteger rejectionCount=0;
static void rejected(NSString *kind,void(^action)(void)){BOOL caught=NO;@try{action();}@catch(NSException *e){RUNTIME([e.name isEqual:kind],@"Unexpected rejection kind");caught=YES;}RUNTIME(caught,@"Expected request rejection");rejectionCount++;}
static SourceBouncingUpdate updateValues(NSDictionary *v){
 SourceBouncingUpdate u={0};u.subSteps=[v[@"subSteps"]intValue];u.timeStep=[v[@"timeStep"]floatValue];u.particleRadius=[v[@"particleRadius"]floatValue];NSDictionary *b=v[@"boundary"];NSString *kind=b[@"kind"];
 u.shape=[kind isEqual:@"circle"]?1:[kind isEqual:@"ellipse"]?2:0;if(u.shape){u.center[0]=[b[@"center"][0]floatValue];u.center[1]=[b[@"center"][1]floatValue];u.radius=[b[@"radius"]floatValue];u.a=[b[@"a"]floatValue];u.b=[b[@"b"]floatValue];}else{NSArray *vertices=b[@"vertices"];INPUT(vertices.count<=64,@"Polygon too large");u.polygonCount=(uint32_t)vertices.count;for(uint32_t i=0;i<u.polygonCount;i++){u.polygon[i*2]=[vertices[i][0]floatValue];u.polygon[i*2+1]=[vertices[i][1]floatValue];}}return u;
}
int main(int argc,const char **argv){@autoreleasepool{
 CGLContextObj context=NULL;SourceCglBouncingState *state=nil;int status=1;
 @try{
  INPUT(argc==4,@"Usage: retained-state prepared-directory reference-directory output-directory");NSString *prepared=@(argv[1]),*reference=@(argv[2]),*out=@(argv[3]);
  NSDictionary *config=[NSJSONSerialization JSONObjectWithData:file([prepared stringByAppendingPathComponent:@"prepared.json"]) options:0 error:NULL];INPUT(config!=nil,@"Invalid prepared config");NSDictionary *shaders=config[@"shaders"];SourceBouncingUpdate update=updateValues(config[@"update"]);
  createContext(&context);GLuint initialContextReferences=CGLGetContextRetainCount(context);NSMutableDictionary *frame;
  @autoreleasepool{
   NSDictionary *parsed=parse(file([prepared stringByAppendingPathComponent:@"initial-frame.bin"]),NO);NSArray *commands=parsed[@"draws"];INPUT(commands.count>=1,@"Missing point command");NSDictionary *point=commands[0];INPUT([point[@"count"]unsignedIntValue]==[config[@"count"]unsignedIntValue]&&[point[@"flags"]unsignedIntValue]==56&&[point[@"attributes"]count]==0,@"Unexpected retained point command");
   state=[[SourceCglBouncingState alloc]initWithCount:[config[@"count"]unsignedIntValue]];[state prepareQuad:shaders[@"quad"] update:shaders[@"update"] vertex:shaders[@"vertex"] fragment:shaders[@"fragment"]];RUNTIME(CGLGetContextRetainCount(context)==initialContextReferences+1,@"State did not retain its context identity");
   rejected(@"input",^{[state upload:[NSData data] atParticle:0];});
   rejected(@"input",^{[state advanceFrom:0 to:1 update:update];});
   NSFileHandle *seeds=[NSFileHandle fileHandleForReadingAtPath:[prepared stringByAppendingPathComponent:@"seeds.f32"]];INPUT(seeds!=nil,@"Missing seed file");
   @try{
    uint64_t size=[seeds seekToEndOfFile];INPUT(size==[config[@"count"]unsignedLongLongValue]*16,@"Seed file dimensions");[seeds seekToFileOffset:0];NSData *firstSeed=[seeds readDataOfLength:16];[seeds seekToFileOffset:0];
    rejected(@"input",^{[state upload:firstSeed atParticle:1];});
    for(uint64_t offset=0;offset<size;offset+=16*1024*1024)@autoreleasepool{NSUInteger length=(NSUInteger)MIN(16*1024*1024,size-offset);NSData *chunk=[seeds readDataOfLength:length];INPUT(chunk.length==length,@"Truncated seed file");[state upload:chunk atParticle:(uint32_t)(offset/16)];}
    rejected(@"input",^{[state upload:firstSeed atParticle:0];});
   }@finally{[seeds closeFile];}
   frame=[parsed mutableCopy];
  }
  rejected(@"input",^{[state advanceFrom:1 to:2 update:update];});rejected(@"capacity",^{[state advanceFrom:0 to:10001 update:update];});
  SourceBouncingUpdate bad=update;bad.timeStep=NAN;rejected(@"input",^{[state advanceFrom:0 to:1 update:bad];});
  CGLContextObj other=NULL;@try{createContext(&other);rejected(@"runtime",^{[state readState];});rejected(@"runtime",^{[state dispose];});}@finally{CGLSetCurrentContext(context);if(other)CGLDestroyContext(other);}
  NSMutableArray *badUniforms=[frame[@"draws"][0][@"uniforms"]mutableCopy];for(NSUInteger i=0;i<badUniforms.count;i++)if([badUniforms[i][@"name"]isEqual:@"radius"]){NSMutableDictionary *binding=[badUniforms[i]mutableCopy];float radius=10000;binding[@"bytes"]=[NSData dataWithBytes:&radius length:4];badUniforms[i]=binding;}
  rejected(@"capacity",^{[state drawUniforms:badUniforms];});
  NSMutableArray *foreignBindings=[frame[@"draws"][0][@"uniforms"]mutableCopy];[foreignBindings addObject:@{@"name":@"stateTex",@"kind":@9,@"texture":@0}];rejected(@"input",^{[state drawUniforms:foreignBindings];});
  NSMutableArray *rows=[NSMutableArray new];NSArray *checkpoints=@[@1,@3,@4,@7,@8,@12,@23,@32,@38,@53,@62];
  for(uint32_t number=1;number<=62;number++)@autoreleasepool{
   uint32_t target=number>2?number-2:0;[state advanceFrom:state.updates to:target update:update];
   NSString *prefix=number>=3?[NSString stringWithFormat:@"frame-%u/paused",number]:[NSString stringWithFormat:@"frame-%u",number];NSMutableDictionary *row=[@{@"frame":@(number),@"updates":@(target)} mutableCopy];
   if([checkpoints containsObject:@(number)]){NSData *actual=[state readState],*expected=file([[reference stringByAppendingPathComponent:prefix]stringByAppendingPathComponent:@"state.f32"]);INPUT(actual.length==expected.length,@"State dimensions differ");NSUInteger different=0;const uint32_t *a=actual.bytes,*b=expected.bytes;for(NSUInteger i=0;i<actual.length/4;i++)if(a[i]!=b[i])different++;row[@"stateComponents"]=@(actual.length/4);row[@"stateDifferent"]=@(different);}
   __block NSUInteger drawIndex=0;NSData *pixels=renderFrameWithDraw(frame,nil,state.retainedBytes,^(NSDictionary *command,NSArray *textures){if(drawIndex++==0)[state drawUniforms:command[@"uniforms"]];else draw(command,textures);});
   NSData *expected=file([[reference stringByAppendingPathComponent:prefix]stringByAppendingPathComponent:@"before-branding.rgba"]);INPUT(pixels.length==expected.length,@"Pixel dimensions differ");const uint8_t *a=pixels.bytes,*b=expected.bytes;NSUInteger rgbPixels=0,alphaPixels=0;for(NSUInteger i=0;i<pixels.length;i+=4){if(a[i]!=b[i]||a[i+1]!=b[i+1]||a[i+2]!=b[i+2])rgbPixels++;if(a[i+3]!=255)alphaPixels++;}row[@"rgbPixels"]=@(rgbPixels);row[@"opaqueAlphaFailures"]=@(alphaPixels);[rows addObject:row];writeFile(out,[NSString stringWithFormat:@"frame-%u.rgba",number],pixels);
  }
  rejected(@"input",^{[state advanceFrom:60 to:59 update:update];});
  uint64_t readback=state.readbackBytes,retained=state.retainedBytes;glEnable(0xffffffff);[state dispose];RUNTIME(state.retainedBytes==0,@"Disposed state retained storage");[state dispose];rejected(@"input",^{[state advanceFrom:60 to:60 update:update];});state=nil;
  state=[[SourceCglBouncingState alloc]initWithCount:4];rejected(@"runtime",^{[state prepareQuad:@"invalid shader" update:shaders[@"update"] vertex:shaders[@"vertex"] fragment:shaders[@"fragment"]];});[state dispose];state=nil;
  // Capacity/streaming case: no original 5M parity claim. Fully exercise chunk
  // upload including partial rows, padding, rejected chunks and diagnostic data.
  state=[[SourceCglBouncingState alloc]initWithCount:5000000];[state prepareQuad:shaders[@"quad"] update:shaders[@"update"] vertex:shaders[@"vertex"] fragment:shaders[@"fragment"]];RUNTIME(CGLGetContextRetainCount(context)==initialContextReferences+1,@"State did not retain its context identity");
  @autoreleasepool{NSData *tooLarge=[NSMutableData dataWithLength:32*1024*1024];rejected(@"capacity",^{[state upload:tooLarge atParticle:0];});}RUNTIME(state.uploaded==0,@"Rejected upload changed ownership position");
  for(uint32_t offset=0;offset<5000000;)@autoreleasepool{uint32_t count=MIN(1048576,5000000-offset);NSMutableData *chunk=[NSMutableData dataWithLength:(NSUInteger)count*16];float *v=chunk.mutableBytes;for(uint32_t i=0;i<count*4;i++)v[i]=(float)(((uint64_t)offset*4+i)%1024)/1024.0f;[state upload:chunk atParticle:offset];offset+=count;}
  NSMutableDictionary *oversize=[frame mutableCopy];oversize[@"width"]=@4000;oversize[@"height"]=@3000;
  rejected(@"capacity",^{renderFrameWithDraw(oversize,nil,state.retainedBytes,^(NSDictionary *command,NSArray *textures){(void)command;(void)textures;RUNTIME(NO,@"Over-capacity frame reached drawing");});});
  NSUInteger capacityDifferences=0;@autoreleasepool{NSData *actual=[state readState];const float *a=actual.bytes;for(NSUInteger i=0;i<actual.length/4;i++){float expected=i<20000000?(float)(i%1024)/1024.0f:0;if(memcmp(&a[i],&expected,4))capacityDifferences++;}}
  uint64_t largeRetained=state.retainedBytes;[state dispose];RUNTIME(state.retainedBytes==0,@"Large state cleanup failed");state=nil;RUNTIME(CGLGetContextRetainCount(context)==initialContextReferences,@"Context reference retained after disposal");
  BOOL matched=capacityDifferences==0;for(NSDictionary *row in rows)if([row[@"rgbPixels"]unsignedLongLongValue]||[row[@"opaqueAlphaFailures"]unsignedLongLongValue]||[row[@"stateDifferent"]unsignedLongLongValue])matched=NO;
  NSDictionary *report=@{@"status":matched?@"passed":@"differences",@"rows":rows,@"stateReadbackBytes":@(readback),@"retainedStateBytes":@(retained),@"largeCapacity":@{@"particles":@5000000,@"differences":@(capacityDifferences),@"retainedStateBytes":@(largeRetained)},@"rejectedRequests":@(rejectionCount),@"disposed":@YES,@"staleGlErrorCleanup":@YES,@"contextReferencesRestored":@YES,@"windowCreated":@NO,@"renderer":@((const char*)glGetString(GL_RENDERER))};writeFile(out,@"native-report.json",[NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:NULL]);status=matched?0:2;
 }@catch(NSException *e){fprintf(stderr,"%s: %s\n",e.name.UTF8String,e.reason.UTF8String);}
 @finally{@try{[state dispose];}@catch(NSException *e){fprintf(stderr,"Cleanup: %s\n",e.reason.UTF8String);status=3;}destroyContext(&context);}
 return status;
}}
