#ifndef SOURCE_CGL_ITERATED_PROGRAMS_H
#define SOURCE_CGL_ITERATED_PROGRAMS_H
// A complete six-program transaction owns every provisional GL handle. The
// ink owner registers this bundle before compilation and keeps it until every
// deletion succeeds, including after a failed preparation or atomic exchange.
static NSArray *iteratedInkProgramNames(void){return @[@"draw",@"statsFirst",@"statsReduce",@"present",@"presentReduce",@"decay"];}
// This is the native renderer's typed binding ABI, not shader-source parsing.
// Variants may link any subset, but cannot introduce an unbindable uniform.
// The shared producer supplies this union for source/local palettes and points/
// quads; fixed reduction and presentation bindings are owned by the renderer.
static NSDictionary *iteratedInkProgramAbi(int index){
 if(index==2)return @{@"values":@(GL_UNSIGNED_INT_SAMPLER_2D),@"sourceSize":@(GL_INT_VEC2)};
 if(index==3)return @{@"ink":@(GL_SAMPLER_2D),@"origin":@(GL_INT_VEC2),@"usePaletteLUT":@(GL_INT),@"backgroundRgb":@(GL_FLOAT_VEC3),@"displayRotation":@(GL_FLOAT),@"viewportAspect":@(GL_FLOAT),@"brightness":@(GL_FLOAT),@"contrast":@(GL_FLOAT),@"gamma":@(GL_FLOAT),@"dynamicRange":@(GL_FLOAT),@"saturation":@(GL_FLOAT),@"scale":@(GL_FLOAT)};
 if(index==4)return @{@"values":@(GL_UNSIGNED_INT_SAMPLER_2D),@"size":@(GL_INT_VEC2),@"reductionOrigin":@(GL_INT_VEC2)};
 if(index==5)return @{};
 NSMutableDictionary *abi=[@{@"scale":@(GL_FLOAT_VEC3),@"offset":@(GL_FLOAT_VEC3),@"turn":@(GL_FLOAT_VEC2),@"axes":@(GL_INT_VEC2),@"samilaNdc":@(GL_INT),@"samilaAspect":@(GL_FLOAT),@"samilaOffset":@(GL_FLOAT_VEC2),@"densitySplat":@(GL_BOOL),@"capturedCamera":@(GL_INT),@"capturedProjection":@(GL_FLOAT_MAT4),@"capturedModelView":@(GL_FLOAT_MAT4),@"states":@(GL_SAMPLER_2D),@"counters":@(GL_UNSIGNED_INT_SAMPLER_2D),@"size":@(GL_INT_VEC2),@"bounds":@(GL_FLOAT_VEC4),@"radius":@(GL_FLOAT),@"count":@(GL_INT)}mutableCopy];
 if(index==1)[abi addEntriesFromDictionary:@{@"sourceSize":@(GL_INT_VEC2),@"recording":@(GL_INT),@"sourcePointClip":@(GL_INT)}];
 else [abi addEntriesFromDictionary:@{@"stateWidth":@(GL_INT),@"particleOffset":@(GL_INT),@"metricMin":@(GL_FLOAT),@"metricMax":@(GL_FLOAT),@"metricRange":@(GL_FLOAT),@"metricMode":@(GL_INT),@"colorSpeed":@(GL_FLOAT),@"colorPhase":@(GL_FLOAT),@"paletteCycles":@(GL_FLOAT),@"paletteOffset":@(GL_FLOAT),@"colorMode":@(GL_INT),@"palette":@(GL_SAMPLER_2D),@"noisePermutation":@(GL_UNSIGNED_INT_SAMPLER_2D),@"mapCosine":@(GL_BOOL),@"quadSplat":@(GL_BOOL),@"symmetryLut":@(GL_BOOL),@"usePaletteLut":@(GL_BOOL),@"alpha":@(GL_FLOAT)}];return abi;
}
@interface SourceCglIteratedPrograms:NSObject {
 @public GLuint handles[6];
 @private GLuint _shaders[12];uint64_t _bytes;NSDictionary *_sources;BOOL _disposed;
}
@property(readonly) uint64_t retainedBytes;
-(instancetype)initWithSources:(NSDictionary*)sources;
-(void)prepareRecoverableInput:(BOOL)recoverable;
-(void)dispose;
@end
@implementation SourceCglIteratedPrograms
-(uint64_t)retainedBytes{return _disposed?0:_bytes;}
-(instancetype)initWithSources:(NSDictionary*)sources{
 self=[super init];if(!self)return nil;INPUT([sources isKindOfClass:NSDictionary.class],@"Iterated programs must be a record");NSMutableDictionary *snapshot=[NSMutableDictionary new];
 for(NSString *name in iteratedInkProgramNames()){NSDictionary *p=sources[name];INPUT([p isKindOfClass:NSDictionary.class],@"Iterated shader program must be a record");NSMutableDictionary *stages=[NSMutableDictionary new];for(NSString *stage in @[@"vertex",@"fragment"]){NSString *source=p[stage];INPUT([source isKindOfClass:NSString.class]&&[source hasPrefix:@"#version 410 core\n"]&&[source rangeOfString:@"\0"].location==NSNotFound,@"Iterated ink shader profile missing or contains NUL");NSUInteger bytes=[source lengthOfBytesUsingEncoding:NSUTF8StringEncoding];ensure(bytes<=Budget/3&&_bytes<=Budget-bytes*3,@"capacity",@"Iterated program sources exceed budget");_bytes+=bytes*3;stages[stage]=[source copy];}snapshot[name]=[stages copy];}
 _sources=[snapshot copy];return self;
}
-(void)checkGl{RUNTIME(glGetError()==GL_NO_ERROR,@"Iterated program transaction GL error");}
-(void)prepareRecoverableInput:(BOOL)recoverable{
 INPUT(!_disposed,@"Iterated program bundle disposed");
 NSArray *names=iteratedInkProgramNames();
 for(int i=0;i<6;i++){
  NSDictionary *p=_sources[names[i]];for(int s=0;s<2;s++){
   GLuint *shader=&_shaders[i*2+s];*shader=glCreateShader(s?GL_FRAGMENT_SHADER:GL_VERTEX_SHADER);[self checkGl];RUNTIME(*shader!=0,@"Iterated shader allocation failed");NSString *source=p[s?@"fragment":@"vertex"];const char *text=source.UTF8String;GLint length=(GLint)[source lengthOfBytesUsingEncoding:NSUTF8StringEncoding];glShaderSource(*shader,1,&text,&length);glCompileShader(*shader);GLint compiled=0;glGetShaderiv(*shader,GL_COMPILE_STATUS,&compiled);[self checkGl];
   if(!compiled){char log[8192]={0};glGetShaderInfoLog(*shader,sizeof(log),NULL,log);[self checkGl];ensure(NO,recoverable?@"input":@"runtime",[NSString stringWithUTF8String:log]?:@"Iterated shader compilation failed");}
  }
  handles[i]=glCreateProgram();[self checkGl];RUNTIME(handles[i]!=0,@"Iterated program allocation failed");glAttachShader(handles[i],_shaders[i*2]);glAttachShader(handles[i],_shaders[i*2+1]);glLinkProgram(handles[i]);GLint linked=0;glGetProgramiv(handles[i],GL_LINK_STATUS,&linked);[self checkGl];
  if(!linked){char log[8192]={0};glGetProgramInfoLog(handles[i],sizeof(log),NULL,log);[self checkGl];ensure(NO,recoverable?@"input":@"runtime",[NSString stringWithUTF8String:log]?:@"Iterated ink link failed");}
  GLint attributes=0;glGetProgramiv(handles[i],GL_ACTIVE_ATTRIBUTES,&attributes);[self checkGl];for(GLint a=0;a<attributes;a++){char name[128]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveAttrib(handles[i],a,sizeof(name),&length,&size,&type,name);[self checkGl];INPUT(size==1&&type==GL_INT&&(strcmp(name,"gl_VertexID")==0||strcmp(name,"gl_InstanceID")==0),@"Iterated render must not consume external vertex attributes");}
  NSDictionary *abi=iteratedInkProgramAbi(i);GLint uniforms=0;glGetProgramiv(handles[i],GL_ACTIVE_UNIFORMS,&uniforms);[self checkGl];
  for(GLint u=0;u<uniforms;u++){char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveUniform(handles[i],u,sizeof(name),&length,&size,&type,name);[self checkGl];INPUT(length>0&&length<1023&&size==1&&abi[@(name)]&&[abi[@(name)]unsignedIntValue]==type,([NSString stringWithFormat:@"Iterated %@ active uniform ABI differs: %s",names[i],name]));}
  NSString *output=i==3?@"pixel":i==4?@"total":i==5?@"color":@"result";GLint location=glGetFragDataLocation(handles[i],output.UTF8String),facts=i==3?glGetFragDataLocation(handles[i],"facts"):1;[self checkGl];INPUT(location==0&&facts==1,@"Iterated render output ABI differs");
  for(int s=0;s<2;s++){glDetachShader(handles[i],_shaders[i*2+s]);[self checkGl];glDeleteShader(_shaders[i*2+s]);[self checkGl];_shaders[i*2+s]=0;}
 }
}
-(void)dispose{
 if(_disposed)return;
 for(int i=0;i<6;i++)if(handles[i]){glDeleteProgram(handles[i]);[self checkGl];handles[i]=0;}
 for(int i=0;i<12;i++)if(_shaders[i]){glDeleteShader(_shaders[i]);[self checkGl];_shaders[i]=0;}
 _sources=nil;_disposed=YES;
}
@end
#endif
