"use strict";

/*
 * Furry Arena — vereinfachte Version 2
 */

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const startScreen = document.querySelector("#start-screen");
const gameShell = document.querySelector("#game-shell");
const endScreen = document.querySelector("#end-screen");
const toast = document.querySelector("#toast");
const crosshair = document.querySelector("#crosshair");
const playerNameInput = document.querySelector("#player-name");
const roomCodeInput = document.querySelector("#room-code-input");

const WIDTH = 1280;
const HEIGHT = 720;
const MAP_SIZE = 1800;
const HITBOX_RADIUS = 16;
const BOT_COUNT = 5;
const PHASES = [850, 620, 420, 260, 130];
const PHASE_DURATION = 28;

const WEAPON = { name: "Pistole", damage: 15, cooldown: 0.3, range: 550, speed: 850, color: "#ffffff" };

const state = {
  running: false,
  player: null,
  bots: [],
  bullets: [],
  loot: [],
  props: [],
  remotePlayers: new Map(),
  elapsed: 0,
  previousTime: 0,
  camera: { x: 0, y: 0 },
  mouse: { x: WIDTH / 2, y: HEIGHT / 2, down: false, worldX: 0, worldY: 0 },
  keys: new Set(),
  toastTimer: 0,
  multiplayer: false,
  socket: null,
  netTimer: 0,
  playerName: "Spieler",
  roomCode: null,
};

const clamp = function(v, min, max) { return Math.max(min, Math.min(max, v)); };
const distance = function(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };
const rand = function(min, max) { return min + Math.random() * (max - min); };

/* ---------------------------------------------------------------- */
/* Start menu / mode selection                                       */
/* ---------------------------------------------------------------- */

document.querySelector("#solo-button").addEventListener("click", function() {
  console.log("Solo button clicked");
  state.playerName = (playerNameInput.value.trim() || "Spieler").slice(0, 16);
  state.multiplayer = false;
  startMatch();
});

document.querySelector("#multi-button").addEventListener("click", function() {
  console.log("Multi button clicked");
  state.playerName = (playerNameInput.value.trim() || "Spieler").slice(0, 16);
  document.querySelector("#mode-select").classList.add("hidden");
  document.querySelector("#multi-panel").classList.remove("hidden");
});

document.querySelector("#host-button").addEventListener("click", function() {
  console.log("Host button clicked");
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  var code = "";
  for (var i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  document.querySelector("#room-code").textContent = "Raumcode: " + code;
  document.querySelector("#room-code").classList.remove("hidden");
  joinRoom(code);
});

document.querySelector("#join-button").addEventListener("click", function() {
  console.log("Join button clicked");
  document.querySelector("#join-code-entry").classList.remove("hidden");
  roomCodeInput.focus();
});

document.querySelector("#code-confirm").addEventListener("click", function() {
  var code = roomCodeInput.value.trim().toUpperCase();
  if (code.length >= 4) {
    joinRoom(code);
  } else {
    showToast("Bitte gib einen 4-stelligen Code ein");
  }
});

document.querySelector("#mp-start-button").addEventListener("click", function() {
  console.log("MP Start button clicked");
  state.multiplayer = true;
  startMatch();
});

function joinRoom(code) {
  state.roomCode = code;
  var statusEl = document.querySelector("#mp-status");
  statusEl.textContent = "Verbinde mit Raum " + code + " ...";

  var protocol = location.protocol === "https:" ? "wss:" : "ws:";
  var host = location.host || "localhost:3000";

  try {
    var socket = new WebSocket(protocol + "//" + host + "/ws?room=" + encodeURIComponent(code));

    socket.addEventListener("open", function() {
      state.socket = socket;
      statusEl.textContent = "Verbunden. Bereit zum Start.";
      document.querySelector("#mp-start-button").classList.remove("hidden");
      socket.send(JSON.stringify({ type: "join", name: state.playerName }));
    });

    socket.addEventListener("message", function(event) {
      try {
        var msg = JSON.parse(event.data);
        if (msg.type === "state") {
          state.remotePlayers.clear();
          for (var i = 0; i < msg.players.length; i++) {
            var p = msg.players[i];
            if (p.id !== state.socket.id) state.remotePlayers.set(p.id, p);
          }
        }
      } catch (e) { /* ignore */ }
    });

    socket.addEventListener("close", function() {
      state.socket = null;
      statusEl.textContent = "Verbindung getrennt.";
      document.querySelector("#mp-start-button").classList.add("hidden");
    });

    socket.addEventListener("error", function() {
      statusEl.textContent = "Verbindung fehlgeschlagen.";
    });
  } catch (e) {
    statusEl.textContent = "Verbindung fehlgeschlagen: " + e.message;
  }
}

function resetToStartMenu() {
  if (state.socket) { try { state.socket.close(); } catch (e) { /* ignore */ } }
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

document.querySelector("#again-button").addEventListener("click", resetToStartMenu);

/* ---------------------------------------------------------------- */
/* World / entities                                                  */
/* ---------------------------------------------------------------- */

function makePlayer(name) {
  return {
    kind: "player", id: "self", name: name || "Spieler",
    x: MAP_SIZE / 2 + rand(-100, 100), y: MAP_SIZE / 2 + rand(-100, 100),
    radius: HITBOX_RADIUS, color: "#df8845",
    hp: 100, alive: true, speed: 210, facing: 0,
    ammo: 20, kills: 0, cooldown: 0,
  };
}

function makeBot(index) {
  var x, y;
  do {
    x = rand(120, MAP_SIZE - 120);
    y = rand(120, MAP_SIZE - 120);
  } while (Math.hypot(x - MAP_SIZE / 2, y - MAP_SIZE / 2) < 350);
  var names = ["Boris", "Hoppel", "Pepe", "Ozzy", "Kira"];
  return {
    kind: "bot", id: "bot-" + index, name: names[index % names.length],
    x: x, y: y, radius: HITBOX_RADIUS, color: "#8a8f86",
    hp: 100, alive: true, speed: rand(110, 140), facing: rand(0, Math.PI * 2),
    ammo: 999, cooldown: rand(0, 1), wanderAngle: rand(0, Math.PI * 2), nextWander: rand(1, 3),
  };
}

function makeLoot(x, y) {
  if (Math.random() < 0.5) return { x: x, y: y, type: "ammo", amount: 15 };
  return { x: x, y: y, type: "heal", amount: 25 };
}

function populateWorld() {
  state.loot = [];
  state.props = [];
  for (var i = 0; i < 40; i += 1) state.loot.push(makeLoot(rand(80, MAP_SIZE - 80), rand(80, MAP_SIZE - 80)));
  for (var i = 0; i < 70; i += 1) {
    state.props.push({ x: rand(40, MAP_SIZE - 40), y: rand(40, MAP_SIZE - 40), size: rand(10, 20) });
  }
}

/* ---------------------------------------------------------------- */
/* Match flow                                                        */
/* ---------------------------------------------------------------- */

function startMatch() {
  console.log("startMatch called, multiplayer:", state.multiplayer);
  state.player = makePlayer(state.playerName);
  state.bots = [];
  if (!state.multiplayer) {
    for (var i = 0; i < BOT_COUNT; i++) {
      state.bots.push(makeBot(i));
    }
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
  showToast(state.multiplayer ? "Multiplayer verbunden" : "Kampfe gegen Bots");
  state.previousTime = performance.now();
  requestAnimationFrame(gameLoop);
}

function finishMatch(won) {
  if (!state.running) return;
  state.running = false;
  state.mouse.down = false;
  crosshair.classList.add("hidden");
  document.querySelector("#end-title").textContent = won ? "Sieg!" : "Runde vorbei";
  document.querySelector("#end-stats").textContent =
    state.player.kills + " Kills · " + Math.round(state.elapsed) + " Sekunden";
  endScreen.classList.remove("hidden");
}

/* ---------------------------------------------------------------- */
/* Update logic                                                      */
/* ---------------------------------------------------------------- */

function allEntities() {
  var entities = [state.player];
  for (var i = 0; i < state.bots.length; i++) {
    entities.push(state.bots[i]);
  }
  return entities;
}

function updatePlayer(dt) {
  var player = state.player;
  if (!player.alive) return;
  player.cooldown = Math.max(0, player.cooldown - dt);

  var aimX = state.mouse.worldX - player.x;
  var aimY = state.mouse.worldY - player.y;
  player.facing = Math.atan2(aimY, aimX);

  var mx = 0, my = 0;
  if (state.keys.has("KeyW")) my -= 1;
  if (state.keys.has("KeyS")) my += 1;
  if (state.keys.has("KeyA")) mx -= 1;
  if (state.keys.has("KeyD")) mx += 1;
  if (mx !== 0 || my !== 0) {
    var len = Math.hypot(mx, my);
    player.x += (mx / len) * player.speed * dt;
    player.y += (my / len) * player.speed * dt;
  }
  player.x = clamp(player.x, HITBOX_RADIUS, MAP_SIZE - HITBOX_RADIUS);
  player.y = clamp(player.y, HITBOX_RADIUS, MAP_SIZE - HITBOX_RADIUS);

  if (state.mouse.down) shoot(player, player.facing);
}

function shoot(shooter, angle) {
  if (shooter.cooldown > 0) return;
  if (shooter.ammo <= 0) {
    if (shooter.kind === "player") showToast("Keine Munition mehr");
    return;
  }
  shooter.ammo -= 1;
  shooter.cooldown = WEAPON.cooldown;
  var spread = rand(-0.02, 0.02);
  var a = angle + spread;
  state.bullets.push({
    x: shooter.x + Math.cos(a) * 22, y: shooter.y + Math.sin(a) * 22,
    vx: Math.cos(a) * WEAPON.speed, vy: Math.sin(a) * WEAPON.speed,
    life: WEAPON.range / WEAPON.speed, damage: WEAPON.damage, owner: shooter,
  });
}

function updateBots(dt) {
  var entities = allEntities();
  for (var b = 0; b < state.bots.length; b++) {
    var bot = state.bots[b];
    if (!bot.alive) continue;
    bot.cooldown = Math.max(0, bot.cooldown - dt);

    var target = null;
    var bestDist = Infinity;
    for (var e = 0; e < entities.length; e++) {
      var entity = entities[e];
      if (entity === bot || !entity.alive) continue;
      var d = distance(bot, entity);
      if (d < bestDist) { bestDist = d; target = entity; }
    }

    if (target && bestDist < 620) {
      var desired = Math.atan2(target.y - bot.y, target.x - bot.x);
      bot.facing = desired;
      var preferred = 380;
      var moveAngle = bestDist > preferred + 50 ? desired : bestDist < preferred - 60 ? desired + Math.PI : desired + Math.PI / 2;
      bot.x += Math.cos(moveAngle) * bot.speed * dt;
      bot.y += Math.sin(moveAngle) * bot.speed * dt;
      if (bestDist < WEAPON.range && Math.random() < dt * 1.8) shoot(bot, desired + rand(-0.1, 0.1));
    } else {
      bot.nextWander -= dt;
      if (bot.nextWander <= 0) { bot.nextWander = rand(1, 3); bot.wanderAngle = rand(0, Math.PI * 2); }
      bot.x += Math.cos(bot.wanderAngle) * bot.speed * 0.4 * dt;
      bot.y += Math.sin(bot.wanderAngle) * bot.speed * 0.4 * dt;
    }
    bot.x = clamp(bot.x, HITBOX_RADIUS, MAP_SIZE - HITBOX_RADIUS);
    bot.y = clamp(bot.y, HITBOX_RADIUS, MAP_SIZE - HITBOX_RADIUS);
  }
}

function updateBullets(dt) {
  var entities = allEntities();
  for (var i = state.bullets.length - 1; i >= 0; i -= 1) {
    var b = state.bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    var target = null;
    for (var e = 0; e < entities.length; e++) {
      var entity = entities[e];
      if (entity !== b.owner && entity.alive && Math.hypot(entity.x - b.x, entity.y - b.y) < entity.radius + 3) {
        target = entity;
        break;
      }
    }
    if (target) { damage(target, b.damage, b.owner); state.bullets.splice(i, 1); }
    else if (b.life <= 0) state.bullets.splice(i, 1);
  }
}

function damage(target, amount, attacker) {
  if (!target.alive) return;
  target.hp -= amount;
  if (target.hp <= 0) eliminate(target, attacker);
}

function eliminate(target, attacker) {
  target.hp = 0; target.alive = false;
  if (target.kind === "bot") {
    if (attacker.kind === "player") { attacker.kills += 1; showToast(target.name + " ausgeschaltet"); }
    state.loot.push(makeLoot(target.x, target.y));
    var alive = false;
    for (var i = 0; i < state.bots.length; i++) {
      if (state.bots[i].alive) { alive = true; break; }
    }
    if (!alive) finishMatch(true);
  } else if (target.kind === "player") {
    finishMatch(false);
  }
}

function currentZone() {
  var phase = clamp(Math.floor(state.elapsed / PHASE_DURATION), 0, PHASES.length - 1);
  var t = (state.elapsed % PHASE_DURATION) / PHASE_DURATION;
  var from = PHASES[phase];
  var to = PHASES[Math.min(phase + 1, PHASES.length - 1)];
  var damages = [2, 5, 9, 15, 25];
  return { radius: from + (to - from) * t, damage: damages[phase] };
}

function updateZone(dt) {
  var zone = currentZone();
  var entities = allEntities();
  for (var i = 0; i < entities.length; i++) {
    var e = entities[i];
    if (!e.alive) continue;
    if (Math.hypot(e.x - MAP_SIZE / 2, e.y - MAP_SIZE / 2) > zone.radius) {
      damage(e, zone.damage * dt, { kind: "zone", name: "Zone" });
    }
  }
}

function pickupClosest() {
  var player = state.player;
  if (!state.running || !player.alive) return;
  var index = -1, closest = 60;
  for (var i = 0; i < state.loot.length; i++) {
    var item = state.loot[i];
    var d = distance(player, item);
    if (d < closest) { closest = d; index = i; }
  }
  if (index === -1) { showToast("Nichts in Reichweite"); return; }
  var item = state.loot[index];
  state.loot.splice(index, 1);
  if (item.type === "ammo") {
    player.ammo += item.amount;
    showToast("+" + item.amount + " Munition");
  } else {
    player.hp = Math.min(100, player.hp + item.amount);
    showToast("+" + item.amount + " HP");
  }
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  state.toastTimer = window.setTimeout(function() { toast.classList.remove("show"); }, 1600);
}

/* ---------------------------------------------------------------- */
/* Multiplayer networking                                            */
/* ---------------------------------------------------------------- */

function sendNetworkUpdate() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  var p = state.player;
  state.socket.send(JSON.stringify({
    type: "update", name: p.name, x: p.x, y: p.y, facing: p.facing, hp: p.hp, alive: p.alive,
  }));
}

/* ---------------------------------------------------------------- */
/* Loop                                                              */
/* ---------------------------------------------------------------- */

function gameLoop(now) {
  if (!state.running) return;
  var dt = Math.min(0.05, (now - state.previousTime) / 1000 || 0);
  state.previousTime = now;
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
  var player = state.player;
  state.camera.x = clamp(player.x - WIDTH / 2, 0, MAP_SIZE - WIDTH);
  state.camera.y = clamp(player.y - HEIGHT / 2, 0, MAP_SIZE - HEIGHT);
  var rect = canvas.getBoundingClientRect();
  state.mouse.worldX = state.camera.x + (state.mouse.x / rect.width) * WIDTH;
  state.mouse.worldY = state.camera.y + (state.mouse.y / rect.height) * HEIGHT;
}

function worldToScreen(x, y) { return { x: x - state.camera.x, y: y - state.camera.y }; }
function isOnScreen(x, y, pad) {
  if (pad === undefined) pad = 30;
  return x >= state.camera.x - pad && y >= state.camera.y - pad &&
    x <= state.camera.x + WIDTH + pad && y <= state.camera.y + HEIGHT + pad;
}

/* ---------------------------------------------------------------- */
/* Render                                                            */
/* ---------------------------------------------------------------- */

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#78a95c";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawProps();
  drawLoot();
  drawBullets();

  var entities = [];
  for (var i = 0; i < state.bots.length; i++) entities.push(state.bots[i]);
  entities.push(state.player);
  entities.sort(function(a, b) { return a.y - b.y; });
  for (var i = 0; i < entities.length; i++) drawEntity(entities[i]);
  
  var remoteValues = state.remotePlayers.values();
  for (var rp of remoteValues) drawRemotePlayer(rp);

  drawZone();
  drawHud();
}

function drawProps() {
  ctx.fillStyle = "#5f8f4a";
  for (var i = 0; i < state.props.length; i++) {
    var prop = state.props[i];
    if (!isOnScreen(prop.x, prop.y, 25)) continue;
    var p = worldToScreen(prop.x, prop.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, prop.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLoot() {
  for (var i = 0; i < state.loot.length; i++) {
    var item = state.loot[i];
    if (!isOnScreen(item.x, item.y, 25)) continue;
    var p = worldToScreen(item.x, item.y);
    ctx.fillStyle = item.type === "heal" ? "#e95159" : "#efd766";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawBullets() {
  for (var i = 0; i < state.bullets.length; i++) {
    var b = state.bullets[i];
    if (!isOnScreen(b.x, b.y)) continue;
    var p = worldToScreen(b.x, b.y);
    ctx.fillStyle = "#ffffff";
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
}

function drawEntity(entity) {
  if (!entity.alive || !isOnScreen(entity.x, entity.y, 40)) return;
  var p = worldToScreen(entity.x, entity.y);
  
  ctx.shadowColor = "rgba(0,0,0,.2)";
  ctx.shadowBlur = 8;
  
  ctx.fillStyle = entity.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, HITBOX_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  
  ctx.strokeStyle = "rgba(20,20,20,.7)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(entity.facing) * 20, p.y + Math.sin(entity.facing) * 20);
  ctx.stroke();

  drawBar(p.x - 20, p.y - 30, 40, 4, entity.hp / 100, "#e85055", "rgba(0,0,0,.4)");
  ctx.fillStyle = "#fff";
  ctx.font = "12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,.8)";
  ctx.shadowBlur = 4;
  ctx.fillText(entity.name, p.x, p.y - 36);
  ctx.shadowBlur = 0;
}

function drawRemotePlayer(rp) {
  if (!isOnScreen(rp.x, rp.y, 40)) return;
  var p = worldToScreen(rp.x, rp.y);
  
  ctx.shadowColor = "rgba(0,0,0,.2)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = rp.alive === false ? "#555" : "#4d8fd6";
  ctx.beginPath();
  ctx.arc(p.x, p.y, HITBOX_RADIUS, 0, Math.PI * 2);
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

function drawZone() {
  var zone = currentZone();
  var p = worldToScreen(MAP_SIZE / 2, MAP_SIZE / 2);
  ctx.save();
  ctx.fillStyle = "rgba(60,60,60,.25)";
  ctx.beginPath();
  ctx.rect(0, 0, WIDTH, HEIGHT);
  ctx.arc(p.x, p.y, zone.radius, 0, Math.PI * 2, true);
  ctx.fill("evenodd");
  ctx.strokeStyle = "rgba(255,255,255,.6)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, zone.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHud() {
  var player = state.player;
  ctx.font = "14px 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.shadowColor = "rgba(0,0,0,.8)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#fff";
  ctx.fillText("HP " + Math.ceil(player.hp), 20, 26);
  ctx.fillText("Munition: " + player.ammo, 20, 46);
  ctx.fillText("Kills: " + player.kills, 20, 66);
  ctx.textAlign = "right";
  var remaining = state.multiplayer ? state.remotePlayers.size + 1 : 0;
  if (!state.multiplayer) {
    for (var i = 0; i < state.bots.length; i++) {
      if (state.bots[i].alive) remaining++;
    }
    remaining++;
  }
  ctx.fillText(remaining + " ubrig", WIDTH - 20, 26);
  ctx.shadowBlur = 0;
}

/* ---------------------------------------------------------------- */
/* Input                                                             */
/* ---------------------------------------------------------------- */

function updatePointer(event) {
  var rect = canvas.getBoundingClientRect();
  state.mouse.x = event.clientX - rect.left;
  state.mouse.y = event.clientY - rect.top;
  crosshair.style.left = event.clientX + "px";
  crosshair.style.top = event.clientY + "px";
}

canvas.addEventListener("mousemove", updatePointer);
canvas.addEventListener("mousedown", function(e) { 
  if (e.button === 0) { 
    updatePointer(e); 
    state.mouse.down = true; 
  } 
});
window.addEventListener("mouseup", function() { state.mouse.down = false; });

function isTypingInField() {
  var el = document.activeElement;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

window.addEventListener("keydown", function(event) {
  if (isTypingInField()) return;
  if (!state.running) return;
  if (["KeyW", "KeyA", "KeyS", "KeyD"].indexOf(event.code) !== -1) event.preventDefault();
  state.keys.add(event.code);
  if (event.code === "KeyE") pickupClosest();
});

window.addEventListener("keyup", function(event) {
  if (isTypingInField()) return;
  state.keys.delete(event.code);
});

window.addEventListener("blur", function() { state.keys.clear(); state.mouse.down = false; });

// Enter-Taste im Namensfeld startet Solo-Modus
playerNameInput.addEventListener("keydown", function(event) {
  if (event.code === "Enter") {
    event.preventDefault();
    state.playerName = (playerNameInput.value.trim() || "Spieler").slice(0, 16);
    state.multiplayer = false;
    startMatch();
  }
});

// Enter-Taste im Raumcode-Feld bestätigt den Code
roomCodeInput.addEventListener("keydown", function(event) {
  if (event.code === "Enter") {
    event.preventDefault();
    var code = roomCodeInput.value.trim().toUpperCase();
    if (code.length >= 4) {
      joinRoom(code);
    } else {
      showToast("Bitte gib einen 4-stelligen Code ein");
    }
  }
});

// Debug: Log wenn Seite geladen ist
console.log("Furry Arena geladen!");