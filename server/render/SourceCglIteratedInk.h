#ifndef SOURCE_CGL_ITERATED_INK_H
#define SOURCE_CGL_ITERATED_INK_H
// Retained drawing companion for the exact iterated state owner. It borrows
// checkpoint-bound GPU texture views; no particle readback or CPU recurrence.
// Included after SourceCglIteratedState. The composition owner disposes ink
// before state, and keeps both on any failed cleanup.
@interface SourceCglIteratedInk:NSObject {
 CGLContextObj _context;SourceCglIteratedState *_state;
 GLuint _programs[6],_shaders[12],_ink,_output,_facts,_reductions[2],_palette,_noise,_framebuffer,_vao;
 uint32_t _width,_height,_reduceWidth,_reduceHeight,_displays,_count,_lastIndex;
 uint64_t _programBytes;BOOL _prepared,_failed,_disposed;
 NSDictionary *_sources;NSString *_paletteKey;NSDictionary *_lastFacts;
}
@property(readonly) uint64_t retainedBytes;
@property(readonly) uint32_t width,height,displays,count,lastIndex;
@property(readonly) NSDictionary *lastFacts;
-(instancetype)initWithState:(SourceCglIteratedState*)state programs:(NSDictionary*)programs width:(uint32_t)width height:(uint32_t)height;
-(void)prepareWithRetained:(uint64_t)retained;
-(NSDictionary*)accumulateAtIndex:(uint32_t)index plan:(NSDictionary*)plan clear:(BOOL)clear decay:(float)decay record:(BOOL)record retained:(uint64_t)retained;
-(NSData*)present:(NSDictionary*)plan retained:(uint64_t)retained;
-(NSData*)readInkWithRetained:(uint64_t)retained;
-(void)dispose;
@end

static NSArray *iteratedInkProgramNames(void){return @[@"draw",@"statsFirst",@"statsReduce",@"present",@"presentReduce",@"decay"];}
static GLenum iteratedInkUniformType(NSString *kind){if(![kind isKindOfClass:NSString.class])return 0;NSDictionary *types=@{@"float":@(GL_FLOAT),@"int":@(GL_INT),@"bool":@(GL_BOOL),@"vec2":@(GL_FLOAT_VEC2),@"vec3":@(GL_FLOAT_VEC3),@"vec4":@(GL_FLOAT_VEC4),@"ivec2":@(GL_INT_VEC2),@"mat4":@(GL_FLOAT_MAT4),@"sampler2d":@(GL_SAMPLER_2D),@"usampler2d":@(GL_UNSIGNED_INT_SAMPLER_2D)};return [types[kind]unsignedIntValue];}
static NSDictionary *iteratedInkUniform(NSString *name,NSString *kind,NSArray *values){return @{@"name":name,@"kind":kind,@"values":values};}
static NSDictionary *iteratedInkSampler(NSString *name,BOOL integer,uint32_t unit){return @{@"name":name,@"kind":integer?@"usampler2d":@"sampler2d",@"texture":@(unit)};}
static NSArray *iteratedInkReplace(NSArray *values,NSArray *owned){INPUT([values isKindOfClass:NSArray.class]&&values.count<=65536,@"Invalid iterated render bindings");NSMutableArray *out=[NSMutableArray new];NSMutableSet *names=[NSMutableSet new];for(NSDictionary *u in values){INPUT([u isKindOfClass:NSDictionary.class],@"Iterated render binding must be a record");NSString *name=u[@"name"];INPUT([name isKindOfClass:NSString.class]&&nameValid(name)&&![names containsObject:name],@"Invalid or duplicate iterated render binding");[names addObject:name];BOOL replaced=NO;for(NSDictionary *v in owned)if([u[@"name"]isEqual:v[@"name"]]){INPUT([u isEqualToDictionary:v],@"Iterated owned binding identity differs");replaced=YES;}if(!replaced)[out addObject:u];}[out addObjectsFromArray:owned];return out;}
// Validate the complete linked ABI before applying any uniforms. Inputs are
// prepared scalar facts, not a second interpretation of scene settings.
static void iteratedInkValidate(GLuint program,NSArray *uniforms){
 INPUT([uniforms isKindOfClass:NSArray.class]&&uniforms.count<=65536,@"Invalid iterated render bindings");NSMutableDictionary *byName=[NSMutableDictionary new];
 for(NSDictionary *u in uniforms){INPUT([u isKindOfClass:NSDictionary.class],@"Iterated render binding must be a record");NSString *name=u[@"name"],*kind=u[@"kind"];INPUT([name isKindOfClass:NSString.class]&&nameValid(name)&&!byName[name]&&iteratedInkUniformType(kind),@"Invalid or duplicate iterated render binding");byName[name]=u;
  if([kind isEqual:@"sampler2d"]||[kind isEqual:@"usampler2d"]){uint32_t unit=iteratedStateWord(u,@"texture");INPUT(unit<4,@"Iterated render sampler exceeds owned units");continue;}
  NSArray *values=u[@"values"];NSUInteger n=[kind isEqual:@"mat4"]?16:([kind isEqual:@"vec4"]?4:([kind isEqual:@"vec3"]?3:([kind isEqual:@"vec2"]||[kind isEqual:@"ivec2"]?2:1)));INPUT([values isKindOfClass:NSArray.class]&&values.count==n,@"Iterated render uniform dimensions differ");
  BOOL integer=[kind isEqual:@"int"]||[kind isEqual:@"bool"]||[kind isEqual:@"ivec2"];for(id value in values){INPUT([value isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)value)!=CFBooleanGetTypeID(),@"Non-numeric iterated render uniform");double v=[value doubleValue];INPUT(isfinite(v)&&isfinite((float)v)&&(!integer||(floor(v)==v&&v>=INT32_MIN&&v<=INT32_MAX)),@"Iterated render uniform exceeds scalar range");if([kind isEqual:@"bool"])INPUT(v==0||v==1,@"Invalid iterated render boolean");}
 }
 GLint active=0;glGetProgramiv(program,GL_ACTIVE_UNIFORMS,&active);
 for(GLint i=0;i<active;i++){char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveUniform(program,i,sizeof(name),&length,&size,&type,name);RUNTIME(length>0&&length<1023&&size==1,@"Iterated render active binding shape unsupported");NSDictionary *u=byName[@(name)];INPUT(u&&type==iteratedInkUniformType(u[@"kind"]),([NSString stringWithFormat:@"Iterated render active binding absent or mistyped: %s",name]));}
}
static void iteratedInkBind(GLuint program,NSArray *uniforms){
 iteratedInkValidate(program,uniforms);glUseProgram(program);
 for(NSDictionary *u in uniforms){GLint location=glGetUniformLocation(program,[u[@"name"]UTF8String]);if(location<0)continue;NSString *kind=u[@"kind"];if([kind isEqual:@"sampler2d"]||[kind isEqual:@"usampler2d"]){glUniform1i(location,[u[@"texture"]intValue]);continue;}GLfloat f[16]={0};GLint n[16]={0};NSArray *values=u[@"values"];for(NSUInteger i=0;i<values.count;i++){f[i]=[values[i]floatValue];n[i]=[values[i]intValue];}
  if([kind isEqual:@"int"]||[kind isEqual:@"bool"])glUniform1iv(location,1,n);else if([kind isEqual:@"ivec2"])glUniform2iv(location,1,n);else if([kind isEqual:@"vec2"])glUniform2fv(location,1,f);else if([kind isEqual:@"vec3"])glUniform3fv(location,1,f);else if([kind isEqual:@"vec4"])glUniform4fv(location,1,f);else if([kind isEqual:@"mat4"])glUniformMatrix4fv(location,1,GL_FALSE,f);else glUniform1fv(location,1,f);
 }
}

@implementation SourceCglIteratedInk
-(uint32_t)width{return _width;}-(uint32_t)height{return _height;}-(uint32_t)displays{return _displays;}-(uint32_t)count{return _count;}-(uint32_t)lastIndex{return _lastIndex;}-(NSDictionary*)lastFacts{return _lastFacts;}
-(uint64_t)retainedBytes{return _disposed?0:_programBytes+(uint64_t)_width*_height*36+(uint64_t)_reduceWidth*_reduceHeight*32+4097*16+256+1024*1024;}
-(instancetype)initWithState:(SourceCglIteratedState*)state programs:(NSDictionary*)programs width:(uint32_t)width height:(uint32_t)height{
 self=[super init];if(!self)return nil;INPUT(state&&width&&height&&width<=16384&&height<=16384&&(uint64_t)width*height<=16000000,@"Invalid iterated ink dimensions");INPUT([programs isKindOfClass:NSDictionary.class],@"Iterated programs must be a record");_state=state;_width=width;_height=height;_count=state.count;_lastIndex=state.index;
 uint32_t tw=[state drawViewWidth],th=[state drawViewHeight];_reduceWidth=MAX((tw+1)/2,(width+3)/4);_reduceHeight=MAX((th+1)/2,(height+3)/4);
 for(NSString *name in iteratedInkProgramNames()){NSDictionary *p=programs[name];INPUT([p isKindOfClass:NSDictionary.class],@"Iterated shader program must be a record");for(NSString *stage in @[@"vertex",@"fragment"]){NSString *source=p[stage];INPUT([source isKindOfClass:NSString.class]&&[source hasPrefix:@"#version 410 core\n"],@"Iterated ink shader profile missing");_programBytes+=[source lengthOfBytesUsingEncoding:NSUTF8StringEncoding]*3;}}
 ensure(self.retainedBytes<=Budget,@"capacity",@"Iterated ink storage exceeds budget");_sources=[programs copy];_context=CGLGetCurrentContext();RUNTIME(_context!=NULL,@"Iterated ink needs current context");_context=CGLRetainContext(_context);return self;
}
-(void)checkGl{GLenum e=glGetError();if(e){_failed=YES;RUNTIME(NO,([NSString stringWithFormat:@"Iterated ink GL error %u",e]));}}
-(void)check{INPUT(_prepared&&!_disposed,@"Iterated ink not prepared");RUNTIME(!_failed&&CGLGetCurrentContext()==_context,@"Iterated ink context unavailable");}
-(void)texture:(GLuint*)texture width:(uint32_t)width height:(uint32_t)height internal:(GLenum)internal format:(GLenum)format type:(GLenum)type{
 glGenTextures(1,texture);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,*texture);glTexImage2D(GL_TEXTURE_2D,0,internal,width,height,0,format,type,NULL);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_BASE_LEVEL,0);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAX_LEVEL,0);[self checkGl];
}
-(void)target:(GLuint)texture width:(uint32_t)width height:(uint32_t)height facts:(BOOL)facts{
 glBindFramebuffer(GL_FRAMEBUFFER,_framebuffer);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,texture,0);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT1,GL_TEXTURE_2D,facts?_facts:0,0);const GLenum attachments[]={GL_COLOR_ATTACHMENT0,GL_COLOR_ATTACHMENT1};glDrawBuffers(facts?2:1,attachments);glReadBuffer(GL_COLOR_ATTACHMENT0);RUNTIME(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"Iterated ink framebuffer incomplete");glViewport(0,0,width,height);
}
-(void)unbind{glBindFramebuffer(GL_FRAMEBUFFER,0);glBindVertexArray(0);glUseProgram(0);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);glBindBuffer(GL_PIXEL_PACK_BUFFER,0);glDisable(GL_BLEND);glDisable(GL_PROGRAM_POINT_SIZE);glActiveTexture(GL_TEXTURE0);[self checkGl];}
-(void)finishWithFailure:(NSException*)failure restoreInkFilter:(BOOL)restore{
 @try{if(restore){[self bindTexture:_ink unit:0];glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);}[self unbind];}
 @catch(NSException *cleanup){_failed=YES;if(failure)failure=[NSException exceptionWithName:@"runtime" reason:[NSString stringWithFormat:@"%@ (%@); ink cleanup also failed: %@ (%@)",failure.reason,failure.name,cleanup.reason,cleanup.name] userInfo:@{@"primary":failure,@"cleanup":cleanup}];else failure=cleanup;}
 if(failure)@throw failure;
}
// Creation admission includes other owners but excludes this new ink owner.
-(void)prepareWithRetained:(uint64_t)retained{
 RUNTIME(CGLGetCurrentContext()==_context,@"Iterated ink preparation context mismatch");INPUT(retained>=_state.retainedBytes,@"Ink preparation admission omits compute state");
 INPUT(!_prepared&&!_disposed&&!_failed,@"Iterated ink already prepared");iteratedStateBudget(retained+self.retainedBytes,0,0);NSException *failure=nil;
 @try{
  GLint max=0;glGetIntegerv(GL_MAX_TEXTURE_SIZE,&max);ensure(_width<=(uint32_t)max&&_height<=(uint32_t)max&&_reduceWidth<=(uint32_t)max&&_reduceHeight<=(uint32_t)max&&max>=4097,@"unsupported",@"Iterated ink texture size unavailable");
  NSArray *names=iteratedInkProgramNames();for(int i=0;i<6;i++){NSDictionary *p=_sources[names[i]];iteratedStateCompile(&_shaders[i*2],GL_VERTEX_SHADER,p[@"vertex"]);iteratedStateCompile(&_shaders[i*2+1],GL_FRAGMENT_SHADER,p[@"fragment"]);_programs[i]=glCreateProgram();glAttachShader(_programs[i],_shaders[i*2]);glAttachShader(_programs[i],_shaders[i*2+1]);glLinkProgram(_programs[i]);GLint linked=0;glGetProgramiv(_programs[i],GL_LINK_STATUS,&linked);if(!linked){char log[8192]={0};glGetProgramInfoLog(_programs[i],sizeof(log),NULL,log);RUNTIME(NO,[NSString stringWithUTF8String:log]?:@"Iterated ink link failed");}GLint attributes=0;glGetProgramiv(_programs[i],GL_ACTIVE_ATTRIBUTES,&attributes);for(GLint a=0;a<attributes;a++){char name[128]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveAttrib(_programs[i],a,sizeof(name),&length,&size,&type,name);INPUT(size==1&&type==GL_INT&&(strcmp(name,"gl_VertexID")==0||strcmp(name,"gl_InstanceID")==0),@"Iterated render must not consume external vertex attributes");}NSString *output=i==3?@"pixel":i==4?@"total":i==5?@"color":@"result";INPUT(glGetFragDataLocation(_programs[i],output.UTF8String)==0&&(i!=3||glGetFragDataLocation(_programs[i],"facts")==1),@"Iterated render output ABI differs");for(int s=0;s<2;s++){glDetachShader(_programs[i],_shaders[i*2+s]);glDeleteShader(_shaders[i*2+s]);[self checkGl];_shaders[i*2+s]=0;}}
  samilaRaster(_width,_height);glGenFramebuffers(1,&_framebuffer);glGenVertexArrays(1,&_vao);
  [self texture:&_ink width:_width height:_height internal:GL_RGBA32F format:GL_RGBA type:GL_FLOAT];[self texture:&_output width:_width height:_height internal:GL_RGBA8 format:GL_RGBA type:GL_UNSIGNED_BYTE];[self texture:&_facts width:_width height:_height internal:GL_RGBA32UI format:GL_RGBA_INTEGER type:GL_UNSIGNED_INT];
  for(int i=0;i<2;i++)[self texture:&_reductions[i] width:_reduceWidth height:_reduceHeight internal:GL_RGBA32UI format:GL_RGBA_INTEGER type:GL_UNSIGNED_INT];[self texture:&_palette width:4097 height:1 internal:GL_RGBA32F format:GL_RGBA type:GL_FLOAT];[self texture:&_noise width:256 height:1 internal:GL_R8UI format:GL_RED_INTEGER type:GL_UNSIGNED_BYTE];
  [self target:_ink width:_width height:_height facts:NO];const GLfloat zero[4]={0};glClearBufferfv(GL_COLOR,0,zero);[self checkGl];_prepared=YES;
 }@catch(NSException *e){_failed=YES;failure=e;}[self finishWithFailure:failure restoreInkFilter:NO];
}
-(void)bindTexture:(GLuint)texture unit:(uint32_t)unit{glActiveTexture(GL_TEXTURE0+unit);glBindTexture(GL_TEXTURE_2D,texture);}
-(NSDictionary*)accumulateAtIndex:(uint32_t)index plan:(NSDictionary*)plan clear:(BOOL)clear decay:(float)decay record:(BOOL)record retained:(uint64_t)retained{
 [self check];INPUT([plan isKindOfClass:NSDictionary.class]&&[plan[@"palette"]isKindOfClass:NSDictionary.class],@"Iterated draw plan must be a record");INPUT(index==_state.index&&isfinite(decay)&&decay>=0&&decay<=1&&_displays<UINT32_MAX,@"Invalid iterated ink checkpoint/decay");INPUT(retained>=self.retainedBytes+_state.retainedBytes,@"Ink admission omits owned storage");iteratedStateBudget(retained,0,0);
 NSArray *draw=plan[@"drawUniforms"],*stats=plan[@"statsUniforms"];NSDictionary *palette=plan[@"palette"];NSString *key=palette[@"key"],*format=palette[@"format"];NSData *paletteData=palette[@"bytes"],*noise=plan[@"noise"];
 BOOL native=[format isEqual:@"source-rgb1024"];INPUT([key isKindOfClass:NSString.class]&&[paletteData isKindOfClass:NSData.class]&&[noise isKindOfClass:NSData.class]&&(native||[format isEqual:@"local-rgba4097"])&&paletteData.length==(native?1024*12:4097*16)&&noise.length==256,@"Iterated palette/noise input mismatch");
 for(NSUInteger i=0;i<paletteData.length/4;i++){float v;memcpy(&v,(const uint8_t*)paletteData.bytes+i*4,4);INPUT(isfinite(v),@"Iterated palette contains nonfinite values");}
 NSString *primitive=plan[@"primitive"];BOOL points=[primitive isEqual:@"points"];INPUT(points||[primitive isEqual:@"triangles"],@"Unknown iterated primitive");
 // Read dimensions from the state owner without materializing its GPU view.
 // Malformed bindings must fail before either owner's storage is changed.
 SourceCglIteratedDrawView view={0,0,[_state drawViewWidth],[_state drawViewHeight],_state.count,index};
 NSArray *stateBindings=@[iteratedInkUniform(@"quadSplat",@"bool",@[@(points?0:1)]),iteratedInkSampler(@"states",NO,0),iteratedInkSampler(@"counters",YES,1),iteratedInkSampler(@"palette",NO,2),iteratedInkSampler(@"noisePermutation",YES,3),iteratedInkUniform(@"size",@"ivec2",@[@(_width),@(_height)]),iteratedInkUniform(@"count",@"int",@[@(view.count)]),iteratedInkUniform(@"stateWidth",@"int",@[@(view.width)]),iteratedInkUniform(@"particleOffset",@"int",@[@0])];
 draw=iteratedInkReplace(draw,stateBindings);stats=iteratedInkReplace(stats,@[iteratedInkUniform(@"sourcePointClip",@"int",@[@(points?1:0)]),iteratedInkUniform(@"size",@"ivec2",@[@(_width),@(_height)]),iteratedInkUniform(@"recording",@"int",@[@(record?1:0)]),iteratedInkSampler(@"states",NO,0),iteratedInkSampler(@"counters",YES,1),iteratedInkUniform(@"count",@"int",@[@(view.count)]),iteratedInkUniform(@"sourceSize",@"ivec2",@[@(view.width),@(view.height)])]);
 // Complete active bindings are validated before the retained ink is touched.
 iteratedInkValidate(_programs[0],draw);iteratedInkValidate(_programs[1],stats);iteratedInkValidate(_programs[2],@[iteratedInkSampler(@"values",YES,0),iteratedInkUniform(@"sourceSize",@"ivec2",@[@(view.width),@(view.height)])]);iteratedInkValidate(_programs[5],@[]);[self checkGl];
 view=[_state drawViewAtIndex:index retained:retained packetBytes:0];NSException *failure=nil;NSDictionary *facts=nil;
 @try{
  samilaRaster(_width,_height);glBindVertexArray(_vao);glDisable(GL_BLEND);
  if(![_paletteKey isEqual:key]){[self bindTexture:_palette unit:2];glTexImage2D(GL_TEXTURE_2D,0,native?GL_RGB32F:GL_RGBA32F,native?1024:4097,1,0,native?GL_RGB:GL_RGBA,GL_FLOAT,paletteData.bytes);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,native?GL_LINEAR:GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,native?GL_LINEAR:GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,native?GL_REPEAT:GL_CLAMP_TO_EDGE);_paletteKey=[key copy];}
  [self bindTexture:_noise unit:3];glTexSubImage2D(GL_TEXTURE_2D,0,0,0,256,1,GL_RED_INTEGER,GL_UNSIGNED_BYTE,noise.bytes);
  [self target:_ink width:_width height:_height facts:NO];if(clear){const GLfloat zero[4]={0};glClearBufferfv(GL_COLOR,0,zero);}if(decay!=1){glUseProgram(_programs[5]);glEnable(GL_BLEND);glBlendEquation(GL_FUNC_ADD);glBlendColor(0,0,0,decay);glBlendFunc(GL_ZERO,GL_CONSTANT_ALPHA);glDrawArrays(GL_TRIANGLES,0,3);glDisable(GL_BLEND);}
  uint32_t w=view.width,h=view.height,side=0,level=0;do{
   if(!level){iteratedInkBind(_programs[1],stats);[self bindTexture:view.positions unit:0];[self bindTexture:view.metadata unit:1];}
   else{iteratedInkBind(_programs[2],@[iteratedInkSampler(@"values",YES,0),iteratedInkUniform(@"sourceSize",@"ivec2",@[@(w),@(h)])]);[self bindTexture:_reductions[1-side] unit:0];}
   w=(w+1)/2;h=(h+1)/2;[self target:_reductions[side] width:w height:h facts:NO];glDrawArrays(GL_TRIANGLES,0,3);side=1-side;level++;
  }while(w>1||h>1);
  uint32_t values[4]={0};glReadPixels(0,0,1,1,GL_RGBA_INTEGER,GL_UNSIGNED_INT,values);[self checkGl];uint64_t invalid=(uint64_t)values[0]+((uint64_t)values[1]<<32);RUNTIME(invalid<=9007199254740991ULL&&(uint64_t)values[2]+values[3]<=view.count,@"Iterated sample statistics exceed exact coverage");
  if(record){iteratedInkBind(_programs[0],draw);[self target:_ink width:_width height:_height facts:NO];[self bindTexture:view.positions unit:0];[self bindTexture:view.metadata unit:1];[self bindTexture:_palette unit:2];[self bindTexture:_noise unit:3];glEnable(GL_BLEND);glBlendEquation(GL_FUNC_ADD);glBlendFunc(GL_ONE,GL_ONE);if(points)glEnable(GL_PROGRAM_POINT_SIZE);else glDisable(GL_PROGRAM_POINT_SIZE);GLint offset=glGetUniformLocation(_programs[0],"particleOffset");
   for(uint32_t first=0;first<view.count;first+=65536){glUniform1i(offset,(GLint)first);glDrawArraysInstanced(points?GL_POINTS:GL_TRIANGLES,0,points?1:6,MIN(65536,view.count-first));}[self checkGl];
  }
  facts=@{@"invalid":@(invalid),@"accepted":@(values[2]),@"clipped":@(values[3]),@"sampleInvalid":@(record?view.count-values[2]-values[3]:0)};
 }@catch(NSException *e){_failed=YES;failure=e;}[self finishWithFailure:failure restoreInkFilter:NO];_lastFacts=facts;_lastIndex=index;_displays++;return _lastFacts;
}
-(NSData*)present:(NSDictionary*)plan retained:(uint64_t)retained{
 [self check];INPUT([plan isKindOfClass:NSDictionary.class],@"Iterated present plan must be a record");INPUT(retained>=self.retainedBytes+_state.retainedBytes,@"Presentation admission omits owned storage");iteratedStateBudget(retained,0,(uint64_t)_width*_height*4);
 NSArray *clear=plan[@"clear"],*uniforms=plan[@"uniforms"];NSString *filter=plan[@"filter"];INPUT([clear isKindOfClass:NSArray.class]&&clear.count==4&&([filter isEqual:@"linear"]||[filter isEqual:@"nearest"]),@"Invalid iterated presentation target");GLfloat color[4];for(int i=0;i<4;i++){INPUT([clear[i]isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)clear[i])!=CFBooleanGetTypeID(),@"Iterated clear must be numeric");color[i]=[clear[i]floatValue];INPUT(isfinite(color[i])&&color[i]>=0&&color[i]<=1,@"Invalid iterated presentation clear");}uniforms=iteratedInkReplace(uniforms,@[iteratedInkSampler(@"ink",NO,0),iteratedInkUniform(@"origin",@"ivec2",@[@0,@0]),iteratedInkUniform(@"viewportAspect",@"float",@[@((float)_width/_height)])]);iteratedInkValidate(_programs[3],uniforms);iteratedInkValidate(_programs[4],@[iteratedInkSampler(@"values",YES,0),iteratedInkUniform(@"size",@"ivec2",@[@(_width),@(_height)]),iteratedInkUniform(@"reductionOrigin",@"ivec2",@[@0,@0])]);[self checkGl];NSMutableData *rgba=[NSMutableData dataWithLength:(NSUInteger)_width*_height*4];NSException *failure=nil;NSDictionary *facts=nil;
 @try{
  samilaRaster(_width,_height);glBindVertexArray(_vao);iteratedInkBind(_programs[3],uniforms);[self bindTexture:_ink unit:0];glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,[filter isEqual:@"linear"]?GL_LINEAR:GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,[filter isEqual:@"linear"]?GL_LINEAR:GL_NEAREST);
  [self target:_output width:_width height:_height facts:YES];glClearBufferfv(GL_COLOR,0,color);const GLuint zero[4]={0};glClearBufferuiv(GL_COLOR,1,zero);glEnablei(GL_BLEND,0);glDisablei(GL_BLEND,1);glBlendEquation(GL_FUNC_ADD);glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);glDrawArrays(GL_TRIANGLE_STRIP,0,4);glDisable(GL_BLEND);[self checkGl];
  uint32_t w=_width,h=_height,side=0;GLuint input=_facts;do{iteratedInkBind(_programs[4],@[iteratedInkSampler(@"values",YES,0),iteratedInkUniform(@"size",@"ivec2",@[@(w),@(h)]),iteratedInkUniform(@"reductionOrigin",@"ivec2",@[@0,@0])]);[self bindTexture:input unit:0];w=(w+3)/4;h=(h+3)/4;[self target:_reductions[side] width:w height:h facts:NO];glDrawArrays(GL_TRIANGLES,0,3);input=_reductions[side];side=1-side;}while(w>1||h>1);
  uint32_t values[4]={0};glReadPixels(0,0,1,1,GL_RGBA_INTEGER,GL_UNSIGNED_INT,values);[self checkGl];float maxCount;memcpy(&maxCount,&values[1],4);RUNTIME(values[2]==0&&values[3]==0&&isfinite(maxCount)&&maxCount>=0&&values[0]<=(uint64_t)_width*_height,@"Invalid iterated presentation facts");
  [self target:_output width:_width height:_height facts:NO];glReadPixels(0,0,_width,_height,GL_RGBA,GL_UNSIGNED_BYTE,rgba.mutableBytes);[self checkGl];facts=@{@"occupiedPixels":@(values[0]),@"maxCount":@(maxCount)};
 }@catch(NSException *e){_failed=YES;failure=e;}[self finishWithFailure:failure restoreInkFilter:YES];_lastFacts=facts;return rgba;
}
-(NSData*)readInkWithRetained:(uint64_t)retained{[self check];INPUT(retained>=self.retainedBytes+_state.retainedBytes,@"Ink read admission omits owned storage");iteratedStateBudget(retained,0,(uint64_t)_width*_height*16);NSMutableData *data=[NSMutableData dataWithLength:(NSUInteger)_width*_height*16];NSException *failure=nil;@try{samilaRaster(_width,_height);[self target:_ink width:_width height:_height facts:NO];glReadPixels(0,0,_width,_height,GL_RGBA,GL_FLOAT,data.mutableBytes);[self checkGl];}@catch(NSException *e){_failed=YES;failure=e;}[self finishWithFailure:failure restoreInkFilter:NO];return data;}
-(void)dispose{
 if(_disposed)return;RUNTIME(CGLGetCurrentContext()==_context,@"Cannot dispose ink in another context");for(int i=0;i<16;i++){GLenum e=glGetError();if(!e)break;RUNTIME(i<15,@"Cannot establish ink cleanup boundary");}[self unbind];
 #define INK_DROP(handle,operation) if(handle){operation;RUNTIME(glGetError()==GL_NO_ERROR,@"Iterated ink cleanup failed; retain owner");handle=0;}
 INK_DROP(_framebuffer,glDeleteFramebuffers(1,&_framebuffer));INK_DROP(_vao,glDeleteVertexArrays(1,&_vao));INK_DROP(_ink,glDeleteTextures(1,&_ink));INK_DROP(_output,glDeleteTextures(1,&_output));INK_DROP(_facts,glDeleteTextures(1,&_facts));INK_DROP(_palette,glDeleteTextures(1,&_palette));INK_DROP(_noise,glDeleteTextures(1,&_noise));for(int i=0;i<2;i++){INK_DROP(_reductions[i],glDeleteTextures(1,&_reductions[i]));}for(int i=0;i<6;i++){INK_DROP(_programs[i],glDeleteProgram(_programs[i]));}for(int i=0;i<12;i++){INK_DROP(_shaders[i],glDeleteShader(_shaders[i]));}
 #undef INK_DROP
 _disposed=YES;_sources=nil;_state=nil;CGLReleaseContext(_context);_context=NULL;
}
@end
#endif
