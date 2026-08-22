"use strict";

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const startScreen = document.querySelector("#start-screen");
const gameShell = document.querySelector("#game-shell");
const endScreen = document.querySelector("#end-screen");
const toast = document.querySelector("#toast");
const crosshair = document.querySelector("#crosshair");
const playerNameInput = document.querySelector("#player-name");
const roomCodeInput = document.querySelector("#room-code-input");

const W = 1280, H = 720, MAP = 1800, RADIUS = 16, BOTS = 5;
const PHASES = [850, 620, 420, 260, 130];
const PHASE_DURATION = 28;
const WEAPON = { damage: 15, cooldown: 0.3, range: 550, speed: 850 };

const state = {
  running: false, player: null, bots: [], bullets: [], loot: [], props: [],
  remotePlayers: new Map(),
  elapsed: 0, prevTime: 0,
  camera: { x: 0, y: 0 },
  mouse: { x: W / 2, y: H / 2, down: false, worldX: 0, worldY: 0 },
  keys: new Set(),
  toastTimer: 0,
  multiplayer: false,
  socket: null,
  netTimer: 0,
  playerName: "Spieler",
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rand = (min, max) => min + Math.random() * (max - min);

// Buttons
document.querySelector("#solo-button").onclick = () => {
  state.playerName = (playerNameInput.value.trim() || "Spieler").slice(0, 16);
  state.multiplayer = false;
  startMatch();
};

document.querySelector("#multi-button").onclick = () => {
  state.playerName = (playerNameInput.value.trim() || "Spieler").slice(0, 16);
  document.querySelector("#mode-select").classList.add("hidden");
  document.querySelector("#multi-panel").classList.remove("hidden");
};

document.querySelector("#host-button").onclick = () => {
  let code = "";
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  document.querySelector("#room-code").textContent = "Raumcode: " + code;
  document.querySelector("#room-code").classList.remove("hidden");
  joinRoom(code);
};

document.querySelector("#join-button").onclick = () => {
  document.querySelector("#join-code-entry").classList.remove("hidden");
  roomCodeInput.focus();
};

document.querySelector("#code-confirm").onclick = () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length >= 4) joinRoom(code);
  else showToast("4-stelligen Code eingeben");
};

document.querySelector("#mp-start-button").onclick = () => {
  state.multiplayer = true;
  startMatch();
};

function joinRoom(code) {
  state.roomCode = code;
  const statusEl = document.querySelector("#mp-status");
  statusEl.textContent = "Verbinde...";

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const host = location.host || "localhost:3000";

  try {
    const socket = new WebSocket(`${protocol}//${host}/ws?room=${encodeURIComponent(code)}`);

    socket.onopen = () => {
      state.socket = socket;
      statusEl.textContent = "Verbunden!";
      document.querySelector("#mp-start-button").classList.remove("hidden");
      socket.send(JSON.stringify({ type: "join", name: state.playerName }));
    };

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "state") {
          state.remotePlayers.clear();
          for (const p of msg.players) {
            if (p.id !== state.socket.id) state.remotePlayers.set(p.id, p);
          }
        }
      } catch (_) {}
    };

    socket.onclose = () => {
      state.socket = null;
      statusEl.textContent = "Getrennt.";
      document.querySelector("#mp-start-button").classList.add("hidden");
    };

    socket.onerror = () => statusEl.textContent = "Fehler.";
  } catch (e) {
    statusEl.textContent = "Fehler: " + e.message;
  }
}

function resetToStartMenu() {
  if (state.socket) try { state.socket.close(); } catch (_) {}
  state.socket = null;
  state.multiplayer = false;
  state.remotePlayers.clear();
  state.running = false;

  document.querySelector("#mode-select").classList.remove("hidden");
  document.querySelector("#multi-panel").classList.add("hidden");
  document.querySelector("#room-code").classList.add("hidden");
  document.querySelector("#join-code-entry").classList.add("hidden");
  document.querySelector("#mp-start-button").classList.add("hidden");
  document.querySelector("#mp-status").textContent = "";
  roomCodeInput.value = "";

  gameShell.classList.add("hidden");
  crosshair.classList.add("hidden");
  endScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
}

document.querySelector("#again-button").onclick = resetToStartMenu;

// Entities
function makePlayer(name) {
  return {
    kind: "player", id: "self", name: name || "Spieler",
    x: MAP / 2 + rand(-100, 100), y: MAP / 2 + rand(-100, 100),
    radius: RADIUS, color: "#df8845",
    hp: 100, alive: true, speed: 210, facing: 0,
    ammo: 20, kills: 0, cooldown: 0,
  };
}

function makeBot(i) {
  const names = ["Boris", "Hoppel", "Pepe", "Ozzy", "Kira"];
  let x, y;
  do {
    x = rand(120, MAP - 120);
    y = rand(120, MAP - 120);
  } while (Math.hypot(x - MAP / 2, y - MAP / 2) < 350);
  return {
    kind: "bot", id: "bot-" + i, name: names[i % names.length],
    x, y, radius: RADIUS, color: "#8a8f86",
    hp: 100, alive: true, speed: rand(110, 140), facing: rand(0, Math.PI * 2),
    ammo: 999, cooldown: rand(0, 1), wanderAngle: rand(0, Math.PI * 2), nextWander: rand(1, 3),
  };
}

function makeLoot(x, y) {
  return Math.random() < 0.5
      ? { x, y, type: "ammo", amount: 15 }
      : { x, y, type: "heal", amount: 25 };
}

function populateWorld() {
  state.loot = [];
  state.props = [];
  for (let i = 0; i < 40; i++) state.loot.push(makeLoot(rand(80, MAP - 80), rand(80, MAP - 80)));
  for (let i = 0; i < 70; i++) {
    state.props.push({ x: rand(40, MAP - 40), y: rand(40, MAP - 40), size: rand(10, 20) });
  }
}

// Match flow
function startMatch() {
  state.player = makePlayer(state.playerName);
  state.bots = [];
  if (!state.multiplayer) {
    for (let i = 0; i < BOTS; i++) state.bots.push(makeBot(i));
  }
  state.bullets = [];
  state.elapsed = 0;
  state.running = true;
  populateWorld();

  endScreen.classList.add("hidden");
  startScreen.classList.add("hidden");
  gameShell.classList.remove("hidden");
  crosshair.classList.remove("hidden");
  canvas.focus();
  state.prevTime = performance.now();
  requestAnimationFrame(gameLoop);
}

function finishMatch(won) {
  if (!state.running) return;
  state.running = false;
  state.mouse.down = false;
  crosshair.classList.add("hidden");
  document.querySelector("#end-title").textContent = won ? "Sieg!" : "Runde vorbei";
  document.querySelector("#end-stats").textContent =
      state.player.kills + " Kills · " + Math.round(state.elapsed) + "s";
  endScreen.classList.remove("hidden");
}

// Update
function allEntities() {
  return [state.player, ...state.bots];
}

function updatePlayer(dt) {
  const p = state.player;
  if (!p.alive) return;
  p.cooldown = Math.max(0, p.cooldown - dt);

  const aimX = state.mouse.worldX - p.x;
  const aimY = state.mouse.worldY - p.y;
  p.facing = Math.atan2(aimY, aimX);

  let mx = 0, my = 0;
  if (state.keys.has("KeyW")) my -= 1;
  if (state.keys.has("KeyS")) my += 1;
  if (state.keys.has("KeyA")) mx -= 1;
  if (state.keys.has("KeyD")) mx += 1;
  if (mx !== 0 || my !== 0) {
    const len = Math.hypot(mx, my);
    p.x += (mx / len) * p.speed * dt;
    p.y += (my / len) * p.speed * dt;
  }
  p.x = clamp(p.x, RADIUS, MAP - RADIUS);
  p.y = clamp(p.y, RADIUS, MAP - RADIUS);

  if (state.mouse.down) shoot(p, p.facing);
}

function shoot(shooter, angle) {
  if (shooter.cooldown > 0) return;
  if (shooter.ammo <= 0) {
    if (shooter.kind === "player") showToast("Keine Munition");
    return;
  }
  shooter.ammo--;
  shooter.cooldown = WEAPON.cooldown;
  const a = angle + rand(-0.02, 0.02);
  state.bullets.push({
    x: shooter.x + Math.cos(a) * 22, y: shooter.y + Math.sin(a) * 22,
    vx: Math.cos(a) * WEAPON.speed, vy: Math.sin(a) * WEAPON.speed,
    life: WEAPON.range / WEAPON.speed, damage: WEAPON.damage, owner: shooter,
  });
}

function updateBots(dt) {
  const entities = allEntities();
  for (const bot of state.bots) {
    if (!bot.alive) continue;
    bot.cooldown = Math.max(0, bot.cooldown - dt);

    let target = null, best = Infinity;
    for (const e of entities) {
      if (e === bot || !e.alive) continue;
      const d = dist(bot, e);
      if (d < best) { best = d; target = e; }
    }

    if (target && best < 620) {
      const desired = Math.atan2(target.y - bot.y, target.x - bot.x);
      bot.facing = desired;
      const moveAngle = best > 430 ? desired : best < 320 ? desired + Math.PI : desired + Math.PI / 2;
      bot.x += Math.cos(moveAngle) * bot.speed * dt;
      bot.y += Math.sin(moveAngle) * bot.speed * dt;
      if (best < WEAPON.range && Math.random() < dt * 1.8) shoot(bot, desired + rand(-0.1, 0.1));
    } else {
      bot.nextWander -= dt;
      if (bot.nextWander <= 0) {
        bot.nextWander = rand(1, 3);
        bot.wanderAngle = rand(0, Math.PI * 2);
      }
      bot.x += Math.cos(bot.wanderAngle) * bot.speed * 0.4 * dt;
      bot.y += Math.sin(bot.wanderAngle) * bot.speed * 0.4 * dt;
    }
    bot.x = clamp(bot.x, RADIUS, MAP - RADIUS);
    bot.y = clamp(bot.y, RADIUS, MAP - RADIUS);
  }
}

function updateBullets(dt) {
  const entities = allEntities();
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let hit = null;
    for (const e of entities) {
      if (e !== b.owner && e.alive && Math.hypot(e.x - b.x, e.y - b.y) < e.radius + 3) {
        hit = e;
        break;
      }
    }
    if (hit) { damage(hit, b.damage, b.owner); state.bullets.splice(i, 1); }
    else if (b.life <= 0) state.bullets.splice(i, 1);
  }
}

function damage(target, amount, attacker) {
  if (!target.alive) return;
  target.hp -= amount;
  if (target.hp <= 0) eliminate(target, attacker);
}

function eliminate(target, attacker) {
  target.hp = 0;
  target.alive = false;
  if (target.kind === "bot") {
    if (attacker.kind === "player") {
      attacker.kills++;
      showToast(target.name + " aus");
    }
    state.loot.push(makeLoot(target.x, target.y));
    if (!state.bots.some(b => b.alive)) finishMatch(true);
  } else if (target.kind === "player") {
    finishMatch(false);
  }
}

function currentZone() {
  const phase = clamp(Math.floor(state.elapsed / PHASE_DURATION), 0, PHASES.length - 1);
  const t = (state.elapsed % PHASE_DURATION) / PHASE_DURATION;
  const from = PHASES[phase];
  const to = PHASES[Math.min(phase + 1, PHASES.length - 1)];
  return { radius: from + (to - from) * t, damage: [2, 5, 9, 15, 25][phase] };
}

function updateZone(dt) {
  const zone = currentZone();
  for (const e of allEntities()) {
    if (!e.alive) continue;
    if (Math.hypot(e.x - MAP / 2, e.y - MAP / 2) > zone.radius) {
      damage(e, zone.damage * dt, { kind: "zone", name: "Zone" });
    }
  }
}

function pickupClosest() {
  const p = state.player;
  if (!state.running || !p.alive) return;
  let idx = -1, closest = 60;
  for (let i = 0; i < state.loot.length; i++) {
    const d = dist(p, state.loot[i]);
    if (d < closest) { closest = d; idx = i; }
  }
  if (idx === -1) return;
  const item = state.loot[idx];
  state.loot.splice(idx, 1);
  if (item.type === "ammo") {
    p.ammo += item.amount;
    showToast("+" + item.amount + " Munition");
  } else {
    p.hp = Math.min(100, p.hp + item.amount);
    showToast("+" + item.amount + " HP");
  }
}

function showToast(msg) {
  clearTimeout(state.toastTimer);
  toast.textContent = msg;
  toast.classList.add("show");
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
}

// Networking
function sendNetworkUpdate() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  const p = state.player;
  state.socket.send(JSON.stringify({
    type: "update", name: p.name, x: p.x, y: p.y, facing: p.facing, hp: p.hp, alive: p.alive,
  }));
}

// Loop
function gameLoop(now) {
  if (!state.running) return;
  const dt = Math.min(0.05, (now - state.prevTime) / 1000 || 0);
  state.prevTime = now;
  state.elapsed += dt;

  updatePlayer(dt);
  updateBots(dt);
  updateBullets(dt);
  updateZone(dt);
  updateCamera();

  if (state.multiplayer) {
    state.netTimer -= dt;
    if (state.netTimer <= 0) { state.netTimer = 0.08; sendNetworkUpdate(); }
  }

  render();
  requestAnimationFrame(gameLoop);
}

function updateCamera() {
  const p = state.player;
  state.camera.x = clamp(p.x - W / 2, 0, MAP - W);
  state.camera.y = clamp(p.y - H / 2, 0, MAP - H);
  const rect = canvas.getBoundingClientRect();
  state.mouse.worldX = state.camera.x + (state.mouse.x / rect.width) * W;
  state.mouse.worldY = state.camera.y + (state.mouse.y / rect.height) * H;
}

function worldToScreen(x, y) { return { x: x - state.camera.x, y: y - state.camera.y }; }
function isOnScreen(x, y, pad = 30) {
  return x >= state.camera.x - pad && y >= state.camera.y - pad &&
      x <= state.camera.x + W + pad && y <= state.camera.y + H + pad;
}

// Render
function render() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#78a95c";
  ctx.fillRect(0, 0, W, H);

  // Props
  ctx.fillStyle = "#5f8f4a";
  for (const prop of state.props) {
    if (!isOnScreen(prop.x, prop.y, 25)) continue;
    const p = worldToScreen(prop.x, prop.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, prop.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // Loot
  for (const item of state.loot) {
    if (!isOnScreen(item.x, item.y, 25)) continue;
    const p = worldToScreen(item.x, item.y);
    ctx.fillStyle = item.type === "heal" ? "#e95159" : "#efd766";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Bullets
  for (const b of state.bullets) {
    if (!isOnScreen(b.x, b.y)) continue;
    const p = worldToScreen(b.x, b.y);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(255,255,255,.5)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0,0,0,.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Entities
  const entities = [...state.bots, state.player];
  entities.sort((a, b) => a.y - b.y);
  for (const e of entities) drawEntity(e);
  for (const rp of state.remotePlayers.values()) drawRemotePlayer(rp);

  // Zone
  const zone = currentZone();
  const cp = worldToScreen(MAP / 2, MAP / 2);
  ctx.save();
  ctx.fillStyle = "rgba(60,60,60,.25)";
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(cp.x, cp.y, zone.radius, 0, Math.PI * 2, true);
  ctx.fill("evenodd");
  ctx.strokeStyle = "rgba(255,255,255,.6)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(cp.x, cp.y, zone.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // HUD
  const p = state.player;
  ctx.font = "14px 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.shadowColor = "rgba(0,0,0,.8)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#fff";
  ctx.fillText("HP " + Math.ceil(p.hp), 20, 26);
  ctx.fillText("Munition: " + p.ammo, 20, 46);
  ctx.fillText("Kills: " + p.kills, 20, 66);
  ctx.textAlign = "right";
  let remaining = state.multiplayer ? state.remotePlayers.size + 1 : 0;
  if (!state.multiplayer) {
    for (const b of state.bots) if (b.alive) remaining++;
    remaining++;
  }
  ctx.fillText(remaining + " ubrig", W - 20, 26);
  ctx.shadowBlur = 0;
}

function drawEntity(e) {
  if (!e.alive || !isOnScreen(e.x, e.y, 40)) return;
  const p = worldToScreen(e.x, e.y);
  ctx.shadowColor = "rgba(0,0,0,.2)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = e.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(20,20,20,.7)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(e.facing) * 20, p.y + Math.sin(e.facing) * 20);
  ctx.stroke();
  drawBar(p.x - 20, p.y - 30, 40, 4, e.hp / 100, "#e85055", "rgba(0,0,0,.4)");
  ctx.fillStyle = "#fff";
  ctx.font = "12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,.8)";
  ctx.shadowBlur = 4;
  ctx.fillText(e.name, p.x, p.y - 36);
  ctx.shadowBlur = 0;
}

function drawRemotePlayer(rp) {
  if (!isOnScreen(rp.x, rp.y, 40)) return;
  const p = worldToScreen(rp.x, rp.y);
  ctx.shadowColor = "rgba(0,0,0,.2)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = rp.alive === false ? "#555" : "#4d8fd6";
  ctx.beginPath();
  ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff";
  ctx.font = "12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,.8)";
  ctx.shadowBlur = 4;
  ctx.fillText(rp.name || "Spieler", p.x, p.y - 24);
  ctx.shadowBlur = 0;
  drawBar(p.x - 20, p.y - 18, 40, 4, (rp.hp || 0) / 100, "#4d8fd6", "rgba(0,0,0,.4)");
}

function drawBar(x, y, width, height, percent, fill, bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width * clamp(percent, 0, 1), height);
}

// Input
function updatePointer(e) {
  const rect = canvas.getBoundingClientRect();
  state.mouse.x = e.clientX - rect.left;
  state.mouse.y = e.clientY - rect.top;
  crosshair.style.left = e.clientX + "px";
  crosshair.style.top = e.clientY + "px";
}

canvas.onmousemove = updatePointer;
canvas.onmousedown = (e) => { if (e.button === 0) { updatePointer(e); state.mouse.down = true; } };
window.onmouseup = () => state.mouse.down = false;

function isTyping() {
  const el = document.activeElement;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

window.onkeydown = (e) => {
  if (isTyping()) return;
  if (!state.running) return;
  if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) e.preventDefault();
  state.keys.add(e.code);
  if (e.code === "KeyE") pickupClosest();
};

window.onkeyup = (e) => {
  if (isTyping()) return;
  state.keys.delete(e.code);
};

window.onblur = () => { state.keys.clear(); state.mouse.down = false; };

playerNameInput.onkeydown = (e) => {
  if (e.code === "Enter") {
    e.preventDefault();
    state.playerName = (playerNameInput.value.trim() || "Spieler").slice(0, 16);
    state.multiplayer = false;
    startMatch();
  }
};

roomCodeInput.onkeydown = (e) => {
  if (e.code === "Enter") {
    e.preventDefault();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (code.length >= 4) joinRoom(code);
    else showToast("4-stelligen Code eingeben");
  }
};