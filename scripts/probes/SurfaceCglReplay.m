// Windowless diagnostic consumer of sourceDrawingFrame.ts. No HTTP or product
// process lifecycle yet. Parse/admit the entire packet before creating CGL.
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
static BOOL nameValid(NSString *s){NSData *b=[s dataUsingEncoding:NSASCIIStringEncoding];if(!b||!b.length)return NO;const uint8_t *p=b.bytes;for(NSUInteger i=0;i<b.length;i++)if(!((p[i]>='a'&&p[i]<='z')||(p[i]>='A'&&p[i]<='Z')||p[i]=='_'||(i&&p[i]>='0'&&p[i]<='9')))return NO;return YES;}
static NSUInteger count(FrameReader *r,NSUInteger minimum){NSUInteger n=[r word];INPUT(n<=(r.data.length-r.offset)/minimum,@"Collection exceeds remaining packet");return n;}
static uint32_t indexAt(NSData *b,NSUInteger i,NSUInteger width){if(width==2){uint16_t n;memcpy(&n,(const uint8_t*)b.bytes+i*2,2);return CFSwapInt16LittleToHost(n);}uint32_t n;memcpy(&n,(const uint8_t*)b.bytes+i*4,4);return CFSwapInt32LittleToHost(n);}
static NSDictionary *parse(NSData *packet){
 FrameReader *r=[FrameReader new];r.data=packet;
 INPUT([r word]==0x31464c4d&&[r word]==1,@"Unknown frame magic/version");INPUT([r word]==packet.length,@"Packet length mismatch");
 uint32_t generation=[r word],sequence=[r word],width=[r word],height=[r word];INPUT(generation&&sequence,@"Missing frame identity");
 INPUT(width>0&&width<=16384&&height>0&&height<=16384&&(uint64_t)width*height<=16000000,@"Invalid physical frame dimensions");
 ensure(packet.length*4+(uint64_t)width*height*12<=Budget,@"capacity",@"Packet, copies, GPU and frame buffers exceed budget");
 NSMutableArray *clear=[NSMutableArray new];for(int i=0;i<4;i++){float v=[r number];INPUT(v>=0&&v<=1,@"Invalid clear color");[clear addObject:@(v)];}
 NSUInteger nt=count(r,16),nd=count(r,40);ensure(((uint64_t)nd+1)*width*height*4<=Budget,@"capacity",@"Diagnostic draw readbacks exceed budget");
 NSMutableArray *textures=[NSMutableArray new],*draws=[NSMutableArray new];
 for(NSUInteger i=0;i<nt;i++){
  uint32_t w=[r word],h=[r word];float anisotropy=[r number];NSData *pixels=[r block];
  INPUT(w>0&&w<=16384&&h>0&&h<=16384&&(uint64_t)w*h*4==pixels.length&&anisotropy>=1,@"Invalid RGBA8 texture");
  [textures addObject:@{@"width":@(w),@"height":@(h),@"anisotropy":@(anisotropy),@"pixels":pixels}];
 }
 for(NSUInteger i=0;i<nd;i++){
  NSString *vertex=[r text],*fragment=[r text];uint32_t first=[r word],n=[r word],instances=[r word],flags=[r word];
  INPUT(first<=INT_MAX&&n<=INT_MAX&&instances<=INT_MAX&&n%3==0&&flags<=7,@"Invalid draw range or raster flags");
  NSUInteger np=count(r,4);INPUT(np>0&&np<=2,@"Invalid face passes");NSMutableArray *passes=[NSMutableArray new];for(NSUInteger j=0;j<np;j++){uint32_t p=[r word];INPUT(p<=2,@"Invalid face selection");[passes addObject:@(p)];}
  NSUInteger na=count(r,20),vertices=NSUIntegerMax;INPUT(na>0,@"Missing attributes");NSMutableArray *attributes=[NSMutableArray new];NSMutableSet *names=[NSMutableSet new];
  for(NSUInteger j=0;j<na;j++){
   NSString *name=[r text];uint32_t size=[r word],divisor=[r word];NSData *bytes=[r block];
   INPUT(nameValid(name)&&![names containsObject:name],@"Invalid/duplicate attribute name");[names addObject:name];
   INPUT(size>=1&&size<=4&&divisor<=1&&bytes.length%(size*4)==0,@"Invalid packed float attribute");
   NSUInteger slots=bytes.length/(size*4);if(divisor)INPUT(slots>=instances,@"Insufficient instance attributes");else vertices=MIN(vertices,slots);
   [attributes addObject:@{@"name":name,@"size":@(size),@"divisor":@(divisor),@"bytes":bytes}];
  }
  INPUT(vertices!=NSUIntegerMax,@"No per-vertex attributes");uint32_t indexType=[r word];INPUT(indexType==0||indexType==16||indexType==32,@"Invalid index width");
  NSData *indices=indexType?[r block]:[NSData data];NSUInteger indexWidth=indexType/8,available=indexType?indices.length/indexWidth:vertices;
  INPUT((!indexType||indices.length%indexWidth==0)&&first<=available&&n<=available-first,@"Draw exceeds available vertices/indices");
  if(indexType)for(NSUInteger j=first;j<(NSUInteger)first+n;j++)INPUT(indexAt(indices,j,indexWidth)<vertices,@"Index exceeds vertex buffer");
  NSUInteger nu=count(r,12);NSMutableArray *uniforms=[NSMutableArray new];[names removeAllObjects];
  for(NSUInteger j=0;j<nu;j++){
   NSString *name=[r text];uint32_t kind=[r word],number=[r word];INPUT(nameValid(name)&&![names containsObject:name]&&kind>=1&&kind<=9,@"Invalid/duplicate uniform declaration");[names addObject:name];
   if(kind==9){INPUT(number<nt,@"Sampler texture missing");[uniforms addObject:@{@"name":name,@"kind":@(kind),@"texture":@(number)}];continue;}
   NSData *values=[r block];NSUInteger components=kind==3||kind==4?2:kind==5?3:kind==6?4:kind==7?16:1;
   INPUT(number>0&&number<=INT_MAX&&(kind==8||number==1)&&(uint64_t)number*components*4==values.length,@"Uniform dimensions do not match declaration");
   if(kind!=2&&kind!=4)for(NSUInteger k=0;k<values.length/4;k++){uint32_t bits=indexAt(values,k,4);float value;memcpy(&value,&bits,4);INPUT(isfinite(value),@"Nonfinite numeric uniform");}
   [uniforms addObject:@{@"name":name,@"kind":@(kind),@"count":@(number),@"bytes":values}];
  }
  [draws addObject:@{@"vertex":vertex,@"fragment":fragment,@"first":@(first),@"count":@(n),@"instances":@(instances),@"flags":@(flags),@"passes":passes,@"attributes":attributes,@"indexType":@(indexType),@"indices":indices,@"uniforms":uniforms}];
 }
 INPUT(r.offset==packet.length,@"Trailing frame bytes");return @{@"generation":@(generation),@"sequence":@(sequence),@"width":@(width),@"height":@(height),@"clear":clear,@"textures":textures,@"draws":draws};
}
static NSData *readPacket(const char *path){
 FILE *f=fopen(path,"rb");INPUT(f!=NULL,@"Cannot open frame packet");
 @try{uint32_t header[3];INPUT(fread(header,1,12,f)==12,@"Truncated packet header");uint32_t length=CFSwapInt32LittleToHost(header[2]);INPUT(length>=52,@"Invalid packet size");ensure(length<=Budget/4,@"capacity",@"Packet exceeds capacity");NSMutableData *data=[NSMutableData dataWithLength:length];memcpy(data.mutableBytes,header,12);INPUT(fread((uint8_t*)data.mutableBytes+12,1,length-12,f)==length-12&&fgetc(f)==EOF&&!ferror(f),@"Packet file size mismatch");return data;}@finally{fclose(f);}
}
static void writeFile(NSString *root,NSString *name,NSData *data){NSError *e=nil;RUNTIME([data writeToFile:[root stringByAppendingPathComponent:name] options:NSDataWritingAtomic error:&e],e.description?:@"Output write failed");}
static GLuint compile(GLenum kind,NSString *source){GLuint shader=glCreateShader(kind);NSString *text=[@"#version 410\n" stringByAppendingString:source];const char *p=text.UTF8String;glShaderSource(shader,1,&p,NULL);glCompileShader(shader);GLint ok=0;glGetShaderiv(shader,GL_COMPILE_STATUS,&ok);if(!ok){char log[8192]={0};glGetShaderInfoLog(shader,sizeof(log),NULL,log);glDeleteShader(shader);RUNTIME(NO,[NSString stringWithUTF8String:log]?:@"Shader compile failed");}return shader;}
static GLenum uniformType(uint32_t kind){switch(kind){case 1:case 8:return GL_FLOAT;case 2:return GL_INT;case 3:return GL_FLOAT_VEC2;case 4:return GL_INT_VEC2;case 5:return GL_FLOAT_VEC3;case 6:return GL_FLOAT_VEC4;case 7:return GL_FLOAT_MAT4;case 9:return GL_SAMPLER_2D;}return 0;}
static void draw(NSDictionary *d,NSArray *textures,NSString *out,NSUInteger number,GLsizei width,GLsizei height){
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
  for(NSDictionary *u in uniforms){GLint loc=glGetUniformLocation(program,[u[@"name"]UTF8String]);if(loc<0)continue;int kind=[u[@"kind"]intValue];NSData *values=u[@"bytes"];const GLfloat *v=values.bytes;const GLint *iv=values.bytes;switch(kind){case 1:case 8:glUniform1fv(loc,[u[@"count"]intValue],v);break;case 2:glUniform1iv(loc,1,iv);break;case 3:glUniform2fv(loc,1,v);break;case 4:glUniform2iv(loc,1,iv);break;case 5:glUniform3fv(loc,1,v);break;case 6:glUniform4fv(loc,1,v);break;case 7:glUniformMatrix4fv(loc,1,GL_FALSE,v);break;case 9:glUniform1i(loc,[u[@"texture"]intValue]);break;}}
  // Match linked native inputs against the owner's declarations, including
  // arrays. An optimized-away input is fine; a missing/wrong active one is not.
  GLint active=0;glGetProgramiv(program,GL_ACTIVE_UNIFORMS,&active);for(GLint i=0;i<active;i++){char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveUniform(program,i,sizeof(name),&length,&size,&type,name);RUNTIME(length>0&&length<1023,@"Active uniform name capacity");NSString *key=@(name);if([key hasSuffix:@"[0]"])key=[key substringToIndex:key.length-3];NSDictionary *found=nil;for(NSDictionary *u in uniforms)if([u[@"name"]isEqual:key])found=u;RUNTIME(found&&uniformType([found[@"kind"]intValue])==type&&(type==GL_SAMPLER_2D?size==1:[found[@"count"]intValue]>=size),@"Active uniform lacks matching typed data");}
  glGetProgramiv(program,GL_ACTIVE_ATTRIBUTES,&active);for(GLint i=0;i<active;i++){char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveAttrib(program,i,sizeof(name),&length,&size,&type,name);RUNTIME(length>0&&length<1023,@"Active attribute name capacity");NSDictionary *found=nil;for(NSDictionary *a in attributes)if([a[@"name"]isEqual:@(name)])found=a;GLenum expected=[found[@"size"]intValue]==1?GL_FLOAT:[found[@"size"]intValue]==2?GL_FLOAT_VEC2:[found[@"size"]intValue]==3?GL_FLOAT_VEC3:GL_FLOAT_VEC4;RUNTIME(found&&size==1&&type==expected,@"Active attribute lacks matching packed data");}
  uint32_t flags=[d[@"flags"]unsignedIntValue];if(flags&1)glEnable(GL_DEPTH_TEST);else glDisable(GL_DEPTH_TEST);glDepthMask((flags&2)?GL_TRUE:GL_FALSE);glDepthFunc(GL_LEQUAL);glFrontFace((flags&4)?GL_CW:GL_CCW);glEnable(GL_BLEND);glDisable(GL_DITHER);glBlendFuncSeparate(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA,GL_ONE,GL_ONE);glBlendEquationSeparate(GL_FUNC_ADD,GL_FUNC_ADD);
  for(NSNumber *pass in d[@"passes"]){int p=pass.intValue;if(p==0)glDisable(GL_CULL_FACE);else{glEnable(GL_CULL_FACE);glCullFace(p==1?GL_BACK:GL_FRONT);}GLsizei n=[d[@"count"]intValue],instances=[d[@"instances"]intValue];GLint first=[d[@"first"]intValue];if([d[@"indexType"]intValue])glDrawElementsInstanced(GL_TRIANGLES,n,indexType,(void*)(uintptr_t)((NSUInteger)first*([d[@"indexType"]intValue]/8)),instances);else glDrawArraysInstanced(GL_TRIANGLES,first,n,instances);}
  NSMutableData *rgba=[NSMutableData dataWithLength:(NSUInteger)width*height*4];glReadPixels(0,0,width,height,GL_RGBA,GL_UNSIGNED_BYTE,rgba.mutableBytes);RUNTIME(glGetError()==GL_NO_ERROR,@"OpenGL draw/readback failed");writeFile(out,[NSString stringWithFormat:@"draw-%lu-after.rgba",(unsigned long)number],rgba);
 }@finally{glBindVertexArray(0);glDeleteBuffers((GLsizei)attributes.count+1,buffers);glDeleteTextures((GLsizei)textures.count,tex);if(vao)glDeleteVertexArrays(1,&vao);if(program)glDeleteProgram(program);if(vs)glDeleteShader(vs);if(fs)glDeleteShader(fs);}
}
int main(int argc,const char **argv){@autoreleasepool{
 CGLPixelFormatObj pf=NULL;CGLContextObj ctx=NULL;GLuint fb=0,color=0,depth=0;int result=1;
 @try{
  INPUT(argc==3,@"Usage: replay frame.bin output-directory");NSDictionary *frame=parse(readPacket(argv[1]));NSString *out=@(argv[2]);BOOL isDir=NO;INPUT([[NSFileManager defaultManager]fileExistsAtPath:out isDirectory:&isDir]&&isDir,@"Output directory must exist");
  CGLPixelFormatAttribute attrs[]={kCGLPFAOpenGLProfile,(CGLPixelFormatAttribute)kCGLOGLPVersion_GL4_Core,kCGLPFAAccelerated,(CGLPixelFormatAttribute)0};GLint n=0;RUNTIME(CGLChoosePixelFormat(attrs,&pf,&n)==kCGLNoError&&pf&&n>0,@"No accelerated CGL format");RUNTIME(CGLCreateContext(pf,NULL,&ctx)==kCGLNoError,@"CGL context creation failed");RUNTIME(CGLSetCurrentContext(ctx)==kCGLNoError,@"CGL make-current failed");
  GLsizei w=[frame[@"width"]intValue],h=[frame[@"height"]intValue];GLint maxTexture=0,maxRender=0,maxViewport[2]={0};glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maxTexture);glGetIntegerv(GL_MAX_RENDERBUFFER_SIZE,&maxRender);glGetIntegerv(GL_MAX_VIEWPORT_DIMS,maxViewport);ensure(w<=MIN(maxTexture,maxRender)&&h<=MIN(maxTexture,maxRender)&&w<=maxViewport[0]&&h<=maxViewport[1],@"unsupported",@"Frame exceeds native dimensions");
  glGenFramebuffers(1,&fb);glBindFramebuffer(GL_FRAMEBUFFER,fb);glGenTextures(1,&color);glBindTexture(GL_TEXTURE_2D,color);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,w,h,0,GL_RGBA,GL_UNSIGNED_BYTE,NULL);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,color,0);glGenRenderbuffers(1,&depth);glBindRenderbuffer(GL_RENDERBUFFER,depth);glRenderbufferStorage(GL_RENDERBUFFER,GL_DEPTH_COMPONENT24,w,h);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_DEPTH_ATTACHMENT,GL_RENDERBUFFER,depth);RUNTIME(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"Incomplete framebuffer");glDrawBuffer(GL_COLOR_ATTACHMENT0);glReadBuffer(GL_COLOR_ATTACHMENT0);glViewport(0,0,w,h);NSArray *clear=frame[@"clear"];glClearColor([clear[0]floatValue],[clear[1]floatValue],[clear[2]floatValue],[clear[3]floatValue]);glClearDepth(1);glDepthMask(GL_TRUE);glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
  NSArray *draws=frame[@"draws"];for(NSUInteger i=0;i<draws.count;i++)@autoreleasepool{draw(draws[i],frame[@"textures"],out,i+1,w,h);}
  // A clear-only frame is a valid image too.
  NSMutableData *rgba=[NSMutableData dataWithLength:(NSUInteger)w*h*4];glReadPixels(0,0,w,h,GL_RGBA,GL_UNSIGNED_BYTE,rgba.mutableBytes);RUNTIME(glGetError()==GL_NO_ERROR,@"Final readback failed");writeFile(out,@"frame.rgba",rgba);
  NSDictionary *meta=@{@"generation":frame[@"generation"],@"sequence":frame[@"sequence"],@"renderer":@((const char*)glGetString(GL_RENDERER)),@"version":@((const char*)glGetString(GL_VERSION)),@"vendor":@((const char*)glGetString(GL_VENDOR)),@"windowCreated":@NO,@"width":@(w),@"height":@(h),@"draws":@(draws.count),@"rowOrder":@"bottom-up",@"format":@"rgba8"};writeFile(out,@"renderer.json",[NSJSONSerialization dataWithJSONObject:meta options:NSJSONWritingPrettyPrinted error:NULL]);result=0;
 }@catch(NSException *e){NSData *json=[NSJSONSerialization dataWithJSONObject:@{@"kind":e.name,@"reason":e.reason?:@"Native failure"} options:0 error:NULL];fwrite(json.bytes,1,json.length,stderr);fputc('\n',stderr);}
 @finally{if(ctx){if(fb)glDeleteFramebuffers(1,&fb);if(color)glDeleteTextures(1,&color);if(depth)glDeleteRenderbuffers(1,&depth);CGLSetCurrentContext(NULL);CGLDestroyContext(ctx);}if(pf)CGLDestroyPixelFormat(pf);}
 return result;
}}
