#!/usr/bin/env python3
"""Isolated workspaces: each builder edits its own copy of src/, so a half-edited file never breaks someone else's build.

  tools/ws.py new NAME [FROM]     create ws/NAME/src as a copy of ws/FROM/src (FROM omitted = the main src/). Refuses to overwrite.
  tools/ws.py snap NAME LABEL     save ws/NAME/src as ws/NAME/snap/LABEL (do this before every risky round)
  tools/ws.py restore NAME LABEL  put ws/NAME/snap/LABEL back as ws/NAME/src
  tools/ws.py diff NAME [FROM]    list files that differ between ws/NAME/src and ws/FROM/src (or main src/)
  tools/ws.py pull NAME FROM f..  copy the named files from ws/FROM/src (or 'main') into ws/NAME/src

Build a workspace with `python3 tools/build.py NAME`; capture it at the url `ws/NAME/dist/crimson-loong.html?capture`.
"""
import filecmp, os, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def src(n):
    if n in (None, "main"): return os.path.join(ROOT, "src")
    if "@" in n: w, lab = n.split("@", 1); return os.path.join(ROOT, "ws", w, "snap", lab)      # FROM may be NAME@LABEL: a snapshot
    return os.path.join(ROOT, "ws", n, "src")
a = sys.argv[1:]
if len(a) < 2: print(__doc__); sys.exit(1)
cmd, name = a[0], a[1]
if cmd == "new":
    frm = a[2] if len(a) > 2 else None
    dst = src(name)
    if os.path.exists(dst): print(f"ws/{name} already exists, leaving it as it is"); sys.exit(0)
    assert os.path.isdir(src(frm)), f"no such source: {src(frm)}"
    shutil.copytree(src(frm), dst); os.makedirs(os.path.join(ROOT, "ws", name, "dist"), exist_ok=True)
    print(f"created ws/{name}/src from {'main src' if frm in (None, 'main') else 'ws/' + frm}")
elif cmd == "snap":
    d = os.path.join(ROOT, "ws", name, "snap", a[2])
    if os.path.exists(d): shutil.rmtree(d)
    shutil.copytree(src(name), d); print(f"snapshot ws/{name}/snap/{a[2]}")
elif cmd == "restore":
    d = os.path.join(ROOT, "ws", name, "snap", a[2]); assert os.path.isdir(d), f"no snapshot {d}"
    shutil.rmtree(src(name)); shutil.copytree(d, src(name)); print(f"restored ws/{name}/src from snap/{a[2]}")
elif cmd == "diff":
    frm = a[2] if len(a) > 2 else None; A, B = src(name), src(frm)
    names = sorted(set(os.listdir(A)) | set(os.listdir(B)))
    for f in names:
        pa, pb = os.path.join(A, f), os.path.join(B, f)
        if not os.path.exists(pb): print("added   ", f)
        elif not os.path.exists(pa): print("removed ", f)
        elif not filecmp.cmp(pa, pb, shallow=False): print("changed ", f)
elif cmd == "pull":
    frm = a[2]
    for f in a[3:]:
        shutil.copy2(os.path.join(src(frm), f), os.path.join(src(name), f)); print(f"pulled {f} from {frm}")
else:
    print(__doc__); sys.exit(1)
