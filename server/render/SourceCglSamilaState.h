// Dedicated Samila ink owner. Programs and LUTs survive displays/resizes; its
// current context and every provisional allocation remain owned until deletion.
static const uint32_t SamilaChunk=65532;
@interface SourceCglSamilaState:NSObject {
 CGLContextObj _context;
 GLuint _programs[3],_shaders[6],_lut[2],_textures[4],_frames[3],_pendingTextures[4],_pendingFrames[3],_vao,_feedback,_statsBuffer;
 uint32_t _width,_height,_current,_displays;
 uint64_t _programBytes,_pendingBytes;
 BOOL _prepared,_failed,_disposed;
 NSData *_lastStats;
}
@property(readonly) uint64_t retainedBytes;
@property(readonly) uint32_t displays;
@property(readonly) NSData *lastStats;
-(instancetype)initWithOperation:(NSDictionary*)operation;
-(void)prepare:(NSDictionary*)operation;
-(NSData*)display:(NSDictionary*)operation width:(uint32_t)width height:(uint32_t)height retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(NSData*)present:(NSDictionary*)operation width:(uint32_t)width height:(uint32_t)height retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(void)dispose;
@end
static void samilaCompile(GLuint *shader,GLenum kind,NSString *source){
 *shader=glCreateShader(kind);NSString *text=[@"#version 410\n" stringByAppendingString:source];const char *p=text.UTF8String;glShaderSource(*shader,1,&p,NULL);glCompileShader(*shader);GLint ok=0;glGetShaderiv(*shader,GL_COMPILE_STATUS,&ok);if(!ok){char log[8192]={0};glGetShaderInfoLog(*shader,sizeof(log),NULL,log);RUNTIME(NO,[NSString stringWithUTF8String:log]?:@"Samila shader compile failed");}
}
static void samilaProgram(GLuint *program,GLuint *shaders,NSString *vertex,NSString *fragment,BOOL feedback){
 samilaCompile(&shaders[0],GL_VERTEX_SHADER,vertex);samilaCompile(&shaders[1],GL_FRAGMENT_SHADER,fragment);*program=glCreateProgram();glAttachShader(*program,shaders[0]);glAttachShader(*program,shaders[1]);if(feedback){const char *names[]={"sourceStats"};glTransformFeedbackVaryings(*program,1,names,GL_INTERLEAVED_ATTRIBS);}glLinkProgram(*program);GLint linked=0;glGetProgramiv(*program,GL_LINK_STATUS,&linked);if(!linked){char log[8192]={0};glGetProgramInfoLog(*program,sizeof(log),NULL,log);RUNTIME(NO,[NSString stringWithUTF8String:log]?:@"Samila program link failed");}
 if(feedback){char name[128]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetTransformFeedbackVarying(*program,0,sizeof(name),&length,&size,&type,name);RUNTIME(strcmp(name,"sourceStats")==0&&size==1&&type==GL_UNSIGNED_INT_VEC4,@"Samila transform feedback statistics type mismatch");}
 GLint attributes=0;glGetProgramiv(*program,GL_ACTIVE_ATTRIBUTES,&attributes);for(GLint i=0;i<attributes;i++){char name[128]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveAttrib(*program,i,sizeof(name),&length,&size,&type,name);RUNTIME(strcmp(name,"gl_VertexID")==0&&type==GL_INT&&size==1,@"Samila shader requires an unowned vertex attribute");}
 for(int i=0;i<2;i++){glDetachShader(*program,shaders[i]);glDeleteShader(shaders[i]);RUNTIME(glGetError()==GL_NO_ERROR,@"Samila linked shader cleanup failed; owner retained");shaders[i]=0;}
}
static NSDictionary *samilaBinding(NSArray *bindings,NSString *name,uint32_t kind){for(NSDictionary *u in bindings)if([u[@"name"]isEqual:name]){INPUT([u[@"kind"]unsignedIntValue]==kind,@"Samila fixed uniform type mismatch");return u;}INPUT(NO,([@"Missing Samila fixed uniform: " stringByAppendingString:name]));return nil;}
static uint32_t samilaWord(NSArray *bindings,NSString *name,uint32_t kind){return indexAt(samilaBinding(bindings,name,kind)[@"bytes"],0,4);}
static float samilaFloat(NSArray *bindings,NSString *name){uint32_t bits=samilaWord(bindings,name,1);float value;memcpy(&value,&bits,4);return value;}
static void samilaSampler(NSArray *bindings,NSDictionary *expected){for(NSString *name in expected)INPUT([samilaBinding(bindings,name,9)[@"texture"]isEqual:expected[name]],@"Samila sampler binding differs from owned texture");for(NSDictionary *u in bindings)if([u[@"kind"]unsignedIntValue]==9)INPUT(expected[u[@"name"]]!=nil,@"Unexpected Samila sampler");}
static void samilaPresentBindings(NSArray *present,uint32_t width,uint32_t height){
 samilaSampler(present,@{@"ink":@0});NSData *origin=samilaBinding(present,@"origin",4)[@"bytes"];INPUT(indexAt(origin,0,4)==0&&indexAt(origin,1,4)==0&&samilaFloat(present,@"viewportAspect")==((float)width/(float)height),@"Samila presentation viewport identity mismatch");
}
static void samilaRaster(uint32_t width,uint32_t height){
 const GLenum disabled[]={GL_DEPTH_TEST,GL_STENCIL_TEST,GL_SCISSOR_TEST,GL_CULL_FACE,GL_DITHER,GL_MULTISAMPLE,GL_SAMPLE_ALPHA_TO_COVERAGE,GL_SAMPLE_ALPHA_TO_ONE,GL_SAMPLE_COVERAGE,GL_SAMPLE_MASK,GL_FRAMEBUFFER_SRGB,GL_RASTERIZER_DISCARD};for(NSUInteger i=0;i<sizeof(disabled)/sizeof(disabled[0]);i++)glDisable(disabled[i]);
 glColorMask(GL_TRUE,GL_TRUE,GL_TRUE,GL_TRUE);glDepthMask(GL_FALSE);glPolygonMode(GL_FRONT_AND_BACK,GL_FILL);glFrontFace(GL_CCW);glViewport(0,0,width,height);glPointParameteri(GL_POINT_SPRITE_COORD_ORIGIN,GL_UPPER_LEFT);
 glBindBuffer(GL_PIXEL_PACK_BUFFER,0);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);glPixelStorei(GL_PACK_ALIGNMENT,1);glPixelStorei(GL_UNPACK_ALIGNMENT,1);glPixelStorei(GL_PACK_ROW_LENGTH,0);glPixelStorei(GL_UNPACK_ROW_LENGTH,0);glPixelStorei(GL_PACK_SKIP_ROWS,0);glPixelStorei(GL_PACK_SKIP_PIXELS,0);glPixelStorei(GL_UNPACK_SKIP_ROWS,0);glPixelStorei(GL_UNPACK_SKIP_PIXELS,0);
}
@implementation SourceCglSamilaState
-(uint64_t)retainedBytes{return _disposed?0:_programBytes+256*256*4+1024*3*4+(uint64_t)SamilaChunk*16+(uint64_t)_width*_height*52+_pendingBytes;}
-(uint32_t)displays{return _displays;}-(NSData*)lastStats{return _lastStats;}
-(instancetype)initWithOperation:(NSDictionary*)operation{self=[super init];if(!self)return nil;_programBytes=[operation[@"programBytes"]unsignedLongLongValue];_context=CGLGetCurrentContext();RUNTIME(_context!=NULL,@"Samila requires an owned current context");_context=CGLRetainContext(_context);RUNTIME(_context!=NULL,@"Cannot retain Samila context");return self;}
-(void)checkGl{if(glGetError()!=GL_NO_ERROR){_failed=YES;RUNTIME(NO,@"Samila GL operation failed");}}
-(void)texture:(GLuint*)texture width:(uint32_t)width height:(uint32_t)height internal:(GLenum)internal format:(GLenum)format type:(GLenum)type bytes:(const void*)bytes linear:(BOOL)linear repeat:(BOOL)repeat{
 glGenTextures(1,texture);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,*texture);glTexImage2D(GL_TEXTURE_2D,0,internal,width,height,0,format,type,bytes);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,linear?GL_LINEAR:GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,linear?GL_LINEAR:GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,repeat?GL_REPEAT:GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_BASE_LEVEL,0);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAX_LEVEL,0);[self checkGl];
}
-(void)prepare:(NSDictionary*)op{
 INPUT(!_prepared&&!_failed&&!_disposed,@"Samila resource already prepared");RUNTIME(CGLGetCurrentContext()==_context,@"Samila preparation context mismatch");
 @try{GLint textures=0,buffers=0,feedback=0;glGetIntegerv(GL_MAX_TEXTURE_SIZE,&textures);glGetIntegerv(GL_MAX_DRAW_BUFFERS,&buffers);glGetIntegerv(GL_MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS,&feedback);ensure(textures>=1024&&buffers>=2&&feedback>=4,@"unsupported",@"Native Samila texture/statistics capability unavailable");
  samilaProgram(&_programs[0],&_shaders[0],op[@"historyVertex"],op[@"historyFragment"],NO);samilaProgram(&_programs[1],&_shaders[2],op[@"sampleVertex"],op[@"sampleFragment"],YES);samilaProgram(&_programs[2],&_shaders[4],op[@"presentVertex"],op[@"presentFragment"],NO);RUNTIME(glGetFragDataLocation(_programs[0],"result")==0&&glGetFragDataLocation(_programs[1],"result")==0&&glGetFragDataLocation(_programs[2],"pixel")==0&&glGetFragDataLocation(_programs[2],"facts")==1,@"Samila fragment outputs do not match owned targets");
  samilaRaster(1,1);[self texture:&_lut[0] width:256 height:256 internal:GL_R32F format:GL_RED type:GL_FLOAT bytes:[op[@"noise"]bytes] linear:YES repeat:NO];[self texture:&_lut[1] width:1024 height:1 internal:GL_RGB32F format:GL_RGB type:GL_FLOAT bytes:[op[@"palette"]bytes] linear:YES repeat:YES];
  glGenVertexArrays(1,&_vao);glGenTransformFeedbacks(1,&_feedback);glGenBuffers(1,&_statsBuffer);glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,_statsBuffer);glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER,(GLsizeiptr)SamilaChunk*16,NULL,GL_STREAM_READ);glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,0);[self checkGl];_prepared=YES;
 }@catch(NSException *e){_failed=YES;@throw;}
}
-(void)dropTextures:(GLuint*)textures frames:(GLuint*)frames{
 for(int i=0;i<3;i++)if(frames[i]){glDeleteFramebuffers(1,&frames[i]);RUNTIME(glGetError()==GL_NO_ERROR,@"Samila framebuffer cleanup failed; owner retained");frames[i]=0;}
 for(int i=0;i<4;i++)if(textures[i]){glDeleteTextures(1,&textures[i]);RUNTIME(glGetError()==GL_NO_ERROR,@"Samila texture cleanup failed; owner retained");textures[i]=0;}
}
-(void)resizeWidth:(uint32_t)width height:(uint32_t)height{
 _pendingBytes=(uint64_t)width*height*52;
 for(int i=0;i<4;i++)[self texture:&_pendingTextures[i] width:width height:height internal:i<2?GL_RGBA32F:i==2?GL_RGBA8:GL_RGBA32UI format:i==3?GL_RGBA_INTEGER:GL_RGBA type:i==2?GL_UNSIGNED_BYTE:i==3?GL_UNSIGNED_INT:GL_FLOAT bytes:NULL linear:NO repeat:NO];
 glGenFramebuffers(3,_pendingFrames);const GLfloat zero[4]={0,0,0,0};const GLuint zeros[4]={0,0,0,0};
 for(int i=0;i<3;i++){glBindFramebuffer(GL_FRAMEBUFFER,_pendingFrames[i]);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,_pendingTextures[i],0);if(i==2){glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT1,GL_TEXTURE_2D,_pendingTextures[3],0);const GLenum attachments[]={GL_COLOR_ATTACHMENT0,GL_COLOR_ATTACHMENT1};glDrawBuffers(2,attachments);}else glDrawBuffer(GL_COLOR_ATTACHMENT0);RUNTIME(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"Samila target framebuffer incomplete");glClearBufferfv(GL_COLOR,0,zero);if(i==2)glClearBufferuiv(GL_COLOR,1,zeros);}
 [self checkGl];glBindFramebuffer(GL_FRAMEBUFFER,0);[self dropTextures:_textures frames:_frames];memcpy(_textures,_pendingTextures,sizeof(_textures));memcpy(_frames,_pendingFrames,sizeof(_frames));memset(_pendingTextures,0,sizeof(_pendingTextures));memset(_pendingFrames,0,sizeof(_pendingFrames));_width=width;_height=height;_pendingBytes=0;_current=0;
}
-(NSData*)display:(NSDictionary*)op width:(uint32_t)width height:(uint32_t)height retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 INPUT(_prepared&&!_disposed,@"Samila resource not prepared");RUNTIME(!_failed&&CGLGetCurrentContext()==_context,@"Samila resource context is not usable");
 uint32_t index=[op[@"index"]unsignedIntValue],count=[op[@"count"]unsignedIntValue];BOOL resized=width!=_width||height!=_height,clear=[op[@"clear"]boolValue];INPUT(index==_displays&&index<UINT32_MAX,@"Samila display checkpoint mismatch");INPUT((!resized&&_displays>0)||clear,@"Initial/resized Samila display requires clear");
 NSArray *history=op[@"history"],*sample=op[@"sample"],*present=op[@"present"];samilaSampler(history,@{@"previousInk":@0});samilaSampler(sample,@{@"noiseLUT":@3,@"paletteLUT":@2});samilaPresentBindings(present,width,height);float decay=samilaFloat(history,@"decay");INPUT(decay>=0&&decay<=1&&samilaFloat(history,@"densityCeiling")==300,@"Invalid Samila history policy");
 INPUT(samilaWord(sample,@"u_frameSeed",2)==[op[@"seed"]unsignedIntValue]&&samilaWord(sample,@"u_particleCount",2)==count&&samilaWord(sample,@"u_quadSplat",11)==0,@"Samila sample identity mismatch");NSData *viewport=samilaBinding(sample,@"u_viewportSize",3)[@"bytes"];float size[2];memcpy(size,viewport.bytes,sizeof(size));INPUT(size[0]==(float)width&&size[1]==(float)height&&samilaFloat(sample,@"u_aspectRatio")==((float)width/(float)height),@"Samila viewport identity mismatch");
 float radius=samilaFloat(sample,@"radius");INPUT(radius>0,@"Invalid Samila radius");double work=(double)count*pow(ceil(fmax(radius,1))+2,2);ensure(isfinite(work)&&work<=2000000000.,@"capacity",@"Samila point work exceeds budget");
 uint64_t pixels=(uint64_t)width*height;ensure(retained+(resized?pixels*52:0)+packetBytes*6+([op[@"kind"]unsignedIntValue]==5?0:pixels*32)+(uint64_t)SamilaChunk*16+64<=Budget,@"capacity",@"Samila targets, readbacks and shared owners exceed budget");
 GLint maximum=0,viewportMaximum[2]={0};GLfloat pointRange[2]={0};glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maximum);glGetIntegerv(GL_MAX_VIEWPORT_DIMS,viewportMaximum);glGetFloatv(GL_POINT_SIZE_RANGE,pointRange);ensure(width<=(uint32_t)maximum&&height<=(uint32_t)maximum&&width<=(uint32_t)viewportMaximum[0]&&height<=(uint32_t)viewportMaximum[1]&&fmax(radius,1)<=pointRange[1],@"unsupported",@"Samila target/point dimensions unavailable");
 @try{
  // Validate all active bindings before touching either retained ink texture.
  for(int i=0;i<3;i++){glUseProgram(_programs[i]);applyUniforms(_programs[i],i==0?history:i==1?sample:present);}[self checkGl];
  samilaRaster(width,height);glDisable(GL_BLEND);if(resized)[self resizeWidth:width height:height];glBindVertexArray(_vao);
  NSData *palette=op[@"palette"];if(palette.length){glActiveTexture(GL_TEXTURE2);glBindTexture(GL_TEXTURE_2D,_lut[1]);glTexSubImage2D(GL_TEXTURE_2D,0,0,0,1024,1,GL_RGB,GL_FLOAT,palette.bytes);}
  const GLfloat zero[4]={0,0,0,0};if(clear){glBindFramebuffer(GL_FRAMEBUFFER,_frames[_current]);glClearBufferfv(GL_COLOR,0,zero);}
  glUseProgram(_programs[0]);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_textures[_current]);glBindFramebuffer(GL_FRAMEBUFFER,_frames[1-_current]);glDrawBuffer(GL_COLOR_ATTACHMENT0);glDrawArrays(GL_TRIANGLES,0,3);[self checkGl];_current=1-_current;
  glUseProgram(_programs[1]);glActiveTexture(GL_TEXTURE2);glBindTexture(GL_TEXTURE_2D,_lut[1]);glActiveTexture(GL_TEXTURE3);glBindTexture(GL_TEXTURE_2D,_lut[0]);glBindFramebuffer(GL_FRAMEBUFFER,_frames[_current]);glDrawBuffer(GL_COLOR_ATTACHMENT0);glEnable(GL_PROGRAM_POINT_SIZE);glEnable(GL_BLEND);glBlendEquationSeparate(GL_FUNC_ADD,GL_FUNC_ADD);glBlendFuncSeparate(GL_ONE,GL_ONE,GL_ONE,GL_ONE);glBindTransformFeedback(GL_TRANSFORM_FEEDBACK,_feedback);
  NSMutableData *scratch=[NSMutableData dataWithLength:(NSUInteger)SamilaChunk*16];uint64_t accepted=0,clipped=0,invalid=0;
  for(uint32_t first=0;first<count;first+=SamilaChunk){uint32_t n=MIN(SamilaChunk,count-first);glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,_statsBuffer,0,(GLsizeiptr)n*16);glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,(GLint)first,(GLsizei)n);glEndTransformFeedback();glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,_statsBuffer);glGetBufferSubData(GL_TRANSFORM_FEEDBACK_BUFFER,0,(GLsizeiptr)n*16,scratch.mutableBytes);[self checkGl];const uint32_t *v=scratch.bytes;for(uint32_t i=0;i<n;i++){RUNTIME(v[i*4]<=1&&v[i*4+1]==0&&v[i*4+2]<=1&&v[i*4+3]<=1&&v[i*4]+v[i*4+2]+v[i*4+3]==1,@"Invalid Samila per-sample statistics");invalid+=(uint64_t)v[i*4]+((uint64_t)v[i*4+1]<<32);accepted+=v[i*4+2];clipped+=v[i*4+3];}}
  RUNTIME(accepted+clipped+invalid==count&&invalid<=count&&accepted<=count&&clipped<=count,@"Samila sample statistics coverage mismatch");glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,0);glBindTransformFeedback(GL_TRANSFORM_FEEDBACK,0);glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,0);
  if([op[@"kind"]unsignedIntValue]==5){uint32_t stats[7]={count,(uint32_t)accepted,(uint32_t)clipped,(uint32_t)invalid,0,0,0};for(int i=0;i<7;i++)stats[i]=CFSwapInt32HostToLittle(stats[i]);_lastStats=[NSData dataWithBytes:stats length:sizeof(stats)];_displays++;return nil;}
  NSData *rgba=[self renderPresentCount:count accepted:(uint32_t)accepted clipped:(uint32_t)clipped invalid:(uint32_t)invalid];_displays++;return rgba;
 }@catch(NSException *e){_failed=YES;@throw;}@finally{[self unbind];}
}
-(void)unbind{glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,0);glBindTransformFeedback(GL_TRANSFORM_FEEDBACK,0);glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,0);glBindFramebuffer(GL_FRAMEBUFFER,0);glBindVertexArray(0);glUseProgram(0);glDisable(GL_BLEND);glDisable(GL_PROGRAM_POINT_SIZE);glActiveTexture(GL_TEXTURE0);[self checkGl];}
-(NSData*)renderPresentCount:(uint32_t)count accepted:(uint32_t)accepted clipped:(uint32_t)clipped invalid:(uint32_t)invalid{
 uint32_t width=_width,height=_height;uint64_t pixels=(uint64_t)width*height;const GLfloat zero[4]={0,0,0,0};
  glUseProgram(_programs[2]);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_textures[_current]);glBindFramebuffer(GL_FRAMEBUFFER,_frames[2]);const GLenum attachments[]={GL_COLOR_ATTACHMENT0,GL_COLOR_ATTACHMENT1};glDrawBuffers(2,attachments);const GLuint zeros[4]={0,0,0,0};glClearBufferfv(GL_COLOR,0,zero);glClearBufferuiv(GL_COLOR,1,zeros);glEnablei(GL_BLEND,0);glDisablei(GL_BLEND,1);glBlendEquationSeparate(GL_FUNC_ADD,GL_FUNC_ADD);glBlendFuncSeparate(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA,GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);glDisable(GL_PROGRAM_POINT_SIZE);glDrawArrays(GL_TRIANGLE_STRIP,0,4);[self checkGl];
  NSMutableData *facts=[NSMutableData dataWithLength:(NSUInteger)pixels*16];glReadBuffer(GL_COLOR_ATTACHMENT1);glReadPixels(0,0,width,height,GL_RGBA_INTEGER,GL_UNSIGNED_INT,facts.mutableBytes);[self checkGl];uint32_t occupied=0,maximumBits=0,invalidInk=0;const uint32_t *v=facts.bytes;for(uint64_t i=0;i<pixels;i++){RUNTIME(v[i*4]<=1&&v[i*4+2]<=1&&v[i*4+3]==0,@"Invalid Samila presentation facts");occupied+=v[i*4];maximumBits=MAX(maximumBits,v[i*4+1]);invalidInk+=v[i*4+2];}float maxCount;memcpy(&maxCount,&maximumBits,4);RUNTIME(invalidInk==0&&isfinite(maxCount)&&maxCount>=0,@"Samila produced nonfinite ink/presentation");
  NSMutableData *rgba=[NSMutableData dataWithLength:(NSUInteger)pixels*4];glReadBuffer(GL_COLOR_ATTACHMENT0);glReadPixels(0,0,width,height,GL_RGBA,GL_UNSIGNED_BYTE,rgba.mutableBytes);[self checkGl];uint32_t stats[7]={count,(uint32_t)accepted,(uint32_t)clipped,(uint32_t)invalid,occupied,maximumBits,invalidInk};for(int i=0;i<7;i++)stats[i]=CFSwapInt32HostToLittle(stats[i]);_lastStats=[NSData dataWithBytes:stats length:sizeof(stats)];return rgba;
}
-(NSData*)present:(NSDictionary*)op width:(uint32_t)width height:(uint32_t)height retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 INPUT(_prepared&&!_disposed,@"Samila resource not prepared");RUNTIME(!_failed&&CGLGetCurrentContext()==_context,@"Samila resource context is not usable");
 INPUT(_displays>0&&[op[@"index"]unsignedIntValue]==_displays&&width==_width&&height==_height,@"Samila presentation checkpoint/target mismatch");
 NSArray *present=op[@"present"];samilaPresentBindings(present,width,height);ensure(retained+packetBytes*6+(uint64_t)width*height*32+64<=Budget,@"capacity",@"Samila presentation exceeds shared budget");
 @try{glUseProgram(_programs[2]);applyUniforms(_programs[2],present);[self checkGl];samilaRaster(width,height);glBindVertexArray(_vao);return [self renderPresentCount:0 accepted:0 clipped:0 invalid:0];}
 @catch(NSException *e){_failed=YES;@throw;}@finally{[self unbind];}
}
-(void)dispose{
 if(_disposed)return;RUNTIME(CGLGetCurrentContext()==_context,@"Cannot dispose Samila in another context");for(int i=0;i<16;i++){GLenum error=glGetError();if(error==GL_NO_ERROR)break;RUNTIME(i<15,@"Cannot establish clean Samila disposal state");}
 glUseProgram(0);glBindVertexArray(0);glBindFramebuffer(GL_FRAMEBUFFER,0);glBindTransformFeedback(GL_TRANSFORM_FEEDBACK,0);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,0);[self checkGl];
 [self dropTextures:_pendingTextures frames:_pendingFrames];[self dropTextures:_textures frames:_frames];
 #define SAMILA_DROP(handle,operation) if(handle){operation;RUNTIME(glGetError()==GL_NO_ERROR,@"Samila cleanup failed; owner retained");handle=0;}
 for(int i=0;i<6;i++){SAMILA_DROP(_shaders[i],glDeleteShader(_shaders[i]));}for(int i=0;i<2;i++){SAMILA_DROP(_lut[i],glDeleteTextures(1,&_lut[i]));}for(int i=0;i<3;i++){SAMILA_DROP(_programs[i],glDeleteProgram(_programs[i]));}SAMILA_DROP(_statsBuffer,glDeleteBuffers(1,&_statsBuffer));SAMILA_DROP(_feedback,glDeleteTransformFeedbacks(1,&_feedback));SAMILA_DROP(_vao,glDeleteVertexArrays(1,&_vao));
 #undef SAMILA_DROP
 _lastStats=nil;_disposed=YES;CGLReleaseContext(_context);_context=NULL;
}
@end
static uint64_t samilaRetained(NSDictionary *owners){uint64_t bytes=0;for(SourceCglSamilaState *owner in owners.allValues)bytes+=owner.retainedBytes;return bytes;}
static NSData *samilaReply(NSDictionary *operation,SourceCglSamilaState *owner,uint32_t disposition,NSData *rgba){NSMutableData *data=[NSMutableData dataWithLength:64];uint32_t *p=data.mutableBytes;p[0]=CFSwapInt32HostToLittle(1);p[1]=CFSwapInt32HostToLittle([operation[@"kind"]unsignedIntValue]);memcpy((uint8_t*)p+8,[operation[@"resource"]bytes],16);p[6]=CFSwapInt32HostToLittle(owner?owner.displays:0);p[7]=CFSwapInt32HostToLittle(disposition);if([operation[@"kind"]unsignedIntValue]==2||[operation[@"kind"]unsignedIntValue]==4||[operation[@"kind"]unsignedIntValue]==5){memcpy((uint8_t*)p+32,owner.lastStats.bytes,28);}if(rgba)[data appendData:rgba];return data;}
