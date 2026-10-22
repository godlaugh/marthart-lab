/* Execute original JSON parser, CPU scene constructors and Scene.update. No draw/window. */
#include "jni.h"
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
static JNIEnv *e;
static void ck(const char*s){if((*e)->ExceptionCheck(e)){fprintf(stderr,"FAIL %s\n",s);(*e)->ExceptionDescribe(e);exit(2);}}
static jclass cls(const char*s){jclass c=(*e)->FindClass(e,s);ck(s);return c;}
static jmethodID met(jclass c,const char*n,const char*d){jmethodID m=(*e)->GetMethodID(e,c,n,d);ck(n);return m;}
static jfieldID fld(jclass c,const char*n,const char*d){jfieldID f=(*e)->GetFieldID(e,c,n,d);ck(n);return f;}
static void obj(jobject o,jclass c,const char*n,const char*d,jobject v){(*e)->SetObjectField(e,o,fld(c,n,d),v);ck(n);}
static void sf(jobject o,jclass c,const char*n,float v){(*e)->SetFloatField(e,o,fld(c,n,"F"),v);ck(n);}
static void number(double d){uint64_t bits;memcpy(&bits,&d,8);if(!isfinite(d)){fprintf(stderr,"nonfinite snapshot\n");exit(3);}printf("{\"value\":%.17g,\"bits\":\"%016llx\"}",d,(unsigned long long)bits);}
static jclass pc,sc,base,ps,cc,jc,managerc,camc,functionc;
static jobject scene,applet,initialSurface;
static float gf(jobject o,jclass c,const char*n){float v=(*e)->GetFloatField(e,o,fld(c,n,"F"));ck(n);return v;}
static jobject go(jobject o,jclass c,const char*n,const char*d){jobject v=(*e)->GetObjectField(e,o,fld(c,n,d));ck(n);return v;}
static jobject getj(jobject o,const char*n){return (*e)->CallObjectMethod(e,o,met(jc,"getJSONObject","(Ljava/lang/String;)Lprocessing/data/JSONObject;"),(*e)->NewStringUTF(e,n));}
static jobject geta(jobject o,const char*n){return (*e)->CallObjectMethod(e,o,met(jc,"getJSONArray","(Ljava/lang/String;)Lprocessing/data/JSONArray;"),(*e)->NewStringUTF(e,n));}
static jobject at(jobject a,int i){return (*e)->CallObjectMethod(e,a,met(cls("processing/data/JSONArray"),"getJSONObject","(I)Lprocessing/data/JSONObject;"),i);}
static int size(jobject a){return (*e)->CallIntMethod(e,a,met(cls("processing/data/JSONArray"),"size","()I"));}
static void rawjson(jobject o){jstring s=(*e)->CallObjectMethod(e,o,met(jc,"toString","()Ljava/lang/String;"));const char*t=(*e)->GetStringUTFChars(e,s,0);fputs(t,stdout);(*e)->ReleaseStringUTFChars(e,s,t);}
static void snapshot(void){
 jobject surface=(*e)->CallObjectMethod(e,scene,met(sc,"getSurface","()Lmathart/surface/ParametricSurface;")),function=(*e)->CallObjectMethod(e,surface,met(ps,"getSurfaceFunction","()Lmathart/surface/math/SurfaceFunction;"));
 jobject originalFunction=(*e)->CallObjectMethod(e,initialSurface,met(ps,"getSurfaceFunction","()Lmathart/surface/math/SurfaceFunction;"));
 jobject manager=go(scene,base,"manager","Lmathart/scene/SceneManager;"),camera=(*e)->CallObjectMethod(e,scene,met(base,"getCamera","()Lmathart/scene/CameraController;"));
 printf("{\"sceneTime\":%.17g,\"rawDt\":%.17g,\"queueIndex\":%d,\"queueComplete\":%s,\"remaining\":%.17g,\"objectTime\":%.17g,\"initialObjectTime\":%.17g,\"initialObjectStillCurrent\":%s,\"overlayAlpha\":%.17g,\"value\":",(double)gf(scene,base,"time"),(double)gf(scene,base,"frameDeltaTime"),(*e)->GetIntField(e,manager,fld(managerc,"currentIndex","I")),(*e)->CallBooleanMethod(e,manager,met(managerc,"isFinished","()Z"))?"true":"false",(double)(*e)->CallFloatMethod(e,manager,met(managerc,"getRemainingDuration","()F")),(double)gf(surface,ps,"currentAnimationTime"),(double)gf(initialSurface,ps,"currentAnimationTime"),(*e)->IsSameObject(e,surface,initialSurface)?"true":"false",(double)gf(scene,sc,"transitionOverlayAlpha"));
 number((*e)->CallDoubleMethod(e,function,met(functionc,"getParameter","(Ljava/lang/String;)D"),(*e)->NewStringUTF(e,"a")));printf(",\"initialValue\":");number((*e)->CallDoubleMethod(e,originalFunction,met(functionc,"getParameter","(Ljava/lang/String;)D"),(*e)->NewStringUTF(e,"a")));
 jobject mode=(*e)->CallObjectMethod(e,scene,met(sc,"getCurrentSurfaceMode","()Lmathart/surface/config/SurfaceMode;"));jstring modeName=(*e)->CallObjectMethod(e,mode,met(cls("java/lang/Enum"),"name","()Ljava/lang/String;"));const char*modeText=(*e)->GetStringUTFChars(e,modeName,0);printf(",\"mode\":\"%s\"",modeText);(*e)->ReleaseStringUTFChars(e,modeName,modeText);
 printf(",\"camera\":{");const char*fields[]={"phi","theta","gamma","zoom","focalDistance","phiRate","thetaRate","gammaRate"};for(int i=0;i<8;i++){if(i)putchar(',');printf("\"%s\":%.17g",fields[i],(double)gf(camera,camc,fields[i]));}printf("},\"firstPosition\":");
 jobjectArray particles=go(surface,ps,"particles","[Lmathart/mobject/Dot3D;");int count=particles?(*e)->GetArrayLength(e,particles):0;if(count){jobject dot=(*e)->GetObjectArrayElement(e,particles,0),pos=go(dot,cls("mathart/mobject/Dot3D"),"pos","Lprocessing/core/PVector;");jclass pv=cls("processing/core/PVector");printf("[%.17g,%.17g,%.17g]",(double)gf(pos,pv,"x"),(double)gf(pos,pv,"y"),(double)gf(pos,pv,"z"));}else printf("null");printf(",\"particleCount\":%d}",count);ck("snapshot");
}
int main(int argc,char**argv){
 if(argc!=4)return 1;void*lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib){fputs(dlerror(),stderr);return 1;}jint(*create)(JavaVM**,void**,void*)=dlsym(lib,"JNI_CreateJavaVM");if(!create)return 1;
 char*cp=malloc(strlen(argv[2])+24);sprintf(cp,"-Djava.class.path=%s",argv[2]);JavaVMOption opts[]={{cp,0},{"-Djava.awt.headless=true",0},{"-Xmx256m",0}};JavaVMInitArgs args={JNI_VERSION_1_8,3,opts,JNI_FALSE};JavaVM*vm;if(create(&vm,(void**)&e,&args))return 2;
 jclass lc=cls("org/apache/logging/log4j/core/config/Configurator"),ll=cls("org/apache/logging/log4j/Level");(*e)->CallStaticVoidMethod(e,lc,(*e)->GetStaticMethodID(e,lc,"setRootLevel","(Lorg/apache/logging/log4j/Level;)V"),(*e)->GetStaticObjectField(e,ll,(*e)->GetStaticFieldID(e,ll,"OFF","Lorg/apache/logging/log4j/Level;")));ck("quiet logging");

 pc=cls("processing/core/PApplet");sc=cls("mathart/surface/GenericSurfaceScene");base=cls("mathart/scene/Scene");ps=cls("mathart/surface/ParametricSurface");cc=cls("mathart/surface/config/JsonSurfaceConfig");jc=cls("processing/data/JSONObject");managerc=cls("mathart/scene/SceneManager");camc=cls("mathart/scene/CameraController");functionc=cls("mathart/surface/math/SurfaceFunction");
 jclass bytes=cls("java/io/ByteArrayOutputStream"),stream=cls("java/io/PrintStream"),system=cls("java/lang/System");jobject log=(*e)->NewObject(e,bytes,met(bytes,"<init>","()V")),sink=(*e)->NewObject(e,stream,met(stream,"<init>","(Ljava/io/OutputStream;)V"),log);(*e)->CallStaticVoidMethod(e,system,(*e)->GetStaticMethodID(e,system,"setOut","(Ljava/io/PrintStream;)V"),sink);ck("capture original stdout");
 FILE*file=fopen(argv[3],"rb");if(!file)return 4;fseek(file,0,SEEK_END);long n=ftell(file);rewind(file);if(n<1||n>1000000)return 4;char*text=calloc(n+1,1);if(fread(text,1,n,file)!=(size_t)n)return 4;fclose(file);
 jmethodID parse=(*e)->GetStaticMethodID(e,jc,"parse","(Ljava/lang/String;)Lprocessing/data/JSONObject;");jobject doc=(*e)->CallStaticObjectMethod(e,jc,parse,(*e)->NewStringUTF(e,text));ck("case file");free(text);jobject cases=geta(doc,"cases");int length=size(cases);
 puts("REA_SURFACE_SCENE_JSON");printf("{\"cases\":[");
 for(int k=0;k<length;k++){
  (*e)->PushLocalFrame(e,4096);jobject c=at(cases,k),project=getj(c,"project"),steps=geta(c,"steps");
  jboolean editCase=(*e)->CallBooleanMethod(e,c,met(jc,"getBoolean","(Ljava/lang/String;Z)Z"),(*e)->NewStringUTF(e,"parameterEdits"),JNI_FALSE);
  jboolean recordingCase=(*e)->CallBooleanMethod(e,c,met(jc,"getBoolean","(Ljava/lang/String;Z)Z"),(*e)->NewStringUTF(e,"recording"),JNI_FALSE);
  applet=(*e)->NewObject(e,pc,met(pc,"<init>","()V"));jclass pg=cls("processing/core/PGraphics");jobject graphics=(*e)->NewObject(e,pg,met(pg,"<init>","()V"));obj(applet,pc,"g","Lprocessing/core/PGraphics;",graphics);
  jobject config=(*e)->NewObject(e,cc,met(cc,"<init>","(Lprocessing/core/PApplet;Lprocessing/data/JSONObject;)V"),applet,project);ck("original config parse");
  scene=(*e)->NewObject(e,sc,met(sc,"<init>","(Lprocessing/core/PApplet;Lmathart/surface/config/SurfaceConfig;Z)V"),applet,config,JNI_FALSE);(*e)->CallVoidMethod(e,scene,met(sc,"construct","()V"));ck("original scene construct");jobject failure=go(scene,base,"initializationError","Ljava/lang/Exception;");if(failure){(*e)->Throw(e,failure);ck("scene initialization error");}
  initialSurface=(*e)->CallObjectMethod(e,scene,met(sc,"getSurface","()Lmathart/surface/ParametricSurface;"));float recordingFps=recordingCase?(*e)->CallFloatMethod(e,c,met(jc,"getFloat","(Ljava/lang/String;)F"),(*e)->NewStringUTF(e,"simulationFps")):10.0f;(*e)->CallVoidMethod(e,scene,met(base,"setRenderMode","(F)V"),recordingFps);ck("original render mode");
  jclass controllerClass=NULL;jobject controller=NULL;if(editCase){controllerClass=cls("mathart/MathArt");controller=(*e)->AllocObject(e,controllerClass);obj(controller,controllerClass,"currentScene","Lmathart/scene/Scene;",scene);}
  if(k)putchar(',');printf("{\"input\":");rawjson(c);printf(",\"initial\":");snapshot();printf(",\"frames\":[");
  for(int i=0;i<size(steps);i++){
   (*e)->PushLocalFrame(e,256);jobject step=at(steps,i);float dt=(*e)->CallFloatMethod(e,step,met(jc,"getFloat","(Ljava/lang/String;)F"),(*e)->NewStringUTF(e,"dt")),fps=(*e)->CallFloatMethod(e,step,met(jc,"getFloat","(Ljava/lang/String;)F"),(*e)->NewStringUTF(e,"actualFrameRate"));jboolean paused=(*e)->CallBooleanMethod(e,step,met(jc,"getBoolean","(Ljava/lang/String;)Z"),(*e)->NewStringUTF(e,"paused"));if(i)putchar(',');
   if(editCase){
    printf("{\"before\":");snapshot();
    jboolean hasEdit=(*e)->CallBooleanMethod(e,step,met(jc,"hasKey","(Ljava/lang/String;)Z"),(*e)->NewStringUTF(e,"edit"));
    if(hasEdit){jobject edit=getj(step,"edit");jstring name=(*e)->CallObjectMethod(e,edit,met(jc,"getString","(Ljava/lang/String;)Ljava/lang/String;"),(*e)->NewStringUTF(e,"name"));double value=(*e)->CallDoubleMethod(e,edit,met(jc,"getDouble","(Ljava/lang/String;)D"),(*e)->NewStringUTF(e,"value"));(*e)->CallVoidMethod(e,controller,met(controllerClass,"updateParameter","(Ljava/lang/String;D)V"),name,value);ck("original MathArt.updateParameter");}
    printf(",\"afterEdit\":");snapshot();printf(",\"updated\":");
   }
   if(!recordingCase)sf(scene,base,"renderStep",dt);sf(applet,pc,"frameRate",fps);(*e)->CallVoidMethod(e,scene,met(base,"update","(Z)V"),paused);ck("original Scene update");
   if(recordingCase)printf("{\"state\":");snapshot();jboolean complete=JNI_FALSE;
   if(recordingCase){complete=(*e)->CallBooleanMethod(e,scene,met(base,"isAutoRecordingComplete","()Z"));ck("original auto recording completion");printf(",\"autoComplete\":%s}",complete?"true":"false");}
   if(editCase)putchar('}');(*e)->PopLocalFrame(e,0);if(recordingCase&&complete)break;
  }
  printf("]");if(recordingCase){printf(",\"beforeStop\":");snapshot();(*e)->CallVoidMethod(e,scene,met(base,"disableRenderMode","()V"));ck("original disable render mode");printf(",\"afterStop\":");snapshot();}printf("}");(*e)->PopLocalFrame(e,0);
 }
 printf("],\"capturedLog\":");jstring logged=(*e)->CallObjectMethod(e,log,met(bytes,"toString","()Ljava/lang/String;"));jobject holder=(*e)->NewObject(e,jc,met(jc,"<init>","()V"));(*e)->CallObjectMethod(e,holder,met(jc,"setString","(Ljava/lang/String;Ljava/lang/String;)Lprocessing/data/JSONObject;"),(*e)->NewStringUTF(e,"text"),logged);rawjson(holder);puts("}");fflush(stdout);(*vm)->DestroyJavaVM(vm);free(cp);return 0;
}
