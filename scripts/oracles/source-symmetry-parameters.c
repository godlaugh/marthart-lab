/* Original config builder, parameter children, animator and scalar target.
 * No Mobject.update/display, GL setup or application main. Each step begins all
 * supplied children, then advances each child, then the original animator. */
#include "jni.h"
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static JNIEnv *e;
static jclass json,arr,map,mc,ac,animation;
static void ck(const char*s){if((*e)->ExceptionCheck(e)){fprintf(stderr,"failed: %s\n",s);(*e)->ExceptionDescribe(e);exit(2);}}
static jstring str(const char*s){return (*e)->NewStringUTF(e,s);}
static jclass cl(const char*s){jclass c=(*e)->FindClass(e,s);ck(s);return c;}
static jmethodID mid(jclass c,const char*n,const char*s){jmethodID m=(*e)->GetMethodID(e,c,n,s);ck(n);return m;}
static jfieldID fid(jclass c,const char*n,const char*s){jfieldID f=(*e)->GetFieldID(e,c,n,s);ck(n);return f;}
static jobject obj(jclass c){jobject o=(*e)->NewObject(e,c,mid(c,"<init>","()V"));ck("constructor");return o;}
static int has(jobject o,const char*k){return (*e)->CallBooleanMethod(e,o,mid(json,"hasKey","(Ljava/lang/String;)Z"),str(k));}
static jobject get(jobject o,const char*k){jobject v=(*e)->CallObjectMethod(e,o,mid(json,"get","(Ljava/lang/String;)Ljava/lang/Object;"),str(k));ck(k);return v;}
static double num(jobject o,const char*k,double fallback){double v=(*e)->CallDoubleMethod(e,o,mid(json,"getDouble","(Ljava/lang/String;D)D"),str(k),fallback);ck(k);return v;}
static void number(jobject o,const char*k,double v){(*e)->CallObjectMethod(e,o,mid(json,"setDouble","(Ljava/lang/String;D)Lprocessing/data/JSONObject;"),str(k),v);ck(k);}
static void boolean(jobject o,const char*k,int v){(*e)->CallObjectMethod(e,o,mid(json,"setBoolean","(Ljava/lang/String;Z)Lprocessing/data/JSONObject;"),str(k),v);ck(k);}
static void member(jobject o,const char*k,jobject v){(*e)->CallObjectMethod(e,o,mid(json,"setJSONObject","(Ljava/lang/String;Lprocessing/data/JSONObject;)Lprocessing/data/JSONObject;"),str(k),v);ck(k);}
static void array(jobject o,const char*k,jobject v){(*e)->CallObjectMethod(e,o,mid(json,"setJSONArray","(Ljava/lang/String;Lprocessing/data/JSONArray;)Lprocessing/data/JSONObject;"),str(k),v);ck(k);}
static void append(jobject a,jobject o){(*e)->CallObjectMethod(e,a,mid(arr,"append","(Lprocessing/data/JSONObject;)Lprocessing/data/JSONArray;"),o);ck("append");}
static jobject item(jobject a,int i){return (*e)->CallObjectMethod(e,a,mid(arr,"getJSONObject","(I)Lprocessing/data/JSONObject;"),i);}
static int size(jobject a){return (*e)->CallIntMethod(e,a,mid(arr,"size","()I"));}
static jobject numericMap(jobject values){
 jobject out=obj(json),keys=(*e)->CallObjectMethod(e,values,mid(map,"keySet","()Ljava/util/Set;"));
 jobject it=(*e)->CallObjectMethod(e,keys,mid(cl("java/util/Set"),"iterator","()Ljava/util/Iterator;"));jclass iter=cl("java/util/Iterator"),dbl=cl("java/lang/Double");
 while((*e)->CallBooleanMethod(e,it,mid(iter,"hasNext","()Z"))){jstring key=(*e)->CallObjectMethod(e,it,mid(iter,"next","()Ljava/lang/Object;"));jobject v=(*e)->CallObjectMethod(e,values,mid(map,"get","(Ljava/lang/Object;)Ljava/lang/Object;"),key);double d=(*e)->CallDoubleMethod(e,v,mid(dbl,"doubleValue","()D"));(*e)->CallObjectMethod(e,out,mid(json,"setDouble","(Ljava/lang/String;D)Lprocessing/data/JSONObject;"),key,d);ck("numeric map");}
 return out;
}
static jobject definitions(jobject children){
 jobject out=obj(arr);jclass list=cl("java/util/List"),start=cl("mathart/symmetrychaos/animation/StartSymmetryChaosParamAnimation"),easings=cl("mathart/animation/Easings"),edge=cl("mathart/animation/OscillationEdgeEasing");
 jmethodID set=mid(json,"setString","(Ljava/lang/String;Ljava/lang/String;)Lprocessing/data/JSONObject;"),nameOf=(*e)->GetStaticMethodID(e,easings,"getName","(Lmathart/animation/Easings$EasingFunction;)Ljava/lang/String;");ck("easing name");
 int n=(*e)->CallIntMethod(e,children,mid(list,"size","()I"));
 for(int i=0;i<n;i++){
  jobject child=(*e)->CallObjectMethod(e,children,mid(list,"get","(I)Ljava/lang/Object;"),i),result=obj(json),scope=obj(json);jclass type=(*e)->GetObjectClass(e,child);int isStart=(*e)->IsInstanceOf(e,child,start);jstring name=(*e)->GetObjectField(e,child,fid(type,"paramName","Ljava/lang/String;"));
  (*e)->CallObjectMethod(e,result,set,str("kind"),str(isStart?"start":"stop"));(*e)->CallObjectMethod(e,scope,set,str("kind"),str(name?"named":"all"));if(name)(*e)->CallObjectMethod(e,scope,set,str("name"),name);member(result,"scope",scope);number(result,"duration",(*e)->GetFloatField(e,child,fid(animation,"duration","F")));
  jobject easing=(*e)->GetObjectField(e,child,fid(animation,"easing","Lmathart/animation/Easings$EasingFunction;"));(*e)->CallObjectMethod(e,result,set,str("easing"),(*e)->CallStaticObjectMethod(e,easings,nameOf,easing));
  if(isStart&&name){
   jobject config=obj(json),edgeConfig=obj(json);const char*keys[]={"min","max","step"};for(int k=0;k<3;k++){jobject value=(*e)->GetObjectField(e,child,fid(type,keys[k],"Ljava/lang/Double;"));number(config,keys[k],(*e)->CallDoubleMethod(e,value,mid(cl("java/lang/Double"),"doubleValue","()D")));}
   jobject value=(*e)->GetObjectField(e,child,fid(type,"edgeEasing","Lmathart/animation/OscillationEdgeEasing;"));
   if(value){number(edgeConfig,"window",(*e)->GetDoubleField(e,value,fid(edge,"windowRad","D")));number(edgeConfig,"floor",(*e)->GetDoubleField(e,value,fid(edge,"speedFloor","D")));jobject curve=(*e)->GetObjectField(e,value,fid(edge,"easing","Lmathart/animation/Easings$EasingFunction;"));(*e)->CallObjectMethod(e,edgeConfig,set,str("easing"),(*e)->CallStaticObjectMethod(e,easings,nameOf,curve));member(config,"edgeEasing",edgeConfig);}member(result,"configuration",config);
  }
  append(out,result);
 }
 return out;
}
static jobject snapshot(jobject mo,jobject animator,jobject children){
 jobject out=obj(json);member(out,"values",numericMap((*e)->GetObjectField(e,mo,fid(mc,"runtimeEquationParams","Ljava/util/LinkedHashMap;"))));
 member(out,"phases",numericMap((*e)->GetObjectField(e,animator,fid(ac,"scalarPhases","Ljava/util/Map;"))));member(out,"scales",numericMap((*e)->GetObjectField(e,animator,fid(ac,"stepScales","Ljava/util/Map;"))));
 boolean(out,"running",(*e)->CallBooleanMethod(e,animator,mid(ac,"isRunning","()Z")));number(out,"degree",(*e)->GetIntField(e,mo,fid(mc,"runtimeSymmetryDegree","I")));boolean(out,"shaderDirty",(*e)->GetBooleanField(e,mo,fid(mc,"updateShaderDirty","Z")));boolean(out,"replayPending",(*e)->GetBooleanField(e,mo,fid(mc,"replayRebuildPending","Z")));
 jobject states=obj(arr);jclass list=cl("java/util/List");int n=(*e)->CallIntMethod(e,children,mid(list,"size","()I"));for(int i=0;i<n;i++){jobject child=(*e)->CallObjectMethod(e,children,mid(list,"get","(I)Ljava/lang/Object;"),i),state=obj(json);number(state,"runtime",(*e)->GetFloatField(e,child,fid(animation,"runTime","F")));boolean(state,"finished",(*e)->GetBooleanField(e,child,fid(animation,"isFinished","Z")));append(states,state);}array(out,"children",states);return out;
}
int main(int argc,char**argv){
 if(argc!=4)return 1;
 void *lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib){fprintf(stderr,"%s\n",dlerror());return 1;}
 jint(*create)(JavaVM**,void**,void*)=dlsym(lib,"JNI_CreateJavaVM");if(!create)return 1;
 char*cp=malloc(strlen(argv[2])+24);if(!cp)return 1;sprintf(cp,"-Djava.class.path=%s",argv[2]);
 JavaVMOption opts[]={{cp,0},{"-Djava.awt.headless=true",0},{"-Xmx256m",0}};JavaVMInitArgs args={JNI_VERSION_1_8,3,opts,JNI_FALSE};JavaVM*vm;if(create(&vm,(void**)&e,&args)!=JNI_OK)return 2;
 FILE*f=fopen(argv[3],"rb");if(!f||fseek(f,0,SEEK_END))return 3;long length=ftell(f);if(length<0||length>4000000)return 3;rewind(f);char*text=calloc((size_t)length+1,1);if(!text||fread(text,1,(size_t)length,f)!=(size_t)length)return 3;fclose(f);
 json=cl("processing/data/JSONObject");arr=cl("processing/data/JSONArray");map=cl("java/util/Map");mc=cl("mathart/symmetrychaos/SymmetryChaosMobject");ac=cl("mathart/symmetrychaos/animation/SymmetryChaosParameterAnimator");animation=cl("mathart/animation/Animation");jclass cc=cl("mathart/symmetrychaos/config/JsonSymmetryChaosConfig"),list=cl("java/util/List"),arraylist=cl("java/util/ArrayList"),easings=cl("mathart/animation/Easings");
 jmethodID parse=(*e)->GetStaticMethodID(e,json,"parse","(Ljava/lang/String;)Lprocessing/data/JSONObject;");ck("parse method");jobject root=(*e)->CallStaticObjectMethod(e,json,parse,str(text));ck("input");jobject cases=get(root,"cases"),results=obj(arr);int count=size(cases);if(count<0||count>256)return 3;
 for(int c=0;c<count;c++){
  if((*e)->PushLocalFrame(e,8192))return 3;
  jobject row=item(cases,c),doc=get(row,"document"),cfg=(*e)->NewObject(e,cc,mid(cc,"<init>","(Lprocessing/core/PApplet;Lprocessing/data/JSONObject;)V"),obj(cl("processing/core/PApplet")),doc);ck("config");jobject mo=(*e)->NewObject(e,mc,mid(mc,"<init>","(Lprocessing/core/PApplet;Lmathart/symmetrychaos/config/SymmetryChaosConfig;)V"),NULL,cfg);ck("mobject");jobject animator=(*e)->CallObjectMethod(e,mo,mid(mc,"getParamAnimator","()Lmathart/symmetrychaos/animation/SymmetryChaosParameterAnimator;")),children=obj(arraylist),steps=get(row,"steps"),frames=obj(arr),out=obj(json);
  (*e)->CallObjectMethod(e,out,mid(json,"setString","(Ljava/lang/String;Ljava/lang/String;)Lprocessing/data/JSONObject;"),str("id"),get(row,"id"));member(out,"initial",snapshot(mo,animator,children));
  int total=size(steps);if(total<0||total>256)return 3;
  for(int k=0;k<total;k++){
   jobject step=item(steps,k);
   if(has(step,"actions")){
    children=obj(arraylist);jobject actions=get(step,"actions");int n=size(actions);if(n<0||n>64)return 3;
    for(int i=0;i<n;i++){
     jobject action=item(actions,i);jstring easing=has(action,"easing")?get(action,"easing"):str("LINEAR");const char*ename=(*e)->GetStringUTFChars(e,easing,0);jfieldID ef=(*e)->GetStaticFieldID(e,easings,ename,"Lmathart/animation/Easings$EasingFunction;");(*e)->ReleaseStringUTFChars(e,easing,ename);ck("easing");jobject ease=(*e)->GetStaticObjectField(e,easings,ef);
     jobject built=(*e)->CallObjectMethod(e,cfg,mid(cc,"buildParamActionAnimations","(Ljava/lang/String;Ljava/lang/Object;Lmathart/symmetrychaos/SymmetryChaosMobject;FLmathart/animation/Easings$EasingFunction;)Ljava/util/List;"),get(action,"method"),has(action,"args")?get(action,"args"):NULL,mo,(double)(jfloat)num(action,"duration",1),ease);ck("buildParamActionAnimations");(*e)->CallBooleanMethod(e,children,mid(list,"addAll","(Ljava/util/Collection;)Z"),built);ck("add children");
    }
    int nchildren=(*e)->CallIntMethod(e,children,mid(list,"size","()I"));if(nchildren>256)return 3;
    for(int i=0;i<nchildren;i++){jobject child=(*e)->CallObjectMethod(e,children,mid(list,"get","(I)Ljava/lang/Object;"),i);(*e)->CallVoidMethod(e,child,mid(animation,"start","()V"));ck("start child");}
   }
   double dt=num(step,"dt",0);int nchildren=(*e)->CallIntMethod(e,children,mid(list,"size","()I"));
   for(int i=0;i<nchildren;i++){jobject child=(*e)->CallObjectMethod(e,children,mid(list,"get","(I)Ljava/lang/Object;"),i);(*e)->CallVoidMethod(e,child,mid(animation,"update","(F)V"),(double)(jfloat)dt);ck("child update");}
   (*e)->CallVoidMethod(e,animator,mid(ac,"update","(FF)V"),(double)(jfloat)dt,(double)(jfloat)num(step,"rate",60));ck("animator update");jobject frame=snapshot(mo,animator,children);if(has(step,"actions"))array(frame,"built",definitions(children));append(frames,frame);
  }
  array(out,"frames",frames);append(results,out);(*e)->PopLocalFrame(e,NULL);
 }
 jstring output=(*e)->CallObjectMethod(e,results,mid(arr,"toString","()Ljava/lang/String;"));ck("serialize");puts("REA_ORACLE_JSON");const jchar*data=(*e)->GetStringChars(e,output,0);jsize len=(*e)->GetStringLength(e,output);for(jsize i=0;i<len;i++){if(data[i]<128)putchar(data[i]);else printf("\\u%04x",data[i]);}putchar(10);(*e)->ReleaseStringChars(e,output,data);fflush(stdout);(*vm)->DestroyJavaVM(vm);free(text);free(cp);return 0;
}
