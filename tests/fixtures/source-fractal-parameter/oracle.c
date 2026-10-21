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
static void namedmap(jobject p,const char*field,int array){jobject map=(*e)->GetObjectField(e,p,fld(pc,field,"Ljava/util/Map;"));jclass mc=cls("java/util/Map");jobject keys=(*e)->CallObjectMethod(e,map,met(mc,"keySet","()Ljava/util/Set;")),it=iterator(keys);int first=1;putchar('{');while(more(it)){jstring key=next(it);const char*k=(*e)->GetStringUTFChars(e,key,0);if(!first)putchar(',');first=0;printf("\"%s\":",k);jobject v=(*e)->CallObjectMethod(e,map,met(mc,"get","(Ljava/lang/Object;)Ljava/lang/Object;"),key);if(array){double x;(*e)->GetDoubleArrayRegion(e,v,0,1,&x);number(x);}else number(unbox(v));(*e)->ReleaseStringUTFChars(e,key,k);}putchar('}');}
static jobject fractal(const char*formula){
 jobject f=(*e)->AllocObject(e,fc);
 (*e)->SetObjectField(e,f,fld(fc,"activeFormulaId","Ljava/lang/String;"),str(formula));
 (*e)->SetObjectField(e,f,fld(fc,"activeFormulaParamSet","Lmathart/fractal/formula/FormulaParamSet;"),obj("mathart/fractal/formula/FormulaParamSet"));
 (*e)->SetObjectField(e,f,fld(fc,"formulaDomainService","Lmathart/fractal/formula/FormulaDomainService;"),obj("mathart/fractal/formula/FormulaDomainService"));
 (*e)->SetObjectField(e,f,fld(fc,"formulaRuntimeMapper","Lmathart/fractal/FormulaRuntimeMapper;"),obj("mathart/fractal/FormulaRuntimeMapper"));
 jclass ft=cls("mathart/fractal/config/ComplexFractalConfig$FractalType");jfieldID type=(*e)->GetStaticFieldID(e,ft,"MANDELBROT","Lmathart/fractal/config/ComplexFractalConfig$FractalType;");
 (*e)->SetObjectField(e,f,fld(fc,"fractalType","Lmathart/fractal/config/ComplexFractalConfig$FractalType;"),(*e)->GetStaticObjectField(e,ft,type));
 (*e)->SetObjectField(e,f,fld(fc,"formulaParams","[F"),(*e)->NewFloatArray(e,4));
 (*e)->SetIntField(e,f,fld(fc,"power","I"),2);(*e)->SetFloatField(e,f,fld(fc,"bailout","F"),4);
 jobject p=(*e)->NewObject(e,pc,met(pc,"<init>","(Lmathart/fractal/ComplexFractalMobject;)V"),f);
 (*e)->SetObjectField(e,f,fld(fc,"paramAnimator","Lmathart/fractal/animation/FractalParameterAnimator;"),p);ck("fractal numerical fields");return f;
}
static void writevalue(jobject f,jobject input){const char*name=s(input,"name");if(has(input,"imaginary"))(*e)->CallVoidMethod(e,f,met(fc,"setFormulaParameterComplex","(Ljava/lang/String;DD)V"),str(name),n(input,"value"),n(input,"imaginary"));else (*e)->CallVoidMethod(e,f,met(fc,"setFormulaParameterScalar","(Ljava/lang/String;D)V"),str(name),n(input,"value"));ck("write actual parameter");}
static void state(jobject f,jobject p,jobject observed){
 printf("{\"running\":%s,\"order\":[",(*e)->CallBooleanMethod(e,p,met(pc,"isRunning","()Z"))?"true":"false");jobject set=(*e)->CallObjectMethod(e,p,met(pc,"getParamNames","()Ljava/util/Set;")),it=iterator(set);int first=1;while(more(it)){jstring k=next(it);const char*t=(*e)->GetStringUTFChars(e,k,0);if(!first)putchar(',');first=0;printf("\"%s\"",t);(*e)->ReleaseStringUTFChars(e,k,t);}printf("],\"scales\":");namedmap(p,"stepScales",0);printf(",\"scalarPhases\":");namedmap(p,"scalarPhases",0);printf(",\"complexPhases\":");namedmap(p,"complexPhases",1);printf(",\"fixedImaginary\":");namedmap(p,"complexFixedImag",0);printf(",\"values\":{");
 for(int i=0;i<size(observed);i++){jobject item=ai(observed,i);const char*name=s(item,"name"),*kind=s(item,"kind");if(i)putchar(',');printf("\"%s\":",name);if(!strcmp(kind,"complex")){jdoubleArray a=(*e)->CallObjectMethod(e,f,met(fc,"getFormulaParameterComplex","(Ljava/lang/String;)[D"),str(name));if(!a){fputs("null",stdout);continue;}double v[2];(*e)->GetDoubleArrayRegion(e,a,0,2,v);putchar('[');number(v[0]);putchar(',');number(v[1]);putchar(']');}else{jobject v=(*e)->CallObjectMethod(e,f,met(fc,"getFormulaParameterScalar","(Ljava/lang/String;)Ljava/lang/Double;"),str(name));if(v)number(unbox(v));else fputs("null",stdout);}}
 fputs("}}",stdout);ck("state");
}
int main(int argc,char**argv){if(argc!=4)return 1;void*lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib){fputs(dlerror(),stderr);return 1;}jint(*create)(JavaVM**,void**,void*)=dlsym(lib,"JNI_CreateJavaVM");char*cp=malloc(strlen(argv[2])+24);sprintf(cp,"-Djava.class.path=%s",argv[2]);JavaVMOption opts[]={{cp,0},{"-Djava.awt.headless=true",0},{"-Xmx256m",0}};JavaVMInitArgs args={JNI_VERSION_1_8,3,opts,JNI_FALSE};JavaVM*vm;if(create(&vm,(void**)&e,&args))return 2;
 jclass lc=cls("org/apache/logging/log4j/core/config/Configurator"),ll=cls("org/apache/logging/log4j/Level");jfieldID off=(*e)->GetStaticFieldID(e,ll,"OFF","Lorg/apache/logging/log4j/Level;");jmethodID quiet=(*e)->GetStaticMethodID(e,lc,"setRootLevel","(Lorg/apache/logging/log4j/Level;)V");(*e)->CallStaticVoidMethod(e,lc,quiet,(*e)->GetStaticObjectField(e,ll,off));ck("logging");
 fc=cls("mathart/fractal/ComplexFractalMobject");pc=cls("mathart/fractal/animation/FractalParameterAnimator");ac=cls("mathart/animation/Animation");sc=cls("mathart/fractal/animation/StartFractalParamAnimation");tc=cls("mathart/fractal/animation/StopFractalParamAnimation");jc=cls("processing/data/JSONObject");arrc=cls("processing/data/JSONArray");
 FILE*fp=fopen(argv[3],"rb");fseek(fp,0,SEEK_END);long len=ftell(fp);rewind(fp);char*input=calloc(len+1,1);fread(input,1,len,fp);fclose(fp);jmethodID parse=(*e)->GetStaticMethodID(e,jc,"parse","(Ljava/lang/String;)Lprocessing/data/JSONObject;");jobject root=(*e)->CallStaticObjectMethod(e,jc,parse,str(input));ck("input parse");jobject cases=ja(root,"cases");puts("REA_PARAMETER_ORACLE_JSON");fputs("{\"cases\":[",stdout);
 for(int ci=0;ci<size(cases);ci++){
  (*e)->PushLocalFrame(e,16384);jobject c=ai(cases,ci),f=fractal(s(c,"formula")),p=(*e)->GetObjectField(e,f,fld(fc,"paramAnimator","Lmathart/fractal/animation/FractalParameterAnimator;"));jobject initial=ja(c,"initial");for(int i=0;i<size(initial);i++)writevalue(f,ai(initial,i));jobject observed=ja(c,"observed"),operations=ja(c,"operations");jobject children[256];int count=0;
  if(ci)putchar(',');printf("{\"input\":");json(c);printf(",\"initial\":");state(f,p,observed);fputs(",\"steps\":[",stdout);
  for(int oi=0;oi<size(operations);oi++){
   jobject op=ai(operations,oi);const char*kind=s(op,"kind");
   if(!strcmp(kind,"begin")){
    jobject actions=ja(op,"actions");count=size(actions);if(count>256)return 3;
    for(int i=0;i<count;i++){jobject a=ai(actions,i),scope=jo(a,"scope");int all=!strcmp(s(scope,"kind"),"all"),start=!strcmp(s(a,"kind"),"start");
     if(start&&all)children[i]=(*e)->NewObject(e,sc,met(sc,"<init>","(Lmathart/fractal/ComplexFractalMobject;F)V"),f,1.0);
     else if(!start&&all)children[i]=(*e)->NewObject(e,tc,met(tc,"<init>","(Lmathart/fractal/ComplexFractalMobject;F)V"),f,1.0);
     else if(!start)children[i]=(*e)->NewObject(e,tc,met(tc,"<init>","(Lmathart/fractal/ComplexFractalMobject;Ljava/lang/String;F)V"),f,str(s(scope,"name")),1.0);
     else{jobject cfg=jo(a,"configuration"),edge=0;if(has(cfg,"edgeEasing")){jobject ed=jo(cfg,"edgeEasing");jclass ec=cls("mathart/animation/OscillationEdgeEasing");const char*name=s(ed,"easing");edge=(*e)->NewObject(e,ec,met(ec,"<init>","(DDLmathart/animation/Easings$EasingFunction;)V"),n(ed,"window"),n(ed,"floor"),easing(!strcmp(name,"linear")?"LINEAR":"SINE_OUT"));}children[i]=(*e)->NewObject(e,sc,met(sc,"<init>","(Lmathart/fractal/ComplexFractalMobject;Ljava/lang/String;DDDFLmathart/animation/OscillationEdgeEasing;)V"),f,str(s(scope,"name")),n(cfg,"step"),n(cfg,"min"),n(cfg,"max"),1.0,edge);}
     ck("child ctor");(*e)->CallObjectMethod(e,children[i],met(ac,"setEasing","(Lmathart/animation/Easings$EasingFunction;)Lmathart/animation/Animation;"),easing("LINEAR"));(*e)->CallVoidMethod(e,children[i],met(ac,"onStart","()V"));ck("child onStart");
    }
   }else if(!strcmp(kind,"interpolate")){
    float eased=(float)n(op,"eased");int finished=yes(op,"finished");for(int i=0;i<count;i++){if((*e)->GetBooleanField(e,children[i],fld(ac,"isFinished","Z")))continue;(*e)->CallVoidMethod(e,children[i],met(ac,"onUpdate","(F)V"),(double)eased);if(finished){(*e)->CallVoidMethod(e,children[i],met(ac,"onFinish","()V"));(*e)->SetBooleanField(e,children[i],fld(ac,"isFinished","Z"),1);}ck("child interpolate");}
   }else if(!strcmp(kind,"update")){(*e)->CallVoidMethod(e,p,met(pc,"update","(FF)V"),n(op,"dt"),n(op,"fps"));ck("animator update");}
   else if(!strcmp(kind,"write"))writevalue(f,op);
   else if(!strcmp(kind,"stop"))(*e)->CallVoidMethod(e,p,met(pc,"stop","()V"));
   else return 4;
   if(oi)putchar(',');state(f,p,observed);
  }
  fputs("]}",stdout);(*e)->PopLocalFrame(e,0);
 }
 puts("]}");fflush(stdout);(*vm)->DestroyJavaVM(vm);return 0;
}
