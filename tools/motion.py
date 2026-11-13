#!/usr/bin/env python3
"""How alive is the world at a film time? Freezes the film camera where it is at time T and compares the picture
at T and T+DT, so only things that really move in the world count (camera travel is removed).

  python3 tools/motion.py WORKSPACE T [DT=1.0] [--id NAME]

Prints, for the whole frame and for a 3x3 grid (top row = sky, bottom row = lake and foreground), the share of pixels
(after an 8x shrink, so flicker and grain do not count) that changed by more than 6 levels, and the mean change.
A photograph scores 0 everywhere. Leaves the two frames in qa/NAME/ (default NAME = motion_WORKSPACE_T).
"""
import json, os, subprocess, sys
from PIL import Image, ImageChops
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
a = sys.argv[1:]
ws, T = a[0], float(a[1]); DT = float(a[2]) if len(a) > 2 and not a[2].startswith("--") else 1.0
name = a[a.index("--id") + 1] if "--id" in a else f"motion_{ws}_{str(T).replace('.', 'p')}"
url = ("dist/crimson-loong.html" if ws == "main" else f"ws/{ws}/dist/crimson-loong.html") + "?capture"
cap = [sys.executable, os.path.join(ROOT, "tools/cap.py")]
js = (f"(__dbg.frame({T}),(()=>{{const c=__dbg.camera,d=new THREE.Vector3();c.getWorldDirection(d);const p=c.position;"
      "return JSON.stringify([p.x,p.y,p.z,p.x+d.x*100,p.y+d.y*100,p.z+d.z*100,c.fov].map(v=>+v.toFixed(3)))})())")
subprocess.run(cap + [name + "_q", url, "", "--eval", js], capture_output=True, text=True)
cam = json.loads(json.load(open(os.path.join(ROOT, "tools/queue", name + "_q.done.json")))["evalResult"])
f0, f1 = round(T * 60), round((T + DT) * 60)
subprocess.run(cap + [name, url + "&cam=" + ",".join(str(v) for v in cam), f"{f0},{f1}"], capture_output=True, text=True)
A = Image.open(os.path.join(ROOT, "qa", name, f"f{f0:05d}.jpg")).convert("RGB")
B = Image.open(os.path.join(ROOT, "qa", name, f"f{f1:05d}.jpg")).convert("RGB")
# shrink 8x first: leaf flicker and grain average out, only motion you can see at a glance is left
A, B = (im.resize((im.size[0] // 8, im.size[1] // 8), Image.BOX) for im in (A, B))
d = ImageChops.difference(A, B).convert("L"); W, H = d.size
def stat(box):
    h = d.crop(box).histogram(); n = sum(h)
    return 100 * sum(h[7:]) / n, sum(i * v for i, v in enumerate(h)) / n
p, m = stat((0, 0, W, H))
print(f"{ws} t={T}s dt={DT}s  camera {cam}")
print(f"  whole frame: {p:5.1f} % of pixels moved, mean change {m:.2f}")
for r, lab in enumerate(("top", "mid", "low")):
    cells = [stat((c * W // 3, r * H // 3, (c + 1) * W // 3, (r + 1) * H // 3)) for c in range(3)]
    print(f"  {lab}: " + "   ".join(f"{q:5.1f} % ({v:4.1f})" for q, v in cells))
