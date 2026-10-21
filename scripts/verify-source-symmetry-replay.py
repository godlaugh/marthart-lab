"""Reproduce pinned native replay evidence without opening the application.

Usage: python3 scripts/verify-source-symmetry-replay.py APP JNI_HEADERS NEW_OUTPUT
No fixture rewriting, Java installation, application main, or GL calls.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    app, headers, output = (Path(p).resolve() for p in sys.argv[1:])
    root = Path(__file__).resolve().parent.parent
    fixture = json.loads((root / "tests/fixtures/symmetry/replay-runtime.json").read_text())
    harness = root / "scripts/oracles/source-symmetry-replay.c"
    jvm = app / "Contents/runtime/Contents/Home/lib/server/libjvm.dylib"
    jars = sorted((app / "Contents/app").glob("*.jar"))
    sources = [{"name": p.name, "sha256": sha(p)} for p in jars]
    if sha(jvm) != fixture["jvmSha256"] or sources != fixture["sources"]:
        raise ValueError("Original JVM or complete JAR classpath identity differs")
    if not all((headers / name).is_file() for name in ["jni.h", "jni_md.h"]):
        raise ValueError("Existing JNI headers required; no toolchain will be installed")
    output.mkdir()
    inputs = [{key: row[key] for key in ["id", "method", "args"]} for row in fixture["rows"]]
    input_file = output / "input.json"
    input_file.write_text(json.dumps({"cases": inputs}))
    binary = output / "oracle"
    subprocess.run(["clang", "-O2", "-Wall", "-Wextra", "-Werror", "-I", str(headers),
                    str(harness), "-o", str(binary)], check=True, timeout=30)
    started = time.monotonic()
    run = subprocess.run([str(binary), str(jvm), ":".join(map(str, jars)), str(input_file)],
                         capture_output=True, text=True, timeout=20)
    elapsed = time.monotonic() - started
    (output / "stdout").write_text(run.stdout)
    (output / "stderr").write_text(run.stderr)
    run.check_returncode()
    rows = json.loads(run.stdout.split("REA_ORACLE_JSON\n", 1)[1])
    if rows != fixture["rows"]:
        (output / "unexpected-rows.json").write_text(json.dumps(rows, indent=2))
        raise ValueError("Native replay evidence differs; see unexpected-rows.json")
    result = {"status": "passed", "scope": fixture["scope"], "cases": len(rows),
              "elapsedSeconds": elapsed, "harnessSha256": sha(harness),
              "binarySha256": sha(binary), "jvmSha256": sha(jvm), "sources": sources,
              "classSha256": fixture["classSha256"], "rows": rows}
    (output / "report.json").write_text(json.dumps(result, indent=2))
    (output / "report.md").write_text(
        f"# Symmetry 原版重放规则复验\n\n{len(rows)} 组原版方法运行结果与固定证据完全相等。"
        f"JVM 阶段耗时 {elapsed:.3f} 秒。\n\n"
        "范围：重放预算、清除条件、非图形对象状态变化。未执行 update、display、GL 或完整窗口。"
        "构造对象使用空主应用引用（60 FPS 回退）；触发器探针在开始重放后显式清除色板 dirty 标记。"
        "不能据此宣称本地逐帧输出或原版完整画面已经一致。\n"
    )
    print(json.dumps({key: result[key] for key in ["status", "cases", "elapsedSeconds"]}))


if __name__ == "__main__":
    main()
