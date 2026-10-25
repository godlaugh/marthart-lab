// Retained Fractal MRT owner. Requests sample caller-ordered integer pixels;
// duplicate points and nonfinite shader facts are preserved without repairs.
@interface SourceCglFractalState:NSObject {
 CGLContextObj _context;
 GLuint _program,_shaders[2],_vao,_vbo,_textures[4],_frame,_pendingTextures[4],_pendingFrame,_lut[2],_pendingLut[2];
 uint32_t _width,_height,_index,_lutWidths[2];
 uint32_t _lastDraws,_lastTargetAllocations,_lastReferenceUploads,_lastPaletteUploads;
 uint64_t _programBytes,_pendingTargetBytes,_pendingLutBytes[2];
 BOOL _prepared,_failed,_disposed;
}
@property(readonly) uint64_t retainedBytes;
@property(readonly) uint32_t index;
@property(readonly) uint32_t lastDraws,lastTargetAllocations,lastReferenceUploads,lastPaletteUploads;
-(instancetype)initWithOperation:(NSDictionary*)operation;
-(void)prepare:(NSDictionary*)operation;
-(NSData*)sample:(NSDictionary*)operation width:(uint32_t)width height:(uint32_t)height retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(void)dispose;
@end

typedef struct {uint32_t x,y,index;} FractalPoint;
static int fractalPointOrder(const void *aa,const void *bb){const FractalPoint *a=aa,*b=bb;if(a->y!=b->y)return a->y<b->y?-1:1;if(a->x!=b->x)return a->x<b->x?-1:1;return a->index==b->index?0:a->index<b->index?-1:1;}

// v11's source profile permits real OpenGL array-prefix uploads, retaining the
// previously uploaded tail. GL_ACTIVE_UNIFORM size reports only the active
// prefix, not the original declaration capacity. These two known source arrays
// have explicit profile ABI bounds; other arrays are bounded by reflection.
static void applyFractalUniforms(GLuint program,NSArray *uniforms){
 NSDictionary *paletteSize=nil;
 for(NSDictionary *u in uniforms){NSString *name=u[@"name"];if([name isEqual:@"u_paletteSize"])paletteSize=u;uint32_t maximum=[name isEqual:@"u_palette"]?16:[name isEqual:@"u_dynamicParams"]?32:0;
  if(maximum){uint32_t kind=[u[@"kind"]unsignedIntValue],count=[u[@"count"]unsignedIntValue];RUNTIME(kind==(maximum==16?10U:8U)&&count>0&&count<=maximum,@"Fractal source array exceeds typed profile bounds");}
 }
 BOOL emptyPalette=[paletteSize[@"kind"]unsignedIntValue]==2&&[paletteSize[@"count"]unsignedIntValue]==1&&indexAt(paletteSize[@"bytes"],0,4)==0;
 GLint active=0;glGetProgramiv(program,GL_ACTIVE_UNIFORMS,&active);
 for(GLint i=0;i<active;i++){
  char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveUniform(program,i,sizeof(name),&length,&size,&type,name);RUNTIME(length>0&&length<1023&&size>0,@"Fractal active uniform metadata invalid");NSString *key=@(name);if([key hasSuffix:@"[0]"])key=[key substringToIndex:key.length-3];
  NSDictionary *found=nil;for(NSDictionary *u in uniforms)if([u[@"name"]isEqual:key])found=u;
  uint32_t bound=[key isEqual:@"u_palette"]?16:[key isEqual:@"u_dynamicParams"]?32:(uint32_t)size;
  if(!found&&[key isEqual:@"u_palette"]&&emptyPalette){RUNTIME(type==GL_FLOAT_VEC3&&size<=16,@"Fractal omitted palette violates source profile");continue;}
  uint32_t kind=[found[@"kind"]unsignedIntValue],count=[found[@"count"]unsignedIntValue];BOOL array=kind==8||kind==10;
  RUNTIME(found&&uniformType(kind)==type&&(type==GL_SAMPLER_2D?size==1:array?count>0&&count<=bound&&(uint32_t)size<=bound:count==(uint32_t)size),@"Fractal active uniform lacks matching typed prefix data");
 }
 uploadUniforms(program,uniforms);
}

@implementation SourceCglFractalState
-(uint64_t)retainedBytes{return _disposed?0:_programBytes+96+(uint64_t)_width*_height*52+_pendingTargetBytes+(uint64_t)_lutWidths[0]*16+(uint64_t)_lutWidths[1]*12+_pendingLutBytes[0]+_pendingLutBytes[1];}
-(uint32_t)index{return _index;}
-(uint32_t)lastDraws{return _lastDraws;}
-(uint32_t)lastTargetAllocations{return _lastTargetAllocations;}
-(uint32_t)lastReferenceUploads{return _lastReferenceUploads;}
-(uint32_t)lastPaletteUploads{return _lastPaletteUploads;}
-(instancetype)initWithOperation:(NSDictionary*)op{self=[super init];if(!self)return nil;_programBytes=[op[@"programBytes"]unsignedLongLongValue];_context=CGLGetCurrentContext();RUNTIME(_context!=NULL,@"Fractal requires an owned current context");_context=CGLRetainContext(_context);RUNTIME(_context!=NULL,@"Cannot retain Fractal context");return self;}
-(void)checkGl{if(glGetError()!=GL_NO_ERROR){_failed=YES;RUNTIME(NO,@"Fractal GL operation failed");}}
-(void)unbind{
 glDisable(GL_SCISSOR_TEST);glBindBuffer(GL_PIXEL_PACK_BUFFER,0);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);glBindFramebuffer(GL_FRAMEBUFFER,0);glBindVertexArray(0);glBindBuffer(GL_ARRAY_BUFFER,0);glUseProgram(0);glActiveTexture(GL_TEXTURE0);[self checkGl];
}
-(void)texture:(GLuint*)texture width:(uint32_t)width height:(uint32_t)height internal:(GLenum)internal format:(GLenum)format type:(GLenum)type bytes:(const void*)bytes{
 glGenTextures(1,texture);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,*texture);glTexImage2D(GL_TEXTURE_2D,0,internal,width,height,0,format,type,bytes);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_BASE_LEVEL,0);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAX_LEVEL,0);[self checkGl];
}
-(void)prepare:(NSDictionary*)op{
 INPUT(!_prepared&&!_failed&&!_disposed,@"Fractal resource already prepared");RUNTIME(CGLGetCurrentContext()==_context,@"Fractal preparation context mismatch");
 @try{
  GLint textures=0,buffers=0,attachments=0;glGetIntegerv(GL_MAX_TEXTURE_SIZE,&textures);glGetIntegerv(GL_MAX_DRAW_BUFFERS,&buffers);glGetIntegerv(GL_MAX_COLOR_ATTACHMENTS,&attachments);ensure(textures>=2048&&buffers>=4&&attachments>=4,@"unsupported",@"Native Fractal MRT/texture capability unavailable");
  samilaCompile(&_shaders[0],GL_VERTEX_SHADER,op[@"vertex"]);samilaCompile(&_shaders[1],GL_FRAGMENT_SHADER,op[@"fragment"]);_program=glCreateProgram();glAttachShader(_program,_shaders[0]);glAttachShader(_program,_shaders[1]);glLinkProgram(_program);GLint linked=0;glGetProgramiv(_program,GL_LINK_STATUS,&linked);if(!linked){char log[8192]={0};glGetProgramInfoLog(_program,sizeof(log),NULL,log);RUNTIME(NO,[NSString stringWithUTF8String:log]?:@"Fractal program link failed");}
  const char *outputs[]={"sourceZ","sourceTerminal","sourceInside","sourceOutside"};for(int i=0;i<4;i++)RUNTIME(glGetFragDataLocation(_program,outputs[i])==i,@"Fractal fragment outputs do not match owned targets");
  glGenVertexArrays(1,&_vao);glBindVertexArray(_vao);glGenBuffers(1,&_vbo);glBindBuffer(GL_ARRAY_BUFFER,_vbo);const GLfloat vertices[]={-1,1,0,0,1,1,1,0,1,-1,1,1,1,-1,1,1,-1,-1,0,1,-1,1,0,0};glBufferData(GL_ARRAY_BUFFER,sizeof(vertices),vertices,GL_STATIC_DRAW);
  const char *names[]={"position","texCoord"};for(int i=0;i<2;i++){GLint loc=glGetAttribLocation(_program,names[i]);RUNTIME(loc>=0,@"Fractal raster attribute missing");glEnableVertexAttribArray((GLuint)loc);glVertexAttribPointer((GLuint)loc,2,GL_FLOAT,GL_FALSE,16,(const void*)(uintptr_t)(i*8));}
  GLint active=0;glGetProgramiv(_program,GL_ACTIVE_ATTRIBUTES,&active);for(GLint i=0;i<active;i++){char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveAttrib(_program,i,sizeof(name),&length,&size,&type,name);if(strcmp(name,"gl_VertexID")==0&&size==1&&type==GL_INT)continue;RUNTIME((strcmp(name,"position")==0||strcmp(name,"texCoord")==0)&&size==1&&type==GL_FLOAT_VEC2,@"Fractal active attribute is not owned");}
  for(int i=0;i<2;i++){glDetachShader(_program,_shaders[i]);glDeleteShader(_shaders[i]);RUNTIME(glGetError()==GL_NO_ERROR,@"Fractal linked shader cleanup failed; owner retained");_shaders[i]=0;}[self checkGl];_prepared=YES;
 }@catch(NSException *e){_failed=YES;@throw;}@finally{[self unbind];}
}
-(void)dropTarget:(GLuint*)textures frame:(GLuint*)frame{
 if(*frame){glDeleteFramebuffers(1,frame);RUNTIME(glGetError()==GL_NO_ERROR,@"Fractal framebuffer cleanup failed; owner retained");*frame=0;}
 for(int i=0;i<4;i++)if(textures[i]){glDeleteTextures(1,&textures[i]);RUNTIME(glGetError()==GL_NO_ERROR,@"Fractal target cleanup failed; owner retained");textures[i]=0;}
}
-(void)resizeWidth:(uint32_t)width height:(uint32_t)height{
 _pendingTargetBytes=(uint64_t)width*height*52;
 for(int i=0;i<4;i++)[self texture:&_pendingTextures[i] width:width height:height internal:i==2?GL_RGBA8:GL_RGBA32F format:GL_RGBA type:i==2?GL_UNSIGNED_BYTE:GL_FLOAT bytes:NULL];
 glGenFramebuffers(1,&_pendingFrame);glBindFramebuffer(GL_FRAMEBUFFER,_pendingFrame);GLenum attachments[4];for(int i=0;i<4;i++){attachments[i]=GL_COLOR_ATTACHMENT0+i;glFramebufferTexture2D(GL_FRAMEBUFFER,attachments[i],GL_TEXTURE_2D,_pendingTextures[i],0);}glDrawBuffers(4,attachments);RUNTIME(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"Fractal MRT framebuffer incomplete");[self checkGl];glBindFramebuffer(GL_FRAMEBUFFER,0);
 [self dropTarget:_textures frame:&_frame];memcpy(_textures,_pendingTextures,sizeof(_textures));memset(_pendingTextures,0,sizeof(_pendingTextures));_frame=_pendingFrame;_pendingFrame=0;_width=width;_height=height;_pendingTargetBytes=0;
}
-(void)upload:(NSData*)bytes slot:(uint32_t)slot{
 uint32_t components=slot?3:4,width=(uint32_t)(bytes.length/(components*4));GLenum format=slot?GL_RGB:GL_RGBA;
 if(width!=_lutWidths[slot]){
  _pendingLutBytes[slot]=bytes.length;[self texture:&_pendingLut[slot] width:width height:1 internal:slot?GL_RGB32F:GL_RGBA32F format:format type:GL_FLOAT bytes:bytes.bytes];
  if(_lut[slot]){glDeleteTextures(1,&_lut[slot]);RUNTIME(glGetError()==GL_NO_ERROR,@"Fractal LUT cleanup failed; owner retained");_lut[slot]=0;}_lut[slot]=_pendingLut[slot];_pendingLut[slot]=0;_lutWidths[slot]=width;_pendingLutBytes[slot]=0;
 }else{glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_lut[slot]);glTexSubImage2D(GL_TEXTURE_2D,0,0,0,width,1,format,GL_FLOAT,bytes.bytes);[self checkGl];}
}
-(NSData*)sample:(NSDictionary*)op width:(uint32_t)width height:(uint32_t)height retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 INPUT(_prepared&&!_disposed,@"Fractal resource not prepared");RUNTIME(!_failed&&CGLGetCurrentContext()==_context,@"Fractal resource poisoned or context is not usable; release required");
 INPUT([op[@"index"]unsignedIntValue]==_index&&_index<UINT32_MAX,@"Fractal sample checkpoint mismatch");uint32_t count=[op[@"count"]unsignedIntValue],iterations=[op[@"iterations"]unsignedIntValue],span=MIN(count,2000000/iterations);BOOL resized=width!=_width||height!=_height;NSData *reference=op[@"reference"],*palette=op[@"palette"],*points=op[@"points"];
 uint64_t growth=(resized?(uint64_t)width*height*52:0)+(reference.length/16!=_lutWidths[0]?reference.length:0)+(palette.length/12!=_lutWidths[1]?palette.length:0);
 ensure(retained+growth+packetBytes*6+(uint64_t)count*(52*3+sizeof(FractalPoint))+(uint64_t)span*68+192<=Budget,@"capacity",@"Fractal targets, request copies and bounded samples exceed shared budget");
 GLint maximum=0,viewport[2]={0};glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maximum);glGetIntegerv(GL_MAX_VIEWPORT_DIMS,viewport);ensure(width<=(uint32_t)maximum&&height<=(uint32_t)maximum&&width<=(uint32_t)viewport[0]&&height<=(uint32_t)viewport[1],@"unsupported",@"Fractal target dimensions unavailable");
 FractalPoint *order=NULL;uint8_t *readback=NULL,*again=NULL;NSMutableData *records=nil;uint32_t draws=0,targetAllocations=0,referenceUploads=0,paletteUploads=0;
 @try{
  order=malloc((size_t)count*sizeof(FractalPoint));readback=malloc((size_t)span*52);again=malloc((size_t)span*16);ensure(order&&readback&&again,@"capacity",@"Fractal readback/permutation allocation failed");records=[NSMutableData dataWithLength:(NSUInteger)count*52];ensure(records!=nil,@"capacity",@"Fractal response allocation failed");
  for(uint32_t i=0;i<count;i++){order[i]=(FractalPoint){indexAt(points,i*2,4),indexAt(points,i*2+1,4),i};}qsort(order,count,sizeof(FractalPoint),fractalPointOrder);
  glUseProgram(_program);applyFractalUniforms(_program,op[@"uniforms"]);[self checkGl];
  samilaRaster(width,height);glDisable(GL_BLEND);glDisable(GL_PROGRAM_POINT_SIZE);if(resized){[self resizeWidth:width height:height];targetAllocations++;}[self upload:reference slot:0];referenceUploads++;[self upload:palette slot:1];paletteUploads++;
  glUseProgram(_program);glActiveTexture(GL_TEXTURE2);glBindTexture(GL_TEXTURE_2D,_lut[0]);glActiveTexture(GL_TEXTURE1);glBindTexture(GL_TEXTURE_2D,_lut[1]);glBindVertexArray(_vao);glBindFramebuffer(GL_FRAMEBUFFER,_frame);const GLenum attachments[]={GL_COLOR_ATTACHMENT0,GL_COLOR_ATTACHMENT1,GL_COLOR_ATTACHMENT2,GL_COLOR_ATTACHMENT3};glDrawBuffers(4,attachments);glEnable(GL_SCISSOR_TEST);
  uint8_t *destination=records.mutableBytes;
  for(uint32_t first=0;first<count;){uint32_t x=order[first].x,y=order[first].y,end=first+1;while(end<count&&order[end].y==y&&order[end].x-x<span)end++;uint32_t n=order[end-1].x-x+1;
   glScissor((GLint)x,(GLint)(height-1-y),(GLsizei)n,1);glDrawArrays(GL_TRIANGLES,0,6);[self checkGl];draws++;
   for(uint32_t attachment=0;attachment<4;attachment++){
    BOOL color=attachment==2;NSUInteger stride=color?4:16,bytes=(NSUInteger)n*stride;uint8_t *block=readback+(attachment<2?attachment*span*16:attachment==2?span*32:span*36);uint32_t marker=0x7fc0f00d,other=0xffc0e00e;
    if(color)memset(block,0xa5,bytes);else for(NSUInteger j=0;j<bytes/4;j++)memcpy(block+j*4,&marker,4);
    glReadBuffer(GL_COLOR_ATTACHMENT0+attachment);glReadPixels((GLint)x,(GLint)(height-1-y),(GLsizei)n,1,GL_RGBA,color?GL_UNSIGNED_BYTE:GL_FLOAT,block);[self checkGl];BOOL verify=NO;
    if(color){for(NSUInteger j=0;j<bytes;j++)if(block[j]==0xa5){verify=YES;break;}}else{for(NSUInteger j=0;j<bytes/4;j++){uint32_t bits;memcpy(&bits,block+j*4,4);if(bits==marker){verify=YES;break;}}}
    if(verify){if(color)memset(again,0x5a,bytes);else for(NSUInteger j=0;j<bytes/4;j++)memcpy(again+j*4,&other,4);glReadPixels((GLint)x,(GLint)(height-1-y),(GLsizei)n,1,GL_RGBA,color?GL_UNSIGNED_BYTE:GL_FLOAT,again);[self checkGl];RUNTIME(memcmp(block,again,bytes)==0,@"Fractal incomplete readback");}
   }
   for(uint32_t j=first;j<end;j++){NSUInteger offset=order[j].x-x;uint8_t *record=destination+(NSUInteger)order[j].index*52;memcpy(record,readback+offset*16,16);memcpy(record+16,readback+(NSUInteger)span*16+offset*16,16);memcpy(record+32,readback+(NSUInteger)span*32+offset*4,4);memcpy(record+36,readback+(NSUInteger)span*36+offset*16,16);}first=end;
  }
 }@catch(NSException *e){_failed=YES;@throw;}@finally{free(order);free(readback);free(again);[self unbind];}
 // Publish only the facts of a fully read and unbound successful transaction.
 _index++;_lastDraws=draws;_lastTargetAllocations=targetAllocations;_lastReferenceUploads=referenceUploads;_lastPaletteUploads=paletteUploads;return records;
}
-(void)dispose{
 if(_disposed)return;RUNTIME(CGLGetCurrentContext()==_context,@"Cannot dispose Fractal in another context");for(int i=0;i<16;i++){if(glGetError()==GL_NO_ERROR)break;RUNTIME(i<15,@"Cannot establish clean Fractal disposal state");}
 [self unbind];[self dropTarget:_pendingTextures frame:&_pendingFrame];[self dropTarget:_textures frame:&_frame];
 #define FRACTAL_DROP(handle,operation) if(handle){operation;RUNTIME(glGetError()==GL_NO_ERROR,@"Fractal cleanup failed; owner retained");handle=0;}
 for(int i=0;i<2;i++){FRACTAL_DROP(_pendingLut[i],glDeleteTextures(1,&_pendingLut[i]));FRACTAL_DROP(_lut[i],glDeleteTextures(1,&_lut[i]));FRACTAL_DROP(_shaders[i],glDeleteShader(_shaders[i]));}FRACTAL_DROP(_program,glDeleteProgram(_program));FRACTAL_DROP(_vbo,glDeleteBuffers(1,&_vbo));FRACTAL_DROP(_vao,glDeleteVertexArrays(1,&_vao));
 #undef FRACTAL_DROP
 _disposed=YES;CGLReleaseContext(_context);_context=NULL;
}
@end
static uint64_t fractalRetained(NSDictionary<NSData*,SourceCglFractalState*> *owners){uint64_t bytes=0;for(SourceCglFractalState *owner in owners.allValues)bytes+=owner.retainedBytes;return bytes;}
static NSData *fractalReply(NSDictionary *operation,SourceCglFractalState *owner,uint32_t disposition,uint32_t width,uint32_t height,NSData *records){
 uint32_t kind=[operation[@"kind"]unsignedIntValue],words[16]={4,kind,0,0,0,0,owner?owner.index:0,disposition,kind==2?[operation[@"count"]unsignedIntValue]:0,width,height,kind==2?owner.lastDraws:0,kind==2?owner.lastTargetAllocations:0,kind==2?owner.lastReferenceUploads:0,kind==2?owner.lastPaletteUploads:0,0};for(int i=0;i<16;i++)words[i]=CFSwapInt32HostToLittle(words[i]);memcpy((uint8_t*)words+8,[operation[@"resource"]bytes],16);NSMutableData *result=[NSMutableData dataWithBytes:words length:64];if(records)[result appendData:records];return result;
}
