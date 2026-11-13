#!/usr/bin/env python3
"""Inline three.js (as one classic script exposing window.THREE) + src/*.js into ONE html file.

  python3 tools/build.py            -> src/*.js            -> dist/crimson-loong.html
  python3 tools/build.py NAME       -> ws/NAME/src/*.js    -> ws/NAME/dist/crimson-loong.html   (isolated workspace)

The app JS is syntax-checked with `node --check` first; a syntax error stops the build and names the module.
"""
import glob, os, re, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WS = sys.argv[1] if len(sys.argv) > 1 else None
BASE = os.path.join(ROOT, "ws", WS) if WS else ROOT
SRC = os.path.join(BASE, "src"); OUT = os.path.join(BASE, "dist", "crimson-loong.html")
assert os.path.isdir(SRC), f"no such source dir: {SRC}"
V = os.path.join(ROOT, "vendor")
shell = open(os.path.join(SRC, "shell.html")).read()
core = open(os.path.join(V, "three.core.min.js")).read(); mod = open(os.path.join(V, "three.module.min.js")).read()
def pairs(body):
    out = []
    for it in body.split(","):
        it = it.strip()
        if not it: continue
        if " as " in it: a, b = [x.strip() for x in it.split(" as ")]; out.append((a, b))
        else: out.append((it, it))
    return out
mc = re.search(r'export\s*\{([^}]*)\}\s*;?\s*$', core.strip()); core_body = core.strip()[:mc.start()]; core_exports = pairs(mc.group(1))
mi = re.search(r'import\s*\{([^}]*)\}\s*from\s*"\./three\.core\.min\.js"\s*;?', mod); imports = pairs(mi.group(1))
reexp = re.search(r'export\s*\{([^}]*)\}\s*from\s*"\./three\.core\.min\.js"\s*;?', mod)
mod_body = mod.replace(mi.group(0), "", 1)
if reexp: mod_body = mod_body.replace(reexp.group(0), "", 1)
mo = re.search(r'export\s*\{([^}]*)\}\s*;?\s*$', mod_body.strip()); own = pairs(mo.group(1)); mod_body = mod_body.strip()[:mo.start()]
reexported = [n for _, n in pairs(reexp.group(1))] if reexp else []
three = ("var THREE=(function(){'use strict';var __core=(function(){'use strict';" + core_body + ";return{" + ",".join(f"{n}:{l}" for l, n in core_exports) + "};})();" +
  "var __mod=(function(__core){'use strict';var{" + ",".join(f"{n}:{l}" for n, l in imports) + "}=__core;" + mod_body +
  ";return{" + ",".join([f"{n}:__core.{n}" for n in reexported] + [f"{n}:{l}" for l, n in own]) + "};})(__core);return Object.freeze(Object.assign({},__core,__mod));})();")
app = []; ok = True
for f in sorted(glob.glob(os.path.join(SRC, "*.js"))):
    src = open(f).read(); assert "</script" not in src.lower(), f
    r = subprocess.run(["node", "--check", f], capture_output=True, text=True)
    if r.returncode != 0:
        ok = False; print(f"SYNTAX ERROR in {os.path.relpath(f, ROOT)}:\n{r.stderr.strip()[:1500]}")
    app.append(f"// ===== {os.path.basename(f)} =====\n" + src.replace("'use strict';", "", 1))
if not ok:
    print("build stopped: fix the syntax errors above"); sys.exit(1)
joined = "'use strict';\n" + "\n".join(app)
with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as tf: tf.write(joined)
r = subprocess.run(["node", "--check", tf.name], capture_output=True, text=True); os.unlink(tf.name)
if r.returncode != 0:
    print("SYNTAX ERROR in the joined app (usually the same top-level name declared in two modules):\n" + r.stderr.strip()[:1500]); sys.exit(1)
out = shell.replace("{{THREE}}", three).replace("{{APP}}", joined)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
tmp = OUT + ".tmp"; open(tmp, "w").write(out); os.replace(tmp, OUT)
print(f"built {os.path.relpath(OUT, ROOT)} {len(out)/1024:.0f} KB ({len(app)} modules)")
