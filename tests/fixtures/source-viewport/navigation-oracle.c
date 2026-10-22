/* Original shipped methods through JNI, synthetic objects, no constructor/main/window.
   PApplet.loop/noLoop/redraw bytecode inspected: flags only; no render thread created. */
#include "jni.h"
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
static JNIEnv*e;static jclass host,cam,vec,map,sym,surface,cfg,event;
static void ck(const char*s){if((*e)->ExceptionCheck(e)){fprintf(stderr,"FAIL %s\n",s);(*e)->ExceptionDescribe(e);exit(2);}}
static jclass cls(const char*s){jclass c=(*e)->FindClass(e,s);ck(s);return c;}
static jfieldID fld(jclass c,const char*n,const char*d){jfieldID f=(*e)->GetFieldID(e,c,n,d);ck(n);return f;}
static jmethodID met(jclass c,const char*n,const char*d){jmethodID m=(*e)->GetMethodID(e,c,n,d);ck(n);return m;}
static void sf(jobject o,jclass c,const char*n,float f){(*e)->SetFloatField(e,o,fld(c,n,"F"),f);}
static void si(jobject o,jclass c,const char*n,int i){(*e)->SetIntField(e,o,fld(c,n,"I"),i);}
static void sb(jobject o,jclass c,const char*n,int b){(*e)->SetBooleanField(e,o,fld(c,n,"Z"),b);}
static void so(jobject o,jclass c,const char*n,const char*d,jobject v){(*e)->SetObjectField(e,o,fld(c,n,d),v);}
static float gf(jobject o,jclass c,const char*n){return (*e)->GetFloatField(e,o,fld(c,n,"F"));}
static uint32_t bits(float f){uint32_t b;memcpy(&b,&f,4);return b;}
static jobject camera,center,scene,sketch;
static void state(){printf("{\"floatBits\":[%u,%u,%u,%u,%u,%u,%u],\"paused\":%s,\"redraw\":%s,\"looping\":%s}",bits(gf(camera,cam,"phi")),bits(gf(camera,cam,"theta")),bits(gf(camera,cam,"gamma")),bits(gf(camera,cam,"zoom")),bits(gf(center,vec,"x")),bits(gf(center,vec,"y")),bits(gf(center,vec,"z")),(*e)->GetBooleanField(e,sketch,fld(host,"isPaused","Z"))?"true":"false",(*e)->GetBooleanField(e,sketch,fld(host,"redraw","Z"))?"true":"false",(*e)->GetBooleanField(e,sketch,fld(host,"looping","Z"))?"true":"false");}
static void init(int dimension,float zoom){
 sketch=(*e)->AllocObject(e,host);camera=(*e)->AllocObject(e,cam);center=(*e)->AllocObject(e,vec);scene=NULL;
 // dimension == -2/-3 selects Map, zero selects Symmetry below.
 if(dimension<0){scene=(*e)->AllocObject(e,map);jobject config=(*e)->AllocObject(e,cfg);si(config,cfg,"dimension",-dimension);so(scene,map,"config","Lmathart/mapattractor/config/MapAttractorConfig;",config);}else scene=(*e)->AllocObject(e,dimension==4?surface:sym);
 so(camera,cam,"center","Lprocessing/core/PVector;",center);so(scene,dimension<0?map:dimension==4?surface:sym,"cam","Lmathart/scene/CameraController;",camera);so(sketch,host,"currentScene","Lmathart/scene/Scene;",scene);
 sf(camera,cam,"phi",.25f);sf(camera,cam,"theta",-.75f);sf(camera,cam,"gamma",.125f);sf(camera,cam,"zoom",zoom);sf(center,vec,"x",1.25f);sf(center,vec,"y",-2.5f);sf(center,vec,"z",3.75f);
 jclass hc=cls("mathart/config/MathArtConfig");so(sketch,host,"config","Lmathart/config/MathArtConfig;",(*e)->AllocObject(e,hc));jclass st=cls("mathart/MathArt$InitState");jfieldID running=(*e)->GetStaticFieldID(e,st,"RUNNING","Lmathart/MathArt$InitState;");ck("RUNNING");so(sketch,host,"initStep","Lmathart/MathArt$InitState;",(*e)->GetStaticObjectField(e,st,running));
 sb(sketch,host,"isPaused",1);si(sketch,host,"width",640);si(sketch,host,"height",480);ck("initialize");
}
static void drag(int x,int y,int button){si(sketch,host,"mouseX",10);si(sketch,host,"mouseY",20);si(sketch,host,"mouseButton",button);(*e)->CallVoidMethod(e,sketch,met(host,"mousePressed","()V"));si(sketch,host,"mouseX",x);si(sketch,host,"mouseY",y);(*e)->CallVoidMethod(e,sketch,met(host,"mouseDragged","()V"));ck("drag");}
static void wheel(int count){jobject ev=(*e)->AllocObject(e,event);si(ev,event,"count",count);(*e)->CallVoidMethod(e,sketch,met(host,"mouseWheel","(Lprocessing/event/MouseEvent;)V"),ev);ck("wheel");}
int main(int argc,char**argv){
 if(argc!=3)return 1;void*lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib){fprintf(stderr,"%s\n",dlerror());return 1;}jint(*create)(JavaVM**,void**,void*)=dlsym(lib,"JNI_CreateJavaVM");char*cp=malloc(strlen(argv[2])+24);sprintf(cp,"-Djava.class.path=%s",argv[2]);JavaVMOption opts[]={{cp,0},{"-Djava.awt.headless=true",0},{"-Xmx256m",0}};JavaVMInitArgs args={JNI_VERSION_1_8,3,opts,JNI_FALSE};JavaVM*vm;if(create(&vm,(void**)&e,&args))return 2;
 host=cls("mathart/MathArt");cam=cls("mathart/scene/CameraController");vec=cls("processing/core/PVector");map=cls("mathart/mapattractor/GenericMapAttractorScene");sym=cls("mathart/symmetrychaos/GenericSymmetryChaosScene");surface=cls("mathart/surface/GenericSurfaceScene");cfg=cls("mathart/mapattractor/config/JsonMapAttractorConfig");event=cls("processing/event/MouseEvent");
 puts("REA_ORACLE_JSON");puts("[");int first=1;
 for(int kind=0;kind<4;kind++){(*e)->PushLocalFrame(e,256);init(kind==0?-2:kind==1?-3:kind==3?4:0,1.3f);if(!first)puts(",");first=0;printf("{\"id\":\"%s-resume\",\"dimension\":%d,\"input\":{\"start\":[10,20],\"end\":[47,-13],\"width\":640,\"height\":480,\"wheelCount\":-3,\"button\":39},\"initial\":",kind==0?"map2":kind==1?"map3":kind==3?"surface":"symmetry",kind==0?2:kind==1||kind==3?3:2);state();sb(sketch,host,"isPaused",0);sb(sketch,host,"looping",1);(*e)->CallVoidMethod(e,sketch,met(host,"togglePause","()V"));ck("pause");drag(47,-13,39);wheel(-3);printf(",\"navigated\":");state();(*e)->CallVoidMethod(e,sketch,met(host,"togglePause","()V"));ck("resume");printf(",\"resumed\":");state();puts("}");(*e)->PopLocalFrame(e,0);}
 int counts[]={0,1,-1,2,2147483647,(-2147483647-1)};
 for(int k=0;k<6;k++){(*e)->PushLocalFrame(e,128);init(0,k==3?.0101f:1.3f);printf(",{\"id\":\"wheel-%d\",\"input\":{\"count\":%d},\"initial\":",k,counts[k]);state();wheel(counts[k]);printf(",\"result\":");state();puts("}");(*e)->PopLocalFrame(e,0);}
 for(int k=0;k<3;k++){(*e)->PushLocalFrame(e,128);init(k==2?-2:0,1.3f);if(k==0)sb(sketch,host,"isPaused",0);if(k==1)sb(sketch,host,"fractalViewportPickMode",1);if(k==2){si(sketch,host,"width",0);si(sketch,host,"height",0);sf(camera,cam,"zoom",0);}printf(",{\"id\":\"%s\",\"initial\":",k==0?"running-guard":k==1?"pick-guard":"map2-degenerate");state();if(k!=1)drag(47,-13,37);else{si(sketch,host,"mouseX",47);si(sketch,host,"mouseY",-13);(*e)->CallVoidMethod(e,sketch,met(host,"mouseDragged","()V"));}if(k<2)wheel(-3);printf(",\"result\":");state();puts("}");(*e)->PopLocalFrame(e,0);}
 puts("]");fflush(stdout);(*vm)->DestroyJavaVM(vm);return 0;
}
