/* Bloom Kart Sprint — 100% original top-down kart racer.
   No Nintendo characters, tracks, items, art, or code. All procedural. */
(() => {
'use strict';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const hud = document.getElementById('hud');
const elLap = document.getElementById('hud-lap');
const elPos = document.getElementById('hud-pos');
const elTime = document.getElementById('hud-time');
const itemSlot = document.getElementById('item-slot');
const screenTitle = document.getElementById('screen-title');
const screenMsg = document.getElementById('screen-msg');
const screenEnd = document.getElementById('screen-end');
const msgBig = document.getElementById('msg-big');
const msgSub = document.getElementById('msg-sub');
const touchUI = document.getElementById('touch');

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
}
window.addEventListener('resize', resize);
resize();

// ---------- Track (original "Sunny Bloom Loop") ----------
const WORLD = { w: 2200, h: 1500 };
const N = 72;
const center = [];
for (let i = 0; i < N; i++) {
  const t = (i / N) * Math.PI * 2;
  // Original blobby oval — not a copy of any MK track.
  const rx = 760 + Math.sin(t * 2 + 0.7) * 130 + Math.sin(t * 3) * 60;
  const ry = 500 + Math.cos(t * 2 - 0.4) * 110 + Math.sin(t * 5) * 28;
  center.push({
    x: WORLD.w / 2 + Math.cos(t) * rx,
    y: WORLD.h / 2 + Math.sin(t) * ry,
  });
}
const ROAD_W = 190;

function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
function nearestIdx(x, y) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < N; i++) {
    const d = dist2(x, y, center[i].x, center[i].y);
    if (d < bd) { bd = d; best = i; }
  }
  return { idx: best, dist: Math.sqrt(bd) };
}
function isOnRoad(x, y) { return nearestIdx(x, y).dist < ROAD_W / 2; }

// Item boxes at fixed waypoints, alternating left/right offset
const ITEM_SPOTS = [6, 16, 26, 36, 46, 56, 66].map((wi, k) => {
  const a = center[wi], b = center[(wi + 1) % N];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const side = k % 2 === 0 ? 1 : -1;
  return { wi, x: a.x + nx * 42 * side, y: a.y + ny * 42 * side, active: true, timer: 0 };
});
// Boost pads (original "bloom pads")
const PADS = [12, 44].map(wi => ({ wi, x: center[wi].x, y: center[wi].y, r: 44 }));
// Slick hazards dropped by players
let slicks = [];

// ---------- Karts ----------
const TOTAL_LAPS = 3;
const COLORS = ['#ff4d6d', '#35e0a1', '#5a8cff', '#ffb428'];
const NAMES = ['YOU', 'PIP', 'MOSS', 'RUE']; // original bots

function startPose(slot) {
  // staggered grid behind start line (idx 0)
  const wi = (N - 4 + Math.floor(slot / 2)) % N;
  const a = center[wi], b = center[(wi + 1) % N];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const lateral = (slot % 2 === 0 ? -38 : 38);
  return {
    x: a.x + nx * lateral - Math.cos(ang) * (slot < 2 ? 10 : 55),
    y: a.y + ny * lateral - Math.sin(ang) * (slot < 2 ? 10 : 55),
    angle: ang,
  };
}
function makeKart(i, isPlayer) {
  const p = startPose(i);
  return {
    i, name: NAMES[i], isPlayer,
    color: isPlayer ? document.getElementById('color-pick').value : COLORS[i],
    x: p.x, y: p.y, angle: p.angle,
    speed: 0, maxSpeed: 335 + (isPlayer ? 6 : [-8, 4, 12][i - 1] || 0),
    lap: 1, lastIdx: (N - 4 + Math.floor(i / 2)) % N,
    progress: 0, totalProgress: -1000 * (i * 10),
    item: null, shieldT: 0, boostT: 0, spinT: 0,
    driftDir: 0, driftCharge: 0,
    lapStart: 0, lastLapMs: 0, finished: false, finishMs: 0,
    aiOffset: [-40, 30, -15][i - 1] || 0,
    aiItemCd: 3 + Math.random() * 4,
    offroad: false,
  };
}
let karts = [];
let state = 'title'; // title | countdown | race | done
let raceStartMs = 0, nowMs = 0, countdownT0 = 0;
let bestLapMs = Infinity;

// ---------- Input ----------
const input = { left: false, right: false, gas: false, drift: false, item: false };
function bindHold(el, key) {
  const on = e => { e.preventDefault(); input[key] = true; el.classList.add('on'); };
  const off = e => { e.preventDefault(); input[key] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}
bindHold(document.getElementById('t-left'), 'left');
bindHold(document.getElementById('t-right'), 'right');
bindHold(document.getElementById('t-gas'), 'gas');
bindHold(document.getElementById('t-drift'), 'drift');
document.getElementById('t-item').addEventListener('pointerdown', e => {
  e.preventDefault(); useItem(karts[0]);
});
const keys = {};
window.addEventListener('keydown', e => {
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true; syncKeys();
  if (e.key === ' ' && state === 'race') useItem(karts[0]);
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; syncKeys(); });
function syncKeys() {
  input.left = !!(keys['arrowleft'] || keys['a']) || document.getElementById('t-left').classList.contains('on');
  input.right = !!(keys['arrowright'] || keys['d']) || document.getElementById('t-right').classList.contains('on');
  const kbGas = !!(keys['arrowup'] || keys['w']);
  const kbDrift = !!(keys['arrowdown'] || keys['s'] || keys['shift']);
  // touch buttons manage their own .on; merge here for keyboard
  if (kbGas) input.gas = true;
  if (keys['arrowleft']===false && keys['a']===false) { /* keep touch */ }
  input.drift = kbDrift || document.getElementById('t-drift').classList.contains('on');
  // autogas default on for mobile
  if (document.getElementById('autogas').checked && karts[0] && !karts[0].finished) input.gas = input.gas || true;
}
// Re-evaluate touch-held state each frame (pointerleave edge cases)
function pollTouch() {
  const L = document.getElementById('t-left'), R = document.getElementById('t-right'),
        G = document.getElementById('t-gas'), D = document.getElementById('t-drift');
  const auto = document.getElementById('autogas').checked;
  input.left = input.left || L.classList.contains('on') || !!keys['arrowleft'] || !!keys['a'];
  input.right = input.right || R.classList.contains('on') || !!keys['arrowright'] || !!keys['d'];
  input.gas = G.classList.contains('on') || !!keys['arrowup'] || !!keys['w'] || (auto && state === 'race');
  input.drift = D.classList.contains('on') || !!keys['arrowdown'] || !!keys['s'] || !!keys['shift'];
}

// ---------- Items ----------
function grantRandom(k) {
  if (k.item) return;
  const r = Math.random();
  // last place gets better odds of turbo
  const pos = racePos(k);
  let type = 'turbo';
  if (r < (pos > 2 ? 0.55 : 0.4)) type = 'turbo';
  else if (r < 0.8) type = 'shield';
  else type = 'slick';
  k.item = type;
}
function useItem(k) {
  if (!k || !k.item || state !== 'race') return;
  if (k.spinT > 0) return;
  const t = k.item; k.item = null;
  if (t === 'turbo') { k.boostT = 1.6; }
  else if (t === 'shield') { k.shieldT = 8; }
  else if (t === 'slick') {
    slicks.push({ x: k.x - Math.cos(k.angle) * 46, y: k.y - Math.sin(k.angle) * 46, life: 25 });
    if (slicks.length > 14) slicks.shift();
  }
}
const ITEM_ICON = { turbo: '⚡', shield: '🫧', slick: '🛢️' };
const ITEM_NAME = { turbo: 'TURBO', shield: 'BUBBLE', slick: 'SLICK' };

// ---------- Race flow ----------
document.getElementById('btn-start').addEventListener('click', startRace);
document.getElementById('btn-again').addEventListener('click', () => {
  screenEnd.classList.add('hidden'); startRace();
});
function startRace() {
  slicks = [];
  ITEM_SPOTS.forEach(s => { s.active = true; s.timer = 0; });
  karts = [makeKart(0, true), makeKart(1, false), makeKart(2, false), makeKart(3, false)];
  karts.forEach(k => { k.color = k.isPlayer ? document.getElementById('color-pick').value : k.color; });
  bestLapMs = Infinity;
  screenTitle.classList.add('hidden');
  screenEnd.classList.add('hidden');
  hud.classList.remove('hidden');
  touchUI.classList.remove('hidden');
  state = 'countdown';
  countdownT0 = performance.now();
  screenMsg.classList.remove('hidden');
}
function fmt(ms) {
  if (!isFinite(ms)) return '—';
  const t = Math.max(0, ms) / 1000;
  const m = Math.floor(t / 60), s = t % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
function racePos(k) {
  const order = [...karts].sort((a, b) => {
    if (a.finished && b.finished) return a.finishMs - b.finishMs;
    if (a.finished) return -1; if (b.finished) return 1;
    return b.totalProgress - a.totalProgress;
  });
  return order.indexOf(k) + 1;
}
const ORD = ['1ST', '2ND', '3RD', '4TH'];

// ---------- Update ----------
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (t - last) / 1000);
  last = t; nowMs = t;
  // reset per-frame merged keys then poll
  const keepL = document.getElementById('t-left').classList.contains('on');
  const keepR = document.getElementById('t-right').classList.contains('on');
  const keepG = document.getElementById('t-gas').classList.contains('on');
  const keepD = document.getElementById('t-drift').classList.contains('on');
  input.left = keepL; input.right = keepR; input.gas = keepG; input.drift = keepD;
  pollTouch();

  if (state === 'countdown') {
    const e = (t - countdownT0) / 1000;
    const label = e < 0.7 ? '3' : e < 1.4 ? '2' : e < 2.1 ? '1' : 'GO!';
    msgBig.textContent = label;
    msgSub.textContent = label === 'GO!' ? 'Hold GAS, steer with ◀ ▶' : 'Get ready…';
    if (e > 2.5) {
      screenMsg.classList.add('hidden');
      state = 'race'; raceStartMs = t;
      karts.forEach(k => { k.lapStart = t; });
    }
  }
  if (state === 'race' || state === 'done') update(dt, t);
  render(t / 1000);
  updateHud(t);
}
function update(dt, t) {
  // item boxes respawn
  for (const s of ITEM_SPOTS) {
    if (!s.active) { s.timer -= dt; if (s.timer <= 0) s.active = true; }
  }
  for (const s of slicks) s.life -= dt;
  slicks = slicks.filter(s => s.life > 0);

  for (const k of karts) {
    if (k.finished) continue;
    // AI steering
    if (!k.isPlayer && state === 'race') driveAI(k, dt, t);
    else if (k.isPlayer && state === 'race') drivePlayer(k, dt);
    else { k.speed *= (1 - 2 * dt); }

    // integrate
    k.x += Math.cos(k.angle) * k.speed * dt;
    k.y += Math.sin(k.angle) * k.speed * dt;

    // timers
    if (k.boostT > 0) k.boostT -= dt;
    if (k.shieldT > 0) k.shieldT -= dt;
    if (k.spinT > 0) {
      k.spinT -= dt;
      k.angle += 9 * dt;
      k.speed *= (1 - 3 * dt);
    }

    // road / offroad
    const near = nearestIdx(k.x, k.y);
    k.offroad = near.dist > ROAD_W / 2;

    // progress + laps
    const prev = k.lastIdx;
    const cur = near.idx;
    let dIdx = cur - prev;
    if (dIdx < -N / 2) dIdx += N;
    if (dIdx > N / 2) dIdx -= N;
    // ignore teleport jumps
    if (Math.abs(dIdx) < 12) k.totalProgress += dIdx;
    // lap crossing start/finish (idx 0)
    if (prev > N - 8 && cur < 8) {
      k.lap++;
      const lapMs = t - k.lapStart; k.lapStart = t; k.lastLapMs = lapMs;
      if (k.isPlayer) bestLapMs = Math.min(bestLapMs, lapMs);
      if (k.lap > TOTAL_LAPS && !k.finished) {
        k.finished = true; k.finishMs = t - raceStartMs;
        if (k.isPlayer) endRace();
      }
    } else if (prev < 8 && cur > N - 8) {
      k.lap = Math.max(1, k.lap - 1); // went backwards
    }
    k.lastIdx = cur;

    // item pickup
    if (state === 'race' && !k.item) {
      for (const s of ITEM_SPOTS) {
        if (!s.active) continue;
        if (dist2(k.x, k.y, s.x, s.y) < 42 * 42) {
          s.active = false; s.timer = 6;
          grantRandom(k);
          break;
        }
      }
    }
    // boost pads
    if (state === 'race' && k.spinT <= 0) {
      for (const p of PADS) {
        if (dist2(k.x, k.y, p.x, p.y) < p.r * p.r) {
          if (k.boostT <= 0.1) k.boostT = Math.max(k.boostT, 0.9);
        }
      }
    }
    // slick collision
    if (state === 'race' && k.spinT <= 0 && k.shieldT <= 0) {
      for (const s of slicks) {
        if (dist2(k.x, k.y, s.x, s.y) < 34 * 34) {
          s.life = 0; k.spinT = 1.1; k.speed *= 0.45; k.boostT = 0;
          break;
        }
      }
    }
  }
  // AI uses items on cooldown
  for (const k of karts) {
    if (k.isPlayer || !k.item || k.finished) continue;
    k.aiItemCd -= dt;
    if (k.aiItemCd <= 0) {
      k.aiItemCd = 4 + Math.random() * 5;
      if (k.item === 'turbo' && k.offroad === false) useItem(k);
      else if (k.item !== 'turbo' && Math.random() < 0.7) useItem(k);
    }
  }
  // if all finished or player finished + timeout, end
  if (state === 'race' && karts.every(k => k.finished)) endRace();
}
function drivePlayer(k, dt) {
  const off = k.offroad ? 0.55 : 1;
  const boosting = k.boostT > 0;
  const top = k.maxSpeed * (boosting ? 1.55 : 1) * (k.shieldT > 0 ? 1.05 : 1);
  const accel = 260, brake = 420;
  if (input.gas && k.spinT <= 0) k.speed += accel * (boosting ? 1.8 : 1) * dt;
  else k.speed -= 120 * dt;
  if (input.drift) k.speed -= brake * 0.55 * dt;
  k.speed = Math.max(0, Math.min(top * off + (boosting ? 120 : 0), k.speed));
  if (k.offroad && !boosting) k.speed = Math.min(k.speed, k.maxSpeed * 0.62);
  // steering
  const grip = k.speed / k.maxSpeed;
  let steer = 0;
  if (input.left) steer -= 1;
  if (input.right) steer += 1;
  const drifting = input.drift && Math.abs(steer) > 0 && k.speed > 120;
  if (drifting) {
    k.driftDir = steer;
    k.driftCharge += dt;
    k.angle += steer * (2.6 + grip) * dt;
    if (k.driftCharge > 1.1 && k.boostT <= 0) { /* mini-turbo ready */ }
  } else {
    if (k.driftDir !== 0 && k.driftCharge > 1.0 && k.spinT <= 0) k.boostT = Math.max(k.boostT, 0.9);
    k.driftDir = 0; k.driftCharge = 0;
    k.angle += steer * (1.9 + grip * 0.9) * dt * (k.speed > 8 ? 1 : 0);
  }
  // soft wall: push back toward track
  const near = nearestIdx(k.x, k.y);
  if (near.dist > ROAD_W / 2 + 90) {
    const c = center[near.idx];
    const a = Math.atan2(c.y - k.y, c.x - k.x);
    k.x += Math.cos(a) * 120 * dt;
    k.y += Math.sin(a) * 120 * dt;
    k.speed *= (1 - 1.2 * dt);
  }
}
function driveAI(k, dt, t) {
  // rubber-band slightly
  const player = karts[0];
  const gap = (player.totalProgress - k.totalProgress) / N; // laps ahead
  const topBase = k.maxSpeed + Math.max(-25, Math.min(35, gap * 22));
  const look = center[(k.lastIdx + 7) % N];
  // aim with personal offset perpendicular
  const nxt = center[(k.lastIdx + 1) % N], cur = center[k.lastIdx];
  const dx = nxt.x - cur.x, dy = nxt.y - cur.y;
  const len = Math.hypot(dx, dy) || 1;
  const tx = look.x + (-dy / len) * k.aiOffset;
  const ty = look.y + (dx / len) * k.aiOffset;
  const want = Math.atan2(ty - k.y, tx - k.x);
  let da = want - k.angle;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  k.angle += Math.max(-2.6 * dt, Math.min(2.6 * dt, da * 4 * dt * 2));
  const off = nearestIdx(k.x, k.y).dist > ROAD_W / 2 ? 0.6 : 1;
  const top = topBase * (k.boostT > 0 ? 1.5 : 1) * off;
  k.speed += ((Math.abs(da) > 1.2 ? top * 0.55 : top) - k.speed) * Math.min(1, 1.6 * dt);
  if (nearestIdx(k.x, k.y).dist > ROAD_W / 2 + 110) {
    const c = center[nearestIdx(k.x, k.y).idx];
    const a = Math.atan2(c.y - k.y, c.x - k.x);
    k.x += Math.cos(a) * 160 * dt; k.y += Math.sin(a) * 160 * dt;
  }
}
function endRace() {
  if (state === 'done') return;
  state = 'done';
  const me = karts[0];
  const p = racePos(me);
  document.getElementById('end-place').textContent = ORD[p - 1] + (p === 1 ? ' 🏆' : '');
  document.getElementById('end-time').textContent = 'Time ' + fmt(me.finished ? me.finishMs : nowMs - raceStartMs);
  document.getElementById('end-best').textContent = 'Best lap ' + fmt(bestLapMs);
  setTimeout(() => screenEnd.classList.remove('hidden'), 900);
}

// ---------- Render ----------
let grass = null;
function makeGrass() {
  grass = document.createElement('canvas');
  grass.width = 256; grass.height = 256;
  const g = grass.getContext('2d');
  g.fillStyle = '#2a7a3f'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 600; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#2f8546' : '#256f38';
    const s = 2 + Math.random() * 5;
    g.fillRect(Math.random() * 256, Math.random() * 256, s, s * 0.6);
  }
}
makeGrass();

function pathThrough(scaleX = 1, scaleY = 1) {
  ctx.beginPath();
  ctx.moveTo(center[0].x, center[0].y);
  for (let i = 1; i <= N; i++) ctx.lineTo(center[i % N].x, center[i % N].y);
  ctx.closePath();
}
function render(time) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const me = karts[0] || { x: WORLD.w / 2, y: WORLD.h / 2, angle: 0 };
  // camera: follow player, zoom to see ahead
  const zoom = Math.max(W / 900, H / 700, 0.55);
  const scale = Math.min(1.35, zoom);
  ctx.fillStyle = '#12233d'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(scale, scale);
  ctx.translate(-me.x, -me.y);

  // grass
  const pat = ctx.createPattern(grass, 'repeat');
  ctx.fillStyle = pat || '#2a7a3f';
  ctx.fillRect(me.x - W, me.y - H, W * 2, H * 2);

  // decorative bloom flowers (original)
  ctx.fillStyle = '#ffffff22';
  for (let i = 0; i < 24; i++) {
    const fx = ((i * 449) % WORLD.w), fy = ((i * 311) % WORLD.h);
    if (nearestIdx(fx, fy).dist < ROAD_W) continue;
    ctx.beginPath(); ctx.arc(fx, fy, 9, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd6e822';
    ctx.beginPath(); ctx.arc(fx, fy, 15, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffffff22';
  }

  // road base
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  pathThrough();
  ctx.strokeStyle = '#3d4654'; ctx.lineWidth = ROAD_W + 26; ctx.stroke(); // curb shadow
  // curbs red/white dashes
  ctx.setLineDash([34, 34]);
  ctx.strokeStyle = '#e14b5a'; ctx.lineWidth = ROAD_W + 14; ctx.stroke();
  ctx.setLineDash([34, 34]); ctx.lineDashOffset = 34;
  ctx.strokeStyle = '#f2f5f9'; ctx.lineWidth = ROAD_W + 14; ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  pathThrough();
  ctx.strokeStyle = '#565f6e'; ctx.lineWidth = ROAD_W; ctx.stroke();
  pathThrough();
  ctx.strokeStyle = '#6b7484'; ctx.lineWidth = ROAD_W - 26; ctx.stroke();
  // center dashes
  ctx.setLineDash([26, 40]);
  ctx.strokeStyle = '#e8edf4aa'; ctx.lineWidth = 6; ctx.stroke();
  ctx.setLineDash([]);

  // start line
  const s0 = center[0], s1 = center[1];
  const ang = Math.atan2(s1.y - s0.y, s1.x - s0.x);
  ctx.save(); ctx.translate(s0.x, s0.y); ctx.rotate(ang + Math.PI / 2);
  for (let r = -2; r < 2; r++) for (let c = 0; c < 8; c++) {
    ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
    ctx.fillRect(c * (ROAD_W / 8) - ROAD_W / 2, r * 10, ROAD_W / 8, 10);
  }
  ctx.restore();

  // boost pads
  for (const p of PADS) {
    ctx.save(); ctx.translate(p.x, p.y);
    const a = Math.atan2(center[p.wi + 1 > N - 1 ? 0 : p.wi + 1].y - center[p.wi].y,
                         center[p.wi + 1 > N - 1 ? 0 : p.wi + 1].x - center[p.wi].x);
    ctx.rotate(a);
    ctx.fillStyle = '#35e0a1'; ctx.globalAlpha = 0.85 + Math.sin(time * 6) * 0.15;
    roundRect(-46, -30, 92, 60, 12); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = '#06281b';
    ctx.font = 'bold 26px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('»', 0, 2);
    ctx.restore();
  }

  // item boxes
  for (const s of ITEM_SPOTS) {
    if (!s.active) continue;
    const bob = Math.sin(time * 3 + s.wi) * 4;
    ctx.save(); ctx.translate(s.x, s.y + bob);
    ctx.rotate(Math.PI / 4 + time * 0.6);
    const g = ctx.createLinearGradient(-20, -20, 20, 20);
    g.addColorStop(0, '#ffd166'); g.addColorStop(1, '#ff8c42');
    ctx.fillStyle = g;
    const r = 20;
    roundRect(-r, -r, r * 2, r * 2, 6); ctx.fill();
    ctx.strokeStyle = '#7a4a00'; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#5b3600'; ctx.font = 'bold 20px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', s.x, s.y + bob);
  }

  // slicks
  for (const s of slicks) {
    ctx.fillStyle = '#14100a';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, 26, 17, 0.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#3a2d12';
    ctx.beginPath(); ctx.ellipse(s.x - 6, s.y - 3, 10, 6, 0.4, 0, 7); ctx.fill();
  }

  // karts sorted: back to front
  const order = [...karts].sort((a, b) => a.y - b.y);
  for (const k of order) drawKart(k, time, k === me);

  ctx.restore();

  // vignette + minimap
  const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.42, W/2, H/2, Math.max(W,H)*0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.42)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  drawMap();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawKart(k, time, isMe) {
  ctx.save(); ctx.translate(k.x, k.y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(3, 5, 26, 16, 0, 0, 7); ctx.fill();
  ctx.rotate(k.angle);
  // boost flame
  if (k.boostT > 0) {
    ctx.fillStyle = `rgba(53,224,161,${0.6 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.moveTo(-22, -10); ctx.lineTo(-22 - 18 - Math.random() * 14, 0); ctx.lineTo(-22, 10);
    ctx.closePath(); ctx.fill();
  }
  // wheels
  ctx.fillStyle = '#10151d';
  const ww = 16, wh = 9;
  ctx.fillRect(10, -17, ww, wh); ctx.fillRect(10, 8, ww, wh);
  ctx.fillRect(-22, -17, ww, wh); ctx.fillRect(-22, 8, ww, wh);
  // body
  const grad = ctx.createLinearGradient(0, -14, 0, 14);
  grad.addColorStop(0, k.color); grad.addColorStop(1, shade(k.color, -28));
  ctx.fillStyle = grad;
  roundRect(-22, -13, 44, 26, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 2; ctx.stroke();
  // nose
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  roundRect(12, -7, 10, 14, 4); ctx.fill();
  // driver
  ctx.fillStyle = '#f6c89f';
  ctx.beginPath(); ctx.arc(-2, 0, 8, 0, 7); ctx.fill();
  ctx.fillStyle = '#223';
  ctx.beginPath(); ctx.arc(1, 0, 5.5, 0, 7); ctx.fill(); // helmet visor-ish
  ctx.fillStyle = k.color;
  ctx.beginPath(); ctx.arc(-2, 0, 8.6, Math.PI * 0.9, Math.PI * 2.1); ctx.fill(); // helmet
  ctx.restore();

  // shield bubble + spin indicator (unrotated)
  if (k.shieldT > 0) {
    ctx.save(); ctx.translate(k.x, k.y);
    ctx.strokeStyle = 'rgba(140,220,255,.9)'; ctx.lineWidth = 3;
    ctx.fillStyle = 'rgba(140,220,255,.18)';
    ctx.beginPath(); ctx.arc(0, 0, 30 + Math.sin(time * 5) * 2, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  if (k.spinT > 0) {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('💫', k.x, k.y - 34);
  }
  // name tag for me + leader crown-ish
  ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
  ctx.fillStyle = isMe ? '#fff' : '#ffffffbb';
  const label = (isMe ? 'YOU' : k.name) + (k.item && isMe ? ' • ' + ITEM_ICON[k.item] : '');
  ctx.fillText(label, k.x, k.y - 30);
  if (isMe) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(k.x, k.y, 32, 0, 7); ctx.stroke();
  }
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}
function drawMap() {
  const mw = 132, mh = Math.floor(mw * WORLD.h / WORLD.w);
  const mx = W - mw - 12, my = H - mh - 12 - 96; // above touch buttons
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = 'rgba(4,10,20,.72)';
  roundRect(mx - 8, my - 8, mw + 16, mh + 16, 12); ctx.fill();
  ctx.beginPath();
  center.forEach((p, i) => {
    const x = mx + (p.x / WORLD.w) * mw;
    const y = my + (p.y / WORLD.h) * mh;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.strokeStyle = '#8b95a8'; ctx.lineWidth = 7; ctx.stroke();
  ctx.strokeStyle = '#dfe7f2'; ctx.lineWidth = 3; ctx.stroke();
  for (const k of karts) {
    const x = mx + (k.x / WORLD.w) * mw;
    const y = my + (k.y / WORLD.h) * mh;
    ctx.fillStyle = k.color;
    ctx.beginPath(); ctx.arc(x, y, k.isPlayer ? 5 : 4, 0, 7); ctx.fill();
    if (k.isPlayer) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  ctx.restore();
}
function updateHud(t) {
  if (!karts.length || (state !== 'race' && state !== 'done')) return;
  const me = karts[0];
  elLap.textContent = `LAP ${Math.min(TOTAL_LAPS, me.lap)}/${TOTAL_LAPS}`;
  elPos.textContent = ORD[racePos(me) - 1];
  elTime.textContent = fmt(t - raceStartMs);
  if (me.item) {
    itemSlot.textContent = ITEM_ICON[me.item];
    itemSlot.title = ITEM_NAME[me.item];
    itemSlot.classList.add('full');
  } else {
    itemSlot.textContent = '—';
    itemSlot.classList.remove('full');
  }
}

// idle background before race
karts = [makeKart(0, true), makeKart(1, false), makeKart(2, false), makeKart(3, false)];
requestAnimationFrame(frame);
})();
