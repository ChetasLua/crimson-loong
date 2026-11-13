'use strict';
// ---- the film: one 90 s take. Every picture and sound event reads these constants --------------------
//   Film.T        the FROZEN beat sheet (seconds)
//   Film.A        world anchors the effects and the sky read: rift, clash1, boltHit, clash2, splash, exitR, exitW (fixed points),
//                 beamMid and pearl (rewritten every frame); pure samplers Film.beamMidAt(t, out), Film.pearlAt(t, out),
//                 Film.pearlLine(t, out) (the pearl's path without its wobble), Film.fovAt(t)
//   Film.STRIKES  times of the OMEN lightning hits; Film.flashAt(t) is the lightning envelope (0..1+) picture and sound share
//   Film.post     { fade, exposure, shake, flash, god, bloom, white } read by Post.render (white: 0..1 white-out envelope at BLAST)
//   Film.camAt(t, out) is the crane's position (pure). Film.apply(t, camera, look) also drives Sky.fx and the cold storm light G.storm
const Film = (() => {
  const DUR = 90;
  // FROZEN beat sheet (seconds). 80 bpm: 0.75 s per beat, 3 s per bar, 30 bars. Picture, FX and score all hit these exactly.
  const T = {
    EMERGE: 9.0,                    // the red loong slides round the front of the spire
    DRUMS: 15.0,                    // drums enter; red climbs and crests the spire
    CHARGE: 21.4,                   // red inhales, throat glows
    ROAR: 24.0, ROAR_END: 27.0,     // red roars fire at the sky: a challenge
    OMEN: 27.0,                     // thunder answers; lightning inside the cloud tower; a pale rift opens
    DESCENT: 30.0,                  // the white loong breaks out of the cloud and spirals down
    FACEOFF: 36.0,                  // the two circle the spire, eye to eye
    WROAR: 39.0, WROAR_END: 41.2,   // white roars (frost-lightning breath), red snarls back
    CLASH1: 42.0,                   // first mid-air collision
    FIRE2: 46.5,                    // chase: red breathes fire across white's path (about 1.6 s)
    BOLT: 49.5,                     // white spits a lightning bolt; it misses red and shatters rock
    CLASH2: 51.0,                   // second collision: they bite, lock and entwine
    SPLASH: 57.0,                   // the entwined tumble hits the lake; they tear apart
    BEAM: 63.0,                     // fire jet and frost-lightning jet meet head on
    BLAST: 67.5,                    // the meeting point detonates
    FINALE: 69.0,                   // both spiral upward, chasing the pearl the blast left behind
    GONG: 84.0,                     // they vanish into the clouds
    OUT: 86.6 };
  const mono = (xs, ys) => {        // monotone cubic through keys: a crane that never stops dead between two marks
    const n = xs.length, d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]);
    return x => { if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1]; let i = 0; while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]; };
  };
  const track = (rows, col) => mono(rows.map(r => r[0]), rows.map(r => r[col]));
  // ---- the crane: position keys [t, x, y, z, fov]. It stays in the valley corridor in front of the gate, over the lake ----
  const CAM = [
    // 0-9: the crane starts a metre above the bank, behind its grass and a yellow shrub, and rises out to the right over the
    // lake: the grass, the bank's edge, the pavilions, the halls and the spires all slide against each other before anything happens
    [0, -12.6, 6.3, 85.6, 50], [3.2, -10.7, 6.95, 83.5, 49.5], [6.2, -7.7, 7.95, 79.9, 48.5], [9, -4.9, 8.7, 76.5, 47.5], [12, -4.6, 9.1, 75.3, 42], [15, -4.3, 9.4, 74.3, 31], [17.2, -4.05, 9.75, 73.4, 31], [18.4, -3.98, 9.85, 73.1, 37], [19.3, -3.9, 9.9, 72.8, 47], [20.65, -3.8, 10.0, 72.5, 50],
    [21.2, -3.7, 10.3, 72.2, 29.5], [21.7, -3.65, 10.5, 72.1, 30.5], [22.2, -3.6, 13, 72, 34], [23.2, -3.45, 25, 71.8, 43], [24.0, -3.35, 30.5, 71.7, 45], [27.0, -3.1, 31, 71.5, 46], [28.6, -2.8, 26.5, 72.5, 52],
    [30, -2.6, 22, 73.5, 52], [30.8, -2.5, 21.4, 74.1, 49], [32.0, -2.3, 20.5, 74.8, 24], [32.45, -2.25, 20.3, 75, 25], [33.6, -2.05, 18.6, 73.2, 44], [34.2, -1.9, 17.2, 70.5, 33], [35.2, -1.6, 16, 67.5, 34], [36, -1.4, 15.4, 66, 44], [39, -1.15, 15.8, 66, 39], [41.2, -1.0, 16.0, 66, 47.5], [42.6, -0.8, 16.2, 67.5, 53],
    [44.4, 0, 17, 69, 42], [45.6, 0.25, 17.3, 68, 27], [46.4, 0.4, 17.5, 67, 25], [47.2, 0.2, 17, 67.7, 27], [47.8, -0.2, 16.3, 69, 38], [48.4, -0.6, 15.5, 71, 56], [49.95, -0.9, 15.85, 72.4, 54.6], [50.95, -1.0, 16.0, 73, 31], [52.4, -0.9, 15.6, 73.6, 32], [54, -0.9, 14.8, 75.5, 46], [56.0, -1.3, 15.4, 79, 57],
    [57, -1.5, 16, 80.5, 62], [58.4, -0.8, 15.6, 79, 60], [60, 1.0, 14.5, 72, 56], [63, 3.5, 20, 60, 52], [67.4, 5.0, 27, 45.5, 50], [69, 5.0, 27.5, 45, 52],
    [72, 4.2, 26.5, 47, 48], [79, 2.3, 24, 53, 24], [83.3, 1.2, 22.3, 57.3, 25], [84.2, 0.6, 21.5, 59, 31], [85.3, -4.5, 15, 70, 46], [86.4, -10.5, 8.2, 82, 50], [87.2, -12.3, 6.45, 85.2, 50], [90, -12.6, 6.3, 85.6, 50]];      // (84.2-87.2: down to the opening mark as the tails go in, so the valley at dusk holds three seconds before the fade)
  const camX = track(CAM, 1), camY = track(CAM, 2), camZ = track(CAM, 3), camF = track(CAM, 4);
  function camAt(t, out) { return out.set(camX(t) + Math.sin(t * 0.21) * 0.2, camY(t) + Math.sin(t * 0.33 + 1) * 0.1, camZ(t)); }
  // ---- world anchors (metres). The choreography in 60_dragon.js is built from these; retune the values, keep the names. ----
  const HEART = (typeof Sky !== 'undefined' && Sky.stormDir) ? Sky.stormDir(T.DESCENT, new THREE.Vector3()).normalize() : new THREE.Vector3(-32, 287, -214).normalize();
  const A = {
    rift: camAt(T.DESCENT, new THREE.Vector3()).addScaledVector(HEART, 160),   // where white breaks out of the cloud: on the lens's line to the heart of the storm tower (the cloud is a backdrop: only the direction is fixed, and at 160 m the entrance is large in frame)
    clash1: new THREE.Vector3(5, 51.5, 13.5),         // first collision: the two mouths meet here, above the lake in front of the gate
    boltHit: new THREE.Vector3(-56.1, 78.6, 2.5),   // white's bolt lands here: a bare face high on the left cliff, in clear view of the lens (refined at build by a ray cast on the real rock)
    clash2: new THREE.Vector3(7, 70, -4),           // second collision: the top of the knot, above the gate
    splash: new THREE.Vector3(-6.0, 0.05, 45.1),       // where the knot hits the lake (water plane y = 0.05): the open pool in front of the lens
    exitR: new THREE.Vector3(-1.0, 0.05, 25.5),       // where red bursts out of the lake again: up the channel, behind the column
    exitW: new THREE.Vector3(2.2, 0.05, 50.0),       // where white bursts out of the lake again: right of the column and in front of it
    beamMid: new THREE.Vector3(6, 74.7, -15.5),     // every frame: where the two breath jets meet (valid BEAM..BLAST)
    pearl: new THREE.Vector3(6, 74.7, -15.5),       // every frame: the pearl (valid BLAST..GONG + 2)
  };
  const STORM_FROM = camAt(T.DESCENT, new THREE.Vector3()).addScaledVector(HEART, 262);          // where the cold storm light comes from
  const PEARL = { x: 6, y: 74.7, z: -15.5, t0: 67.9, t1: 84.0 };          // the pearl is born here; it reaches the rift at t1
  const STRIKES = [27.45, 28.20, 28.65, 29.55];                           // OMEN lightning: the four hits the score's thunder already lands on (OMEN + 0.45, 1.2, 1.65, 2.55)
  const post = { fade: 1, exposure: 1, shake: 0, flash: 0, god: 0.55, bloom: 0.06, white: 0, kick: 0 };   // kick is written by FX
  const win = (t, a, b, up = 0.3, dn = 0.4) => sm(a, a + up, t) * (1 - sm(b - dn, b, t));
  // smooth value noise in time (pure): the flicker of the beam
  const h1 = i => { const x = Math.sin(i * 127.1 + 3.7) * 43758.5453; return x - Math.floor(x); };
  const flick = (t, hz) => { const x = t * hz, i = Math.floor(x), f = x - i; return lerp(h1(i), h1(i + 1), f * f * (3 - 2 * f)); };
  // lightning envelope: each hit is a fast flash with a re-strike 0.11 s later
  const strikes = t => { let f = 0; for (const s of STRIKES) { const d = t - s; if (d >= 0 && d < 0.7) f += Math.exp(-d / 0.07) + (d > 0.11 ? 0.6 * Math.exp(-(d - 0.11) / 0.05) : 0); } return f; };
  const beamFlick = t => win(t, T.BEAM, T.BLAST, 0.3, 0.1) * (0.15 + 0.35 * flick(t, 9));
  const stormFlash = t => strikes(t) + 1.3 * pulse(t, T.DESCENT - 0.04, 0.04, 0.22) + 1.2 * pulse(t, T.BOLT, 0.03, 0.14) + 1.5 * pulse(t, T.BLAST, 0.04, 0.3) + 0.9 * pulse(t, T.GONG - 0.02, 0.03, 0.5);   // the last: the cloud flashes as it takes the two in
  const flashAt = t => stormFlash(t) + beamFlick(t);
  // the frame before a flash is a touch darker: the contrast comes from the dip, not from more light
  const DIPS = STRIKES.concat([T.DESCENT - 0.04, T.BOLT]), preDip = t => { for (const s of DIPS) if (t >= s - 0.036 && t < s - 0.002) return 1; return 0; };
  // gust strength (0..1+) and its integral (so leaves speed up without jumping)
  const gust = t => 0.10 + 0.06 * Math.sin(t * 0.37) + 0.5 * pulse(t, T.EMERGE + 1.2, 1.6, 3.2) + 0.4 * pulse(t, T.DRUMS - 0.1, 0.25, 1.8) + 0.25 * pulse(t, T.DRUMS + 5, 2, 4) + 0.5 * pulse(t, 19.4, 0.4, 1.9) + 1.0 * pulse(t, T.ROAR + 0.12, 0.28, 2.6)
    + 0.45 * pulse(t, T.DESCENT + 3.2, 1.5, 3) + 0.5 * pulse(t, T.CLASH1, 0.2, 2.0) + 0.45 * pulse(t, 47.6, 0.6, 1.6) + 0.3 * pulse(t, T.BOLT + 0.1, 0.15, 1.2) + 0.6 * pulse(t, T.CLASH2, 0.2, 2.2) + 0.6 * pulse(t, T.SPLASH, 0.2, 2.5)
    + 0.3 * win(t, T.BEAM, T.BLAST, 1, 0.2) + 1.4 * pulse(t, T.BLAST + 0.1, 0.25, 3.5);
  const WN = DUR * 60 + 2, wtab = new Float32Array(WN); for (let i = 1; i < WN; i++) wtab[i] = wtab[i - 1] + (0.9 + 2.4 * gust(i / 60)) / 60;
  const windPhase = t => { const x = clamp(t, 0, DUR) * 60, i = Math.min(WN - 2, x | 0); return lerp(wtab[i], wtab[i + 1], x - i); };
  const shakeAmt = t => pulse(t, T.ROAR, 0.22, 1.15) + 0.25 * pulse(t, T.DRUMS, 0.05, 0.5) + 0.3 * pulse(t, T.GONG, 0.05, 0.6) + 0.3 * pulse(t, 20.9, 0.4, 0.7) + 0.2 * pulse(t, 17.15, 0.05, 0.4) + 0.45 * pulse(t, 19.55, 0.05, 0.5)
    + 0.25 * strikes(t) + 0.3 * pulse(t, T.WROAR + 0.1, 0.2, 0.9) + 0.8 * pulse(t, T.CLASH1, 0.03, 0.5) + 0.35 * pulse(t, 48.3, 0.4, 0.6) + 0.5 * pulse(t, T.BOLT + 0.08, 0.03, 0.4) + 1.0 * pulse(t, T.CLASH2, 0.03, 0.55) + 0.9 * pulse(t, T.SPLASH, 0.04, 0.7)
    + 0.22 * win(t, T.BEAM, T.BLAST, 0.5, 0.1) * (0.6 + 0.4 * flick(t, 7)) + 1.7 * pulse(t, T.BLAST, 0.04, 0.9);

  // ---- pure samplers (any t, any order) ----
  const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tC = new THREE.Vector3(), tE = new THREE.Vector3(), tF = new THREE.Vector3();
  const ready = () => typeof Dragon !== 'undefined' && Dragon.white && Dragon.red.ready && Dragon.white.ready;
  // where the two breath jets meet: on the line between the two heads. Red drives it toward white, white drives it back past
  // the middle toward red, and it settles in the centre before it blows
  const beamPush = keyed([[T.BEAM, 0], [T.BEAM + 1.25, 0.27], [T.BEAM + 2.75, -0.245], [T.BEAM + 3.9, 0.02], [T.BLAST, 0]]);
  function beamMidAt(t, out) {
    if (!ready()) return out.set(PEARL.x, PEARL.y, PEARL.z);
    Dragon.red.headAt(t, tA); Dragon.white.headAt(t, tB);
    out.lerpVectors(tA, tB, 0.5 + beamPush(t) + 0.012 * Math.sin(t * 17) * win(t, T.BEAM, T.BLAST, 0.5, 0.2)); out.y += 1.4; return out;      // the mouths ride 1.5 m above the line between the two head points when the heads are tipped back to aim: the jets meet here
  }
  // the pearl: born where the jets met, it hangs, drifts up slowly in front of the spire while the pair circles it, then climbs
  // faster and faster on a wide spiral once round the main spire and up to the rift; beyond the rift it runs on up the lens's sight line
  const SPX = 10, SPZ = -66;                                             // the main spire's axis (Rock.L.main)
  const pA0 = Math.atan2(PEARL.z - SPZ, PEARL.x - SPX), pR0 = Math.hypot(PEARL.x - SPX, PEARL.z - SPZ);
  let pA1 = Math.atan2(A.rift.z - SPZ, A.rift.x - SPX); while (pA1 < pA0 + TAU) pA1 += TAU;                                // clockwise seen from above, more than one full turn
  const pR1 = Math.hypot(A.rift.x - SPX, A.rift.z - SPZ), pRad = keyed([[0, pR0], [0.25, 35], [0.62, 38], [1, pR1]]);
  const riftOut = new THREE.Vector3().subVectors(A.rift, camAt(T.GONG, new THREE.Vector3())).normalize();                  // beyond the rift: straight on up the lens's sight line
  const PK = [[PEARL.t0, 0, PEARL.y + 6], [69.6, 0.012, 83.5], [72, 0.045, 91], [74.5, 0.12, 101], [77, 0.30, 120], [80.5, 0.64, 134], [PEARL.t1, 1, A.rift.y]];   // [t, way round, height]
  const pG = track(PK, 1), pY = track(PK, 2), PV = 150;                   // PV: speed into the cloud beyond the rift (m/s)
  const STAR = new THREE.Vector3(8.5, 127, -66);                         // when it is all over the pearl hangs here: the evening star above the main spire
  const spiral = (t, out) => { const g = pG(t), a = lerp(pA0, pA1, g), r = pRad(g); return out.set(SPX + r * Math.cos(a), pY(t), SPZ + r * Math.sin(a)); };
  const pV1 = spiral(PEARL.t1, new THREE.Vector3()).sub(spiral(PEARL.t1 - 0.05, new THREE.Vector3())).multiplyScalar(20), pS1 = pV1.length();     // its velocity as it reaches the rift
  function pearlLine(t, out) {                                           // the pearl's path without its wobble: what the pair winds round
    const t1 = PEARL.t1; if (t < t1 - 0.6) return spiral(t, out);
    // into the rift without a kink: the spiral (carried on along its last heading) hands over to the ray up the sight line across 1.2 s
    const tau = t - t1, q = tau <= 0 ? 0 : tau < 0.7 ? tau * tau / 1.4 : tau - 0.35, k = sm(t1 - 0.6, t1 + 0.6, t);
    if (tau <= 0) spiral(t, out); else out.copy(A.rift).addScaledVector(pV1, tau);
    return out.multiplyScalar(1 - k).addScaledVector(tB.copy(A.rift).addScaledVector(riftOut, pS1 * tau + (PV - pS1) * q), k); }
  function pearlAt(t, out) {
    pearlLine(t, out);
    const w = sm(T.BLAST, T.BLAST + 1.3, t); out.x += 0.5 * Math.sin(t * 1.3) * w; out.z += 0.5 * Math.cos(t * 1.1) * w;
    if (w < 1) { beamMidAt(T.BLAST, tC); out.lerpVectors(tC, out, w); }
    if (t > T.GONG + 1.9) out.copy(STAR);                                 // gone into the rift with the two; what is left is the evening star
    return out;
  }
  // a head as the crane follows it: smoothed over a second, so the frame leads and trails instead of twitching
  // (over a longer window while white spirals down and while the pair winds up into the sky: the crane tilts, it does not chase)
  const followW = keyed([[0, 0.17], [29.5, 0.17], [30.4, 0.3], [31.9, 0.09], [32.5, 0.09], [33.3, 0.42], [34.5, 0.42], [36, 0.2], [42.3, 0.2], [43.2, 0.3], [46.5, 0.3], [47.5, 0.17], [68, 0.17], [70, 0.45], [90, 0.45]]);
  function follow(d, t, out) { const w = followW(t); out.set(0, 0, 0); for (let k = -3; k <= 3; k++) out.addScaledVector(d.headAt(t + k * w, tE), (4 - Math.abs(k)) / 16); return out; }
  // ---- what the crane looks at: weights on the red head, the white head and fixed marks, keyed against the beats ----
  //        t     base  red   white rift  lake  jets  pearl bolt     (jets: where the two breath jets meet; bolt: where white's bolt lands)
  const LOOK = [
    [0, 1, 0, 0, 0, 0, 0, 0, 0], [9, 1, 0.06, 0, 0, 0, 0, 0, 0], [12, 0.8, 0.2, 0, 0, 0, 0, 0, 0], [14.3, 0.45, 0.55, 0, 0, 0, 0, 0, 0], [15, 0.3, 0.7, 0, 0, 0, 0, 0, 0], [17.2, 0.25, 0.75, 0, 0, 0, 0, 0, 0], [19.2, 0.1, 0.9, 0, 0, 0, 0, 0, 0], [19.65, 0.06, 0.62, 0, 0, 0.32, 0, 0, 0], [20.65, 0.04, 0.50, 0, 0, 0.46, 0, 0, 0],
    [21.15, 0.02, 0.98, 0, 0, 0, 0, 0, 0], [22, 0.02, 0.98, 0, 0, 0, 0, 0, 0], [23.6, 0.15, 0.85, 0, 0, 0, 0, 0, 0], [26.9, 0.15, 0.85, 0, 0, 0, 0, 0, 0],
    [28.6, 0.15, 0.4, 0, 0.45, 0, 0, 0, 0], [30, 0.12, 0.36, 0, 0.52, 0, 0, 0, 0], [30.55, 0.08, 0.2, 0.72, 0, 0, 0, 0, 0], [31.4, 0.05, 0.1, 0.85, 0, 0, 0, 0, 0], [32.3, 0.03, 0.05, 0.92, 0, 0, 0, 0, 0], [32.7, 0.2, 0.6, 0.2, 0, 0, 0, 0, 0], [33.05, 0.12, 0.88, 0, 0, 0, 0, 0, 0],
    [35.1, 0.08, 0.92, 0, 0, 0, 0, 0, 0], [36, 0.16, 0.42, 0.42, 0, 0, 0, 0, 0], [41.2, 0.1, 0.45, 0.45, 0, 0, 0, 0, 0],
    [42.4, 0.1, 0.45, 0.45, 0, 0, 0, 0, 0], [44.3, 0.3, 0.35, 0.35, 0, 0, 0, 0, 0], [45.4, 0.06, 0.47, 0.47, 0, 0, 0, 0, 0], [47.6, 0.04, 0.48, 0.48, 0, 0, 0, 0, 0], [48.3, 0.1, 0.45, 0.45, 0, 0, 0, 0, 0], [48.5, 0.1, 0.45, 0.45, 0, 0, 0, 0, 0], [49.5, 0.07, 0.34, 0.34, 0, 0, 0, 0, 0.25], [50.15, 0.07, 0.34, 0.34, 0, 0, 0, 0, 0.25],
    [51, 0.04, 0.48, 0.48, 0, 0, 0, 0, 0], [55.5, 0.06, 0.47, 0.47, 0, 0, 0, 0, 0],
    [56.8, 0.04, 0.2, 0.2, 0, 0.56, 0, 0, 0], [57.5, 0.04, 0.2, 0.2, 0, 0.56, 0, 0, 0], [58.3, 0.04, 0.1, 0.1, 0, 0.76, 0, 0, 0], [59.5, 0.03, 0.06, 0.06, 0, 0.85, 0, 0, 0], [60.5, 0.16, 0.4, 0.4, 0, 0.04, 0, 0, 0], [61.2, 0.12, 0.44, 0.44, 0, 0, 0, 0, 0], [63, 0.04, 0.48, 0.48, 0, 0, 0, 0, 0], [67.5, 0.04, 0.48, 0.48, 0, 0, 0, 0, 0],
    [67.9, 0.04, 0.4, 0.4, 0, 0, 0, 0.16, 0], [68.6, 0.04, 0.22, 0.22, 0, 0, 0, 0.52, 0], [69.5, 0.06, 0.2, 0.2, 0, 0, 0, 0.54, 0], [72, 0.04, 0.3, 0.3, 0, 0, 0, 0.36, 0], [74, 0.02, 0.43, 0.43, 0, 0, 0, 0.12, 0], [83.4, 0.02, 0.43, 0.43, 0, 0, 0, 0.12, 0],
    [84.0, 0, 0.14, 0.14, 0.62, 0, 0, 0.1, 0], [84.7, 0.35, 0.03, 0.03, 0.55, 0, 0, 0.04, 0], [85.3, 0.9, 0, 0, 0.1, 0, 0, 0, 0], [86.0, 1, 0, 0, 0, 0, 0, 0, 0], [90, 1, 0, 0, 0, 0, 0, 0, 0]];
  const lk = [1, 2, 3, 4, 5, 6, 7, 8].map(c => track(LOOK, c)), lw = [0, 0, 0, 0, 0, 0, 0, 0];
  //         t     yaw   pitch (degrees; yaw + = the lens turns right of its target, pitch + = above it)
  const AIM = [[0, 0, 0], [22.2, 0, 0], [23.7, 14, 6.5], [26.8, 14, 6.5], [28.4, 11, 0], [30.0, 11, 0], [31.4, 2, 0], [33, 0, 0], [90, 0, 0]];
  const aimY = track(AIM, 1), aimP = track(AIM, 2);
  const LAKE = new THREE.Vector3(-5, 7, 44), FURROW = new THREE.Vector3(-3.8, 2.5, 30);      // the lake mark: where the knot goes in (SPLASH); before that, the furrow red ploughs down the channel (19.6-21)
  function lookAt(t, out) {
    const e = sm(-8, DUR + 6, t), b = sm(T.CHARGE, T.ROAR + 0.4, t) * (1 - sm(T.ROAR_END, T.DESCENT, t));
    out.set(lerp(3.5, 1.5, e), lerp(38, 46, e) + b * 2, lerp(-40, -52, e));                       // base: up the valley at the main spire
    if (!ready()) return out;
    let s = 0; for (let i = 0; i < 8; i++) { lw[i] = Math.max(0, lk[i](t)); s += lw[i]; }
    out.multiplyScalar(lw[0] / s);
    if (lw[1] > 0) out.addScaledVector(follow(Dragon.red, t, tF), lw[1] / s);
    if (lw[2] > 0) out.addScaledVector(follow(Dragon.white, t, tF), lw[2] / s);
    if (lw[3] > 0) out.addScaledVector(A.rift, lw[3] / s);
    if (lw[4] > 0) out.addScaledVector(t < 40 ? FURROW : LAKE, lw[4] / s);
    if (lw[5] > 0) out.addScaledVector(beamMidAt(Math.min(t, T.BLAST), tF), lw[5] / s);
    if (lw[6] > 0) out.addScaledVector(pearlAt(t, tF), lw[6] / s);
    if (lw[7] > 0) out.addScaledVector(A.boltHit, lw[7] / s);
    // framing offsets: the lens is turned off its target by a keyed yaw and pitch (thirds, head room, room for a breath to cross the frame)
    const yw = aimY(t), pt = aimP(t);
    if (yw !== 0 || pt !== 0) { camAt(t, tE); const dx = out.x - tE.x, dy = out.y - tE.y, dz = out.z - tE.z, dh = Math.hypot(dx, dz), d = Math.hypot(dh, dy), az = Math.atan2(dx, -dz) + rad(yw), el = Math.atan2(dy, dh) + rad(pt);
      out.set(tE.x + d * Math.cos(el) * Math.sin(az), tE.y + d * Math.sin(el), tE.z - d * Math.cos(el) * Math.cos(az)); }
    return out;
  }

  const P = new THREE.Vector3(), L = new THREE.Vector3(), m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0), q2 = new THREE.Quaternion(), eu = new THREE.Euler(), tD = new THREE.Vector3();
  const fxDir = { flash: new THREE.Vector3(0, 1, 0), rift: new THREE.Vector3(0, 1, 0), ring: new THREE.Vector3(0, 1, 0) };
  let lx = 0, ly = 0;
  const override = Q.get('cam') ? Q.get('cam').split(',').map(Number) : null;
  function apply(t, camera, look) {
    const ok = ready();
    camAt(t, P); lookAt(t, L);
    pearlAt(t, A.pearl); beamMidAt(t, A.beamMid);
    if (override) { P.set(override[0], override[1], override[2]); L.set(override[3], override[4], override[5]); }
    camera.position.copy(P); m.lookAt(P, L, UP); camera.quaternion.setFromRotationMatrix(m);
    // viewer nudge + handheld breath + shake
    if (look) { lx += (look.tx - lx) * 0.05; ly += (look.ty - ly) * 0.05; }
    const sh = shakeAmt(t);
    eu.set(-ly * 0.10 + Math.sin(t * 0.47) * 0.004 + sh * 0.010 * Math.sin(t * 71.3) * Math.sin(t * 13.1 + 1), -lx * 0.14 + Math.sin(t * 0.31 + 2) * 0.005 + sh * 0.008 * Math.sin(t * 63.7 + 2), Math.sin(t * 0.23) * 0.004 + sh * 0.012 * Math.sin(t * 57.1 + 4), 'YXZ');
    camera.quaternion.multiply(q2.setFromEuler(eu));
    camera.position.x += sh * 0.12 * Math.sin(t * 49.0); camera.position.y += sh * 0.14 * Math.sin(t * 61.0 + 1.3);
    // 16:9 keeps the keyed vertical field; taller windows keep the horizontal field instead
    const base = (override && override[6]) || camF(t), a169 = 16 / 9;
    camera.fov = camera.aspect >= a169 ? base : Math.min(2 * Math.atan(Math.tan(rad(base) / 2) * a169 / camera.aspect) * 180 / Math.PI, Math.max(base, 100));
    G.uGust.value = gust(t); G.uWind.value = windPhase(t);
    // ---- storm: sky controls (the sky builder's Sky.fx) and the cold light from the rift ----
    const tShut = ok ? Math.max(Dragon.red.tGone, Dragon.white.tGone) + 0.05 : T.GONG + 1.6;       // the rift snaps shut behind the last tail tip
    const sf = stormFlash(t), bf = beamFlick(t), presence = sm(T.DESCENT - 0.5, T.DESCENT + 2.5, t) * (1 - sm(T.GONG - 2, T.GONG + 1, t));
    fxDir.rift.subVectors(A.rift, P).normalize();
    { // each OMEN hit lands a little off the rift; the bolt and the beam flash where they happen
      let k = -1; for (let i = 0; i < STRIKES.length; i++) if (t >= STRIKES[i]) k = i;
      if (t >= T.GONG - 1) fxDir.flash.copy(fxDir.rift);
      else if (t >= T.BEAM) fxDir.flash.subVectors(A.beamMid, P).normalize();
      else if (t >= T.BOLT && ok) fxDir.flash.subVectors(Dragon.white.headAt(T.BOLT, tD), P).normalize();
      else fxDir.flash.copy(fxDir.rift).add(tD.set(0.22 * Math.sin(k * 2.4 + 1), 0.10 * Math.sin(k * 4.1), 0.05 * Math.cos(k * 3.3)).multiplyScalar(t < T.DESCENT - 0.1 ? 1 : 0)).normalize(); }
    fxDir.ring.subVectors(beamMidAt(T.BLAST, tD), P).normalize();
    if (typeof Sky !== 'undefined' && Sky.fx) { const s = Sky.fx;
      s.flash = sf + bf; s.flashDir.copy(fxDir.flash);
      s.rift = Math.max(sm(28.3, T.DESCENT - 0.25, t) * (1 - sm(T.DESCENT + 1.3, T.DESCENT + 3.3, t)), 0.85 * sm(T.GONG - 2.4, T.GONG - 0.2, t) * (1 - sm(tShut, tShut + 0.45, t)));   // the rift opens for white, and again to take the two in
      s.riftDir.copy(fxDir.rift);
      s.cool = 0.35 * sm(T.DESCENT, T.DESCENT + 4, t) * (1 - sm(T.FINALE + 8, T.GONG, t));
      const rk = (t - T.BLAST) / 3; s.ring = rk > 0 && rk < 1 ? rk : 0; s.ringDir.copy(fxDir.ring); }
    if (G.storm) { G.storm.position.copy(STORM_FROM); G.storm.intensity = 0.55 * presence * (1 - 0.6 * win(t, T.BEAM - 1, T.BLAST, 1, 0.2)) + Math.min(6.5 * sf, 4.2) + 0.5 * bf;
      const fl = clamp(sf * 0.8); G.storm.color.setRGB(lerp(0.62, 0.80, fl), lerp(0.78, 0.74, fl), 1.0); }       // a flash is violet-white, the standing storm light blue-white
    // ---- grade pulses ----
    post.fade = sm(0.0, 2.8, t) * (1 - sm(88.3, DUR - 0.25, t));
    post.shake = sh;
    post.white = pulse(t, T.BLAST, 0.034, 0.028);
    post.flash = pulse(t, T.ROAR + 0.05, 0.1, 0.6) + 0.35 * strikes(t) + 0.8 * pulse(t, T.CLASH1, 0.04, 0.3) + 0.7 * pulse(t, T.BOLT, 0.03, 0.25) + 0.9 * pulse(t, T.CLASH2, 0.04, 0.35)
      + 0.6 * pulse(t, T.SPLASH, 0.05, 0.4) + 0.5 * pulse(t, T.BEAM, 0.08, 0.5) + 1.1 * pulse(t, T.BLAST, 0.04, 0.3);
    post.exposure = 1.0 + 0.10 * pulse(t, T.ROAR + 0.05, 0.12, 0.8) + 0.10 * Math.min(strikes(t), 1.5) + 0.22 * pulse(t, T.CLASH1, 0.04, 0.25) + 0.25 * pulse(t, T.BOLT, 0.03, 0.18) + 0.25 * pulse(t, T.CLASH2, 0.04, 0.3)
      + 0.12 * pulse(t, T.SPLASH, 0.05, 0.3) + 0.10 * win(t, T.BEAM, T.BLAST, 0.4, 0.1) + 4 * post.white - 0.28 * preDip(t);
    post.exposure *= lerp(1, 0.3, sm(T.OUT, 88.2, t));                 // OUT: the light goes, dusk two stops deeper
    post.bloom = 0.06 + 0.05 * pulse(t, T.ROAR, 0.2, 1.5) + 0.04 * pulse(t, T.CLASH1, 0.05, 0.5) + 0.04 * pulse(t, T.BOLT, 0.04, 0.4) + 0.05 * pulse(t, T.CLASH2, 0.05, 0.6)
      + 0.05 * win(t, T.BEAM, T.BLAST, 0.6, 0.1) + 0.22 * pulse(t, T.BLAST, 0.05, 0.7);
  }
  return { DUR, T, A, PEARL, STRIKES, CAM, apply, post, gust, windPhase, shakeAmt, flashAt, beamMidAt, pearlAt, pearlLine, camAt, lookAt, fovAt: t => camF(t) };
})();
