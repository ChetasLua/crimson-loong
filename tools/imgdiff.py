#!/usr/bin/env python3
"""Compare two frames.   python3 tools/imgdiff.py A.jpg B.jpg [--heat out.jpg] [--box x0,y0,x1,y1]

Prints mean absolute difference (0-255), the share of pixels that differ by more than 12, and the largest difference.
Two JPEG captures of the same deterministic frame differ by about 0.0-0.6 mean; a real change is well above 1.
--heat writes the difference image x8. --box limits the comparison to a rectangle.
"""
import sys
from PIL import Image, ImageChops, ImageStat
a = sys.argv[1:]
A, B = Image.open(a[0]).convert("RGB"), Image.open(a[1]).convert("RGB")
if A.size != B.size: print("sizes differ", A.size, B.size); sys.exit(1)
if "--box" in a:
    box = tuple(int(v) for v in a[a.index("--box") + 1].split(",")); A, B = A.crop(box), B.crop(box)
d = ImageChops.difference(A, B); g = d.convert("L"); st = ImageStat.Stat(d)
hist = g.histogram(); n = A.size[0] * A.size[1]
print(f"mean {sum(st.mean) / 3:.2f}   >12: {100 * sum(hist[13:]) / n:.2f}%   max {max(e[1] for e in d.getextrema())}")
if "--heat" in a:
    d.point(lambda v: min(255, v * 8)).save(a[a.index("--heat") + 1], quality=88)
