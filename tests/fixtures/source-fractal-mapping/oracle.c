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
static jobject fractal(const char*formula,const char*typeName){
 jobject f=(*e)->AllocObject(e,fc);
 (*e)->SetObjectField(e,f,fld(fc,"activeFormulaId","Ljava/lang/String;"),str(formula));
 (*e)->SetObjectField(e,f,fld(fc,"activeFormulaParamSet","Lmathart/fractal/formula/FormulaParamSet;"),obj("mathart/fractal/formula/FormulaParamSet"));
 (*e)->SetObjectField(e,f,fld(fc,"formulaDomainService","Lmathart/fractal/formula/FormulaDomainService;"),obj("mathart/fractal/formula/FormulaDomainService"));
 (*e)->SetObjectField(e,f,fld(fc,"formulaRuntimeMapper","Lmathart/fractal/FormulaRuntimeMapper;"),obj("mathart/fractal/FormulaRuntimeMapper"));
 jclass ft=cls("mathart/fractal/config/ComplexFractalConfig$FractalType");jfieldID type=(*e)->GetStaticFieldID(e,ft,typeName,"Lmathart/fractal/config/ComplexFractalConfig$FractalType;");
 (*e)->SetObjectField(e,f,fld(fc,"fractalType","Lmathart/fractal/config/ComplexFractalConfig$FractalType;"),(*e)->GetStaticObjectField(e,ft,type));
 (*e)->SetObjectField(e,f,fld(fc,"formulaParams","[F"),(*e)->NewFloatArray(e,4));
 (*e)->SetIntField(e,f,fld(fc,"power","I"),7);(*e)->SetFloatField(e,f,fld(fc,"bailout","F"),9);
 (*e)->CallVoidMethod(e,f,met(fc,"setJuliaConstant","(DD)V"),.125,-.25);
 (*e)->CallVoidMethod(e,f,met(fc,"setCenter","(DD)V"),0.0,0.0);
 jfloat fpv[]={11,12,13,14};jfloatArray fp=(*e)->GetObjectField(e,f,fld(fc,"formulaParams","[F"));(*e)->SetFloatArrayRegion(e,fp,0,4,fpv);
 jobject p=(*e)->NewObject(e,pc,met(pc,"<init>","(Lmathart/fractal/ComplexFractalMobject;)V"),f);
 (*e)->SetObjectField(e,f,fld(fc,"paramAnimator","Lmathart/fractal/animation/FractalParameterAnimator;"),p);ck("fractal numerical fields");return f;
}
static void writevalue(jobject f,jobject input){const char*name=s(input,"name");if(has(input,"imaginary"))(*e)->CallVoidMethod(e,f,met(fc,"setFormulaParameterComplex","(Ljava/lang/String;DD)V"),str(name),n(input,"value"),n(input,"imaginary"));else (*e)->CallVoidMethod(e,f,met(fc,"setFormulaParameterScalar","(Ljava/lang/String;D)V"),str(name),n(input,"value"));ck("write actual parameter");}

static void farray(jfloatArray a){if(!a){fputs("null",stdout);return;}int len=(*e)->GetArrayLength(e,a);jfloat v[64];if(len>64)exit(3);(*e)->GetFloatArrayRegion(e,a,0,len,v);putchar('[');for(int i=0;i<len;i++){if(i)putchar(',');number(v[i]);}putchar(']');}
static void storedmap(jobject f,const char*name,int complex){jobject ps=(*e)->GetObjectField(e,f,fld(fc,"activeFormulaParamSet","Lmathart/fractal/formula/FormulaParamSet;"));jclass psc=cls("mathart/fractal/formula/FormulaParamSet");jobject map=(*e)->CallObjectMethod(e,ps,met(psc,name,"()Ljava/util/Map;")),keys=(*e)->CallObjectMethod(e,map,met(cls("java/util/Map"),"keySet","()Ljava/util/Set;")),it=iterator(keys);int first=1;putchar('{');while(more(it)){jstring key=next(it);const char*k=(*e)->GetStringUTFChars(e,key,0);if(!first)putchar(',');first=0;printf("\"%s\":",k);jobject v=(*e)->CallObjectMethod(e,map,met(cls("java/util/Map"),"get","(Ljava/lang/Object;)Ljava/lang/Object;"),key);if(complex){double pair[2];(*e)->GetDoubleArrayRegion(e,v,0,2,pair);putchar('[');number(pair[0]);putchar(',');number(pair[1]);putchar(']');}else number(unbox(v));(*e)->ReleaseStringUTFChars(e,key,k);}putchar('}');}
static void state(jobject f,jobject observed){
 jobject ft=(*e)->GetObjectField(e,f,fld(fc,"fractalType","Lmathart/fractal/config/ComplexFractalConfig$FractalType;"));jstring tn=(*e)->CallObjectMethod(e,ft,met(cls("java/lang/Enum"),"name","()Ljava/lang/String;"));const char*ts=(*e)->GetStringUTFChars(e,tn,0);printf("{\"native\":{\"fractalType\":\"%s\",\"power\":%d,\"bailout\":",!strcmp(ts,"JULIA")?"julia":"mandelbrot",(*e)->GetIntField(e,f,fld(fc,"power","I")));number((*e)->GetFloatField(e,f,fld(fc,"bailout","F")));printf(",\"julia\":[");number((*e)->GetDoubleField(e,f,fld(fc,"juliaCx","D")));putchar(',');number((*e)->GetDoubleField(e,f,fld(fc,"juliaCy","D")));printf("],\"formulaParams\":");farray((*e)->GetObjectField(e,f,fld(fc,"formulaParams","[F")));printf(",\"dynamicParams\":");farray((*e)->GetObjectField(e,f,fld(fc,"dynamicParams","[F")));printf("},\"stored\":{\"floats\":");storedmap(f,"getFloats",0);printf(",\"complex\":");storedmap(f,"getComplex",1);printf("},\"read\":{");
 for(int i=0;i<size(observed);i++){jobject item=ai(observed,i);const char*name=s(item,"name"),*kind=s(item,"kind");if(i)putchar(',');printf("\"%s\":",name);if(!strcmp(kind,"complex")){jdoubleArray a=(*e)->CallObjectMethod(e,f,met(fc,"getFormulaParameterComplex","(Ljava/lang/String;)[D"),str(name));if(!a){fputs("null",stdout);continue;}double v[2];(*e)->GetDoubleArrayRegion(e,a,0,2,v);putchar('[');number(v[0]);putchar(',');number(v[1]);putchar(']');}else{jobject v=(*e)->CallObjectMethod(e,f,met(fc,"getFormulaParameterScalar","(Ljava/lang/String;)Ljava/lang/Double;"),str(name));if(v)number(unbox(v));else fputs("null",stdout);}}
 fputs("}}",stdout);ck("state");
}
int main(int argc,char**argv){if(argc!=4)return 1;void*lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib){fputs(dlerror(),stderr);return 1;}jint(*create)(JavaVM**,void**,void*)=dlsym(lib,"JNI_CreateJavaVM");char*cp=malloc(strlen(argv[2])+24);sprintf(cp,"-Djava.class.path=%s",argv[2]);JavaVMOption opts[]={{cp,0},{"-Djava.awt.headless=true",0},{"-Xmx256m",0}};JavaVMInitArgs args={JNI_VERSION_1_8,3,opts,JNI_FALSE};JavaVM*vm;if(create(&vm,(void**)&e,&args))return 2;
 jclass lc=cls("org/apache/logging/log4j/core/config/Configurator"),ll=cls("org/apache/logging/log4j/Level");jfieldID off=(*e)->GetStaticFieldID(e,ll,"OFF","Lorg/apache/logging/log4j/Level;");jmethodID quiet=(*e)->GetStaticMethodID(e,lc,"setRootLevel","(Lorg/apache/logging/log4j/Level;)V");(*e)->CallStaticVoidMethod(e,lc,quiet,(*e)->GetStaticObjectField(e,ll,off));ck("logging");
 fc=cls("mathart/fractal/ComplexFractalMobject");pc=cls("mathart/fractal/animation/FractalParameterAnimator");ac=cls("mathart/animation/Animation");sc=cls("mathart/fractal/animation/StartFractalParamAnimation");tc=cls("mathart/fractal/animation/StopFractalParamAnimation");jc=cls("processing/data/JSONObject");arrc=cls("processing/data/JSONArray");
 FILE*fp=fopen(argv[3],"rb");fseek(fp,0,SEEK_END);long len=ftell(fp);rewind(fp);char*input=calloc(len+1,1);fread(input,1,len,fp);fclose(fp);jmethodID parse=(*e)->GetStaticMethodID(e,jc,"parse","(Ljava/lang/String;)Lprocessing/data/JSONObject;");jobject root=(*e)->CallStaticObjectMethod(e,jc,parse,str(input));ck("input parse");jobject cases=ja(root,"cases");puts("REA_MAPPING_ORACLE_JSON");fputs("{\"cases\":[",stdout);

 for(int ci=0;ci<size(cases);ci++){
  (*e)->PushLocalFrame(e,16384);jobject c=ai(cases,ci),f=fractal(s(c,"formula"),s(c,"type"));jobject observed=ja(c,"observed"),operations=ja(c,"operations"),anim=0;
  if(ci)putchar(',');printf("{\"input\":");json(c);printf(",\"initial\":");state(f,observed);fputs(",\"steps\":[",stdout);
  for(int oi=0;oi<size(operations);oi++){
   jobject op=ai(operations,oi);const char*kind=s(op,"kind");
   if(!strcmp(kind,"registry"))writevalue(f,op);
   else if(!strcmp(kind,"bind")){
    jclass rc=cls("mathart/fractal/formula/FormulaRegistry");jobject registry=(*e)->CallStaticObjectMethod(e,rc,(*e)->GetStaticMethodID(e,rc,"getGlobal","()Lmathart/fractal/formula/FormulaRegistry;"));jobject optional=(*e)->CallObjectMethod(e,registry,met(rc,"find","(Ljava/lang/String;)Ljava/util/Optional;"),str(s(c,"formula")));jobject registration=(*e)->CallObjectMethod(e,optional,met(cls("java/util/Optional"),"get","()Ljava/lang/Object;"));jobject md=(*e)->CallObjectMethod(e,registration,met(cls("mathart/fractal/formula/FormulaRegistration"),"getMetadata","()Lmathart/fractal/formula/FormulaMetadata;"));jclass bc=cls("mathart/fractal/formula/JsonFormulaParamBinder");jobject binder=(*e)->NewObject(e,bc,met(bc,"<init>","(Lprocessing/core/PApplet;)V"),NULL);jobject ps=(*e)->CallObjectMethod(e,binder,met(bc,"bind","(Lmathart/fractal/formula/FormulaMetadata;Lprocessing/data/JSONObject;)Lmathart/fractal/formula/FormulaParamSet;"),md,jo(op,"parameters"));ps=(*e)->CallObjectMethod(e,binder,met(bc,"validate","(Lmathart/fractal/formula/FormulaMetadata;Lmathart/fractal/formula/FormulaParamSet;)Lmathart/fractal/formula/FormulaParamSet;"),md,ps);(*e)->SetObjectField(e,f,fld(fc,"activeFormulaParamSet","Lmathart/fractal/formula/FormulaParamSet;"),ps);(*e)->CallVoidMethod(e,f,met(fc,"remapFormulaRuntimeFromParamSet","()V"));
   }else if(!strcmp(kind,"remap"))(*e)->CallVoidMethod(e,f,met(fc,"remapFormulaRuntimeFromParamSet","()V"));
   else if(!strcmp(kind,"bailout"))(*e)->CallVoidMethod(e,f,met(fc,"setBailout","(F)V"),n(op,"value"));
   else if(!strcmp(kind,"julia"))(*e)->CallVoidMethod(e,f,met(fc,"setJuliaConstant","(DD)V"),n(op,"value"),n(op,"imaginary"));
   else if(!strcmp(kind,"animationStart")){
    jclass pac=cls("mathart/fractal/animation/FractalParamAnimation");anim=(*e)->NewObject(e,pac,met(pac,"<init>","(Lmathart/fractal/ComplexFractalMobject;F)V"),f,1.0);
    if(has(op,"bailout"))(*e)->CallVoidMethod(e,anim,met(pac,"setTargetBailout","(F)V"),n(op,"bailout"));
    if(has(op,"real"))(*e)->CallVoidMethod(e,anim,met(pac,"setTargetJulia","(DD)V"),n(op,"real"),n(op,"imaginary"));
    (*e)->CallObjectMethod(e,anim,met(ac,"setEasing","(Lmathart/animation/Easings$EasingFunction;)Lmathart/animation/Animation;"),easing("LINEAR"));
    (*e)->CallVoidMethod(e,anim,met(ac,"onStart","()V"));
   }else if(!strcmp(kind,"animationUpdate")){if(!anim)return 4;(*e)->CallVoidMethod(e,anim,met(ac,"onUpdate","(F)V"),n(op,"progress"));}
   else return 4;
   ck("operation");if(oi)putchar(',');state(f,observed);
  }
  fputs("]}",stdout);(*e)->PopLocalFrame(e,0);
 }
 puts("]}");fflush(stdout);(*vm)->DestroyJavaVM(vm);return 0;
}
