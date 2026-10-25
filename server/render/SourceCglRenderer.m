// Windowless native frame owner. CLI evidence and persistent stdio share the
// same parser and drawing implementation. No network listener or app window.
#define GL_SILENCE_DEPRECATION
#import <Foundation/Foundation.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl3.h>
#import <OpenGL/gl3ext.h>
#include <math.h>
static const NSUInteger Budget=256*1024*1024;
#include "SourceCglSamilaStatistics.h"
static void ensure(BOOL ok,NSString *kind,NSString *reason){if(!ok)@throw [NSException exceptionWithName:kind reason:reason userInfo:nil];}
#define INPUT(ok,reason) ensure((ok),@"input",(reason))
#define RUNTIME(ok,reason) ensure((ok),@"runtime",(reason))
@interface FrameReader:NSObject
@property NSData *data;
@property NSUInteger offset;
-(uint32_t)word;
-(float)number;
-(NSData*)block;
-(NSString*)text;
@end
@implementation FrameReader
-(const void*)take:(NSUInteger)n {INPUT(n<=self.data.length-self.offset,@"Truncated frame field");const uint8_t *p=self.data.bytes;const void *result=p+self.offset;self.offset+=n;return result;}
-(uint32_t)word {uint32_t n;memcpy(&n,[self take:4],4);return CFSwapInt32LittleToHost(n);}
-(float)number {uint32_t n=[self word];float value;memcpy(&value,&n,4);INPUT(isfinite(value),@"Nonfinite frame scalar");return value;}
-(NSData*)block {uint32_t n=[self word];const void *p=[self take:n];return [NSData dataWithBytes:p length:n];}
-(NSString*)text {NSData *b=[self block];NSString *s=[[NSString alloc]initWithData:b encoding:NSUTF8StringEncoding];INPUT(s.length>0&&memchr(b.bytes,0,b.length)==NULL,@"Invalid UTF-8/NUL string");return s;}
@end
static BOOL nameValid(NSString *s){NSData *b=[s dataUsingEncoding:NSASCIIStringEncoding];if(!b||!b.length||[s hasPrefix:@"gl_"])return NO;const uint8_t *p=b.bytes;for(NSUInteger i=0;i<b.length;i++)if(!((p[i]>='a'&&p[i]<='z')||(p[i]>='A'&&p[i]<='Z')||p[i]=='_'||(i&&p[i]>='0'&&p[i]<='9')))return NO;return YES;}
static NSUInteger count(FrameReader *r,NSUInteger minimum){NSUInteger n=[r word];INPUT(n<=(r.data.length-r.offset)/minimum,@"Collection exceeds remaining packet");return n;}
static uint32_t indexAt(NSData *b,NSUInteger i,NSUInteger width){if(width==2){uint16_t n;memcpy(&n,(const uint8_t*)b.bytes+i*2,2);return CFSwapInt16LittleToHost(n);}uint32_t n;memcpy(&n,(const uint8_t*)b.bytes+i*4,4);return CFSwapInt32LittleToHost(n);}
typedef struct {
 int32_t subSteps,shape;
 float timeStep,particleRadius,center[2],radius,a,b;
 uint32_t polygonCount;
 float polygon[128];
} SourceBouncingUpdate;
static NSArray *samilaUniforms(FrameReader *r){
 NSUInteger n=count(r,12);NSMutableArray *values=[NSMutableArray new];NSMutableSet *names=[NSMutableSet new];
 for(NSUInteger i=0;i<n;i++){
  NSString *name=[r text];uint32_t kind=[r word],number=[r word];INPUT(nameValid(name)&&![names containsObject:name]&&kind>=1&&kind<=11,@"Invalid Samila uniform declaration");[names addObject:name];
  if(kind==9){INPUT(number<4,@"Invalid Samila sampler unit");[values addObject:@{@"name":name,@"kind":@(kind),@"texture":@(number)}];continue;}
  NSData *bytes=[r block];uint32_t components=kind==3||kind==4?2:kind==5||kind==10?3:kind==6?4:kind==7?16:1;
  INPUT(number>0&&number<=INT_MAX&&(kind==8||kind==10||number==1)&&(uint64_t)number*components*4==bytes.length,@"Invalid Samila uniform dimensions");
  for(NSUInteger j=0;j<bytes.length/4;j++){uint32_t bits=indexAt(bytes,j,4);if(kind==11)INPUT(bits<=1,@"Invalid Samila boolean");else if(kind!=2&&kind!=4){float v;memcpy(&v,&bits,4);INPUT(isfinite(v),@"Nonfinite Samila uniform");}}
  [values addObject:@{@"name":name,@"kind":@(kind),@"count":@(number),@"bytes":bytes}];
 }return values;
}
static void samilaFloatBlock(NSData *data,NSUInteger length){INPUT(data.length==length,@"Invalid Samila LUT length");for(NSUInteger i=0;i<data.length/4;i++){uint32_t bits=indexAt(data,i,4);float v;memcpy(&v,&bits,4);INPUT(isfinite(v),@"Nonfinite Samila LUT");}}
#include "SourceCglIteratedRenderProtocol.h"
#include "SourceCglSymmetryProtocol.h"
static NSDictionary *parseWithRetained(NSData *packet,BOOL trace,uint64_t retainedBytes){
 FrameReader *r=[FrameReader new];r.data=packet;
 INPUT([r word]==0x31464c4d,@"Unknown frame magic");uint32_t version=[r word];INPUT(version>=1&&version<=10,@"Unknown frame version");INPUT([r word]==packet.length,@"Packet length mismatch");
 uint32_t generation=[r word],sequence=[r word],width=[r word],height=[r word];INPUT(generation&&sequence,@"Missing frame identity");
 INPUT(width>0&&width<=16384&&height>0&&height<=16384&&(uint64_t)width*height<=16000000,@"Invalid physical frame dimensions");
 NSMutableArray *clear=[NSMutableArray new];for(int i=0;i<4;i++){float v=[r number];INPUT(v>=0&&v<=1,@"Invalid clear color");[clear addObject:@(v)];}
 NSUInteger nt=count(r,16),nd=count(r,40);uint32_t samples=version>=2?[r word]:0;INPUT(samples<=INT_MAX,@"Invalid sample count");uint32_t completion=version>=3?[r word]:0;INPUT(completion<=1&&(!completion||[clear[3]floatValue]==1),@"Invalid completion alpha policy");
 BOOL render=(version==7||version==10)&&packet.length>=68&&indexAt(packet,15,4)==3;
 BOOL iteratedRelease=((version==6||version==8)&&packet.length==88&&indexAt(packet,16,4)==5)||(render&&packet.length==(version==10?96:88)&&indexAt(packet,16,4)==4);
 uint64_t responseBytes=render?128+(indexAt(packet,16,4)==3?(uint64_t)width*height*12:0):(uint64_t)width*height*(12+(uint64_t)8*samples);
 ensure((iteratedRelease?0:retainedBytes)+packet.length*(version>=4?6:4)+responseBytes<=Budget,@"capacity",@"Packet, copies, multisample GPU and frame buffers exceed budget");
 ensure(!trace||((uint64_t)nd+1)*width*height*4<=Budget,@"capacity",@"Diagnostic draw readbacks exceed budget");
 if(version>=6){
  INPUT(nt==0&&nd==0&&samples==0&&completion==0,@"Iterated envelope cannot contain generic draws");for(NSNumber *v in clear)INPUT(v.floatValue==0,@"Iterated envelope clear must be zero");
  uint32_t family=[r word];if((version==7||version==10)&&family==3){NSDictionary *op=parseIteratedRender(r,width,height,version);INPUT(r.offset==packet.length,@"Trailing iterated render bytes");return @{@"generation":@(generation),@"sequence":@(sequence),@"width":@(width),@"height":@(height),@"samples":@0,@"iteratedRender":op,@"packetBytes":@(packet.length)};}
  INPUT(version!=10&&family==2&&width==1&&height==1,@"Unknown iterated native family/control dimensions");uint32_t kind=[r word];NSData *resource=[r block];BOOL nonzero=NO;for(NSUInteger i=0;i<resource.length;i++)if(((const uint8_t*)resource.bytes)[i])nonzero=YES;
  INPUT((version==6?(kind>=1&&kind<=5):version==7?(kind==3||kind==6):version==8?(kind==2||kind==4||kind==5||kind==7||kind==8):kind==9)&&resource.length==16&&nonzero,@"Invalid iterated operation/resource");NSMutableDictionary *op=[@{@"kind":@(kind),@"resource":resource,@"fragmentProfile":@(version>=8)}mutableCopy];
  if(kind==1||kind==6||kind==7){uint32_t particles=[r word];INPUT(particles>=1&&particles<=8000000,@"Invalid iterated particle count");op[@"count"]=@(particles);uint64_t programBytes=0;
   for(NSString *key in (kind==6?@[@"vertex",@"fragment",@"diagnosticVertex",@"diagnosticFragment"]:@[@"vertex",@"fragment"])){NSString *source=[r text];INPUT([source hasPrefix:@"#version 410 core\n"],@"Iterated shader requires explicit native GL41 profile");op[key]=source;programBytes+=[source lengthOfBytesUsingEncoding:NSUTF8StringEncoding]*3;}
   op[@"programBytes"]=@(programBytes);uint64_t texels=kind==7?(uint64_t)ceil(sqrt((double)particles))*(uint64_t)ceil(sqrt((double)particles)):particles,base=retainedBytes+texels*64+programBytes+1024*1024;ensure(base+packet.length*6<=Budget,@"capacity",@"Iterated creation exceeds shared budget");if(kind==7)op[@"bindingNames"]=parseSymmetryNames(r,base);
  }
  if((kind>=2&&kind<=4)||kind==8||kind==9){uint32_t index=[r word];INPUT(kind!=2||index==0,@"Iterated seed upload requires initial checkpoint");INPUT((kind!=3&&kind!=8&&kind!=9)||index<UINT32_MAX,@"Iterated advance checkpoint exhausted");op[@"index"]=@(index);}
  if(kind==2){uint32_t offset=[r word];NSData *positions=[r block];INPUT(positions.length>0&&positions.length%16==0&&positions.length/16<=65536,@"Iterated seed chunk exceeds range");for(NSUInteger i=0;i<positions.length/4;i++){uint32_t bits=indexAt(positions,i,4);float f;memcpy(&f,&bits,4);INPUT(isfinite(f),@"Nonfinite initial particle");}op[@"offset"]=@(offset);op[@"positions"]=positions;}
  if(kind==3){uint32_t reset=[r word],resetCounter=version==7?[r word]:reset,dimension=[r word],steps=[r word];INPUT(reset<=1&&resetCounter<=1&&reset<=resetCounter&&(dimension==2||dimension==3)&&steps<=256,@"Invalid iterated advance parameters");op[@"reset"]=@(reset);if(version==7)op[@"resetCounter"]=@(resetCounter);op[@"dimension"]=@(dimension);op[@"steps"]=@(steps);NSUInteger n=count(r,9);INPUT(n<=65536,@"Iterated uniform capacity");NSMutableDictionary *uniforms=[NSMutableDictionary new];
   for(NSUInteger i=0;i<n;i++){NSString *name=[r text];INPUT((nameValid(name)&&!uniforms[name]&&![@[@"steps",@"dimension",@"resetCounter"]containsObject:name]),@"Invalid iterated uniform name");uniforms[name]=@([r number]);}op[@"uniforms"]=uniforms;
  }
  if(kind==8||kind==9){uint32_t reset=[r word],resetCounter=[r word],steps=[r word];INPUT(reset<=1&&resetCounter<=1&&reset<=resetCounter&&steps<=16,@"Invalid Symmetry advance controls");op[@"reset"]=@(reset);op[@"resetCounter"]=@(resetCounter);op[@"steps"]=@(steps);if(kind==8)op[@"bindings"]=parseSymmetryBindings(r,retainedBytes);else[op addEntriesFromDictionary:parseSymmetryProcessing(r,retainedBytes)];}
  if(kind==4){uint32_t offset=[r word],n=[r word];INPUT(n>=1&&n<=65536,@"Iterated read chunk exceeds range");op[@"offset"]=@(offset);op[@"count"]=@(n);ensure(retainedBytes+packet.length*6+(uint64_t)n*48<=Budget,@"capacity",@"Iterated bounded read exceeds shared budget");}
  INPUT(r.offset==packet.length,@"Trailing iterated frame bytes");return @{@"generation":@(generation),@"sequence":@(sequence),@"width":@1,@"height":@1,@"samples":@0,@"iterated":op,@"packetBytes":@(packet.length)};
 }
 if(version==5){
  INPUT(nt==0&&nd==0&&samples==0&&completion==0,@"Samila envelope cannot contain generic draws");for(NSNumber *v in clear)INPUT(v.floatValue==0,@"Samila envelope clear must be zero");
  INPUT([r word]==1,@"Unknown native resource family");uint32_t kind=[r word];NSData *resource=[r block];BOOL nonzero=NO;for(NSUInteger i=0;i<resource.length;i++)if(((const uint8_t*)resource.bytes)[i])nonzero=YES;
  INPUT(kind>=1&&kind<=5&&resource.length==16&&nonzero,@"Invalid Samila operation/resource");NSMutableDictionary *op=[@{@"kind":@(kind),@"resource":resource}mutableCopy];
  if(kind==1||kind==3)INPUT(width==1&&height==1,@"Invalid Samila control dimensions");
  if(kind==1){uint64_t programBytes=0;for(NSString *key in @[@"historyVertex",@"historyFragment",@"sampleVertex",@"sampleFragment",@"presentVertex",@"presentFragment"]){NSString *source=[r text];INPUT([source rangeOfString:@"#version"].location==NSNotFound,@"Samila shaders must omit version directives");op[key]=source;programBytes+=[source lengthOfBytesUsingEncoding:NSUTF8StringEncoding]*3;}op[@"programBytes"]=@(programBytes);op[@"noise"]=[r block];op[@"palette"]=[r block];samilaFloatBlock(op[@"noise"],256*256*4);samilaFloatBlock(op[@"palette"],1024*3*4);ensure(retainedBytes+programBytes+256*256*4+1024*3*4+SamilaStatsStorageBytes+samilaStatsProgramBytes()+packet.length*6<=Budget,@"capacity",@"Samila creation exceeds shared budget");}
  if(kind==2||kind==5){uint32_t index=[r word],clearInk=[r word],base=[r word],passes=[r word],seed=[r word];INPUT(index<UINT32_MAX&&clearInk<=1&&base>=1&&base<=8000000&&(passes==1||passes==6),@"Invalid Samila display checkpoint/batch");op[@"index"]=@(index);op[@"clear"]=@(clearInk);op[@"count"]=@(base*passes);op[@"seed"]=@(seed);NSData *palette=[r block];if(palette.length)samilaFloatBlock(palette,1024*3*4);op[@"palette"]=palette;op[@"history"]=samilaUniforms(r);op[@"sample"]=samilaUniforms(r);op[@"present"]=samilaUniforms(r);}
  if(kind==4){op[@"index"]=@([r word]);op[@"present"]=samilaUniforms(r);}
  INPUT(r.offset==packet.length,@"Trailing Samila frame bytes");return @{@"generation":@(generation),@"sequence":@(sequence),@"width":@(width),@"height":@(height),@"samples":@0,@"samila":op,@"packetBytes":@(packet.length)};
 }
 NSMutableDictionary *operation=nil;
 if(version==4){
  uint32_t kind=[r word];NSData *resource=[r block];BOOL nonzero=NO;for(NSUInteger i=0;i<resource.length;i++)if(((const uint8_t*)resource.bytes)[i])nonzero=YES;
  INPUT(kind>=1&&kind<=4&&resource.length==16&&nonzero,@"Invalid Bouncing operation/resource");operation=[@{@"kind":@(kind),@"resource":resource}mutableCopy];
  uint32_t particles=kind==4?0:[r word];if(kind!=4)INPUT(particles>0&&particles<=INT_MAX,@"Invalid Bouncing particle count");operation[@"count"]=@(particles);uint32_t programBytes=kind==4?0:[r word];operation[@"programBytes"]=@(programBytes);
  if(kind==1){for(NSString *key in @[@"quad",@"updateShader",@"vertex",@"fragment"])operation[key]=[r text];INPUT(programBytes==([operation[@"vertex"]length]+[operation[@"fragment"]length])*3,@"Bouncing program storage mismatch");uint64_t size=(uint64_t)ceil(sqrt((double)particles));ensure(retainedBytes+size*size*32+32+programBytes+packet.length*6+12<=Budget,@"capacity",@"Bouncing creation exceeds budget");}
  if(kind==2){uint32_t offset=[r word];NSData *data=[r block];INPUT(data.length>0&&data.length%16==0&&offset<=particles&&data.length/16<=particles-offset,@"Invalid Bouncing upload range");operation[@"offset"]=@(offset);operation[@"data"]=data;}
  if(kind==3){
   uint32_t from=[r word],to=[r word];INPUT(to>=from&&to<=10000,@"Invalid Bouncing update indices");operation[@"from"]=@(from);operation[@"to"]=@(to);
   SourceBouncingUpdate u={0};u.subSteps=(int32_t)[r word];u.timeStep=[r number];u.particleRadius=[r number];u.shape=(int32_t)[r word];INPUT(u.shape>=0&&u.shape<=2,@"Invalid Bouncing boundary kind");
   if(u.shape==0){u.polygonCount=[r word];INPUT(u.polygonCount<=64,@"Bouncing polygon exceeds shader capacity");for(uint32_t i=0;i<u.polygonCount*2;i++)u.polygon[i]=[r number];}
   else{u.center[0]=[r number];u.center[1]=[r number];if(u.shape==1)u.radius=[r number];else{u.a=[r number];u.b=[r number];}}
   operation[@"update"]=[NSData dataWithBytes:&u length:sizeof(u)];
  }else{INPUT(width==1&&height==1&&samples==0&&completion==0&&nt==0&&nd==0,@"Bouncing control request cannot draw");for(NSNumber *component in clear)INPUT(component.floatValue==0,@"Invalid Bouncing control clear");}
 }
 NSMutableArray *textures=[NSMutableArray new],*draws=[NSMutableArray new];
 for(NSUInteger i=0;i<nt;i++){
  uint32_t w=[r word],h=[r word];float anisotropy=[r number];NSData *pixels=[r block];
  INPUT(w>0&&w<=16384&&h>0&&h<=16384&&(uint64_t)w*h*4==pixels.length&&anisotropy>=1,@"Invalid RGBA8 texture");
  [textures addObject:@{@"width":@(w),@"height":@(h),@"anisotropy":@(anisotropy),@"pixels":pixels}];
 }
 for(NSUInteger i=0;i<nd;i++){
  NSString *vertex=[r text],*fragment=[r text];uint32_t first=[r word],n=[r word],instances=[r word],flags=[r word];
  INPUT(first<=INT_MAX&&n<=INT_MAX&&instances<=INT_MAX&&((version>=3&&(flags&8))||n%3==0)&&flags<=(version==4?63:version==3?31:7),@"Invalid draw range or raster flags");
  NSUInteger np=count(r,4);INPUT(np>0&&np<=2,@"Invalid face passes");NSMutableArray *passes=[NSMutableArray new];for(NSUInteger j=0;j<np;j++){uint32_t p=[r word];INPUT(p<=2,@"Invalid face selection");[passes addObject:@(p)];}
  BOOL retained=version==4&&(flags&32);if(retained)INPUT([operation[@"kind"]intValue]==3&&i==0&&first==0&&n==[operation[@"count"]unsignedIntValue]&&instances==1&&flags==56&&np==1&&[passes[0]intValue]==0,@"Invalid retained point draw");
  NSUInteger na=count(r,20),vertices=NSUIntegerMax;INPUT(retained?na==0:na>0,@"Invalid retained/packed attributes");if(retained)vertices=n;NSMutableArray *attributes=[NSMutableArray new];NSMutableSet *names=[NSMutableSet new];
  for(NSUInteger j=0;j<na;j++){
   NSString *name=[r text];uint32_t size=[r word],divisor=[r word];NSData *bytes=[r block];
   INPUT(nameValid(name)&&![names containsObject:name],@"Invalid/duplicate attribute name");[names addObject:name];
   INPUT(size>=1&&size<=4&&divisor<=1&&bytes.length%(size*4)==0,@"Invalid packed float attribute");
   NSUInteger slots=bytes.length/(size*4);if(divisor)INPUT(slots>=instances,@"Insufficient instance attributes");else vertices=MIN(vertices,slots);
   [attributes addObject:@{@"name":name,@"size":@(size),@"divisor":@(divisor),@"bytes":bytes}];
  }
  INPUT(vertices!=NSUIntegerMax,@"No per-vertex attributes");uint32_t indexType=[r word];if(retained)INPUT(indexType==0,@"Retained Bouncing draw cannot use indices");INPUT(indexType==0||indexType==16||indexType==32,@"Invalid index width");
  NSData *indices=indexType?[r block]:[NSData data];NSUInteger indexWidth=indexType/8,available=indexType?indices.length/indexWidth:vertices;
  INPUT((!indexType||indices.length%indexWidth==0)&&first<=available&&n<=available-first,@"Draw exceeds available vertices/indices");
  if(indexType)for(NSUInteger j=first;j<(NSUInteger)first+n;j++)INPUT(indexAt(indices,j,indexWidth)<vertices,@"Index exceeds vertex buffer");
  NSUInteger nu=count(r,12);NSMutableArray *uniforms=[NSMutableArray new];[names removeAllObjects];
  for(NSUInteger j=0;j<nu;j++){
   NSString *name=[r text];uint32_t kind=[r word],number=[r word];INPUT(nameValid(name)&&![names containsObject:name]&&kind>=1&&kind<=(version>=3?10:9),@"Invalid/duplicate uniform declaration");[names addObject:name];
   if(kind==9){INPUT(number<nt,@"Sampler texture missing");[uniforms addObject:@{@"name":name,@"kind":@(kind),@"texture":@(number)}];continue;}
   NSData *values=[r block];NSUInteger components=kind==3||kind==4?2:kind==5||kind==10?3:kind==6?4:kind==7?16:1;
   INPUT(number>0&&number<=INT_MAX&&(kind==8||kind==10||number==1)&&(uint64_t)number*components*4==values.length,@"Uniform dimensions do not match declaration");
   if(kind!=2&&kind!=4)for(NSUInteger k=0;k<values.length/4;k++){uint32_t bits=indexAt(values,k,4);float value;memcpy(&value,&bits,4);INPUT(isfinite(value),@"Nonfinite numeric uniform");}
   [uniforms addObject:@{@"name":name,@"kind":@(kind),@"count":@(number),@"bytes":values}];
  }
  [draws addObject:@{@"vertex":vertex,@"fragment":fragment,@"first":@(first),@"count":@(n),@"instances":@(instances),@"flags":@(flags),@"passes":passes,@"attributes":attributes,@"indexType":@(indexType),@"indices":indices,@"uniforms":uniforms}];
 }
 if([operation[@"kind"]intValue]==3)INPUT(nd>0&&([draws[0][@"flags"]unsignedIntValue]&32),@"Bouncing frame lacks its leading state draw");
 INPUT(r.offset==packet.length,@"Trailing frame bytes");NSMutableDictionary *frame=[@{@"generation":@(generation),@"sequence":@(sequence),@"width":@(width),@"height":@(height),@"samples":@(samples),@"completion":@(completion),@"clear":clear,@"textures":textures,@"draws":draws}mutableCopy];if(operation)frame[@"bouncing"]=operation;return frame;
}
static __attribute__((unused)) NSDictionary *parse(NSData *packet,BOOL trace){return parseWithRetained(packet,trace,0);}
// EOF is valid only between frames. Partial headers/bodies terminate the
// session: no attempt to scan arbitrary bytes for another magic marker.
static NSData *readPacket(FILE *f,BOOL stream){
 uint32_t header[3];size_t got=fread(header,1,12,f);if(stream&&got==0&&feof(f))return nil;
 INPUT(got==12,@"Truncated packet header");uint32_t length=CFSwapInt32LittleToHost(header[2]);INPUT(length>=52,@"Invalid packet size");ensure(length<=Budget/4,@"capacity",@"Packet exceeds capacity");
 NSMutableData *data=[NSMutableData dataWithLength:length];memcpy(data.mutableBytes,header,12);INPUT(fread((uint8_t*)data.mutableBytes+12,1,length-12,f)==length-12&&!ferror(f),@"Packet body size mismatch");
 if(!stream)INPUT(fgetc(f)==EOF&&!ferror(f),@"Trailing packet file bytes");return data;
}
static void writeFile(NSString *root,NSString *name,NSData *data){NSError *e=nil;RUNTIME([data writeToFile:[root stringByAppendingPathComponent:name] options:NSDataWritingAtomic error:&e],e.description?:@"Output write failed");}
static GLuint compile(GLenum kind,NSString *source){GLuint shader=glCreateShader(kind);NSString *text=[@"#version 410\n" stringByAppendingString:source];const char *p=text.UTF8String;glShaderSource(shader,1,&p,NULL);glCompileShader(shader);GLint ok=0;glGetShaderiv(shader,GL_COMPILE_STATUS,&ok);if(!ok){char log[8192]={0};glGetShaderInfoLog(shader,sizeof(log),NULL,log);glDeleteShader(shader);RUNTIME(NO,[NSString stringWithUTF8String:log]?:@"Shader compile failed");}return shader;}
static GLenum uniformType(uint32_t kind){switch(kind){case 1:case 8:return GL_FLOAT;case 2:return GL_INT;case 3:return GL_FLOAT_VEC2;case 4:return GL_INT_VEC2;case 5:case 10:return GL_FLOAT_VEC3;case 6:return GL_FLOAT_VEC4;case 7:return GL_FLOAT_MAT4;case 9:return GL_SAMPLER_2D;case 11:return GL_BOOL;}return 0;}
static void applyUniforms(GLuint program,NSArray *uniforms){
  for(NSDictionary *u in uniforms){GLint loc=glGetUniformLocation(program,[u[@"name"]UTF8String]);if(loc<0)continue;int kind=[u[@"kind"]intValue];NSData *values=u[@"bytes"];const GLfloat *v=values.bytes;const GLint *iv=values.bytes;switch(kind){case 1:case 8:glUniform1fv(loc,[u[@"count"]intValue],v);break;case 2:case 11:glUniform1iv(loc,1,iv);break;case 3:glUniform2fv(loc,1,v);break;case 4:glUniform2iv(loc,1,iv);break;case 5:case 10:glUniform3fv(loc,[u[@"count"]intValue],v);break;case 6:glUniform4fv(loc,1,v);break;case 7:glUniformMatrix4fv(loc,1,GL_FALSE,v);break;case 9:glUniform1i(loc,[u[@"texture"]intValue]);break;}}
  // Match linked native inputs against the owner's declarations, including
  // arrays. An optimized-away input is fine; a missing/wrong active one is not.
  GLint active=0;glGetProgramiv(program,GL_ACTIVE_UNIFORMS,&active);for(GLint i=0;i<active;i++){char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveUniform(program,i,sizeof(name),&length,&size,&type,name);RUNTIME(length>0&&length<1023,@"Active uniform name capacity");NSString *key=@(name);if([key hasSuffix:@"[0]"])key=[key substringToIndex:key.length-3];NSDictionary *found=nil;for(NSDictionary *u in uniforms)if([u[@"name"]isEqual:key])found=u;RUNTIME(found&&uniformType([found[@"kind"]intValue])==type&&(type==GL_SAMPLER_2D?size==1:[found[@"count"]intValue]>=size),@"Active uniform lacks matching typed data");}
}
static void draw(NSDictionary *d,NSArray *textures){
 NSArray *attributes=d[@"attributes"],*uniforms=d[@"uniforms"];GLint maxAttributes=0,maxTextures=0;glGetIntegerv(GL_MAX_VERTEX_ATTRIBS,&maxAttributes);glGetIntegerv(GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS,&maxTextures);
 ensure(attributes.count<=(NSUInteger)maxAttributes&&textures.count<=(NSUInteger)maxTextures,@"unsupported",@"Draw exceeds native attribute/texture limits");
 GLuint vao=0,vs=0,fs=0,program=0;NSMutableData *bufferIds=[NSMutableData dataWithLength:(attributes.count+1)*sizeof(GLuint)],*textureIds=[NSMutableData dataWithLength:textures.count*sizeof(GLuint)];GLuint *buffers=bufferIds.mutableBytes,*tex=textureIds.mutableBytes;
 @try{
  glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers((GLsizei)attributes.count+1,buffers);
  vs=compile(GL_VERTEX_SHADER,d[@"vertex"]);fs=compile(GL_FRAGMENT_SHADER,d[@"fragment"]);program=glCreateProgram();glAttachShader(program,vs);glAttachShader(program,fs);glLinkProgram(program);GLint ok=0;glGetProgramiv(program,GL_LINK_STATUS,&ok);RUNTIME(ok,@"Program link failed");glUseProgram(program);
  for(NSUInteger i=0;i<attributes.count;i++){NSDictionary *a=attributes[i];GLint loc=glGetAttribLocation(program,[a[@"name"]UTF8String]);if(loc<0)continue;NSData *bytes=a[@"bytes"];glBindBuffer(GL_ARRAY_BUFFER,buffers[i]);glBufferData(GL_ARRAY_BUFFER,bytes.length,bytes.bytes,GL_STATIC_DRAW);glEnableVertexAttribArray(loc);glVertexAttribPointer(loc,[a[@"size"]intValue],GL_FLOAT,GL_FALSE,0,NULL);glVertexAttribDivisor(loc,[a[@"divisor"]intValue]);}
  NSData *indices=d[@"indices"];GLenum indexType=[d[@"indexType"]intValue]==16?GL_UNSIGNED_SHORT:GL_UNSIGNED_INT;
  if([d[@"indexType"]intValue]){glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,buffers[attributes.count]);glBufferData(GL_ELEMENT_ARRAY_BUFFER,indices.length,indices.bytes,GL_STATIC_DRAW);}
  glGenTextures((GLsizei)textures.count,tex);GLfloat maximum=1;glGetFloatv(GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT,&maximum);GLint maxTextureSize=0;glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maxTextureSize);
  for(NSUInteger i=0;i<textures.count;i++){NSDictionary *t=textures[i];GLint w=[t[@"width"]intValue],h=[t[@"height"]intValue];GLfloat a=[t[@"anisotropy"]floatValue];ensure(a<=maximum&&w<=maxTextureSize&&h<=maxTextureSize,@"unsupported",@"Requested texture sampling/size unavailable");glActiveTexture(GL_TEXTURE0+(GLenum)i);glBindTexture(GL_TEXTURE_2D,tex[i]);NSData *pixels=t[@"pixels"];glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,w,h,0,GL_RGBA,GL_UNSIGNED_BYTE,pixels.bytes);glGenerateMipmap(GL_TEXTURE_2D);glTexParameterf(GL_TEXTURE_2D,GL_TEXTURE_MAX_ANISOTROPY_EXT,a);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR_MIPMAP_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);}
  applyUniforms(program,uniforms);
  GLint active=0;
  glGetProgramiv(program,GL_ACTIVE_ATTRIBUTES,&active);for(GLint i=0;i<active;i++){char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveAttrib(program,i,sizeof(name),&length,&size,&type,name);RUNTIME(length>0&&length<1023,@"Active attribute name capacity");// Apple GL exposes this fixed-function vertex input in active attributes.
  // Its value is generated by GL even when Apple reports a location.
  // Only this known built-in is exempt; packets cannot declare gl_ bindings.
  if(strcmp(name,"gl_VertexID")==0&&type==GL_INT&&size==1)continue;
  NSDictionary *found=nil;for(NSDictionary *a in attributes)if([a[@"name"]isEqual:@(name)])found=a;GLenum expected=[found[@"size"]intValue]==1?GL_FLOAT:[found[@"size"]intValue]==2?GL_FLOAT_VEC2:[found[@"size"]intValue]==3?GL_FLOAT_VEC3:GL_FLOAT_VEC4;RUNTIME(found&&size==1&&type==expected,([NSString stringWithFormat:@"Active attribute %@ (%u, size %d, location %d) lacks matching packed data",@(name),type,size,glGetAttribLocation(program,name)]));}
  uint32_t flags=[d[@"flags"]unsignedIntValue];if(flags&1)glEnable(GL_DEPTH_TEST);else glDisable(GL_DEPTH_TEST);glDepthMask((flags&2)?GL_TRUE:GL_FALSE);glDepthFunc(GL_LEQUAL);glFrontFace((flags&4)?GL_CW:GL_CCW);glEnable(GL_BLEND);glDisable(GL_DITHER);glBlendFuncSeparate(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA,(flags&16)?GL_SRC_ALPHA:GL_ONE,(flags&16)?GL_ONE_MINUS_SRC_ALPHA:GL_ONE);glBlendEquationSeparate(GL_FUNC_ADD,GL_FUNC_ADD);
  GLenum primitive=(flags&8)?GL_POINTS:GL_TRIANGLES;if(flags&8)glEnable(GL_PROGRAM_POINT_SIZE);else glDisable(GL_PROGRAM_POINT_SIZE);
  for(NSNumber *pass in d[@"passes"]){int p=pass.intValue;if(p==0)glDisable(GL_CULL_FACE);else{glEnable(GL_CULL_FACE);glCullFace(p==1?GL_BACK:GL_FRONT);}GLsizei n=[d[@"count"]intValue],instances=[d[@"instances"]intValue];GLint first=[d[@"first"]intValue];if([d[@"indexType"]intValue])glDrawElementsInstanced(primitive,n,indexType,(void*)(uintptr_t)((NSUInteger)first*([d[@"indexType"]intValue]/8)),instances);else glDrawArraysInstanced(primitive,first,n,instances);}
  RUNTIME(glGetError()==GL_NO_ERROR,@"OpenGL draw failed");
 }@finally{glUseProgram(0);glBindVertexArray(0);glDeleteBuffers((GLsizei)attributes.count+1,buffers);glDeleteTextures((GLsizei)textures.count,tex);if(vao)glDeleteVertexArrays(1,&vao);if(program)glDeleteProgram(program);if(vs)glDeleteShader(vs);if(fs)glDeleteShader(fs);}
}
static void createContext(CGLContextObj *context){
 CGLPixelFormatObj format=NULL;
 @try{CGLPixelFormatAttribute attrs[]={kCGLPFAOpenGLProfile,(CGLPixelFormatAttribute)kCGLOGLPVersion_GL4_Core,kCGLPFAAccelerated,(CGLPixelFormatAttribute)0};GLint n=0;
  RUNTIME(CGLChoosePixelFormat(attrs,&format,&n)==kCGLNoError&&format&&n>0,@"No accelerated CGL format");RUNTIME(CGLCreateContext(format,NULL,context)==kCGLNoError,@"CGL context creation failed");RUNTIME(CGLSetCurrentContext(*context)==kCGLNoError,@"CGL make-current failed");
 }@finally{if(format)CGLDestroyPixelFormat(format);}
}
static void destroyContext(CGLContextObj *context){if(*context){RUNTIME(CGLSetCurrentContext(NULL)==kCGLNoError,@"Cannot unset CGL context");RUNTIME(CGLDestroyContext(*context)==kCGLNoError,@"Cannot destroy CGL context");*context=NULL;}}
// Readbacks belong to the frame target, not individual draws. MSAA color is
// resolved into an owned single-sample attachment before every requested read.
static NSData *readFrame(GLuint fb,GLuint resolved,GLsizei w,GLsizei h){
 if(resolved){glBindFramebuffer(GL_READ_FRAMEBUFFER,fb);glBindFramebuffer(GL_DRAW_FRAMEBUFFER,resolved);glBlitFramebuffer(0,0,w,h,0,0,w,h,GL_COLOR_BUFFER_BIT,GL_NEAREST);glBindFramebuffer(GL_READ_FRAMEBUFFER,resolved);}
 NSMutableData *rgba=[NSMutableData dataWithLength:(NSUInteger)w*h*4];glReadPixels(0,0,w,h,GL_RGBA,GL_UNSIGNED_BYTE,rgba.mutableBytes);
 RUNTIME(glGetError()==GL_NO_ERROR,@"Frame resolve/readback failed");glBindFramebuffer(GL_FRAMEBUFFER,fb);return rgba;
}
static NSData *renderFrameWithDraw(NSDictionary *frame,NSString *out,uint64_t retainedBytes,void (^render)(NSDictionary*,NSArray*)){
 GLuint fb=0,resolved=0,color=0,multiColor=0,depth=0;
 @try{
  GLsizei w=[frame[@"width"]intValue],h=[frame[@"height"]intValue],samples=[frame[@"samples"]intValue];GLint maxTexture=0,maxRender=0,maxViewport[2]={0},maxSamples=0;
  glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maxTexture);glGetIntegerv(GL_MAX_RENDERBUFFER_SIZE,&maxRender);glGetIntegerv(GL_MAX_VIEWPORT_DIMS,maxViewport);glGetIntegerv(GL_MAX_SAMPLES,&maxSamples);
  ensure(w<=MIN(maxTexture,maxRender)&&h<=MIN(maxTexture,maxRender)&&w<=maxViewport[0]&&h<=maxViewport[1],@"unsupported",@"Frame exceeds native dimensions");ensure(samples<=maxSamples,@"unsupported",@"Requested sample count exceeds native limit");
  ensure(retainedBytes+(uint64_t)w*h*(12+(uint64_t)8*samples)<=Budget,@"capacity",@"Retained state and frame targets exceed budget");
  // This texture is the draw target for samples=0 and the resolve target otherwise.
  glGenFramebuffers(1,&fb);glBindFramebuffer(GL_FRAMEBUFFER,fb);glGenTextures(1,&color);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,color);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,w,h,0,GL_RGBA,GL_UNSIGNED_BYTE,NULL);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,color,0);
  if(samples){
   resolved=fb;glGenFramebuffers(1,&fb);glBindFramebuffer(GL_FRAMEBUFFER,fb);glGenRenderbuffers(1,&multiColor);glBindRenderbuffer(GL_RENDERBUFFER,multiColor);glRenderbufferStorageMultisample(GL_RENDERBUFFER,samples,GL_RGBA8,w,h);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_RENDERBUFFER,multiColor);
   GLint actual=0;glGetRenderbufferParameteriv(GL_RENDERBUFFER,GL_RENDERBUFFER_SAMPLES,&actual);RUNTIME(glGetError()==GL_NO_ERROR,@"Multisample color allocation failed");ensure(actual==samples,@"unsupported",@"Driver rounded the requested color sample count");
  }
  glGenRenderbuffers(1,&depth);glBindRenderbuffer(GL_RENDERBUFFER,depth);
  if(samples)glRenderbufferStorageMultisample(GL_RENDERBUFFER,samples,GL_DEPTH_COMPONENT24,w,h);else glRenderbufferStorage(GL_RENDERBUFFER,GL_DEPTH_COMPONENT24,w,h);
  GLint actualDepth=0;glGetRenderbufferParameteriv(GL_RENDERBUFFER,GL_RENDERBUFFER_SAMPLES,&actualDepth);RUNTIME(glGetError()==GL_NO_ERROR,@"Depth allocation failed");ensure(actualDepth==samples,@"unsupported",@"Driver rounded the requested depth sample count");
  glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_DEPTH_ATTACHMENT,GL_RENDERBUFFER,depth);RUNTIME(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"Incomplete framebuffer");glDrawBuffer(GL_COLOR_ATTACHMENT0);glReadBuffer(GL_COLOR_ATTACHMENT0);glViewport(0,0,w,h);
  if(samples)glEnable(GL_MULTISAMPLE);else glDisable(GL_MULTISAMPLE);
  glDisable(GL_SAMPLE_ALPHA_TO_COVERAGE);glDisable(GL_SAMPLE_ALPHA_TO_ONE);glDisable(GL_SAMPLE_COVERAGE);glDisable(GL_SAMPLE_MASK);
  glDisable(GL_SCISSOR_TEST);glDisable(GL_DITHER);glDisable(GL_FRAMEBUFFER_SRGB);glColorMask(GL_TRUE,GL_TRUE,GL_TRUE,GL_TRUE);glDepthMask(GL_TRUE);
  NSArray *clear=frame[@"clear"];glClearColor([clear[0]floatValue],[clear[1]floatValue],[clear[2]floatValue],[clear[3]floatValue]);glClearDepth(1);glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
  NSArray *draws=frame[@"draws"];for(NSUInteger i=0;i<draws.count;i++)@autoreleasepool{
   render(draws[i],frame[@"textures"]);if(out)writeFile(out,[NSString stringWithFormat:@"draw-%lu-after.rgba",(unsigned long)i+1],readFrame(fb,resolved,w,h));
  }
  if([frame[@"completion"]boolValue]){glColorMask(GL_FALSE,GL_FALSE,GL_FALSE,GL_TRUE);glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);glColorMask(GL_TRUE,GL_TRUE,GL_TRUE,GL_TRUE);}
  return readFrame(fb,resolved,w,h);
 }@finally{glBindFramebuffer(GL_FRAMEBUFFER,0);glBindRenderbuffer(GL_RENDERBUFFER,0);if(fb)glDeleteFramebuffers(1,&fb);if(resolved)glDeleteFramebuffers(1,&resolved);if(color)glDeleteTextures(1,&color);if(multiColor)glDeleteRenderbuffers(1,&multiColor);if(depth)glDeleteRenderbuffers(1,&depth);}
}
static NSData *renderFrame(NSDictionary *frame,NSString *out){return renderFrameWithDraw(frame,out,0,^(NSDictionary *command,NSArray *textures){draw(command,textures);});}
#include "SourceCglBouncingState.h"
#include "SourceCglSamilaState.h"
#include "SourceCglIteratedState.h"
#include "SourceCglSymmetryState.h"
#include "SourceCglIteratedInk.h"
#include "SourceCglIteratedRenderRegistry.h"
static uint64_t iteratedRetained(NSDictionary<NSData*,id<SourceCglIteratedStateOwner>> *owners){uint64_t bytes=0;for(id<SourceCglIteratedStateOwner> owner in owners.allValues)bytes+=owner.retainedBytes;return bytes;}
static NSData *iteratedReply(NSDictionary *operation,id<SourceCglIteratedStateOwner> owner,uint32_t disposition,NSData *states){
 uint32_t unit=owner?([owner.diagnosticUnit isEqual:@"completed-pass"]?1:0):([operation[@"fragmentProfile"]boolValue]?1:0);
 uint32_t kind=[operation[@"kind"]unsignedIntValue],words[16]={2,kind,0,0,0,0,owner?owner.index:0,disposition,owner?owner.uploaded:0,owner?owner.count:0,kind==4?[operation[@"offset"]unsignedIntValue]:0,kind==4?[operation[@"count"]unsignedIntValue]:0,(kind==3||kind==8||kind==9)?[operation[@"steps"]unsignedIntValue]:0,unit,[operation[@"fragmentProfile"]boolValue]?1:0,kind==9?1:0};
 for(int i=0;i<16;i++)words[i]=CFSwapInt32HostToLittle(words[i]);memcpy((uint8_t*)words+8,[operation[@"resource"]bytes],16);NSMutableData *result=[NSMutableData dataWithBytes:words length:64];if(states)[result appendData:states];return result;
}
// MLR1: 44-byte little-endian header followed by raw bottom-up RGBA8 or a
// bounded UTF-8 error. Only one in-flight request is admitted by the host.
static void reply(NSData *request,uint32_t status,uint32_t contextSerial,NSData *payload){
 uint32_t version=indexAt(request,1,4),format=status?0:version==10?5:version==7?(indexAt(request,15,4)==3?5:4):(version==6||version==8||version==9)?4:version==5?3:(version==4&&indexAt(request,15,4)!=3?2:1);
 uint32_t header[11]={0x31524c4d,1,(uint32_t)(44+payload.length),indexAt(request,3,4),indexAt(request,4,4),indexAt(request,5,4),indexAt(request,6,4),status,format,(uint32_t)payload.length,contextSerial};
 for(int i=0;i<11;i++)header[i]=CFSwapInt32HostToLittle(header[i]);
 RUNTIME(fwrite(header,1,sizeof(header),stdout)==sizeof(header)&&fwrite(payload.bytes,1,payload.length,stdout)==payload.length&&fflush(stdout)==0,@"Response pipe write failed");
}
static uint32_t errorCode(NSString *kind){return [kind isEqual:@"input"]?1:[kind isEqual:@"unsupported"]?2:[kind isEqual:@"capacity"]?3:[kind isEqual:@"state-lost"]?5:[kind isEqual:@"ownership"]?6:4;}
int main(int argc,const char **argv){@autoreleasepool{
 CGLContextObj ctx=NULL;SourceCglBouncingState *bouncing=nil;NSData *bouncingResource=nil;NSMutableDictionary<NSData*,SourceCglSamilaState*> *samila=[NSMutableDictionary new];NSMutableDictionary<NSData*,id<SourceCglIteratedStateOwner>> *iterated=[NSMutableDictionary new];NSMutableDictionary<NSData*,NSDictionary*> *inks=[NSMutableDictionary new];FILE *input=NULL;int result=1;uint32_t serial=0;BOOL stream=argc==2&&strcmp(argv[1],"--stdio")==0;
 @try{
  INPUT(stream||argc==3,@"Usage: renderer --stdio | frame.bin output-directory");input=stream?stdin:fopen(argv[1],"rb");INPUT(input!=NULL,@"Cannot open frame packet");
  NSString *out=stream?nil:@(argv[2]);if(out){BOOL isDir=NO;INPUT([[NSFileManager defaultManager]fileExistsAtPath:out isDirectory:&isDir]&&isDir,@"Output directory must exist");}
  while(YES){@autoreleasepool{
   NSData *packet=readPacket(input,stream);if(!packet)break;
   @try{
    uint64_t retained=(bouncing?bouncing.retainedBytes:0)+samilaRetained(samila)+iteratedRetained(iterated)+iteratedInkRetained(inks);NSDictionary *frame=parseWithRetained(packet,!stream,retained),*operation=frame[@"bouncing"],*samilaOperation=frame[@"samila"],*iteratedOperation=frame[@"iterated"],*renderOperation=frame[@"iteratedRender"];uint32_t kind=[operation[@"kind"]unsignedIntValue],renderKind=[renderOperation[@"kind"]unsignedIntValue];
    uint32_t samilaKind=[samilaOperation[@"kind"]unsignedIntValue];NSData *samilaResource=samilaOperation[@"resource"];SourceCglSamilaState *samilaOwner=samilaResource?samila[samilaResource]:nil;
    if(samilaKind==1)ensure(samila.count<2&&!samilaOwner,@"capacity",@"Two Samila resources are already owned or token is duplicate");else if(samilaKind==2||samilaKind==4||samilaKind==5)ensure(samilaOwner!=nil,@"state-lost",@"Samila resource is absent after release or context loss");
    uint32_t iteratedKind=[iteratedOperation[@"kind"]unsignedIntValue];NSData *iteratedResource=iteratedOperation[@"resource"];id<SourceCglIteratedStateOwner> iteratedOwner=iteratedResource?iterated[iteratedResource]:nil;
    if(iteratedKind==1||iteratedKind==6||iteratedKind==7)ensure(iterated.count<2&&!iteratedOwner,@"capacity",@"Two iterated resources are owned or token is duplicate");else if((iteratedKind>=2&&iteratedKind<=4)||iteratedKind==8||iteratedKind==9)ensure(iteratedOwner!=nil,@"state-lost",@"Iterated resource is absent after release or context loss");
    if(iteratedOwner)ensure([iteratedOperation[@"fragmentProfile"]boolValue]==[iteratedOwner.executionProfile isEqual:@"source-fragment"],@"ownership",@"Iterated operation belongs to another execution profile");
    if(iteratedKind==5)ensure(iteratedInkDependents(inks,iteratedResource)==0,@"ownership",@"Release dependent iterated ink owners before compute state");
    if(kind==1)ensure(bouncing==nil,@"capacity",@"A Bouncing resource is already owned");
    else if(kind){if(bouncing)ensure([bouncingResource isEqual:operation[@"resource"]],@"ownership",@"Bouncing resource belongs to another caller");else if(kind!=4)ensure(NO,@"state-lost",@"Bouncing resource is absent after release or context loss");if(bouncing&&kind!=4)INPUT(bouncing.particleCount==[operation[@"count"]unsignedIntValue]&&(bouncing.pointVertex.length+bouncing.pointFragment.length)*3==[operation[@"programBytes"]unsignedIntValue],@"Bouncing particle count differs from owned state");}
    if(!ctx){createContext(&ctx);serial++;}NSData *rgba;
    if(renderKind){rgba=renderIteratedOperation(frame,inks,iterated,retained);}
    else if(iteratedKind){
     NSData *states=nil;
     if(iteratedKind==1||iteratedKind==6||iteratedKind==7){iteratedOwner=iteratedKind==7?[[SourceCglSymmetryState alloc]initWithOperation:iteratedOperation]:[[SourceCglIteratedState alloc]initWithOperation:iteratedOperation];iterated[iteratedResource]=iteratedOwner;@try{[iteratedOwner prepare:iteratedOperation];}@catch(NSException *e){[iteratedOwner dispose];[iterated removeObjectForKey:iteratedResource];@throw;}}
     else if(iteratedKind==2)[iteratedOwner upload:iteratedOperation retained:retained packetBytes:packet.length];
     else if(iteratedKind==3||iteratedKind==8)[iteratedOwner advance:iteratedOperation retained:retained packetBytes:packet.length];
     else if(iteratedKind==9){ensure([iteratedOwner isKindOfClass:SourceCglSymmetryState.class],@"ownership",@"Processing advance requires a source-fragment owner");states=[(SourceCglSymmetryState*)iteratedOwner advanceProcessing:iteratedOperation retained:retained packetBytes:packet.length];}
     else if(iteratedKind==4)states=[iteratedOwner read:iteratedOperation retained:retained packetBytes:packet.length];
     uint32_t disposition=iteratedKind==5?(iteratedOwner?1:2):0;if(iteratedKind==5)[iteratedOwner dispose];rgba=iteratedReply(iteratedOperation,iteratedOwner,disposition,states);if(iteratedKind==5)[iterated removeObjectForKey:iteratedResource];
    }else if(samilaKind){
     if(samilaKind==1){samilaOwner=[[SourceCglSamilaState alloc]initWithOperation:samilaOperation];samila[samilaResource]=samilaOwner;@try{[samilaOwner prepare:samilaOperation];}@catch(NSException *e){[samilaOwner dispose];[samila removeObjectForKey:samilaResource];@throw;}rgba=samilaReply(samilaOperation,samilaOwner,0,nil);}
     else if(samilaKind==2||samilaKind==5){NSData *pixels=[samilaOwner display:samilaOperation width:[frame[@"width"]unsignedIntValue] height:[frame[@"height"]unsignedIntValue] retained:retained packetBytes:packet.length];rgba=samilaReply(samilaOperation,samilaOwner,0,pixels);}
     else if(samilaKind==4){NSData *pixels=[samilaOwner present:samilaOperation width:[frame[@"width"]unsignedIntValue] height:[frame[@"height"]unsignedIntValue] retained:retained packetBytes:packet.length];rgba=samilaReply(samilaOperation,samilaOwner,0,pixels);}
     else{uint32_t disposition=samilaOwner?1:2;[samilaOwner dispose];rgba=samilaReply(samilaOperation,samilaOwner,disposition,nil);[samila removeObjectForKey:samilaResource];}
    }else{
    if(kind==1){bouncing=[[SourceCglBouncingState alloc]initWithCount:[operation[@"count"]unsignedIntValue]];bouncingResource=operation[@"resource"];@try{[bouncing prepareQuad:operation[@"quad"] update:operation[@"updateShader"] vertex:operation[@"vertex"] fragment:operation[@"fragment"]];}@catch(NSException *e){[bouncing dispose];bouncing=nil;bouncingResource=nil;@throw;}}
    else if(kind==2)[bouncing upload:operation[@"data"] atParticle:[operation[@"offset"]unsignedIntValue]];
    else if(kind==4){[bouncing dispose];bouncing=nil;bouncingResource=nil;}
    if(kind==3){
     NSDictionary *point=frame[@"draws"][0];INPUT([point[@"vertex"]isEqual:bouncing.pointVertex]&&[point[@"fragment"]isEqual:bouncing.pointFragment],@"Bouncing draw shaders differ from the owned programs");[bouncing validateDrawUniforms:point[@"uniforms"]];
     SourceBouncingUpdate update;memcpy(&update,[operation[@"update"]bytes],sizeof(update));[bouncing advanceFrom:[operation[@"from"]unsignedIntValue] to:[operation[@"to"]unsignedIntValue] update:update];
     rgba=renderFrameWithDraw(frame,out,bouncing.retainedBytes+samilaRetained(samila)+iteratedRetained(iterated)+iteratedInkRetained(inks),^(NSDictionary *command,NSArray *textures){if([command[@"flags"]unsignedIntValue]&32)[bouncing drawUniforms:command[@"uniforms"]];else draw(command,textures);});
    }else if(kind){uint32_t uploaded=CFSwapInt32HostToLittle(bouncing?bouncing.uploaded:0);rgba=[NSData dataWithBytes:&uploaded length:4];}
    else rgba=retained?renderFrameWithDraw(frame,out,retained,^(NSDictionary *command,NSArray *textures){draw(command,textures);}):renderFrame(frame,out);
    }
    if(stream)reply(packet,0,serial,rgba);
    else{writeFile(out,renderKind?@"render.bin":iteratedKind?@"state.bin":@"frame.rgba",rgba);NSDictionary *meta=@{@"generation":frame[@"generation"],@"sequence":frame[@"sequence"],@"renderer":@((const char*)glGetString(GL_RENDERER)),@"version":@((const char*)glGetString(GL_VERSION)),@"vendor":@((const char*)glGetString(GL_VENDOR)),@"windowCreated":@NO,@"width":frame[@"width"],@"height":frame[@"height"],@"samples":frame[@"samples"],@"draws":@([(NSArray*)frame[@"draws"]count]),@"rowOrder":renderKind?(renderKind==3?@"bottom-up":@"none"):iteratedKind?@"none":@"bottom-up",@"format":renderKind?@"iterated-render-v1":iteratedKind?@"iterated-v1":@"rgba8"};writeFile(out,@"renderer.json",[NSJSONSerialization dataWithJSONObject:meta options:NSJSONWritingPrettyPrinted error:NULL]);}
   }@catch(NSException *e){
    if(!stream)@throw;
    // A failed GL operation can poison context state. Recreate it before the
    // next valid frame; invalid input never touches an existing good context.
    uint32_t status=errorCode(e.name);if(status==4){disposeIteratedInks(inks);[bouncing dispose];bouncing=nil;bouncingResource=nil;for(NSData *key in [samila.allKeys copy]){[samila[key]dispose];[samila removeObjectForKey:key];}for(NSData *key in [iterated.allKeys copy]){[iterated[key]dispose];[iterated removeObjectForKey:key];}destroyContext(&ctx);}
    NSData *message=[(e.reason?:@"Native frame failed") dataUsingEncoding:NSUTF8StringEncoding];if(!message||message.length>8192)message=[@"Native frame failed; diagnostic exceeded response budget" dataUsingEncoding:NSUTF8StringEncoding];
    reply(packet,status,serial,message);
   }
   if(!stream)break;
  }}result=0;
 }@catch(NSException *e){NSData *json=[NSJSONSerialization dataWithJSONObject:@{@"kind":e.name,@"reason":e.reason?:@"Native failure"} options:0 error:NULL];fwrite(json.bytes,1,json.length,stderr);fputc('\n',stderr);}
 @finally{BOOL clean=YES;for(NSData *key in [inks.allKeys copy])@try{[inks[key][@"owner"]dispose];[inks removeObjectForKey:key];}@catch(NSException *e){fprintf(stderr,"Iterated ink cleanup failed: %s\n",e.reason.UTF8String);clean=NO;result=1;}
  @try{[bouncing dispose];}@catch(NSException *e){fprintf(stderr,"Bouncing cleanup failed: %s\n",e.reason.UTF8String);clean=NO;result=1;}for(SourceCglSamilaState *owner in samila.allValues)@try{[owner dispose];}@catch(NSException *e){fprintf(stderr,"Samila cleanup failed: %s\n",e.reason.UTF8String);clean=NO;result=1;}
  for(NSData *key in iterated.allKeys)@try{ensure(iteratedInkDependents(inks,key)==0,@"ownership",@"Failed ink cleanup retains its compute dependency");[iterated[key]dispose];}@catch(NSException *e){fprintf(stderr,"Iterated cleanup failed: %s\n",e.reason.UTF8String);clean=NO;result=1;}
  if(clean)@try{destroyContext(&ctx);}@catch(NSException *e){fprintf(stderr,"Context cleanup failed: %s\n",e.reason.UTF8String);result=1;}if(input&&!stream)fclose(input);}
 return result;
}}
