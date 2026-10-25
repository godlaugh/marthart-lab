// Windowless diagnostic, not an app service/retained-state implementation.
// Runs the production custom-fragment producer against caller-pinned inputs.
#define main source_renderer_main
#include "SourceCglRenderer.m"
#undef main

static void customWrite(NSString *path,NSData *bytes){
 INPUT([path isAbsolutePath]&&![[NSFileManager defaultManager]fileExistsAtPath:path],@"Diagnostic output must be a new absolute file");
 RUNTIME([bytes writeToFile:path options:NSDataWritingWithoutOverwriting error:NULL],@"Diagnostic output failed");
}
int main(int argc,const char **argv){@autoreleasepool{
 CGLContextObj context=NULL;GLuint program=0,shaders[2]={0},textures[2]={0},framebuffer=0,vao=0,quad=0;int result=1;
 NSMutableDictionary *facts=[@{@"status":@"failed",@"windowMode":@"CGL-only diagnostic; no window API invoked",@"scope":@"Finite diagnostic inputs only; not app routing, retained owner or arbitrary shader termination validation"}mutableCopy];
 @try{
  INPUT(argc==3,@"Expected manifest and new output directory");NSString *output=@(argv[2]);
  NSDictionary *attributes=[[NSFileManager defaultManager]attributesOfItemAtPath:@(argv[1]) error:NULL];INPUT(attributes&&[attributes fileSize]<=4*1024*1024,@"Diagnostic manifest exceeds budget");
  NSDictionary *spec=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:@(argv[1])] options:0 error:NULL];INPUT([spec isKindOfClass:NSDictionary.class],@"Invalid manifest");
  uint32_t count=iteratedStateWord(spec,@"count"),size=iteratedStateWord(spec,@"size");INPUT(count>0&&count<=1000000&&size==(uint32_t)ceil(sqrt((double)count)),@"Diagnostic square layout mismatch");uint64_t bytes=(uint64_t)size*size*16;
  INPUT([spec[@"seed"]isKindOfClass:NSString.class],@"Diagnostic seed path invalid");NSDictionary *seedAttributes=[[NSFileManager defaultManager]attributesOfItemAtPath:spec[@"seed"] error:NULL];INPUT(seedAttributes&&[seedAttributes fileSize]==bytes,@"Diagnostic seed file size mismatch");
  NSData *seed=[NSData dataWithContentsOfFile:spec[@"seed"] options:NSDataReadingMappedIfSafe error:NULL];INPUT(seed&&seed.length==bytes,@"Diagnostic seed length mismatch");
  NSArray *frames=spec[@"frames"];INPUT([frames isKindOfClass:NSArray.class]&&frames.count>0&&frames.count<=64,@"Diagnostic frame budget");uint64_t work=0;
  for(NSArray *passes in frames){INPUT([passes isKindOfClass:NSArray.class]&&passes.count<=128,@"Diagnostic pass budget");for(NSDictionary *pass in passes){uint32_t steps=iteratedStateWord(pass,@"iterations");INPUT(steps>=1&&steps<=16,@"Diagnostic source pass must contain 1..16 iterations");work+=(uint64_t)size*size*steps;INPUT(work<=128000000,@"Diagnostic texel-step budget");}}
  NSString *vertex=spec[@"vertex"],*fragment=spec[@"fragment"];INPUT([vertex isKindOfClass:NSString.class]&&[fragment isKindOfClass:NSString.class]&&vertex.length<=8192&&fragment.length<=128*1024,@"Diagnostic shader text budget");
  createContext(&context);facts[@"renderer"]=@((const char*)glGetString(GL_RENDERER));facts[@"version"]=@((const char*)glGetString(GL_VERSION));facts[@"texelSteps"]=@(work);
  GLint max=0;glGetIntegerv(GL_MAX_TEXTURE_SIZE,&max);INPUT(size<=(uint32_t)max,@"Diagnostic texture size unavailable");
  iteratedStateCompile(&shaders[0],GL_VERTEX_SHADER,vertex);iteratedStateCompile(&shaders[1],GL_FRAGMENT_SHADER,fragment);program=glCreateProgram();RUNTIME(program,@"Program allocation failed");
  glAttachShader(program,shaders[0]);glAttachShader(program,shaders[1]);glBindAttribLocation(program,0,"quadPosition");glBindFragDataLocation(program,0,"newState");glLinkProgram(program);GLint linked=0;glGetProgramiv(program,GL_LINK_STATUS,&linked);
  if(!linked){char log[8192]={0};glGetProgramInfoLog(program,sizeof(log),NULL,log);RUNTIME(NO,@(log));}
  for(int i=0;i<2;i++){glDetachShader(program,shaders[i]);glDeleteShader(shaders[i]);RUNTIME(glGetError()==GL_NO_ERROR,@"Shader cleanup failed");shaders[i]=0;}
  glGenTextures(2,textures);glGenFramebuffers(1,&framebuffer);glGenVertexArrays(1,&vao);glGenBuffers(1,&quad);RUNTIME(textures[0]&&textures[1]&&framebuffer&&vao&&quad,@"Diagnostic allocation failed");
  glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);glPixelStorei(GL_UNPACK_ALIGNMENT,1);glPixelStorei(GL_UNPACK_ROW_LENGTH,0);glPixelStorei(GL_UNPACK_SKIP_PIXELS,0);glPixelStorei(GL_UNPACK_SKIP_ROWS,0);
  for(int i=0;i<2;i++){glBindTexture(GL_TEXTURE_2D,textures[i]);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA32F,size,size,0,GL_RGBA,GL_FLOAT,seed.bytes);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);}
  const GLfloat vertices[]={-1,-1,1,-1,-1,1,1,1};glBindVertexArray(vao);glBindBuffer(GL_ARRAY_BUFFER,quad);glBufferData(GL_ARRAY_BUFFER,sizeof(vertices),vertices,GL_STATIC_DRAW);glEnableVertexAttribArray(0);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,0,NULL);
  glBindFramebuffer(GL_FRAMEBUFFER,framebuffer);glDrawBuffer(GL_COLOR_ATTACHMENT0);glReadBuffer(GL_COLOR_ATTACHMENT0);samilaRaster(size,size);glUseProgram(program);glUniform1i(glGetUniformLocation(program,"stateTex"),0);glActiveTexture(GL_TEXTURE0);
  glBindBuffer(GL_PIXEL_PACK_BUFFER,0);glPixelStorei(GL_PACK_ALIGNMENT,1);glPixelStorei(GL_PACK_ROW_LENGTH,0);glPixelStorei(GL_PACK_SKIP_PIXELS,0);glPixelStorei(GL_PACK_SKIP_ROWS,0);
  uint32_t current=0,index=0;NSMutableArray *timings=[NSMutableArray new];
  for(NSArray *passes in frames){CFAbsoluteTime start=CFAbsoluteTimeGetCurrent();
   for(NSDictionary *pass in passes){
    NSDictionary *uniforms=pass[@"uniforms"];INPUT([uniforms isKindOfClass:NSDictionary.class]&&uniforms.count<=65536,@"Diagnostic uniforms invalid");
    glUniform1i(glGetUniformLocation(program,"iterations"),[pass[@"iterations"]intValue]);
    for(NSString *name in uniforms){INPUT([name isKindOfClass:NSString.class]&&nameValid(name),@"Diagnostic uniform name invalid");NSNumber *value=uniforms[name];INPUT([value isKindOfClass:NSNumber.class]&&isfinite(value.floatValue),@"Diagnostic uniform value invalid");glUniform1f(glGetUniformLocation(program,name.UTF8String),value.floatValue);}
    const uint32_t next=1-current;glBindTexture(GL_TEXTURE_2D,textures[current]);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,textures[next],0);RUNTIME(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"Diagnostic framebuffer incomplete");glDrawArrays(GL_TRIANGLE_STRIP,0,4);RUNTIME(glGetError()==GL_NO_ERROR,@"Diagnostic source pass failed");current=next;
   }
   glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,textures[current],0);NSMutableData *state=[NSMutableData dataWithLength:(NSUInteger)bytes];glReadPixels(0,0,size,size,GL_RGBA,GL_FLOAT,state.mutableBytes);RUNTIME(glGetError()==GL_NO_ERROR,@"Diagnostic state readback failed");
   [timings addObject:@(CFAbsoluteTimeGetCurrent()-start)];customWrite([output stringByAppendingPathComponent:[NSString stringWithFormat:@"frame-%u.bin",index++]],state);
  }
  facts[@"frameSecondsIncludingReadback"]=timings;facts[@"frames"]=@(frames.count);facts[@"status"]=@"observed";result=0;
 }@catch(NSException *e){facts[@"error"]=@{@"kind":e.name,@"message":e.reason?:@"custom diagnostic failed"};}
 @finally{
  @try{if(context){glBindFramebuffer(GL_FRAMEBUFFER,0);glBindVertexArray(0);glUseProgram(0);glBindBuffer(GL_ARRAY_BUFFER,0);glBindTexture(GL_TEXTURE_2D,0);
   // The process owns this context. Never silently clear a failed delete.
   #define CUSTOM_DROP(handle,call) if(handle){call;RUNTIME(glGetError()==GL_NO_ERROR,@"Diagnostic cleanup failed");handle=0;}
   for(int i=0;i<2;i++){CUSTOM_DROP(shaders[i],glDeleteShader(shaders[i]));CUSTOM_DROP(textures[i],glDeleteTextures(1,&textures[i]));}
   CUSTOM_DROP(program,glDeleteProgram(program));CUSTOM_DROP(vao,glDeleteVertexArrays(1,&vao));CUSTOM_DROP(quad,glDeleteBuffers(1,&quad));CUSTOM_DROP(framebuffer,glDeleteFramebuffers(1,&framebuffer));
   #undef CUSTOM_DROP
   facts[@"handlesAfterDelete"]=@0;
  }}@catch(NSException *e){facts[@"cleanupError"]=e.reason?:@"cleanup failed";result=1;}
  @try{destroyContext(&context);facts[@"contextReleased"]=@YES;}@catch(NSException *e){facts[@"contextError"]=e.reason?:@"context cleanup failed";result=1;}
 }
 if(result)facts[@"status"]=@"failed";
 NSData *json=[NSJSONSerialization dataWithJSONObject:facts options:NSJSONWritingPrettyPrinted error:NULL];if(json)fwrite(json.bytes,1,json.length,stdout);return result;
}}
