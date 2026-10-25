// CPU recorder: executes the production ink owner with fake GL calls. It does
// not create a CGL context, execute shaders, or establish actual GPU parity.
#define GL_SILENCE_DEPRECATION
#import <Foundation/Foundation.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl3.h>
#import <OpenGL/gl3ext.h>
#include <math.h>
static const NSUInteger Budget=256*1024*1024;
static void ensure(BOOL ok,NSString *kind,NSString *reason){if(!ok)@throw [NSException exceptionWithName:kind reason:reason userInfo:nil];}
#define INPUT(ok,reason) ensure((ok),@"input",(reason))
#define RUNTIME(ok,reason) ensure((ok),@"runtime",(reason))
static BOOL nameValid(NSString *s){NSData *b=[s dataUsingEncoding:NSASCIIStringEncoding];if(!b||!b.length||[s hasPrefix:@"gl_"])return NO;const uint8_t *p=b.bytes;for(NSUInteger i=0;i<b.length;i++)if(!((p[i]>='a'&&p[i]<='z')||(p[i]>='A'&&p[i]<='Z')||p[i]=='_'||(i&&p[i]>='0'&&p[i]<='9')))return NO;return YES;}
static NSMutableArray<NSDictionary*> *calls;
static NSMutableDictionary<NSNumber*,NSArray*> *active;
static GLuint nextObject=100,currentProgram=0,attachment=0;
static GLenum nextError=GL_NO_ERROR;
static CGLContextObj currentContext=(CGLContextObj)(uintptr_t)1;
static BOOL failDraw=NO,failUnbind=NO,failDelete=NO,failLink=NO,externalAttribute=NO,badOutput=NO;
static NSString *failureReason;
static void note(NSString *kind){[calls addObject:@{@"kind":kind}];}
static CGLContextObj cpuCurrent(void){return currentContext;}
static CGLContextObj cpuRetain(CGLContextObj c){return c;}
static void cpuRelease(CGLContextObj c){(void)c;note(@"releaseContext");}
static GLenum cpuError(void){GLenum r=nextError;nextError=GL_NO_ERROR;return r;}
static void cpuGet(GLenum p,GLint *v){*v=p==GL_MAX_TEXTURE_SIZE?16384:0;}
static void cpuUse(GLuint p){currentProgram=p;note(@"use");}
static void cpuBindFbo(GLenum t,GLuint f){(void)t;if(!f&&failUnbind){nextError=GL_INVALID_OPERATION;failUnbind=NO;}note(@"bindFbo");}
static void cpuBindVao(GLuint v){(void)v;note(@"bindVao");}
static void cpuBindBuffer(GLenum t,GLuint b){(void)t;(void)b;note(@"bindBuffer");}
static void cpuEnable(GLenum e){(void)e;note(@"enable");}
static void cpuDisable(GLenum e){(void)e;note(@"disable");}
static void cpuEnablei(GLenum e,GLuint i){(void)e;(void)i;note(@"enablei");}
static void cpuDisablei(GLenum e,GLuint i){(void)e;(void)i;note(@"disablei");}
static void cpuActive(GLenum e){(void)e;note(@"activeTexture");}
static void cpuBindTexture(GLenum t,GLuint n){(void)t;(void)n;note(@"bindTexture");}
static void cpuParam(GLenum t,GLenum p,GLint n){(void)t;(void)p;(void)n;note(@"parameter");}
static void cpuImage(GLenum t,GLint l,GLint f,GLsizei w,GLsizei h,GLint b,GLenum fm,GLenum ty,const void *d){(void)t;(void)l;(void)f;(void)w;(void)h;(void)b;(void)fm;(void)ty;(void)d;note(@"allocation");}
static void cpuSubImage(GLenum t,GLint l,GLint x,GLint y,GLsizei w,GLsizei h,GLenum fm,GLenum ty,const void *d){(void)t;(void)l;(void)x;(void)y;(void)w;(void)h;(void)fm;(void)ty;(void)d;note(@"upload");}
static void cpuGen(GLsizei n,GLuint *p){for(int i=0;i<n;i++)p[i]=nextObject++;note(@"allocation");}
static void cpuDelete(GLsizei n,const GLuint *p){(void)n;(void)p;note(@"delete");if(failDelete){nextError=GL_INVALID_OPERATION;failDelete=NO;}}
static GLuint cpuCreateShader(GLenum t){(void)t;note(@"createShader");return nextObject++;}
static void cpuShaderSource(GLuint n,GLsizei c,const GLchar *const *s,const GLint *l){(void)n;(void)c;(void)s;(void)l;note(@"shaderSource");}
static void cpuCompile(GLuint n){(void)n;note(@"compile");}
static void cpuShaderInfo(GLuint n,GLenum p,GLint *v){(void)n;(void)p;*v=1;}
static void cpuShaderLog(GLuint n,GLsizei c,GLsizei *l,GLchar *s){(void)n;(void)c;if(l)*l=0;*s=0;}
static GLuint cpuCreateProgram(void){note(@"createProgram");return nextObject++;}
static void cpuAttach(GLuint p,GLuint s){(void)p;(void)s;note(@"attach");}
static void cpuLink(GLuint p){(void)p;note(@"link");}
static void cpuDetach(GLuint p,GLuint s){(void)p;(void)s;note(@"detach");}
static void cpuDrop(GLuint n){cpuDelete(1,&n);}
static GLenum typeFor(NSString *k){NSDictionary *v=@{@"float":@(GL_FLOAT),@"int":@(GL_INT),@"bool":@(GL_BOOL),@"vec2":@(GL_FLOAT_VEC2),@"vec3":@(GL_FLOAT_VEC3),@"vec4":@(GL_FLOAT_VEC4),@"ivec2":@(GL_INT_VEC2),@"mat4":@(GL_FLOAT_MAT4),@"sampler2D":@(GL_SAMPLER_2D),@"usampler2D":@(GL_UNSIGNED_INT_SAMPLER_2D)};return[v[k]unsignedIntValue];}
static void cpuProgramInfo(GLuint p,GLenum kind,GLint *v){if(kind==GL_LINK_STATUS)*v=!failLink;else if(kind==GL_ACTIVE_UNIFORMS)*v=(GLint)[active[@(p)]count];else if(kind==GL_ACTIVE_ATTRIBUTES)*v=externalAttribute?1:0;else *v=0;}
static void cpuActiveUniform(GLuint p,GLuint i,GLsizei cap,GLsizei *length,GLint *size,GLenum *type,GLchar *name){NSDictionary *u=active[@(p)][i];const char *n=[u[@"name"]UTF8String];strlcpy(name,n,(size_t)cap);*length=(GLsizei)strlen(n);*size=[u[@"size"]intValue];*type=typeFor(u[@"kind"]);}
static void cpuActiveAttribute(GLuint p,GLuint i,GLsizei c,GLsizei *l,GLint *s,GLenum *t,GLchar *n){(void)p;(void)i;strlcpy(n,"unowned",(size_t)c);*l=7;*s=1;*t=GL_FLOAT_VEC4;}
static GLint cpuLocation(GLuint p,const GLchar *name){NSArray *a=active[@(p)];for(NSUInteger i=0;i<a.count;i++)if([a[i][@"name"]isEqual:@(name)])return (GLint)i;return -1;}
static GLint cpuOutput(GLuint p,const GLchar *n){(void)p;return badOutput?-1:strcmp(n,"facts")==0?1:0;}
static void cpuUniform1i(GLint l,GLint v){(void)l;(void)v;note(@"uniform");}
static void cpuUniformiv(GLint l,GLsizei n,const GLint *v){(void)l;(void)n;(void)v;note(@"uniform");}
static void cpuUniformfv(GLint l,GLsizei n,const GLfloat *v){(void)l;(void)n;(void)v;note(@"uniform");}
static void cpuMatrix(GLint l,GLsizei n,GLboolean t,const GLfloat *v){(void)l;(void)n;(void)t;(void)v;note(@"uniform");}
static void cpuAttachTexture(GLenum t,GLenum a,GLenum tx,GLuint id,GLint l){(void)t;(void)tx;(void)l;if(a==GL_COLOR_ATTACHMENT0)attachment=id;note(@"attachTarget");}
static void cpuDrawBuffers(GLsizei n,const GLenum *v){(void)n;(void)v;note(@"drawBuffers");}
static void cpuReadBuffer(GLenum v){(void)v;note(@"readBuffer");}
static GLenum cpuFboStatus(GLenum t){(void)t;return GL_FRAMEBUFFER_COMPLETE;}
static void cpuViewport(GLint x,GLint y,GLsizei w,GLsizei h){(void)x;(void)y;(void)w;(void)h;note(@"viewport");}
static void cpuClearF(GLenum b,GLint d,const GLfloat *v){(void)b;(void)d;(void)v;note(@"clear");}
static void cpuClearU(GLenum b,GLint d,const GLuint *v){(void)b;(void)d;(void)v;note(@"clear");}
static void cpuBlendEquation(GLenum e){(void)e;note(@"blendEquation");}
static void cpuBlendColor(GLfloat r,GLfloat g,GLfloat b,GLfloat a){(void)r;(void)g;(void)b;(void)a;note(@"blendColor");}
static void cpuBlendFunc(GLenum s,GLenum d){(void)s;(void)d;note(@"blendFunc");}
static void cpuDraw(GLenum m,GLint f,GLsizei c){(void)m;(void)f;(void)c;[calls addObject:@{@"kind":@"draw",@"program":@(currentProgram)}];if(failDraw){failDraw=NO;@throw[NSException exceptionWithName:@"runtime" reason:failureReason?:@"primary draw failure" userInfo:nil];}}
static void cpuDrawInstanced(GLenum m,GLint f,GLsizei c,GLsizei n){(void)n;cpuDraw(m,f,c);}
static void cpuPixels(GLint x,GLint y,GLsizei w,GLsizei h,GLenum f,GLenum t,void *v){(void)x;(void)y;note(@"read");size_t size=(size_t)w*h*4*(t==GL_UNSIGNED_BYTE?1:4);memset(v,0,size);(void)f;}
#define CGLGetCurrentContext cpuCurrent
#define CGLRetainContext cpuRetain
#define CGLReleaseContext cpuRelease
#define glGetError cpuError
#define glGetIntegerv cpuGet
#define glUseProgram cpuUse
#define glBindFramebuffer cpuBindFbo
#define glBindVertexArray cpuBindVao
#define glBindBuffer cpuBindBuffer
#define glEnable cpuEnable
#define glDisable cpuDisable
#define glEnablei cpuEnablei
#define glDisablei cpuDisablei
#define glActiveTexture cpuActive
#define glBindTexture cpuBindTexture
#define glTexParameteri cpuParam
#define glTexImage2D cpuImage
#define glTexSubImage2D cpuSubImage
#define glGenTextures cpuGen
#define glGenFramebuffers cpuGen
#define glGenVertexArrays cpuGen
#define glDeleteTextures cpuDelete
#define glDeleteFramebuffers cpuDelete
#define glDeleteVertexArrays cpuDelete
#define glCreateShader cpuCreateShader
#define glShaderSource cpuShaderSource
#define glCompileShader cpuCompile
#define glGetShaderiv cpuShaderInfo
#define glGetShaderInfoLog cpuShaderLog
#define glCreateProgram cpuCreateProgram
#define glAttachShader cpuAttach
#define glLinkProgram cpuLink
#define glDetachShader cpuDetach
#define glDeleteShader cpuDrop
#define glDeleteProgram cpuDrop
#define glGetProgramiv cpuProgramInfo
#define glGetProgramInfoLog cpuShaderLog
#define glGetActiveUniform cpuActiveUniform
#define glGetActiveAttrib cpuActiveAttribute
#define glGetUniformLocation cpuLocation
#define glGetFragDataLocation cpuOutput
#define glUniform1i cpuUniform1i
#define glUniform1iv cpuUniformiv
#define glUniform2iv cpuUniformiv
#define glUniform1fv cpuUniformfv
#define glUniform2fv cpuUniformfv
#define glUniform3fv cpuUniformfv
#define glUniform4fv cpuUniformfv
#define glUniformMatrix4fv cpuMatrix
#define glFramebufferTexture2D cpuAttachTexture
#define glDrawBuffers cpuDrawBuffers
#define glReadBuffer cpuReadBuffer
#define glCheckFramebufferStatus cpuFboStatus
#define glViewport cpuViewport
#define glClearBufferfv cpuClearF
#define glClearBufferuiv cpuClearU
#define glBlendEquation cpuBlendEquation
#define glBlendColor cpuBlendColor
#define glBlendFunc cpuBlendFunc
#define glDrawArrays cpuDraw
#define glDrawArraysInstanced cpuDrawInstanced
#define glReadPixels cpuPixels
#include "../../../server/render/SourceCglIteratedState.h"
static void samilaRaster(uint32_t w,uint32_t h){(void)w;(void)h;note(@"raster");}
#include "../../../server/render/SourceCglIteratedInk.h"

@interface CpuState:SourceCglIteratedState
-(instancetype)initWithCount:(uint32_t)count;
@property(readonly) uint32_t viewCalls;
@end
@implementation CpuState {uint32_t _viewCalls;}
-(instancetype)initWithCount:(uint32_t)count{self=[super init];if(self){_count=count;_uploaded=count;_prepared=YES;}return self;}
-(SourceCglIteratedDrawView)drawViewAtIndex:(uint32_t)index retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{(void)retained;(void)packetBytes;INPUT(index==_index,@"bad view checkpoint");_viewCalls++;return(SourceCglIteratedDrawView){11,12,MIN(2048,_count),(_count+MIN(2048,_count)-1)/MIN(2048,_count),_count,_index};}
-(uint32_t)viewCalls{return _viewCalls;}
@end
@interface CpuInk:SourceCglIteratedInk
-(void)acceptFixturePrograms:(NSDictionary*)fixture;
-(BOOL)failed;
-(GLuint)framebuffer;
@end
@implementation CpuInk
-(void)acceptFixturePrograms:(NSDictionary*)fixture{_prepared=YES;_framebuffer=800;_vao=801;_ink=802;_output=803;_facts=804;_reductions[0]=805;_reductions[1]=806;_palette=807;_noise=808;NSArray *names=iteratedInkProgramNames();for(int i=0;i<6;i++){_programs[i]=(GLuint)i+1;active[@(i+1)]=fixture[names[i]];}}
-(BOOL)failed{return _failed;}
-(GLuint)framebuffer{return _framebuffer;}
@end
static unsigned checks=0;
static NSMutableArray *cases,*findings;
static void expect(BOOL ok,NSString *message){checks++;if(!ok)@throw[NSException exceptionWithName:@"TestFailure" reason:message userInfo:nil];}
static NSException *rejected(NSString *kind,void (^work)(void)){NSException *failure=nil;@try{work();}@catch(NSException *e){failure=e;}expect(failure!=nil,@"Unexpected admission");expect([failure.name isEqual:kind],[NSString stringWithFormat:@"Expected %@, got %@: %@",kind,failure.name,failure.reason]);return failure;}
static NSUInteger nCalls(NSString *kind){return [[calls filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *r,NSDictionary *b){(void)b;return[r[@"kind"]isEqual:kind];}]]count];}
static NSMutableDictionary *mutablePlan(NSDictionary *p){NSMutableDictionary *r=[p mutableCopy];for(NSString *k in @[@"drawUniforms",@"statsUniforms",@"uniforms"])if(p[k]){NSMutableArray *a=[NSMutableArray new];for(NSDictionary *u in p[k])[a addObject:[u mutableCopy]];r[k]=a;}return r;}
static void setBinding(NSMutableDictionary *plan,NSString *group,NSString *name,id value,BOOL sampler){for(NSMutableDictionary *u in plan[group])if([u[@"name"]isEqual:name]){u[sampler?@"texture":@"values"]=value;return;}@throw[NSException exceptionWithName:@"TestFailure" reason:@"Missing fixture binding" userInfo:nil];}
static void resetCalls(void){calls=[NSMutableArray new];nextError=GL_NO_ERROR;failDraw=failUnbind=failDelete=failLink=externalAttribute=badOutput=NO;failureReason=nil;currentContext=(CGLContextObj)(uintptr_t)1;}
static void unchanged(CpuInk *ink,uint64_t bytes){expect(nCalls(@"clear")==0&&nCalls(@"draw")==0&&nCalls(@"uniform")==0&&nCalls(@"allocation")==0&&nCalls(@"upload")==0,@"Rejected binding mutated ink or submitted uniforms");expect(ink.displays==0&&ink.lastFacts==nil&&ink.retainedBytes==bytes&&!ink.failed,@"Input rejection changed owner state");}
int main(int argc,const char **argv){@autoreleasepool{@try{
 expect(argc==2,@"Supply production fixture JSON");NSDictionary *fixture=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:@(argv[1])] options:NSJSONReadingMutableContainers error:nil];expect(fixture!=nil,@"Readable fixture");active=[NSMutableDictionary new];cases=[NSMutableArray new];findings=[NSMutableArray new];resetCalls();
 uint32_t count=[fixture[@"count"]unsignedIntValue],width=[fixture[@"width"]unsignedIntValue],height=[fixture[@"height"]unsignedIntValue];CpuState *state=[[CpuState alloc]initWithCount:count];CpuInk *ink=[[CpuInk alloc]initWithState:state programs:fixture[@"programs"] width:width height:height];[ink acceptFixturePrograms:fixture[@"declared"]];uint64_t baseline=ink.retainedBytes,retained=baseline+state.retainedBytes;
 NSMutableDictionary *draw=mutablePlan(fixture[@"draw"]),*palette=[draw[@"palette"]mutableCopy];palette[@"bytes"]=[[NSData alloc]initWithBase64EncodedString:palette[@"base64"] options:0];draw[@"palette"]=palette;draw[@"noise"]=[[NSData alloc]initWithBase64EncodedString:draw[@"noiseBase64"] options:0];NSDictionary *present=fixture[@"present"];
 // Each expected input failure executes the same real accumulate entry point.
 NSArray *owned=@[@[@"drawUniforms",@"states",@3,@YES],@[@"drawUniforms",@"counters",@0,@YES],@[@"drawUniforms",@"palette",@0,@YES],@[@"drawUniforms",@"noisePermutation",@0,@YES],@[@"drawUniforms",@"size",@[@1,@1],@NO],@[@"drawUniforms",@"count",@[@1],@NO],@[@"drawUniforms",@"stateWidth",@[@1],@NO],@[@"drawUniforms",@"particleOffset",@[@1],@NO],@[@"statsUniforms",@"size",@[@1,@1],@NO],@[@"statsUniforms",@"recording",@[@0],@NO],@[@"statsUniforms",@"count",@[@1],@NO]];
 for(NSArray *c in owned){NSMutableDictionary *p=mutablePlan(draw);setBinding(p,c[0],c[1],c[2],[c[3]boolValue]);resetCalls();rejected(@"input",^{[ink accumulateAtIndex:0 plan:p clear:YES decay:.5 record:YES retained:retained];});unchanged(ink,baseline);[cases addObject:[@"owned-" stringByAppendingString:c[1]]];}
 for(NSArray *c in @[@[@"ink",@2,@YES],@[@"origin",@[@1,@0],@NO],@[@"viewportAspect",@[@1],@NO]]){NSMutableDictionary *p=mutablePlan(present);setBinding(p,@"uniforms",c[0],c[1],[c[2]boolValue]);resetCalls();rejected(@"input",^{[ink present:p retained:retained];});unchanged(ink,baseline);[cases addObject:[@"present-owned-"stringByAppendingString:c[0]]];}
 for(id bad in @[@[],@[@1,@2],@[@"number"],@[@(NAN)],@[@(INFINITY)],@[@(DBL_MAX)]]){NSMutableDictionary *p=mutablePlan(draw);setBinding(p,@"drawUniforms",@"radius",bad,NO);resetCalls();rejected(@"input",^{[ink accumulateAtIndex:0 plan:p clear:YES decay:.5 record:YES retained:retained];});unchanged(ink,baseline);}
 [cases addObject:@"malformed-float-shape-and-range"];
 for(NSString *kind in @[@"bogus",@"vec2",@"int"]){NSMutableDictionary *p=mutablePlan(draw);for(NSMutableDictionary *u in p[@"drawUniforms"])if([u[@"name"]isEqual:@"radius"])u[@"kind"]=kind;resetCalls();rejected(@"input",^{[ink accumulateAtIndex:0 plan:p clear:YES decay:.5 record:YES retained:retained];});unchanged(ink,baseline);}
 [cases addObject:@"wrong-active-kind"];
 for(id bad in @[@[@.5],@[@(2147483648.)]]){NSMutableDictionary *p=mutablePlan(draw);setBinding(p,@"drawUniforms",@"colorMode",bad,NO);resetCalls();rejected(@"input",^{[ink accumulateAtIndex:0 plan:p clear:YES decay:.5 record:YES retained:retained];});unchanged(ink,baseline);}
 [cases addObject:@"malformed-integer-range"];
 // Regressions for probes that previously admitted duplicate fixed bindings,
 // a mismatched primitive, or coerced string clear colors into numbers.
 for(NSString *probe in @[@"duplicate-owned",@"non-record-uniform",@"non-array-uniforms",@"primitive-mismatch",@"missing-plan-record",@"palette-record",@"palette-bytes",@"noise-bytes"]){NSMutableDictionary *p=mutablePlan(draw);
  if([probe isEqual:@"duplicate-owned"]){for(NSDictionary *u in [p[@"drawUniforms"]copy])if([u[@"name"]isEqual:@"states"])[p[@"drawUniforms"]addObject:u];}
  if([probe isEqual:@"non-record-uniform"])[p[@"drawUniforms"]addObject:@"not a record"];
  if([probe isEqual:@"non-array-uniforms"])p[@"drawUniforms"]=(id)@"not an array";
  if([probe isEqual:@"primitive-mismatch"])p[@"primitive"]=@"triangles";
  if([probe isEqual:@"palette-record"])p[@"palette"]=@[];
  if([probe isEqual:@"palette-bytes"]){NSMutableDictionary *v=[p[@"palette"]mutableCopy];v[@"bytes"]=@"not bytes";p[@"palette"]=v;}
  if([probe isEqual:@"noise-bytes"])p[@"noise"]=@"not bytes";
  resetCalls();rejected(@"input",^{[ink accumulateAtIndex:0 plan:[probe isEqual:@"missing-plan-record"]?(id)@[]:p clear:YES decay:1 record:YES retained:retained];});unchanged(ink,baseline);[cases addObject:probe];
 }
 for(id clear in @[@[@"0",@"0",@"0",@"1"],@[@YES,@0,@0,@1],@[[NSNull null],@0,@0,@1]]){NSMutableDictionary *p=mutablePlan(present);p[@"clear"]=clear;resetCalls();rejected(@"input",^{[ink present:p retained:retained];});unchanged(ink,baseline);}
 [cases addObject:@"typed-clear-no-coercion"];
 NSMutableDictionary *badPresent=mutablePlan(present);[badPresent[@"uniforms"]addObject:[badPresent[@"uniforms"]firstObject]];resetCalls();rejected(@"input",^{[ink present:badPresent retained:retained];});unchanged(ink,baseline);[cases addObject:@"duplicate-present-owned"];

 // Inactive extra uniforms are legal; active missing names and array shape fail.
 for(int program=1;program<=6;program++){NSArray *saved=active[@(program)];active[@(program)]=[saved arrayByAddingObject:@{@"name":@"unexpectedActive",@"kind":@"float",@"size":@1}];resetCalls();rejected(@"input",^{if(program==4||program==5)[ink present:present retained:retained];else [ink accumulateAtIndex:0 plan:draw clear:YES decay:.5 record:YES retained:retained];});unchanged(ink,baseline);active[@(program)]=saved;}
 [cases addObject:@"all-programs-active-coverage-before-mutation"];
 resetCalls();rejected(@"input",^{[ink accumulateAtIndex:1 plan:draw clear:YES decay:1 record:YES retained:retained];});unchanged(ink,baseline);
 resetCalls();rejected(@"input",^{[ink accumulateAtIndex:0 plan:draw clear:YES decay:1 record:YES retained:retained-1];});unchanged(ink,baseline);
 resetCalls();rejected(@"capacity",^{[ink present:present retained:Budget];});unchanged(ink,baseline);
 resetCalls();rejected(@"input",^{[ink readInkWithRetained:retained-1];});unchanged(ink,baseline);
 resetCalls();currentContext=(CGLContextObj)(uintptr_t)2;rejected(@"runtime",^{[ink present:present retained:retained];});unchanged(ink,baseline);resetCalls();[cases addObject:@"checkpoint-budget-context"];

 // Creation checks execute real compilation/link admission against stub driver
 // facts. External vertex input and missing fragment outputs precede storage.
 for(NSString *problem in @[@"attribute",@"output",@"link",@"context",@"budget"]){resetCalls();CpuInk *q=[[CpuInk alloc]initWithState:state programs:fixture[@"programs"] width:width height:height];externalAttribute=[problem isEqual:@"attribute"];badOutput=[problem isEqual:@"output"];failLink=[problem isEqual:@"link"];if([problem isEqual:@"context"])currentContext=(CGLContextObj)(uintptr_t)2;NSString *kind=[problem isEqual:@"context"]||failLink?@"runtime":[problem isEqual:@"budget"]?@"capacity":@"input";
  rejected(kind,^{[q prepareWithRetained:[problem isEqual:@"budget"]?Budget:state.retainedBytes];});expect(nCalls(@"allocation")==0&&nCalls(@"clear")==0&&nCalls(@"draw")==0,@"Invalid creation reached ink allocation");expect(q.retainedBytes==baseline,@"Failed creation abandoned cleanup responsibility");resetCalls();[q dispose];expect(q.retainedBytes==0,@"Failed creation cleanup was not possible");
 }
 [cases addObject:@"creation-attributes-outputs-context-budget"];
 // Uniform array-shaped linked ABI is unsupported before touching ink.
 NSArray *originalActive=active[@1];active[@1]=[originalActive arrayByAddingObject:@{@"name":@"unsupportedArray",@"kind":@"float",@"size":@2}];resetCalls();rejected(@"runtime",^{[ink accumulateAtIndex:0 plan:draw clear:YES decay:.5 record:YES retained:retained];});unchanged(ink,baseline);active[@1]=originalActive;[cases addObject:@"active-array-shape"];
 // A successful draw publishes facts only after cleanup. The fake reducer has
 // zero facts, deliberately independent of the mathematical scene.
 [ink accumulateAtIndex:0 plan:draw clear:YES decay:1 record:YES retained:retained];expect(ink.displays==1&&ink.lastFacts!=nil&&nCalls(@"draw")>0,@"Valid prepared draw rejected");[cases addObject:@"successful-owner-publication"];
 CpuInk *failed=[[CpuInk alloc]initWithState:state programs:fixture[@"programs"] width:width height:height];[failed acceptFixturePrograms:fixture[@"declared"]];resetCalls();failDraw=YES;failUnbind=YES;failureReason=@"injected primary";NSException *failure=rejected(@"runtime",^{[failed accumulateAtIndex:0 plan:draw clear:YES decay:.5 record:YES retained:retained];});expect([failure.reason containsString:@"injected primary"]&&[failure.reason containsString:@"cleanup"],@"Primary or cleanup reason lost");expect(failure.userInfo[@"primary"]&&failure.userInfo[@"cleanup"],@"Both underlying errors must remain inspectable");expect(failed.failed&&failed.displays==0&&failed.lastFacts==nil&&failed.retainedBytes==baseline,@"Failed effect published state or abandoned ownership");resetCalls();rejected(@"runtime",^{[failed present:present retained:retained];});expect(calls.count==0,@"Poisoned owner performed GL work");[cases addObject:@"primary-cleanup-error-and-poison"];
 resetCalls();failDelete=YES;GLuint ownedFramebuffer=failed.framebuffer;rejected(@"runtime",^{[failed dispose];});expect(failed.framebuffer==ownedFramebuffer&&failed.retainedBytes==baseline,@"Failed deletion relinquished handle ownership");resetCalls();[failed dispose];expect(failed.retainedBytes==0&&failed.framebuffer==0,@"Explicit cleanup retry failed");NSUInteger callsBefore=calls.count;[failed dispose];expect(calls.count==callsBefore,@"Idempotent disposal performed GL work");[cases addObject:@"cleanup-retry-retains-exact-handle"];
 resetCalls();[ink dispose];expect(ink.retainedBytes==0,@"Successful owner did not release");
 NSDictionary *result=@{@"status":@"passed",@"checks":@(checks),@"cases":cases,@"findings":findings,@"scope":@"CPU GL-call recorder executes production ink methods; prepared fixture contains declared rather than driver-linked active uniforms. No real GL context, shader execution, GPU contents or actual driver cleanup is established."};NSData *json=[NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];fwrite(json.bytes,1,json.length,stdout);fputc('\n',stdout);return 0;
 }@catch(NSException *e){fprintf(stderr,"%s: %s\n",e.name.UTF8String,e.reason.UTF8String);return 1;}}}
