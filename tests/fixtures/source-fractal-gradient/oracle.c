/* Original MathArt classes, pure numerical JNI calls, no graphics constructor. */
#include "jni.h"
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <math.h>
#include <string.h>
static JNIEnv *e;static jclass fc,gc,rc,cc,mc,ic,ac,stc,spc,frc;static jobject fractal,animator,start,stop;
static void ck(const char*s){if((*e)->ExceptionCheck(e)){fprintf(stderr,"FAIL %s\n",s);(*e)->ExceptionDescribe(e);exit(2);}}
static jclass cls(const char*s){jclass c=(*e)->FindClass(e,s);ck(s);return c;}
static jmethodID met(jclass c,const char*n,const char*d){jmethodID m=(*e)->GetMethodID(e,c,n,d);ck(n);return m;}
static jfieldID fld(jclass c,const char*n,const char*d){jfieldID f=(*e)->GetFieldID(e,c,n,d);ck(n);return f;}
static void num(double d){uint64_t b;memcpy(&b,&d,8);if(isfinite(d))printf("{\"value\":%.17g,\"bits\":\"%016llx\"}",d,(unsigned long long)b);else printf("{\"value\":\"%s\",\"bits\":\"%016llx\"}",isnan(d)?"NaN":d>0?"Infinity":"-Infinity",(unsigned long long)b);}
static void fnum(float f){uint32_t b;memcpy(&b,&f,4);printf("{\"value\":%.17g,\"bits\":\"%08x\"}",(double)f,b);}
static double gd(jobject o,jclass c,const char*n){return (*e)->GetDoubleField(e,o,fld(c,n,"D"));}
static void snapshot(const char*label,jobject animation){
 jobject state=(*e)->CallObjectMethod(e,animator,met(gc,"snapshot","()Lmathart/animation/gradient/GradientRuntimeState;"));
 printf("{\"operation\":\"%s\",\"running\":%s,\"progress\":",label,(*e)->CallBooleanMethod(e,animator,met(gc,"isRunning","()Z"))?"true":"false");num(gd(state,rc,"progress"));printf(",\"speedScale\":");num(gd(state,rc,"speedScale"));printf(",\"targetSpeed\":");num(gd(state,rc,"targetSpeed"));
 printf(",\"base\":[");const char*bn[]={"basePaletteOffset","baseInsideOffset","baseOutsideOffset"};for(int i=0;i<3;i++){if(i)putchar(',');num(gd(state,rc,bn[i]));}printf("],\"frame\":[");jobject frame=(*e)->CallObjectMethod(e,state,met(rc,"buildFrame","()Lmathart/animation/gradient/GradientFrame;"));const char*fn[]={"paletteOffset","insideGradientOffset","outsideGradientOffset"};for(int i=0;i<3;i++){if(i)putchar(',');num((*e)->CallDoubleMethod(e,frame,met(frc,fn[i],"()D")));}printf("],\"applied\":[");for(int i=0;i<3;i++){if(i)putchar(',');fnum((*e)->GetFloatField(e,fractal,fld(fc,fn[i],"F")));}printf("],\"dirty\":%s",(*e)->GetBooleanField(e,fractal,fld(fc,"gradientDirty","Z"))?"true":"false");if(animation){printf(",\"animation\":{\"runtime\":");fnum((*e)->GetFloatField(e,animation,fld(ac,"runTime","F")));printf(",\"started\":%s,\"finished\":%s}",(*e)->GetBooleanField(e,animation,fld(ac,"isStarted","Z"))?"true":"false",(*e)->GetBooleanField(e,animation,fld(ac,"isFinished","Z"))?"true":"false");}putchar('}');ck("snapshot");
}
static void clean(){(*e)->SetBooleanField(e,fractal,fld(fc,"gradientDirty","Z"),JNI_FALSE);}
static void animstep(jobject a,float dt,const char*label){clean();(*e)->CallVoidMethod(e,a,met(ac,"update","(F)V"),dt);ck(label);putchar(',');snapshot(label,a);}
static void tick(float dt,const char*label){clean();(*e)->CallVoidMethod(e,animator,met(gc,"update","(F)V"),dt);ck(label);putchar(',');snapshot(label,NULL);}
static void linear(jobject a){jclass ec=cls("mathart/animation/Easings");jobject ease=(*e)->CallStaticObjectMethod(e,ec,(*e)->GetStaticMethodID(e,ec,"getByName","(Ljava/lang/String;)Lmathart/animation/Easings$EasingFunction;"),(*e)->NewStringUTF(e,"LINEAR"));(*e)->SetObjectField(e,a,fld(ac,"easing","Lmathart/animation/Easings$EasingFunction;"),ease);ck("linear");}
static void run(const char*mode,const char*interpolation,int inside,int outside,int id){
 (*e)->PushLocalFrame(e,2048);fractal=(*e)->AllocObject(e,fc);(*e)->CallVoidMethod(e,fractal,met(fc,"setGradientOffsets","(DDD)V"),.123456789,-.234567891,1.345678912);ck("initial offsets");animator=(*e)->NewObject(e,gc,met(gc,"<init>","(Lmathart/animation/gradient/GradientTarget;)V"),fractal);
 jobject gm=(*e)->GetStaticObjectField(e,mc,(*e)->GetStaticFieldID(e,mc,mode,"Lmathart/animation/gradient/GradientActionConfig$GradientMode;")),gi=(*e)->GetStaticObjectField(e,ic,(*e)->GetStaticFieldID(e,ic,interpolation,"Lmathart/animation/gradient/GradientActionConfig$ColorInterpolation;"));
 jobject config=(*e)->NewObject(e,cc,met(cc,"<init>","(Lmathart/animation/gradient/GradientActionConfig$GradientMode;DLmathart/animation/gradient/GradientActionConfig$ColorInterpolation;ZZ)V"),gm,137.25,gi,inside?JNI_TRUE:JNI_FALSE,outside?JNI_TRUE:JNI_FALSE);
 start=(*e)->NewObject(e,stc,met(stc,"<init>","(Lmathart/animation/gradient/GradientAnimator;Lmathart/animation/gradient/GradientActionConfig;F)V"),animator,config,1.0);linear(start);
 printf("{\"id\":%d,\"mode\":\"%s\",\"interpolation\":\"%s\",\"inside\":%s,\"outside\":%s,\"speed\":137.25,\"initialInput\":[0.123456789,-0.234567891,1.345678912],\"samples\":[",id,mode,interpolation,inside?"true":"false",outside?"true":"false");clean();snapshot("initial",NULL);
 animstep(start,0,"start.update(0)");animstep(start,.25f,"start.update(.25)");tick(.125f,"animator.update(.125)");animstep(start,.75f,"start.update(.75)");tick(2.75f,"animator.update(2.75)");tick(0,"animator.update(0)");tick(-.25f,"animator.update(-.25)");
 stop=(*e)->NewObject(e,spc,met(spc,"<init>","(Lmathart/animation/gradient/GradientAnimator;F)V"),animator,.5);linear(stop);animstep(stop,.125f,"stop.update(.125)");tick(.2f,"animator.update(.2)");animstep(stop,.375f,"stop.update(.375)");tick(.5f,"stopped animator.update(.5)");
 jobject idle=(*e)->NewObject(e,spc,met(spc,"<init>","(Lmathart/animation/gradient/GradientAnimator;F)V"),animator,.5);linear(idle);animstep(idle,.25f,"idle stop.update(.25)");
 clean();(*e)->CallVoidMethod(e,animator,met(gc,"start","(Lmathart/animation/gradient/GradientActionConfig;)V"),config);ck("restart");putchar(',');snapshot("direct restart",NULL);
 printf("]}");(*e)->PopLocalFrame(e,NULL);
}
int main(int argc,char**argv){if(argc!=3)return 1;void*lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib){fputs(dlerror(),stderr);return 1;}jint(*create)(JavaVM**,void**,void*)=dlsym(lib,"JNI_CreateJavaVM");char*cp=malloc(strlen(argv[2])+24);sprintf(cp,"-Djava.class.path=%s",argv[2]);JavaVMOption opts[]={{cp,0},{"-Djava.awt.headless=true",0},{"-Xmx256m",0}};JavaVMInitArgs args={JNI_VERSION_1_8,3,opts,JNI_FALSE};JavaVM*vm;if(create(&vm,(void**)&e,&args))return 2;
 jclass lc=cls("org/apache/logging/log4j/core/config/Configurator"),ll=cls("org/apache/logging/log4j/Level");(*e)->CallStaticVoidMethod(e,lc,(*e)->GetStaticMethodID(e,lc,"setRootLevel","(Lorg/apache/logging/log4j/Level;)V"),(*e)->GetStaticObjectField(e,ll,(*e)->GetStaticFieldID(e,ll,"OFF","Lorg/apache/logging/log4j/Level;")));ck("quiet logging");
 fc=cls("mathart/fractal/ComplexFractalMobject");gc=cls("mathart/animation/gradient/GradientAnimator");rc=cls("mathart/animation/gradient/GradientRuntimeState");cc=cls("mathart/animation/gradient/GradientActionConfig");mc=cls("mathart/animation/gradient/GradientActionConfig$GradientMode");ic=cls("mathart/animation/gradient/GradientActionConfig$ColorInterpolation");ac=cls("mathart/animation/Animation");stc=cls("mathart/animation/gradient/StartGradientAnimation");spc=cls("mathart/animation/gradient/StopGradientAnimation");frc=cls("mathart/animation/gradient/GradientFrame");
 const char*modes[]={"HUE_ROTATE","OFFSET_CYCLE","CROSS_FADE","PALETTE_MORPH"};puts("REA_ORACLE_JSON");puts("[");int id=0;for(int m=0;m<4;m++)for(int f=0;f<4;f++){if(id)putchar(',');run(modes[m],"RGB",f&1,f&2,id++);}const char*interp[]={"LINEAR","OKLAB","OKLCH"};for(int i=0;i<3;i++){putchar(',');run("PALETTE_MORPH",interp[i],1,1,id++);}puts("]");fflush(stdout);(*vm)->DestroyJavaVM(vm);return 0;}
