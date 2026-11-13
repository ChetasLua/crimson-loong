#!/usr/bin/env python3
"""Frame cost of a build at given film times, measured on the real GPU through capd.

  python3 tools/perf.py NAME 24 40 51 65      (NAME = workspace name, or 'main')

Renders 90 consecutive frames from each time at 2392x1546 (the 3.7 MP the live page runs at on this Mac) and prints
ms per frame, draw calls and triangles. Capture mode refreshes shadows every frame (the live page every other frame),
so read the numbers RELATIVE to the same probe on ws/base, not as live fps.
"""
import json, os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
name = sys.argv[1]; times = [float(x) for x in sys.argv[2:]] or [10, 24, 40, 51, 65, 75]
url = ("dist/crimson-loong.html" if name == "main" else f"ws/{name}/dist/crimson-loong.html") + "?capture"
js = ("(async()=>{const d=window.__dbg,gl=d.R.getContext(),px=new Uint8Array(4),out=[];"
      "const run=(t0,n)=>{const a=performance.now();for(let i=0;i<n;i++)d.frame(t0+i/60);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return(performance.now()-a)/n;};"
      f"for(const t of {json.dumps(times)}){{run(t,12);const ms=run(t,90),i=d.info;out.push({{t,ms:+ms.toFixed(2),calls:i.calls,tris:i.tris}});await new Promise(r=>setTimeout(r,30));}}"
      "const i=d.info;return JSON.stringify({w:i.w,h:i.h,loadMs:i.loadMs,probes:out});})()")
jid = f"{name}_perf"
r = subprocess.run([sys.executable, os.path.join(ROOT, "tools/cap.py"), jid, url, "", "--w", "2392", "--h", "1546", "--eval", js], capture_output=True, text=True)
done = os.path.join(ROOT, "tools/queue", jid + ".done.json")
try:
    res = json.load(open(done)); ev = json.loads(res["evalResult"])
    print(f"{name}: {ev['w']}x{ev['h']}  load {ev['loadMs']} ms")
    for p in ev["probes"]: print(f"  t={p['t']:5.1f}s  {p['ms']:6.2f} ms/frame  {p['calls']:4d} calls  {p['tris']/1e6:.2f} M tris")
    errs = [c for c in res.get("console", []) if c.startswith(("error", "EXCEPTION"))]
    if errs: print("CONSOLE:", "\n".join(errs[:10]))
except Exception as e:
    print("perf probe failed:", e); print(r.stdout[-1500:], r.stderr[-800:]); sys.exit(1)
