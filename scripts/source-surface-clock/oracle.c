/* Execute original surface update/parameter methods; no constructors needing GL. */
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
static double mapValue(jobject animator,jclass ac,const char*field,jstring key){jobject map=(*e)->GetObjectField(e,animator,fld(ac,field,"Ljava/util/Map;"));jobject v=(*e)->CallObjectMethod(e,map,met(cls("java/util/Map"),"get","(Ljava/lang/Object;)Ljava/lang/Object;"),key);ck("map value");return v?(*e)->CallDoubleMethod(e,v,met(cls("java/lang/Double"),"doubleValue","()D")):0;}
int main(int argc,char**argv){
 if(argc!=3)return 1;void*lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib){fputs(dlerror(),stderr);return 1;}jint(*create)(JavaVM**,void**,void*)=dlsym(lib,"JNI_CreateJavaVM");if(!create)return 1;
 char*cp=malloc(strlen(argv[2])+24);sprintf(cp,"-Djava.class.path=%s",argv[2]);JavaVMOption opts[]={{cp,0},{"-Djava.awt.headless=true",0},{"-Xmx256m",0}};JavaVMInitArgs args={JNI_VERSION_1_8,3,opts,JNI_FALSE};JavaVM*vm;if(create(&vm,(void**)&e,&args))return 2;
 jclass lc=cls("org/apache/logging/log4j/core/config/Configurator"),ll=cls("org/apache/logging/log4j/Level");(*e)->CallStaticVoidMethod(e,lc,(*e)->GetStaticMethodID(e,lc,"setRootLevel","(Lorg/apache/logging/log4j/Level;)V"),(*e)->GetStaticObjectField(e,ll,(*e)->GetStaticFieldID(e,ll,"OFF","Lorg/apache/logging/log4j/Level;")));ck("quiet logging");
 jclass pc=cls("processing/core/PApplet"),sc=cls("mathart/surface/ParametricSurface"),mc=cls("mathart/surface/MeshSurface"),fc=cls("mathart/surface/math/JsonSurfaceFunction"),ac=cls("mathart/surface/SurfaceParameterAnimator"),hc=cls("java/util/HashMap"),dc=cls("java/lang/Double"),gc=cls("mathart/animation/gradient/GradientAnimator");
 const double initial[]={.25,.25,5,.25},step[]={.1,-.1,.1,.1},minimum[]={-1,-1,-1,2},maximum[]={1,1,1,2.0000001};
 const float rates[]={37,24,1,0,-2,29.97f,120,500,1,0},dts[]={.1f,.2f,0,-.1f,.1f,.1f,.25f,.1f,.05f,.05f};
 puts("REA_SURFACE_CLOCK_JSON");putchar('[');int counter=0;
 for(int kind=0;kind<3;kind++)for(int c=0;c<4;c++){
  (*e)->PushLocalFrame(e,4096);jobject applet=(*e)->AllocObject(e,pc),surface=(*e)->AllocObject(e,kind?mc:sc),map=(*e)->NewObject(e,hc,met(hc,"<init>","()V"));jstring key=(*e)->NewStringUTF(e,"a");
  jobject val=(*e)->NewObject(e,dc,met(dc,"<init>","(D)V"),initial[c]);(*e)->CallObjectMethod(e,map,met(hc,"put","(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;"),key,val);ck("initial parameters");
  jstring raw=(*e)->NewStringUTF(e,"a");jobject function=(*e)->NewObject(e,fc,met(fc,"<init>","(Lmathart/core/FastExpression;Lmathart/core/FastExpression;Lmathart/core/FastExpression;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/util/Map;)V"),NULL,NULL,NULL,raw,raw,raw,map);ck("original function constructor");
  obj(surface,sc,"p","Lprocessing/core/PApplet;",applet);obj(surface,sc,"surfaceFunc","Lmathart/surface/math/SurfaceFunction;",function);
  jobject animator=(*e)->NewObject(e,ac,met(ac,"<init>","(Lmathart/surface/ParametricSurface;)V"),surface);ck("original animator constructor");obj(surface,sc,"paramAnimator","Lmathart/surface/SurfaceParameterAnimator;",animator);
  jobject gradient=(*e)->NewObject(e,gc,met(gc,"<init>","(Lmathart/animation/gradient/GradientTarget;)V"),surface);ck("gradient constructor");obj(surface,sc,"gradientAnimator","Lmathart/animation/gradient/GradientAnimator;",gradient);
  if(kind)obj(surface,mc,"particles","[Lmathart/mobject/Dot3D;",(*e)->NewObjectArray(e,kind==2?0:1,cls("mathart/mobject/Dot3D"),NULL));
  (*e)->CallVoidMethod(e,animator,met(ac,"addParam","(Ljava/lang/String;DDD)V"),key,step[c],minimum[c],maximum[c]);(*e)->CallVoidMethod(e,animator,met(ac,"start","()V"));ck("original add/start");
  if(counter++)putchar(',');printf("{\"kind\":\"%s\",\"case\":%d,\"initial\":%.17g,\"step\":%.17g,\"min\":%.17g,\"max\":%.17g,\"initialPhase\":",kind==0?"points":kind==1?"mesh":"mesh-empty",c,initial[c],step[c],minimum[c],maximum[c]);number(mapValue(animator,ac,"currentPhases",key));printf(",\"frames\":[");float time=0;
  for(int i=0;i<10;i++){
   (*e)->PushLocalFrame(e,64);time+=dts[i];sf(applet,pc,"frameRate",rates[i]);(*e)->CallVoidMethod(e,surface,met(kind?mc:sc,"update","(FF)V"),time,dts[i]);ck("original surface update");if(i)putchar(',');printf("{\"time\":%.17g,\"dt\":%.17g,\"actualFrameRate\":%.17g,\"value\":",(double)time,(double)dts[i],(double)rates[i]);number((*e)->CallDoubleMethod(e,function,met(fc,"getParameter","(Ljava/lang/String;)D"),key));printf(",\"phase\":");number(mapValue(animator,ac,"currentPhases",key));printf(",\"animationTime\":%.17g}",(double)(*e)->GetFloatField(e,surface,fld(sc,"currentAnimationTime","F")));(*e)->PopLocalFrame(e,0);
  }
  printf("]}");(*e)->PopLocalFrame(e,0);
 }
 puts("]");fflush(stdout);(*vm)->DestroyJavaVM(vm);free(cp);return 0;
}
