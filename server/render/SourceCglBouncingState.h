// Internal CGL state owner. The stdio/HTTP protocol does not expose this owner
// until resource identity, cancellation and transport admission are integrated.
// Included after the renderer's compile/applyUniforms helpers.

@interface SourceCglBouncingState:NSObject {
 CGLContextObj _context;
 NSString *_pointVertex,*_pointFragment;
 GLuint _textures[2],_frames[2],_quadVao,_pointVao,_quadBuffer,_updateProgram,_pointProgram;
 uint32_t _count,_size,_uploaded,_updates,_current,_draws;
 BOOL _failed,_disposed,_prepared;
 uint64_t _readbackBytes;
}
@property(readonly) NSString *pointVertex,*pointFragment;
@property(readonly) uint32_t particleCount,size,updates,uploaded;
@property(readonly) uint64_t retainedBytes,readbackBytes;
-(instancetype)initWithCount:(uint32_t)count;
-(void)prepareQuad:(NSString*)quad update:(NSString*)update vertex:(NSString*)vertex fragment:(NSString*)fragment;
-(void)upload:(NSData*)data atParticle:(uint32_t)offset;
-(void)advanceFrom:(uint32_t)from to:(uint32_t)to update:(SourceBouncingUpdate)update;
-(NSData*)readState;
-(void)validateDrawUniforms:(NSArray*)uniforms;
-(void)drawUniforms:(NSArray*)uniforms;
-(void)dispose;
@end
static GLuint bouncingProgram(NSString *vertex,NSString *fragment){
 GLuint vs=0,fs=0,program=0;
 @try{vs=compile(GL_VERTEX_SHADER,vertex);fs=compile(GL_FRAGMENT_SHADER,fragment);program=glCreateProgram();glAttachShader(program,vs);glAttachShader(program,fs);glLinkProgram(program);GLint ok=0;glGetProgramiv(program,GL_LINK_STATUS,&ok);RUNTIME(ok,@"Bouncing program link failed");return program;}
 @catch(NSException *e){if(program)glDeleteProgram(program);@throw;}
 @finally{if(vs)glDeleteShader(vs);if(fs)glDeleteShader(fs);}
}
@implementation SourceCglBouncingState
-(NSString*)pointVertex{return _pointVertex;}-(NSString*)pointFragment{return _pointFragment;}
-(uint32_t)particleCount{return _count;}-(uint32_t)size{return _size;}-(uint32_t)updates{return _updates;}-(uint32_t)uploaded{return _uploaded;}
-(uint64_t)retainedBytes{return _disposed?0:(uint64_t)_size*_size*32+32+(_pointVertex.length+_pointFragment.length)*3;}
-(uint64_t)readbackBytes{return _readbackBytes;}
-(void)check{INPUT(_prepared,@"Bouncing state not prepared");INPUT(!_disposed,@"Bouncing state disposed");RUNTIME(!_failed,@"Bouncing state requires reset after GL failure");RUNTIME(CGLGetCurrentContext()==_context,@"Bouncing state belongs to another context");}
-(void)checkGl{if(glGetError()!=GL_NO_ERROR){_failed=YES;RUNTIME(NO,@"Bouncing state GL operation failed");}}
-(void)ready{[self check];INPUT(_uploaded==_count,@"Bouncing initial state upload incomplete");}
-(instancetype)initWithCount:(uint32_t)n{
 self=[super init];if(!self)return nil;
 INPUT(n>0&&n<=INT_MAX,@"Invalid Bouncing particle count");_count=n;_size=(uint32_t)ceil(sqrt((double)n));
 ensure(self.retainedBytes<=Budget,@"capacity",@"Bouncing state exceeds memory budget");_context=CGLGetCurrentContext();RUNTIME(_context!=NULL,@"Bouncing requires a current owned context");
 // Keep identity alive even if the host retires its own context reference.
 _context=CGLRetainContext(_context);RUNTIME(_context!=NULL,@"Cannot retain Bouncing context");
 return self;
}
-(void)prepareQuad:(NSString*)quad update:(NSString*)update vertex:(NSString*)vertex fragment:(NSString*)fragment{
 INPUT(!_prepared&&!_disposed&&!_failed,@"Bouncing state cannot be prepared twice");RUNTIME(CGLGetCurrentContext()==_context,@"Bouncing preparation context mismatch");
 @try{
  GLint maximum=0;glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maximum);ensure(_size<=(uint32_t)maximum,@"unsupported",@"Bouncing state texture too large");
  _updateProgram=bouncingProgram(quad,update);_pointProgram=bouncingProgram(vertex,fragment);_pointVertex=[vertex copy];_pointFragment=[fragment copy];
  glGenTextures(2,_textures);glGenFramebuffers(2,_frames);glActiveTexture(GL_TEXTURE0);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);
  glDisable(GL_SCISSOR_TEST);glColorMask(GL_TRUE,GL_TRUE,GL_TRUE,GL_TRUE);const GLfloat zero[4]={0,0,0,0};
  for(int i=0;i<2;i++){
   glBindTexture(GL_TEXTURE_2D,_textures[i]);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA32F,_size,_size,0,GL_RGBA,GL_FLOAT,NULL);
   glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
   glBindFramebuffer(GL_FRAMEBUFFER,_frames[i]);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,_textures[i],0);RUNTIME(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"Bouncing float framebuffer incomplete");
   glDrawBuffer(GL_COLOR_ATTACHMENT0);glClearBufferfv(GL_COLOR,0,zero);
  }
  glGenVertexArrays(1,&_quadVao);glBindVertexArray(_quadVao);glGenBuffers(1,&_quadBuffer);glBindBuffer(GL_ARRAY_BUFFER,_quadBuffer);
  const GLfloat positions[8]={-1,-1,1,-1,-1,1,1,1};glBufferData(GL_ARRAY_BUFFER,sizeof(positions),positions,GL_STATIC_DRAW);GLint location=glGetAttribLocation(_updateProgram,"quadPosition");RUNTIME(location>=0,@"Bouncing quad input missing");glEnableVertexAttribArray(location);glVertexAttribPointer(location,2,GL_FLOAT,GL_FALSE,0,NULL);
  glGenVertexArrays(1,&_pointVao);[self checkGl];_prepared=YES;
 }@catch(NSException *e){_failed=YES;@throw;}
}
-(void)upload:(NSData*)data atParticle:(uint32_t)offset{
 [self check];INPUT(offset==_uploaded&&_uploaded<_count&&data.length>0&&data.length%16==0&&data.length/16<=_count-_uploaded,@"Bouncing upload must cover the next contiguous particle range");
 // Reserve the incoming chunk plus transport, parser and upload representations.
 ensure(self.retainedBytes+(uint64_t)data.length*4<=Budget,@"capacity",@"Bouncing upload chunk exceeds remaining budget");
 glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_textures[0]);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);glPixelStorei(GL_UNPACK_ALIGNMENT,4);glPixelStorei(GL_UNPACK_ROW_LENGTH,0);glPixelStorei(GL_UNPACK_SKIP_PIXELS,0);glPixelStorei(GL_UNPACK_SKIP_ROWS,0);
 uint32_t left=(uint32_t)(data.length/16),at=offset;const uint8_t *bytes=data.bytes;
 while(left){uint32_t x=at%_size,y=at/_size,width=MIN(left,_size-x),rows=1;if(x==0&&left>=_size){width=_size;rows=left/_size;}glTexSubImage2D(GL_TEXTURE_2D,0,x,y,width,rows,GL_RGBA,GL_FLOAT,bytes);uint32_t used=width*rows;at+=used;left-=used;bytes+=(NSUInteger)used*16;}
 [self checkGl];_uploaded=at;
}
-(void)advanceFrom:(uint32_t)from to:(uint32_t)to update:(SourceBouncingUpdate)u{
 [self ready];INPUT(from==_updates&&to>=from,@"Bouncing update checkpoint mismatch");
 INPUT(u.shape>=0&&u.shape<=2&&u.polygonCount<=64&&isfinite(u.timeStep)&&isfinite(u.particleRadius),@"Invalid Bouncing update values");
 if(u.shape==1)INPUT(isfinite(u.center[0])&&isfinite(u.center[1])&&isfinite(u.radius),@"Invalid circle values");
 else if(u.shape==2)INPUT(isfinite(u.center[0])&&isfinite(u.center[1])&&isfinite(u.a)&&isfinite(u.b),@"Invalid ellipse values");
 else for(uint32_t i=0;i<u.polygonCount*2;i++)INPUT(isfinite(u.polygon[i]),@"Invalid polygon values");
 uint64_t units=(uint64_t)_size*_size*MAX(1,MIN(16,u.subSteps))*(u.shape==0?8*MAX(1,u.polygonCount):4);
 ensure(to<=10000&&(uint64_t)(to-from)*units<=1000000000,@"capacity",@"Bouncing replay exceeds update/work budget");
 // Paused redraws do not submit an update, regardless of scene seconds.
 if(to==from)return;
 glUseProgram(_updateProgram);glBindVertexArray(_quadVao);glDisable(GL_BLEND);glDisable(GL_DEPTH_TEST);glDisable(GL_SCISSOR_TEST);glDisable(GL_CULL_FACE);glDisable(GL_DITHER);glDisable(GL_FRAMEBUFFER_SRGB);glColorMask(GL_TRUE,GL_TRUE,GL_TRUE,GL_TRUE);glViewport(0,0,_size,_size);
 glUniform1i(glGetUniformLocation(_updateProgram,"stateTex"),0);glUniform1i(glGetUniformLocation(_updateProgram,"subSteps"),u.subSteps);glUniform1f(glGetUniformLocation(_updateProgram,"timeStep"),u.timeStep);glUniform1f(glGetUniformLocation(_updateProgram,"particleRadius"),u.particleRadius);glUniform1i(glGetUniformLocation(_updateProgram,"containerShape"),u.shape);
 if(u.shape==1){glUniform2fv(glGetUniformLocation(_updateProgram,"circleCenter"),1,u.center);glUniform1f(glGetUniformLocation(_updateProgram,"circleRadius"),u.radius);}
 else if(u.shape==2){glUniform2fv(glGetUniformLocation(_updateProgram,"ellipseCenter"),1,u.center);glUniform1f(glGetUniformLocation(_updateProgram,"ellipseA"),u.a);glUniform1f(glGetUniformLocation(_updateProgram,"ellipseB"),u.b);}
 else{glUniform1i(glGetUniformLocation(_updateProgram,"polygonVertexCount"),u.polygonCount);glUniform2fv(glGetUniformLocation(_updateProgram,"polygonVertices[0]"),64,u.polygon);}
 for(uint32_t i=from;i<to;i++){glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_textures[_current]);glBindFramebuffer(GL_FRAMEBUFFER,_frames[1-_current]);glDrawArrays(GL_TRIANGLE_STRIP,0,4);[self checkGl];_current=1-_current;_updates++;}
}
-(NSData*)readState{
 [self ready];NSUInteger length=(NSUInteger)_size*_size*16;ensure(self.retainedBytes+length<=Budget,@"capacity",@"Bouncing diagnostic readback exceeds budget");NSMutableData *bytes=[NSMutableData dataWithLength:length];glBindFramebuffer(GL_FRAMEBUFFER,_frames[_current]);glBindBuffer(GL_PIXEL_PACK_BUFFER,0);glPixelStorei(GL_PACK_ALIGNMENT,4);glPixelStorei(GL_PACK_ROW_LENGTH,0);glPixelStorei(GL_PACK_SKIP_PIXELS,0);glPixelStorei(GL_PACK_SKIP_ROWS,0);glReadPixels(0,0,_size,_size,GL_RGBA,GL_FLOAT,bytes.mutableBytes);[self checkGl];_readbackBytes+=length;return bytes;
}
-(void)validateDrawUniforms:(NSArray*)uniforms{
 [self ready];
 NSDictionary *particleCount=nil,*radius=nil;for(NSDictionary *u in uniforms){INPUT(![u[@"name"]isEqual:@"stateTex"]&&![u[@"name"]isEqual:@"texSize"],@"Bouncing state texture bindings belong to the state owner");if([u[@"name"]isEqual:@"particleCount"])particleCount=u;if([u[@"name"]isEqual:@"radius"])radius=u;}
 NSData *countBytes=particleCount[@"bytes"],*radiusBytes=radius[@"bytes"];int32_t n=0;float pointSize=0;
 INPUT([particleCount[@"kind"]intValue]==2&&countBytes.length==4&&[radius[@"kind"]intValue]==1&&radiusBytes.length==4,@"Bouncing draw missing count/radius");memcpy(&n,countBytes.bytes,4);memcpy(&pointSize,radiusBytes.bytes,4);
 INPUT(n==(int32_t)_count&&isfinite(pointSize),@"Bouncing drawing state identity mismatch");double fragments=(double)_count*pow(ceil(fmax(1,pointSize)),2);
 ensure(_draws<10000&&isfinite(fragments)&&fragments<=1000000000,@"capacity",@"Bouncing point fragments/draw count exceed budget");
}
-(void)drawUniforms:(NSArray*)uniforms{
 [self validateDrawUniforms:uniforms];
 glUseProgram(_pointProgram);glBindVertexArray(_pointVao);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_textures[_current]);
 int32_t size=(int32_t)_size;NSMutableArray *bindings=[uniforms mutableCopy];[bindings addObject:@{@"name":@"stateTex",@"kind":@9,@"texture":@0}];[bindings addObject:@{@"name":@"texSize",@"kind":@2,@"count":@1,@"bytes":[NSData dataWithBytes:&size length:4]}];applyUniforms(_pointProgram,bindings);
 glDisable(GL_DEPTH_TEST);glDepthMask(GL_FALSE);glDisable(GL_CULL_FACE);glDisable(GL_DITHER);glEnable(GL_BLEND);glBlendFuncSeparate(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA,GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);glBlendEquationSeparate(GL_FUNC_ADD,GL_FUNC_ADD);glEnable(GL_PROGRAM_POINT_SIZE);glDrawArrays(GL_POINTS,0,_count);[self checkGl];_draws++;
}
-(void)dispose{
 if(_disposed)return;RUNTIME(CGLGetCurrentContext()==_context,@"Cannot dispose Bouncing state in another context");
 // Discard earlier operation errors before attributing a result to deletion.
 // Otherwise a successful delete could look failed and leave a stale GL name.
 for(int i=0;i<16;i++){GLenum error=glGetError();if(error==GL_NO_ERROR)break;RUNTIME(i<15,@"Cannot establish clean GL error state for disposal");}
 // Clear each ownership slot only after successful deletion; callers can retry.
 #define DROP(handle,operation) if(handle){operation;RUNTIME(glGetError()==GL_NO_ERROR,@"Bouncing cleanup failed; owner retained");handle=0;}
 glUseProgram(0);glBindVertexArray(0);glBindFramebuffer(GL_FRAMEBUFFER,0);
 for(int i=0;i<2;i++){DROP(_frames[i],glDeleteFramebuffers(1,&_frames[i]));DROP(_textures[i],glDeleteTextures(1,&_textures[i]));}
 DROP(_quadBuffer,glDeleteBuffers(1,&_quadBuffer));DROP(_quadVao,glDeleteVertexArrays(1,&_quadVao));DROP(_pointVao,glDeleteVertexArrays(1,&_pointVao));DROP(_updateProgram,glDeleteProgram(_updateProgram));DROP(_pointProgram,glDeleteProgram(_pointProgram));
 #undef DROP
 _pointVertex=nil;_pointFragment=nil;_disposed=YES;CGLReleaseContext(_context);_context=NULL;
}
@end
