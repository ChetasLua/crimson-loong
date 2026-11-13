'use strict';
// ---- boot, loader, render loop, QA hooks -------------------------------------------------------------
(async () => {
  const canvas = document.getElementById('c'), $ = id => document.getElementById(id);
  const st = $('st'), ld = $('ld'), snd = $('snd'), cr = $('cr'), barBox = $('bar');
  // a machine that cannot draw the film gets one plain line under the title, never a blank frame
  const cannot = msg => { st.textContent = msg; st.style.opacity = 0.9; barBox.style.visibility = 'hidden'; window.__UNSUPPORTED = msg; window.__READY = true; };
  let R;
  try { R = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: false }); }
  catch (e) { cannot('this film needs WebGL 2'); return; }
  R.outputColorSpace = THREE.LinearSRGBColorSpace; R.toneMapping = THREE.NoToneMapping;
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  R.info.autoReset = false;
  const gl = R.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
  G.info.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?';
  // every target of the film (sky bake, detail maps, the HDR scene, bloom) is half float: ask the driver for one before building anything
  { const tx = gl.createTexture(), fb = gl.createFramebuffer(); gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_color_buffer_half_float');
    gl.bindTexture(gl.TEXTURE_2D, tx); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tx); R.resetState();
    if (!ok) { cannot('this film needs WebGL 2 float render targets'); return; } }
  const scene = new THREE.Scene(), fx = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.001);          // only switches USE_FOG on; our chunk does the work
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 6000);
  G.scene = scene; G.fx = fx; G.camera = camera; G.R = R;
  Post.init(R); Sky.init(R); scene.add(Sky.mesh);

  // sun + sky fill. The sun's own colour and strength stay put: its share and tint at every point of the world (cloud shadows, the
  // storm's shadow, the dusk line, gold going to ember) are applied in the shared light chunk (clSun, 05_glsl.js). The fill is the blue
  // of the evening sky from above and the warm bounce of rock and leaves from below; it deepens as the take runs (dayFill below).
  const sun = new THREE.DirectionalLight(SUN_COL, 6.9); sun.castShadow = true;
  const SC = new THREE.Vector3(0, 45, -40);
  sun.position.copy(SC).addScaledVector(SUN, 520); sun.target.position.copy(SC); scene.add(sun, sun.target);
  const sc = sun.shadow.camera; sc.left = -150; sc.right = 150; sc.top = 170; sc.bottom = -170; sc.near = 20; sc.far = 1100; sc.updateProjectionMatrix();
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.22; sun.shadow.radius = 2.4;
  G.sun = sun;
  const hemi = new THREE.HemisphereLight(new THREE.Color(0.40, 0.47, 0.74), new THREE.Color(0.44, 0.31, 0.24), 1.15); scene.add(hemi);
  const ENV0 = 0.45, FILLK = Q.has('fillk') ? +Q.get('fillk') : 0.0;       // the storm's cut of the fill is local (clFill in the light chunk); a global one would dim the loongs flying above it
  function dayFill(L) {
    const e = L.dusk, c = L.cool, g = L.gloom;
    hemi.color.setRGB(lerp(0.40, 0.27, e) + 0.04 * c, lerp(0.47, 0.35, e) + 0.03 * c, lerp(0.74, 0.68, e));
    hemi.groundColor.setRGB(lerp(0.44, 0.30, e) * (1 - 0.35 * c), lerp(0.31, 0.20, e) * (1 - 0.25 * c), lerp(0.24, 0.20, e));
    hemi.intensity = 1.15 * lerp(1, 0.80, e) * (1 - 0.12 * c) * (1 - FILLK * g);
    scene.environmentIntensity = ENV0 * lerp(1, 0.70, e) * (1 - 0.15 * c) * (1 - FILLK * g);
  }
  // cold storm light from the rift (no shadow). Created once at intensity 0: Film.apply sets its intensity every frame
  // (lightning flashes, and a low steady level while the white loong is in the valley, for a cool rim against the red dusk).
  const storm = new THREE.DirectionalLight(new THREE.Color(0.62, 0.78, 1.0), 0);
  storm.position.copy(Film.A.rift); storm.target.position.set(0, 40, -30); scene.add(storm, storm.target);
  G.storm = storm;

  // ---- sizing: device pixels, capped, 16:9 field of view kept (Vert+ on taller windows) ----
  // quality scales the pixel count; below 0.7 the low tier also halves the shadow map, MSAA and the instance count of the plants
  // that offer it (InstancedMesh.userData.thin: instances in random order, so the first half is an even thinning).
  let quality = 1, tier = 0, cssW = 0, cssH = 0, sizeDirty = false, sizeAt = 0, redraw = true, shadowDue = true, running = false, lastDpr = 0;
  const buf = new THREE.Vector2(), thin = [];
  function resize() {
    sizeDirty = false; redraw = true;
    const w = innerWidth, h = innerHeight; if (w < 2 || h < 2) return;       // a collapsed window: keep the last good size
    cssW = w; cssH = h; lastDpr = devicePixelRatio || 1;
    const cap = Math.sqrt(3.7e6 / (cssW * cssH));
    const pr = CAPTURE ? +(Q.get('dpr') || 1) : Math.min(lastDpr, cap) * quality;
    camera.aspect = cssW / cssH;
    R.setPixelRatio(pr); R.setSize(cssW, cssH, false);
    R.getDrawingBufferSize(buf); Post.size(buf.x, buf.y, tier ? 2 : 4);
  }
  // a window being dragged fires dozens of resize events a second: the targets are rebuilt at most once per 90 ms, in the frame loop
  addEventListener('resize', () => { if (running) sizeDirty = true; else resize(); }); resize();
  function setTier(k) {
    if (k === tier) return; tier = k;
    const sh = sun.shadow, sz = k ? 2048 : 4096; sh.mapSize.set(sz, sz); if (sh.map) { sh.map.dispose(); sh.map = null; } shadowDue = true;
    for (let i = 0; i < thin.length; i += 2) thin[i].count = k ? Math.ceil(thin[i + 1] / 2) : thin[i + 1];
  }

  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  // ---- staged build behind the loader ----
  const bar = barBox.firstElementChild;
  const tick = () => new Promise(r => CAPTURE ? setTimeout(r, 0) : requestAnimationFrame(() => r()));
  const steps = [];
  const add = (label, w, fn) => steps.push({ label, w, fn });
  add('painting the sky', 30, async prog => { let p = 0; while (p < 1) { p = Sky.bakeStep(R, 40); prog(p); await tick(); } scene.environment = Sky.makeEnv(R); scene.environmentIntensity = ENV0;  Tex.init(R); });
  if (typeof Rock !== 'undefined') add('raising the mountains', 14, async prog => { await Rock.build(scene, prog, tick); });
  if (typeof Arch !== 'undefined') add('building the red halls', 8, async prog => { await Arch.build(scene, prog, tick); });
  if (typeof Flora !== 'undefined') add('growing maples and pines', 14, async prog => { await Flora.build(scene, prog, tick); });
  if (typeof Dragon !== 'undefined') add('waking the dragons', 14, async prog => { await Dragon.build(scene, fx, prog, tick); if (typeof Wake !== 'undefined' && Wake.build) Wake.build(scene, fx); });
  if (typeof FX !== 'undefined') add('mist, water, leaves', 6, async prog => { await FX.build(scene, fx, prog, tick); });
  if (typeof Air !== 'undefined') add('moving the air', 3, async prog => { Air.build(scene, fx); prog(1); });
  if (typeof Score !== 'undefined') add('tuning the erhu', 6, async prog => { Score.start(); });
  add('first light', 8, async prog => { Daylight.plan(); frame(0); await tick(); frame(Film.DUR * 0.62); await tick(); });
  const tw = steps.reduce((a, s) => a + s.w, 0); let done = 0; const t0 = performance.now();
  for (const s of steps) {
    st.textContent = s.label; await tick();
    const ts = performance.now();
    await s.fn(p => { bar.style.width = ((done + s.w * p) / tw * 100).toFixed(1) + '%'; });
    done += s.w; bar.style.width = (done / tw * 100).toFixed(1) + '%';
    G.info[s.label] = Math.round(performance.now() - ts);
  }
  G.info.loadMs = Math.round(performance.now() - t0);
  scene.traverse(o => { if (o.isInstancedMesh && o.userData.thin) thin.push(o, o.count); });

  // ---- frame ----
  function frame(t, dt = 1 / 60) {
    G.t = t; G.uTime.value = t;
    Film.apply(t, camera, look);
    dayFill(Daylight.apply(t));
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    for (const f of G.tick) f(t, dt);
    Sky.update(camera, t);
    R.info.reset();
    Post.render(scene, fx, camera, Film.post);
  }
  window.__renderFrame = n => { frame(n / 60); return true; };
  window.__frameAt = t => { frame(t); return true; };
  window.__dbg = { G, scene, fx, camera, R, Post, Sky, frame, get info() { return { ...G.info, calls: R.info.render.calls, tris: R.info.render.triangles, w: Post.W, h: Post.H }; } };
  window.__INFO = G.info;

  if (CAPTURE) {
    // a lost context takes the baked sky, the detail maps and the environment with it: build the page again
    canvas.addEventListener('webglcontextrestored', () => location.reload());
    ld.remove(); window.__READY = true; return;
  }

  // ================= live playback =================
  const DUR = Film.DUR, mod = t => ((t % DUR) + DUR) % DUR, wrap = e => e - DUR * Math.round(e / DUR), secs = () => performance.now() / 1000;
  const HAS = typeof Score !== 'undefined', COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches), HINT = COARSE ? 'tap for sound' : 'click for sound';
  let pillT = 0, pillIs = '';
  const pill = (txt, hold) => { pillIs = txt; snd.textContent = txt; snd.style.opacity = 1; clearTimeout(pillT); if (hold) pillT = setTimeout(() => { snd.style.opacity = 0; }, hold); };

  // ---- clock ----
  // The film runs on its own clock (frame time minus tBase). Once the score plays, the film follows the score's clock, but only
  // while that clock is seen to run: a context that never starts, or stops, hands the film back to its own clock without a step.
  let tBase = secs() - (+(Q.get('t') || 0)), paused = Q.has('pause'), tHold = mod(+(Q.get('t') || 0));
  let locked = false, wasOn = false, sRef = 0, pRef = 0, autoMute = false, starting = false, deaf = 0;
  const free = p => mod(p - tBase);
  const playing = () => HAS && Score.playing;
  const audible = () => playing() && ('running' in Score ? Score.running : locked);
  function clock(p) {                                         // film time of the frame drawn at p (seconds on the performance clock)
    if (!playing()) { locked = wasOn = false; return free(p); }
    const s = Score.time();
    if (!wasOn || p - pRef > 2) { wasOn = true; sRef = s; pRef = p; }             // sound just started, or frames stopped for a while (hidden tab): measure afresh
    else if (p - pRef >= 0.12) { const rate = wrap(s - sRef) / (p - pRef), ok = rate > 0.5 && rate < 1.5; sRef = s; pRef = p;
      if (ok) locked = true; else if (locked) { locked = false; tBase = p - G.t; } }
    return locked ? s : free(p);
  }
  // Space: the picture holds its frame and the sound stops with it; both go on from the same film time
  const hush = () => { if (Score.pause) Score.pause(); else if (!Score.muted) { Score.toggle(); autoMute = Score.muted; } };
  function setPaused(on) {
    if (on === paused) return; paused = on;
    if (on) { tHold = G.t; if (playing()) hush(); pill('paused', 1400); }
    else { const p = secs(); tBase = p - tHold; last = 0; acc = 0; nfr = 0;
      if (playing()) { if (Score.resume) Score.resume(tHold); else if (autoMute && Score.muted) Score.toggle(); autoMute = false; wasOn = false; }
      if (playing()) { snd.style.opacity = 0; clearTimeout(pillT); } else pill(HINT); }
    redraw = true;
  }
  // sound: one start per film, however many clicks arrive while the score is still tuning; afterwards a click or M mutes and unmutes
  async function go() {
    if (!HAS || starting || paused) return;
    if (!Score.playing) {
      starting = true; pill('tuning…');
      try { await Score.play(() => paused ? tHold : free(secs())); } catch (e) { console.warn('sound did not start', e && e.message || e); }
      starting = false; wasOn = false;
      if (!Score.playing) { pill(HINT); return; }
      if (paused) hush();
      pill('running' in Score && !Score.running ? HINT : 'sound on', 'running' in Score && !Score.running ? 0 : 1500); return;
    }
    if (!audible()) { if (Score.resume) Score.resume(); pill(HINT); return; }      // the context has not started: this gesture asks again
    Score.toggle(); pill(Score.muted ? 'sound off' : 'sound on', 1200);
  }

  // ---- frame pacing and adaptive quality ----
  // The film is drawn at 60 frames a second: on a faster display (120 Hz) every second refresh is drawn, so frames stay evenly spaced.
  // Level 0-5 lower the pixel count (quality 1 .. 0.5); the last level keeps quality 0.5 and draws every second frame (a steady 30).
  // A level that holds its rate for 4 s climbs back one step; a climb that fails doubles the wait before the next try.
  const QL = [1, 0.86, 0.74, 0.636, 0.547, 0.5], HALF = QL.length, FIXED = Q.has('q') ? clamp(+Q.get('q') || 1, 0.3, 1) : 0;
  let level = 0, tickMs = 1000 / 60, slack = 0, d0 = 1, div = 1, minD = 1e9, nTick = 0, lastTs = 0, lastDraw = 0, last = 0, acc = 0, nfr = 0, slow = 0, goodMs = 0, upWait = 4000, probing = 0, fcount = 0, lost = false, lastMove = 0, curOff = false;
  function setLevel(L) {
    level = L; quality = FIXED || QL[Math.min(L, HALF - 1)]; setTier(quality < 0.7 ? 1 : 0); div = d0 * (L === HALF ? 2 : 1);
    G.info.quality = +quality.toFixed(2); G.info.level = L; resize();
  }
  // GPU time of a frame, where the browser offers timer queries: tells a climb that would not fit from one that would
  const tq = (() => { const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext) return null;
    const N = 4, qs = [], busy = []; for (let i = 0; i < N; i++) { qs.push(gl.createQuery()); busy.push(false); } let cur = -1, best = 0;
    return { begin() { if (cur >= 0) this.end(); for (let i = 0; i < N; i++) if (!busy[i]) { cur = i; break; } if (cur >= 0) gl.beginQuery(ext.TIME_ELAPSED_EXT, qs[cur]); },      // a frame that threw left its query open: close it first
      end() { if (cur >= 0) { gl.endQuery(ext.TIME_ELAPSED_EXT); busy[cur] = true; cur = -1; } },
      poll() { for (let i = 0; i < N; i++) if (busy[i] && gl.getQueryParameter(qs[i], gl.QUERY_RESULT_AVAILABLE)) { const ms = gl.getQueryParameter(qs[i], gl.QUERY_RESULT) / 1e6; busy[i] = false; if (!gl.getParameter(ext.GPU_DISJOINT_EXT) && ms > 0.2 && (best === 0 || ms < best)) best = ms; } },
      take() { const b = best; best = 0; return b; } }; })();
  function govern(avg, span) {
    const gpu = tq ? tq.take() : 0; G.info.ms = +avg.toFixed(1); if (gpu) G.info.gpuMs = +gpu.toFixed(1);
    if (HAS && Score.playing && !paused) { const a = audible(); deaf = a ? 0 : deaf + 1; if (deaf >= 2 && pillIs !== HINT && !starting) pill(HINT); else if (a && pillIs === HINT) pill('sound on', 1500); }      // the pill tells the truth about a context that did not start
    if ((devicePixelRatio || 1) !== lastDpr) sizeDirty = true;
    if (FIXED || avg > 100) return;                              // a stall or a tab coming back, not a slow GPU
    const target = Math.max(tickMs, slack) * div;              // slack: a display slower than 60 Hz is not a slow GPU
    if (avg > target * 1.17) {                                   // 19.5 ms at 60 frames a second
      goodMs = 0;
      if (level < HALF && ++slow >= 2) { slow = 0; if (probing) { upWait = Math.min(upWait * 2, 64000); probing = 0; } setLevel(level + 1); }
      return;
    }
    slow = 0; goodMs = avg < target * 1.07 ? goodMs + span : 0;
    if (probing && (probing += span) > 8000) { probing = 0; upWait = 4000; }      // the climb held
    if (level > 0 && goodMs >= upWait) {
      // what the next level up would cost, if all of this level's GPU time scaled with the pixels (it scales less: a safe overestimate)
      const k = level === HALF ? 1 : Math.pow(QL[level - 1] / QL[level], 2), over = gpu > 0 && gpu * k > 14 * tickMs * d0 / (1000 / 60);
      if (!over || goodMs >= upWait * 4) { goodMs = 0; probing = 1; setLevel(level - 1); }
    }
  }

  // ---- a lost WebGL context: hold the film, say so, and build the page again at the same film time once the context is back ----
  const rPrev = +(Q.get('r') || 0);
  if (rPrev) { try { const u = new URL(location.href); u.searchParams.delete('r'); u.searchParams.delete('t'); u.searchParams.delete('s'); history.replaceState(null, '', u); } catch (e) {} }
  let reloading = false;
  function rebuild() {
    if (reloading) return; reloading = true;
    if (Date.now() - rPrev < 30000) { st.textContent = 'the graphics context was lost twice: reload the page'; return; }      // never a reload loop
    const u = new URL(location.href); u.searchParams.set('t', G.t.toFixed(2)); u.searchParams.set('r', Date.now()); if (playing() && (!Score.muted || autoMute)) u.searchParams.set('s', 1);
    location.replace(u);
  }
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); if (lost) return; lost = true; tHold = G.t;
    if (playing()) hush();
    st.textContent = 'restoring the picture'; barBox.style.visibility = 'hidden'; ld.style.transition = 'none'; ld.style.opacity = 1; document.body.appendChild(ld);
    setTimeout(() => { if (!document.hidden) rebuild(); }, 5000);      // no restore event came: a fresh page gets a fresh context
  });
  canvas.addEventListener('webglcontextrestored', rebuild);
  addEventListener('visibilitychange', () => { last = 0; acc = 0; nfr = 0; if (lost && !document.hidden) setTimeout(rebuild, 1500); });

  function loop(ts) {
    requestAnimationFrame(loop);
    if (lost) return;
    const d = ts - lastTs; lastTs = ts;
    // the display's own refresh interval is the shortest gap between two callbacks; from it, how many refreshes one film frame takes
    if (d > 2 && d < minD) minD = d;
    if (++nTick === 8 || nTick % 64 === 0) { if (minD < 50) { tickMs = Math.min(minD, 1000 / 60); slack = minD > 17.5 && minD < 27 ? minD : 0; const n = Math.max(1, Math.round(1000 / 60 / tickMs)); if (n !== d0) { d0 = n; div = d0 * (level === HALF ? 2 : 1); } } minD = 1e9; }
    if (sizeDirty && ts - sizeAt > 90) { sizeAt = ts; resize(); }
    if (!curOff && ts - lastMove > 2000) { curOff = true; canvas.style.cursor = 'none'; }
    if (paused) { if (redraw) { redraw = false; R.shadowMap.autoUpdate = false; R.shadowMap.needsUpdate = true; frame(tHold); } last = 0; return; }
    if (ts - lastDraw < (div - 0.5) * tickMs) return;             // not this refresh
    lastDraw = ts;
    const t = clock(ts / 1000);
    R.shadowMap.autoUpdate = false; R.shadowMap.needsUpdate = shadowDue || (fcount++ % (tier ? 4 : 2)) === 0; shadowDue = false;       // shadows refresh every other frame (every fourth on the low tier)
    if (tq) { tq.poll(); tq.begin(); }
    frame(t, last ? Math.min(0.1, (ts - last) / 1000) : 1 / 60);
    if (tq) tq.end();
    redraw = false;
    if (last) { const g = ts - last; if (g > 250) { acc = 0; nfr = 0; } else { acc += g; nfr++; if (acc >= 750) { const a = acc / nfr, span = acc; acc = 0; nfr = 0; govern(a, span); } } }
    last = ts;
  }

  // ---- controls: click or tap and M for sound, Space to pause ----
  ld.style.opacity = 0; setTimeout(() => { if (!lost) ld.remove(); }, 1300);
  pill(HINT); cr.style.opacity = 1; setTimeout(() => { cr.style.opacity = 0; }, 9000);
  addEventListener('pointermove', e => { look.tx = (e.clientX / innerWidth - 0.5); look.ty = (e.clientY / innerHeight - 0.5); lastMove = e.timeStamp; if (curOff) { curOff = false; canvas.style.cursor = ''; } });
  addEventListener('click', () => { if (paused) setPaused(false); else go(); });
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;      // shortcuts of the system and the browser are not ours
    if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
    else if (e.key === 'm' || e.key === 'M') go();
  });
  window.__dbg.live = { setPaused, setLevel, go, get state() { return { paused, locked, level, tier, quality, div, tickMs: +tickMs.toFixed(2), audible: audible() }; } };
  if (FIXED) setLevel(0);
  G.info.quality = +quality.toFixed(2); G.info.level = level;
  running = true; lastMove = performance.now(); requestAnimationFrame(loop);
  if (Q.get('s') === '1' && HAS && Score.resume) go();                // the sound was on when a lost context rebuilt the page: ask for it again
  window.__READY = true;
})().catch(e => { console.error('BOOT', e && e.stack || e); const s = document.getElementById('st'); if (s) s.textContent = 'error: ' + (e && e.message || e); window.__ERR = String(e && e.stack || e); });
