#!/usr/bin/env node
// capd — headless-Chrome capture daemon for the crimson-loong film.
// Runs OUTSIDE the Bash sandbox (Terminal panel). Takes jobs from tools/queue/*.job.json one at a time,
// renders exact frames through window.__renderFrame(n) on the real GPU (ANGLE/Metal), writes JPEG/PNG
// stills, optional WAV export, and a *.done.json with timings + console errors.
// Stop: touch tools/queue/STOP (closes Chrome, exits). Zero dependencies (Node >= 22 global WebSocket).
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const QUEUE = path.join(ROOT, 'tools/queue');
const PROF = process.env.CAPD_PROF || path.join(ROOT, 'tools/.chrome-prof');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wav': 'audio/wav' };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- static server for the project (ES modules need http) ----
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
log('static server http://127.0.0.1:' + PORT + ' root', ROOT);

// ---- chrome ----
fs.mkdirSync(PROF, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + PROF,
  '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false',
  '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--no-first-run',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--crimsonloong-capd-marker'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res, rej) => {
  let buf = ''; const to = setTimeout(() => rej(new Error('chrome start timeout')), 20000);
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(to); res(m[1]); } });
});
log('chrome', chrome.pid, wsUrl);
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));
let nextId = 1; const pending = new Map(); const listeners = new Set();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.to); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  else for (const l of listeners) l(m);
});
function send(method, params = {}, sessionId, ms = 120000) {
  const id = nextId++;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { pending.delete(id); rej(new Error('timeout ' + method)); }, ms);
    pending.set(id, { res, rej, to });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runJob(job) {
  const t0 = Date.now();
  const W = job.width || 1920, H = job.height || 1080;
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const consoleLines = [];
  const onMsg = m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400));
    if (m.method === 'Runtime.exceptionThrown') consoleLines.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 800));
  };
  listeners.add(onMsg);
  const out = { id: job.id, ok: false, frames: 0, console: consoleLines };
  try {
    await send('Runtime.enable', {}, sessionId); await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: job.dpr || 1, mobile: false }, sessionId);
    const url = /^(https?|file):/.test(job.url) ? job.url : `http://127.0.0.1:${PORT}/${job.url.replace(/^\//, '')}`;
    await send('Page.navigate', { url }, sessionId);
    const ready = job.ready || '__READY';
    const deadline = Date.now() + (job.readyTimeoutMs || 90000);
    for (;;) {
      const r = await send('Runtime.evaluate', { expression: `!!window.${ready}`, returnByValue: true }, sessionId);
      if (r.result.value) break;
      if (consoleLines.some(l => l.startsWith('EXCEPTION') || l.includes('BOOT'))) throw new Error('page exception before ready');
      if (Date.now() > deadline) throw new Error('ready timeout');
      await sleep(150);
    }
    const info = await send('Runtime.evaluate', { expression: `JSON.stringify(window.__INFO||{})`, returnByValue: true }, sessionId);
    out.info = JSON.parse(info.result.value || '{}');
    if (job.eval) { const r = await send('Runtime.evaluate', { expression: job.eval, awaitPromise: true, returnByValue: true }, sessionId); out.evalResult = r.result.value; }
    let frames = job.frames || [];
    if (!Array.isArray(frames)) { const a = []; for (let f = frames.from; f <= frames.to; f += (frames.step || 1)) a.push(f); frames = a; }
    const outDir = path.join(ROOT, job.out || ('qa/' + job.id));
    fs.mkdirSync(outDir, { recursive: true });
    const fmt = job.fmt || 'jpeg';
    const times = [];
    for (const f of frames) {
      const a = Date.now();
      const r = await send('Runtime.evaluate', { expression: job.live ? `new Promise(r => setTimeout(() => r(true), ${job.liveWait || 400}))` : `window.__renderFrame(${f})`, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error('renderFrame ' + f + ': ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
      const shot = await send('Page.captureScreenshot', { format: fmt, quality: fmt === 'jpeg' ? (job.quality || 88) : undefined, fromSurface: true, captureBeyondViewport: false }, sessionId);
      fs.writeFileSync(path.join(outDir, `f${String(f).padStart(5, '0')}.${fmt === 'jpeg' ? 'jpg' : 'png'}`), Buffer.from(shot.data, 'base64'));
      times.push(Date.now() - a); out.frames++;
    }
    out.msPerFrame = times.length ? Math.round(times.reduce((x, y) => x + y, 0) / times.length) : 0;
    if (job.wav) {
      const r = await send('Runtime.evaluate', { expression: `window.__exportWav ? window.__exportWav() : null`, awaitPromise: true, returnByValue: true }, sessionId, 600000);
      if (r.result.value) { fs.writeFileSync(path.join(ROOT, job.wav), Buffer.from(r.result.value, 'base64')); out.wav = job.wav; }
    }
    out.ok = true;
  } catch (e) { out.error = String(e && e.stack || e); }
  finally {
    listeners.delete(onMsg);
    try { await send('Target.closeTarget', { targetId }, undefined, 10000); } catch {}
  }
  out.ms = Date.now() - t0;
  return out;
}

let busy = false, stop = false;
async function tick() {
  if (busy || stop) return;
  if (fs.existsSync(path.join(QUEUE, 'STOP'))) { stop = true; return shutdown(); }
  const jobs = fs.readdirSync(QUEUE).filter(f => f.endsWith('.job.json')).sort();
  if (!jobs.length) return;
  busy = true;
  const jf = path.join(QUEUE, jobs[0]);
  const runF = jf.replace('.job.json', '.run.json');
  let job; try { job = JSON.parse(fs.readFileSync(jf, 'utf8')); fs.renameSync(jf, runF); } catch (e) { busy = false; return; }
  log('job', job.id, job.url, Array.isArray(job.frames) ? job.frames.length + ' frames' : JSON.stringify(job.frames));
  const res = await runJob(job);
  fs.writeFileSync(runF.replace('.run.json', '.done.json'), JSON.stringify(res, null, 1));
  try { fs.unlinkSync(runF); } catch {}
  log('done', job.id, res.ok ? 'ok' : 'FAIL', res.frames + 'f', res.ms + 'ms', res.error ? res.error.slice(0, 200) : '');
  busy = false;
}
function shutdown() {
  log('STOP — closing chrome');
  try { fs.unlinkSync(path.join(QUEUE, 'STOP')); } catch {}
  try { fs.unlinkSync(path.join(QUEUE, 'capd.pid')); } catch {}
  try { ws.close(); } catch {}
  try { chrome.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { chrome.kill('SIGKILL'); } catch {} server.close(); process.exit(0); }, 1500);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
chrome.on('exit', c => { log('chrome exited', c); try { fs.unlinkSync(path.join(QUEUE, 'capd.pid')); } catch {} if (!stop) process.exit(1); });
fs.writeFileSync(path.join(QUEUE, 'capd.pid'), String(process.pid));
setInterval(tick, 400);
log('capd ready; queue', QUEUE);
