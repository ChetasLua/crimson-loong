#!/usr/bin/env python3
"""Client for capd: submit a capture job, wait for it, optionally tile the frames into a labelled sheet.

usage: cap.py <id> <url> <frames> [--w 1920 --h 1080 --fps 60 --sheet cols --tile 480 --png --wav out.wav --eval JS]
frames: "0,30,60" | "0:600:30" (from:to:step, inclusive)
"""
import json, os, sys, time, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Q = os.path.join(ROOT, "tools/queue")
a = sys.argv[1:]
def opt(k, d=None):
    return a[a.index(k) + 1] if k in a else d
jid, url, fr = a[0], a[1], a[2]
if ":" in fr:
    s, e, st = (int(x) for x in fr.split(":"))
    frames = list(range(s, e + 1, st))
else:
    frames = [int(x) for x in fr.split(",") if x]
fps = float(opt("--fps", 60))
job = {"id": jid, "url": url, "frames": frames, "width": int(opt("--w", 1920)), "height": int(opt("--h", 1080)),
       "out": f"qa/{jid}", "fmt": "png" if "--png" in a else "jpeg", "quality": int(opt("--q", 88))}
if opt("--wav"): job["wav"] = opt("--wav")
if opt("--dpr"): job["dpr"] = float(opt("--dpr"))
if "--live" in a: job["live"] = True; job["liveWait"] = int(opt("--livewait", 400))
if opt("--eval"): job["eval"] = opt("--eval")
outdir = os.path.join(ROOT, job["out"])
for f in glob.glob(outdir + "/f*.jpg") + glob.glob(outdir + "/f*.png"):
    os.remove(f)
done = os.path.join(Q, jid + ".done.json")
if os.path.exists(done): os.remove(done)
def daemon_alive():
    try: os.kill(int(open(os.path.join(Q, "capd.pid")).read().strip()), 0); return True
    except Exception: return False
DEAD = "capd is NOT running. Start it with: tools/capd-ensure.sh   then run this capture again."
# First come, first served. capd takes queued jobs in NAME order, which starved every id late in the alphabet, so each
# client takes a numbered ticket and files its job only when its ticket is the oldest and no other job is waiting.
# A ticket is kept fresh while its client waits; one that goes 20 s without a touch belongs to a dead client and is dropped.
tkn = f"{int(time.time() * 1000):013d}_{jid}.ticket"; tk = os.path.join(Q, tkn)
jobf = os.path.join(Q, jid + ".job.json"); tw = time.time()
try:
    while True:
        now = time.time(); open(tk, "a").close(); os.utime(tk)
        names = os.listdir(Q); live = []
        for f in names:
            if not f.endswith(".ticket"): continue
            try:
                if now - os.path.getmtime(os.path.join(Q, f)) > 20: os.remove(os.path.join(Q, f))
                else: live.append(f)
            except OSError: pass
        if min(live, default=tkn) >= tkn and not any(f.endswith(".job.json") for f in names): break
        if now - tw > 20 and int(now - tw) % 20 == 5 and not daemon_alive():
            time.sleep(1.0)
            if not daemon_alive(): print(DEAD); sys.exit(3)
        if now - tw > 3600: print("TIMEOUT waiting in line for capd (an hour)"); sys.exit(2)
        time.sleep(0.3)
    tmp = os.path.join(Q, jid + ".tmp")
    json.dump(job, open(tmp, "w")); os.rename(tmp, jobf)
finally:
    try: os.remove(tk)
    except OSError: pass
t0 = time.time(); limit = float(opt("--timeout", 1500))
def give_up(msg, code):
    try: os.remove(jobf)          # do not leave a job nobody is waiting for
    except OSError: pass
    print(msg); sys.exit(code)
while not os.path.exists(done):
    time.sleep(0.4)
    if int(time.time() - t0) % 20 == 5 and not daemon_alive():
        time.sleep(1.0)
        if not daemon_alive() and not os.path.exists(done): give_up(DEAD, 3)
    if time.time() - t0 > limit:
        give_up("TIMEOUT waiting for capd (the queue is shared; run tools/capd-ensure.sh and try again)", 2)
time.sleep(0.1)
res = json.load(open(done))
print(json.dumps({k: res.get(k) for k in ["id", "ok", "frames", "ms", "msPerFrame", "info", "evalResult", "error"]}, indent=None)[:3000])
errs = [c for c in res.get("console", []) if c.startswith(("error", "EXCEPTION", "warning"))]
if errs: print("CONSOLE:", "\n".join(errs[:25]))
if res.get("ok") and opt("--sheet"):
    from PIL import Image, ImageDraw, ImageFont
    cols = int(opt("--sheet")); tw = int(opt("--tile", 480))
    fs = sorted(glob.glob(outdir + "/f*.*"))
    ims = [Image.open(f) for f in fs]
    th = int(tw * ims[0].height / ims[0].width)
    rows = (len(ims) + cols - 1) // cols
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 15)
    sh = Image.new("RGB", (cols * (tw + 4) + 4, rows * (th + 20) + 4), (18, 18, 18)); d = ImageDraw.Draw(sh)
    for k, (im, f) in enumerate(zip(ims, fs)):
        x = 4 + (k % cols) * (tw + 4); y = 4 + (k // cols) * (th + 20)
        sh.paste(im.convert("RGB").resize((tw, th), Image.LANCZOS), (x, y + 18))
        n = int(os.path.basename(f)[1:6]); d.text((x + 2, y + 1), f"f{n}  {n / fps:.2f}s", fill=(255, 210, 0), font=font)
    p = os.path.join(ROOT, "qa", jid + "_sheet.jpg"); sh.save(p, quality=87); print("SHEET", p, sh.size)
