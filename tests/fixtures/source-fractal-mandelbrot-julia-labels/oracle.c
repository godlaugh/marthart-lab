/* Original MathArt Mandelbrot/Julia config labels via bounded JNI. No scene,
 * PApplet, TeX, renderer, graphics, host, recording or encoder construction. */
#include "jni.h"
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static JNIEnv *e;
static void check(const char *where) {
  if ((*e)->ExceptionCheck(e)) {
    fprintf(stderr, "FAIL %s\n", where);
    (*e)->ExceptionDescribe(e);
    exit(2);
  }
}
static jclass cls(const char *name) {
  jclass c = (*e)->FindClass(e, name); check(name); return c;
}
static jmethodID method(jclass c, const char *name, const char *signature) {
  jmethodID m = (*e)->GetMethodID(e, c, name, signature); check(name); return m;
}
static void string(const char *s) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)s; *p; ++p) {
    if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
    else if (*p < 32) printf("\\u%04x", *p);
    else putchar(*p);
  }
  putchar('"');
}
static void java_string(jstring s) {
  check("formatter result");
  if (!s) { fputs("null", stdout); return; }
  const char *chars = (*e)->GetStringUTFChars(e, s, NULL);
  string(chars); (*e)->ReleaseStringUTFChars(e, s, chars);
}
struct Formula { const char *id; const char *input; };

int main(int argc, char **argv) {
  if (argc != 3) return 1;
  void *library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
  if (!library) { fputs(dlerror(), stderr); return 1; }
  jint (*create)(JavaVM **, void **, void *) = dlsym(library, "JNI_CreateJavaVM");
  if (!create) return 1;
  char *classpath = malloc(strlen(argv[2]) + 24);
  sprintf(classpath, "-Djava.class.path=%s", argv[2]);
  JavaVMOption options[] = {{classpath, 0}, {"-Djava.awt.headless=true", 0}, {"-Xmx256m", 0}};
  JavaVMInitArgs args = {JNI_VERSION_1_8, 3, options, JNI_FALSE};
  JavaVM *vm;
  if (create(&vm, (void **)&e, &args)) return 2;
  jclass logging = cls("org/apache/logging/log4j/core/config/Configurator");
  jclass level = cls("org/apache/logging/log4j/Level");
  jfieldID off = (*e)->GetStaticFieldID(e, level, "OFF", "Lorg/apache/logging/log4j/Level;");
  jmethodID quiet = (*e)->GetStaticMethodID(e, logging, "setRootLevel", "(Lorg/apache/logging/log4j/Level;)V");
  (*e)->CallStaticVoidMethod(e, logging, quiet, (*e)->GetStaticObjectField(e, level, off)); check("logging");
  jclass config_class = cls("mathart/fractal/config/JsonComplexFractalConfig");
  const struct Formula formulas[] = {
    {"mandelbrot-default", "{\"fractal\":{\"formula_id\":\"mandelbrot\"}}"},
    {"mandelbrot-empty-parameters", "{\"fractal\":{\"formula_id\":\"mandelbrot\",\"parameters\":{}}}"},
    {"mandelbrot-explicit-power", "{\"fractal\":{\"formula_id\":\"mandelbrot\",\"parameters\":{\"power\":3.125}}}"},
    {"mandelbrot-float32-power", "{\"fractal\":{\"formula_id\":\"mandelbrot\",\"parameters\":{\"power\":3.00015}}}"},
    {"mandelbrot-clamped-power", "{\"fractal\":{\"formula_id\":\"mandelbrot\",\"parameters\":{\"power\":-3}}}"},
    {"mandelbrot-legacy-fields-do-not-supply-label", "{\"fractal\":{\"formula_id\":\"mandelbrot\",\"power\":9,\"formula_params\":{\"power\":7},\"formula\":\"z^11 + c\"}}"},
    {"mandelbrot-metadata-over-legacy", "{\"fractal\":{\"formula_id\":\"mandelbrot\",\"power\":9,\"formula_params\":{\"power\":7},\"parameters\":{\"power\":5.5}}}"},
    {"mandelbrot-unrelated-metadata", "{\"fractal\":{\"formula_id\":\"mandelbrot\",\"parameters\":{\"bailout\":123,\"start_point\":[2,3]}}}"},
    {"julia-default", "{\"fractal\":{\"formula_id\":\"julia\",\"type\":\"JULIA\"}}"},
    {"julia-empty-parameters", "{\"fractal\":{\"formula_id\":\"julia\",\"type\":\"JULIA\",\"parameters\":{}}}"},
    {"julia-explicit-parameters", "{\"fractal\":{\"formula_id\":\"julia\",\"type\":\"JULIA\",\"parameters\":{\"power\":3.125,\"julia_seed\":[-0.45,0.875]}}}"},
    {"julia-object-complex", "{\"fractal\":{\"formula_id\":\"julia\",\"parameters\":{\"julia_seed\":{\"re\":3.141592653589793,\"im\":-0.33335}}}}"},
    {"julia-legacy-fields-do-not-supply-label", "{\"fractal\":{\"formula_id\":\"julia\",\"type\":\"JULIA\",\"power\":9,\"formula_params\":{\"power\":7},\"julia_constant\":[0.7,-0.8]}}"},
    {"julia-metadata-over-legacy", "{\"fractal\":{\"formula_id\":\"julia\",\"type\":\"JULIA\",\"power\":9,\"julia_constant\":[0.7,-0.8],\"parameters\":{\"power\":4.5,\"julia_seed\":[0,-1]}}}"},
    {"julia-template-independent-of-native-variant", "{\"fractal\":{\"formula_id\":\"julia\",\"type\":\"MANDELBROT\",\"parameters\":{\"power\":4,\"julia_seed\":[1,2]}}}"},
    {"julia-float32-power-double-seed", "{\"fractal\":{\"formula_id\":\"julia\",\"parameters\":{\"power\":3.00015,\"julia_seed\":[1.00015,-1.23455]}}}"},
  };
  jclass json_class = cls("processing/data/JSONObject");
  jmethodID parse = (*e)->GetStaticMethodID(e, json_class, "parse", "(Ljava/lang/String;)Lprocessing/data/JSONObject;"); check("JSON parse method");
  jmethodID constructor = method(config_class, "<init>", "(Lprocessing/core/PApplet;Lprocessing/data/JSONObject;)V");
  jmethodID build = method(config_class, "buildFractalLatex", "()Ljava/lang/String;");
  puts("REA_FORMULA_LABELS_ORACLE_JSON");
  fputs("{\"formula\":[", stdout);
  for (size_t i = 0; i < sizeof(formulas) / sizeof(formulas[0]); ++i) {
    (*e)->PushLocalFrame(e, 256);
    jobject raw = (*e)->CallStaticObjectMethod(e, json_class, parse, (*e)->NewStringUTF(e, formulas[i].input)); check("config JSON");
    jobject instance = (*e)->NewObject(e, config_class, constructor, NULL, raw); check("pure config constructor");
    if (i) putchar(','); fputs("{\"id\":", stdout); string(formulas[i].id);
    printf(",\"input\":%s,\"output\":", formulas[i].input);
    java_string((*e)->CallObjectMethod(e, instance, build)); putchar('}');
    (*e)->PopLocalFrame(e, NULL);
  }
  puts("]}"); fflush(stdout);
  jint destroyed = (*vm)->DestroyJavaVM(vm);
  fprintf(stderr, "DestroyJavaVM=%d\n", destroyed);
  free(classpath); return destroyed == JNI_OK ? 0 : 3;
}
