/* Direct original numerical methods only. No Mobject constructor, PApplet,
 * renderer, scene host or OpenGL creation. Original callbacks own writes. */
#include "jni.h"
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
static JNIEnv *e;static jclass fc,pc,ac,sc,tc,jc,arrc;
static void ck(const char*s){if((*e)->ExceptionCheck(e)){fprintf(stderr,"FAIL %s\n",s);(*e)->ExceptionDescribe(e);exit(2);}}
static jclass cls(const char*s){jclass c=(*e)->FindClass(e,s);ck(s);return c;}
static jmethodID met(jclass c,const char*n,const char*d){jmethodID m=(*e)->GetMethodID(e,c,n,d);ck(n);return m;}
static jfieldID fld(jclass c,const char*n,const char*d){jfieldID f=(*e)->GetFieldID(e,c,n,d);ck(n);return f;}
static jstring str(const char*s){return (*e)->NewStringUTF(e,s);}
static jobject obj(const char*s){jclass c=cls(s);jobject o=(*e)->NewObject(e,c,met(c,"<init>","()V"));ck(s);return o;}
static int has(jobject j,const char*k){return (*e)->CallBooleanMethod(e,j,met(jc,"hasKey","(Ljava/lang/String;)Z"),str(k));}
static jobject value(jobject j,const char*k){jobject v=(*e)->CallObjectMethod(e,j,met(jc,"get","(Ljava/lang/String;)Ljava/lang/Object;"),str(k));ck(k);return v;}
static jobject jo(jobject j,const char*k){jobject v=(*e)->CallObjectMethod(e,j,met(jc,"getJSONObject","(Ljava/lang/String;)Lprocessing/data/JSONObject;"),str(k));ck(k);return v;}
static jobject ja(jobject j,const char*k){jobject v=(*e)->CallObjectMethod(e,j,met(jc,"getJSONArray","(Ljava/lang/String;)Lprocessing/data/JSONArray;"),str(k));ck(k);return v;}
static int size(jobject a){return (*e)->CallIntMethod(e,a,met(arrc,"size","()I"));}
static jobject ai(jobject a,int i){jobject v=(*e)->CallObjectMethod(e,a,met(arrc,"getJSONObject","(I)Lprocessing/data/JSONObject;"),i);ck("array item");return v;}
static double n(jobject j,const char*k){double x=(*e)->CallDoubleMethod(e,j,met(jc,"getDouble","(Ljava/lang/String;)D"),str(k));ck(k);return x;}
static const char* s(jobject j,const char*k){jstring v=(*e)->CallObjectMethod(e,j,met(jc,"getString","(Ljava/lang/String;)Ljava/lang/String;"),str(k));ck(k);return (*e)->GetStringUTFChars(e,v,0);}
static int yes(jobject j,const char*k){int b=(*e)->CallBooleanMethod(e,j,met(jc,"getBoolean","(Ljava/lang/String;)Z"),str(k));ck(k);return b;}
static jobject easing(const char*name){jclass c=cls("mathart/animation/Easings");jmethodID m=(*e)->GetStaticMethodID(e,c,"getByName","(Ljava/lang/String;)Lmathart/animation/Easings$EasingFunction;");jobject v=(*e)->CallStaticObjectMethod(e,c,m,str(name));ck("easing");return v;}
static void json(jobject o){jclass c=(*e)->GetObjectClass(e,o);jstring js=(*e)->CallObjectMethod(e,o,met(c,"toString","()Ljava/lang/String;"));const char*text=(*e)->GetStringUTFChars(e,js,0);fputs(text,stdout);(*e)->ReleaseStringUTFChars(e,js,text);}
static jobject iterator(jobject set){jclass c=cls("java/util/Set");return (*e)->CallObjectMethod(e,set,met(c,"iterator","()Ljava/util/Iterator;"));}
static int more(jobject it){return (*e)->CallBooleanMethod(e,it,met(cls("java/util/Iterator"),"hasNext","()Z"));}
static jobject next(jobject it){return (*e)->CallObjectMethod(e,it,met(cls("java/util/Iterator"),"next","()Ljava/lang/Object;"));}
static double unbox(jobject v){return (*e)->CallDoubleMethod(e,v,met(cls("java/lang/Number"),"doubleValue","()D"));}
static void number(double v){if(!isfinite(v)){fprintf(stderr,"unexpected nonfinite\n");exit(3);}printf("%.17g",v);}
static void farray(jfloatArray a){if(!a){fputs("null",stdout);return;}int len=(*e)->GetArrayLength(e,a);jfloat v[64];if(len>64)exit(3);(*e)->GetFloatArrayRegion(e,a,0,len,v);putchar('[');for(int i=0;i<len;i++){if(i)putchar(',');number(v[i]);}putchar(']');}
static void storedmap(jobject ps,const char*name,int complex){jclass psc=cls("mathart/fractal/formula/FormulaParamSet");jobject map=(*e)->CallObjectMethod(e,ps,met(psc,name,"()Ljava/util/Map;")),keys=(*e)->CallObjectMethod(e,map,met(cls("java/util/Map"),"keySet","()Ljava/util/Set;")),it=iterator(keys);int first=1;putchar('{');while(more(it)){jstring key=next(it);const char*k=(*e)->GetStringUTFChars(e,key,0);if(!first)putchar(',');first=0;printf("\"%s\":",k);jobject v=(*e)->CallObjectMethod(e,map,met(cls("java/util/Map"),"get","(Ljava/lang/Object;)Ljava/lang/Object;"),key);if(complex){double pair[2];(*e)->GetDoubleArrayRegion(e,v,0,2,pair);putchar('[');number(pair[0]);putchar(',');number(pair[1]);putchar(']');}else number(unbox(v));(*e)->ReleaseStringUTFChars(e,key,k);}putchar('}');}
int main(int argc,char**argv){if(argc!=4)return 1;void*lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib){fputs(dlerror(),stderr);return 1;}jint(*create)(JavaVM**,void**,void*)=dlsym(lib,"JNI_CreateJavaVM");char*cp=malloc(strlen(argv[2])+24);sprintf(cp,"-Djava.class.path=%s",argv[2]);JavaVMOption opts[]={{cp,0},{"-Djava.awt.headless=true",0},{"-Xmx256m",0}};JavaVMInitArgs args={JNI_VERSION_1_8,3,opts,JNI_FALSE};JavaVM*vm;if(create(&vm,(void**)&e,&args))return 2;
 jclass lc=cls("org/apache/logging/log4j/core/config/Configurator"),ll=cls("org/apache/logging/log4j/Level");jfieldID off=(*e)->GetStaticFieldID(e,ll,"OFF","Lorg/apache/logging/log4j/Level;");jmethodID quiet=(*e)->GetStaticMethodID(e,lc,"setRootLevel","(Lorg/apache/logging/log4j/Level;)V");(*e)->CallStaticVoidMethod(e,lc,quiet,(*e)->GetStaticObjectField(e,ll,off));ck("logging");
 fc=cls("mathart/fractal/ComplexFractalMobject");pc=cls("mathart/fractal/animation/FractalParameterAnimator");ac=cls("mathart/animation/Animation");sc=cls("mathart/fractal/animation/StartFractalParamAnimation");tc=cls("mathart/fractal/animation/StopFractalParamAnimation");jc=cls("processing/data/JSONObject");arrc=cls("processing/data/JSONArray");
 FILE*fp=fopen(argv[3],"rb");fseek(fp,0,SEEK_END);long len=ftell(fp);rewind(fp);char*input=calloc(len+1,1);fread(input,1,len,fp);fclose(fp);jmethodID parse=(*e)->GetStaticMethodID(e,jc,"parse","(Ljava/lang/String;)Lprocessing/data/JSONObject;");jobject root=(*e)->CallStaticObjectMethod(e,jc,parse,str(input));ck("input parse");jobject cases=ja(root,"cases");puts("REA_FORMULA_CONFIG_ORACLE_JSON");fputs("{\"cases\":[",stdout);


 jclass configClass=cls("mathart/fractal/config/JsonComplexFractalConfig");
 for(int ci=0;ci<size(cases);ci++){
  (*e)->PushLocalFrame(e,16384);jobject item=ai(cases,ci),rootInput=obj("processing/data/JSONObject");(*e)->CallObjectMethod(e,rootInput,met(jc,"setJSONObject","(Ljava/lang/String;Lprocessing/data/JSONObject;)Lprocessing/data/JSONObject;"),str("fractal"),jo(item,"fractal"));
  jobject c=(*e)->NewObject(e,configClass,met(configClass,"<init>","(Lprocessing/core/PApplet;Lprocessing/data/JSONObject;)V"),NULL,rootInput);ck("original JSON config");
  if(ci)putchar(',');printf("{\"input\":");json(item);printf(",\"configuration\":{\"formulaId\":");jstring id=(*e)->CallObjectMethod(e,c,met(configClass,"getFormulaId","()Ljava/lang/String;"));if(id){const char*t=(*e)->GetStringUTFChars(e,id,0);printf("\"%s\"",t);(*e)->ReleaseStringUTFChars(e,id,t);}else fputs("null",stdout);
  jobject ft=(*e)->CallObjectMethod(e,c,met(configClass,"getFractalType","()Lmathart/fractal/config/ComplexFractalConfig$FractalType;"));jstring tn=(*e)->CallObjectMethod(e,ft,met(cls("java/lang/Enum"),"name","()Ljava/lang/String;"));const char*ts=(*e)->GetStringUTFChars(e,tn,0);printf(",\"fractalType\":\"%s\",\"power\":%d,\"formulaParams\":",!strcmp(ts,"JULIA")?"julia":"mandelbrot",(*e)->CallIntMethod(e,c,met(configClass,"getPower","()I")));farray((*e)->CallObjectMethod(e,c,met(configClass,"getFormulaParams","()[F")));printf(",\"bailout\":");number((*e)->CallFloatMethod(e,c,met(configClass,"getBailout","()F")));printf(",\"julia\":[");number((*e)->CallDoubleMethod(e,c,met(configClass,"getJuliaCx","()D")));putchar(',');number((*e)->CallDoubleMethod(e,c,met(configClass,"getJuliaCy","()D")));putchar(']');
  jobject ps=(*e)->CallObjectMethod(e,c,met(configClass,"getFormulaParamSet","()Lmathart/fractal/formula/FormulaParamSet;"));if(ps){printf(",\"parameters\":{\"floats\":");storedmap(ps,"getFloats",0);printf(",\"complex\":");storedmap(ps,"getComplex",1);putchar('}');}
  fputs("}}",stdout);ck("config getters");(*e)->PopLocalFrame(e,0);
 }
 puts("]}");fflush(stdout);(*vm)->DestroyJavaVM(vm);return 0;
}
