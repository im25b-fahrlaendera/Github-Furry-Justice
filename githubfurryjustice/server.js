"use strict";

const express = require("express");
const path = require("path");
const { WebSocketServer } = require("ws");
const http = require("http");
const crypto = require("crypto");

const app = express();
app.use(express.static(__dirname));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const rooms = new Map();
const BOT_COUNT = 3;

function makeBot(index, mapSize) {
  const names = ["Boris", "Hoppel", "Pepe", "Ozzy", "Kira"];
  let x, y;
  do {
    x = 120 + Math.random() * (mapSize - 240);
    y = 120 + Math.random() * (mapSize - 240);
  } while (Math.hypot(x - mapSize / 2, y - mapSize / 2) < 350);
  return {
    id: "bot-" + index,
    name: names[index % names.length],
    x, y,
    radius: 16,
    color: "#8a8f86",
    hp: 100,
    alive: true,
    speed: 110 + Math.random() * 30,
    facing: Math.random() * Math.PI * 2,
    ammo: 999,
    cooldown: Math.random(),
    wanderAngle: Math.random() * Math.PI * 2,
    nextWander: 1 + Math.random() * 2,
    kind: "bot",
    kills: 0
  };
}

function makePlayer(id, name, mapSize) {
  return {
    id: id,
    name: name || "Spieler",
    x: mapSize / 2 + (Math.random() - 0.5) * 200,
    y: mapSize / 2 + (Math.random() - 0.5) * 200,
    radius: 16,
    color: "#df8845",
    hp: 100,
    alive: true,
    speed: 210,
    facing: 0,
    ammo: 20,
    kills: 0,
    cooldown: 0,
    kind: "player",
    lastUpdate: Date.now()
  };
}

function getRandomLoot(x, y) {
  return Math.random() < 0.5
      ? { x, y, type: "ammo", amount: 15 }
      : { x, y, type: "heal", amount: 25 };
}

function spawnLoot(mapSize) {
  const loot = [];
  for (let i = 0; i < 40; i++) {
    loot.push(getRandomLoot(
        80 + Math.random() * (mapSize - 160),
        80 + Math.random() * (mapSize - 160)
    ));
  }
  return loot;
}

function getBotTarget(bot, players, bots, mapSize) {
  const all = [...players, ...bots];
  let target = null;
  let best = Infinity;
  for (const e of all) {
    if (e === bot || !e.alive) continue;
    const d = Math.hypot(e.x - bot.x, e.y - bot.y);
    if (d < best) { best = d; target = e; }
  }
  return target;
}

function botShoot(bot, target, bullets, mapSize, weapon) {
  if (bot.cooldown > 0) return;
  bot.cooldown = 0.3;
  const angle = Math.atan2(target.y - bot.y, target.x - bot.x) + (Math.random() - 0.5) * 0.1;
  bullets.push({
    x: bot.x + Math.cos(angle) * 22,
    y: bot.y + Math.sin(angle) * 22,
    vx: Math.cos(angle) * weapon.speed,
    vy: Math.sin(angle) * weapon.speed,
    damage: 15,
    life: weapon.range / weapon.speed,
    ownerId: bot.id,
    ownerKind: "bot"
  });
}

function updateBot(bot, players, bots, bullets, mapSize, dt, weapon) {
  if (!bot.alive) return;
  bot.cooldown = Math.max(0, bot.cooldown - dt);

  const target = getBotTarget(bot, players, bots, mapSize);
  const bestDist = target ? Math.hypot(target.x - bot.x, target.y - bot.y) : Infinity;

  if (target && bestDist < 620) {
    const desired = Math.atan2(target.y - bot.y, target.x - bot.x);
    bot.facing = desired;
    const moveAngle = bestDist > 430 ? desired : bestDist < 320 ? desired + Math.PI : desired + Math.PI / 2;
    bot.x += Math.cos(moveAngle) * bot.speed * dt;
    bot.y += Math.sin(moveAngle) * bot.speed * dt;
    if (bestDist < weapon.range && Math.random() < dt * 1.8) {
      botShoot(bot, target, bullets, mapSize, weapon);
    }
  } else {
    bot.nextWander -= dt;
    if (bot.nextWander <= 0) {
      bot.nextWander = 1 + Math.random() * 2;
      bot.wanderAngle = Math.random() * Math.PI * 2;
    }
    bot.x += Math.cos(bot.wanderAngle) * bot.speed * 0.4 * dt;
    bot.y += Math.sin(bot.wanderAngle) * bot.speed * 0.4 * dt;
  }

  bot.x = Math.max(16, Math.min(mapSize - 16, bot.x));
  bot.y = Math.max(16, Math.min(mapSize - 16, bot.y));
}

function playerShoot(player, bullets, weapon) {
  if (player.cooldown > 0) return;
  if (player.ammo <= 0) return;
  player.ammo--;
  player.cooldown = weapon.cooldown;
  const angle = player.facing + (Math.random() - 0.5) * 0.04;
  bullets.push({
    x: player.x + Math.cos(angle) * 22,
    y: player.y + Math.sin(angle) * 22,
    vx: Math.cos(angle) * weapon.speed,
    vy: Math.sin(angle) * weapon.speed,
    damage: 15,
    life: weapon.range / weapon.speed,
    ownerId: player.id,
    ownerKind: "player"
  });
}

function updateBullets(bullets, players, bots, mapSize) {
  const all = [...players, ...bots];
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * 0.016;
    b.y += b.vy * 0.016;
    b.life -= 0.016;

    let hit = null;
    for (const e of all) {
      if (!e.alive) continue;
      if (e.id === b.ownerId) continue;
      if (Math.hypot(e.x - b.x, e.y - b.y) < e.radius + 3) {
        hit = e;
        break;
      }
    }

    if (hit) {
      hit.hp -= b.damage;
      if (hit.hp <= 0) {
        hit.hp = 0;
        hit.alive = false;
        const killer = all.find(e => e.id === b.ownerId);
        if (killer && killer.alive) {
          killer.kills = (killer.kills || 0) + 1;
        }
        // Loot drop
        if (hit.kind === "player" || hit.kind === "bot") {
          // loot wird client-seitig generiert
        }
      }
      bullets.splice(i, 1);
    } else if (b.life <= 0 || b.x < 0 || b.x > mapSize || b.y < 0 || b.y > mapSize) {
      bullets.splice(i, 1);
    }
  }
}

function getAliveCount(players, bots) {
  let count = 0;
  for (const p of players) if (p.alive) count++;
  for (const b of bots) if (b.alive) count++;
  return count;
}

wss.on("connection", (socket, request) => {
  const url = new URL(request.url, "http://localhost");
  const room = (url.searchParams.get("room") || "LOBBY").toUpperCase();
  const id = crypto.randomUUID();

  if (!rooms.has(room)) {
    const mapSize = 1800;
    rooms.set(room, {
      players: new Map(),
      bots: [],
      bullets: [],
      loot: spawnLoot(mapSize),
      mapSize: mapSize,
      gameRunning: false,
      gameTime: 0,
      lastUpdate: Date.now(),
      weapon: { damage: 15, cooldown: 0.3, range: 550, speed: 850 }
    });
  }

  const roomData = rooms.get(room);
  const player = makePlayer(id, "Spieler", roomData.mapSize);
  roomData.players.set(id, { socket, player });

  // Bots spawnen wenn Spieler joinen
  if (roomData.bots.length === 0) {
    for (let i = 0; i < BOT_COUNT; i++) {
      roomData.bots.push(makeBot(i, roomData.mapSize));
    }
  }

  socket.id = id;

  socket.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const entry = roomData.players.get(id);
    if (!entry) return;
    const player = entry.player;

    if (msg.type === "join" && typeof msg.name === "string") {
      player.name = msg.name.slice(0, 16);
    } else if (msg.type === "update") {
      player.name = typeof msg.name === "string" ? msg.name.slice(0, 16) : player.name;
      player.x = Number(msg.x) || player.x;
      player.y = Number(msg.y) || player.y;
      player.facing = Number(msg.facing) || 0;
      player.hp = Number(msg.hp) || 100;
      player.alive = Boolean(msg.alive);
      player.ammo = Number(msg.ammo) || player.ammo;
      player.lastUpdate = Date.now();
    } else if (msg.type === "shoot") {
      if (player.alive && player.ammo > 0) {
        playerShoot(player, roomData.bullets, roomData.weapon);
      }
    } else if (msg.type === "pickup") {
      const idx = roomData.loot.findIndex(l =>
          Math.hypot(l.x - player.x, l.y - player.y) < 60
      );
      if (idx !== -1) {
        const item = roomData.loot[idx];
        roomData.loot.splice(idx, 1);
        if (item.type === "ammo") {
          player.ammo += item.amount;
        } else {
          player.hp = Math.min(100, player.hp + item.amount);
        }
        // Neuen Loot spawnen
        const mapSize = roomData.mapSize;
        roomData.loot.push(getRandomLoot(
            80 + Math.random() * (mapSize - 160),
            80 + Math.random() * (mapSize - 160)
        ));
      }
    } else if (msg.type === "start") {
      roomData.gameRunning = true;
      roomData.gameTime = 0;
    }
  });

  socket.on("close", () => {
    roomData.players.delete(id);
    if (roomData.players.size === 0) {
      rooms.delete(room);
    }
  });
});

// Game Loop pro Raum
setInterval(() => {
  const now = Date.now();
  for (const [room, data] of rooms) {
    if (!data.gameRunning || data.players.size === 0) continue;

    const dt = Math.min(0.05, (now - data.lastUpdate) / 1000);
    data.lastUpdate = now;
    data.gameTime += dt;

    // Spieler updaten (von Clients)
    for (const [id, entry] of data.players) {
      const p = entry.player;
      if (!p.alive) continue;
      // Timeout für inaktive Spieler
      if (now - p.lastUpdate > 5000) {
        p.alive = false;
      }
    }

    // Bots updaten
    const players = Array.from(data.players.values()).map(e => e.player);
    for (const bot of data.bots) {
      updateBot(bot, players, data.bots, data.bullets, data.mapSize, dt, data.weapon);
    }

    // Bullets updaten
    updateBullets(data.bullets, players, data.bots, data.mapSize);

    // Zone Damage (einfache Version)
    const phase = Math.min(Math.floor(data.gameTime / 28), 4);
    const zoneRadius = [850, 620, 420, 260, 130][phase] || 130;
    const zoneDamage = [2, 5, 9, 15, 25][phase] || 25;
    for (const p of players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - data.mapSize / 2, p.y - data.mapSize / 2) > zoneRadius) {
        p.hp -= zoneDamage * dt;
        if (p.hp <= 0) { p.hp = 0; p.alive = false; }
      }
    }
    for (const bot of data.bots) {
      if (!bot.alive) continue;
      if (Math.hypot(bot.x - data.mapSize / 2, bot.y - data.mapSize / 2) > zoneRadius) {
        bot.hp -= zoneDamage * dt;
        if (bot.hp <= 0) { bot.hp = 0; bot.alive = false; }
      }
    }

    // Game Over check
    const alivePlayers = players.filter(p => p.alive);
    if (alivePlayers.length <= 1 && data.bots.filter(b => b.alive).length === 0) {
      data.gameRunning = false;
      const winner = alivePlayers.length === 1 ? alivePlayers[0] : null;
      // Broadcast game over
      broadcastState(room, data, winner);
      continue;
    }

    // State broadcasten
    broadcastState(room, data, null);
  }
}, 50);

function broadcastState(room, data, winner) {
  const players = Array.from(data.players.values()).map(e => e.player);
  const payload = JSON.stringify({
    type: "state",
    players: players.map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      facing: p.facing,
      hp: p.hp,
      alive: p.alive,
      kills: p.kills || 0
    })),
    bots: data.bots.map(b => ({
      id: b.id,
      name: b.name,
      x: b.x,
      y: b.y,
      facing: b.facing,
      hp: b.hp,
      alive: b.alive
    })),
    bullets: data.bullets.map(b => ({
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy
    })),
    loot: data.loot.map(l => ({
      x: l.x,
      y: l.y,
      type: l.type
    })),
    gameTime: data.gameTime,
    gameRunning: data.gameRunning,
    winner: winner ? { id: winner.id, name: winner.name } : null
  });

  for (const [id, entry] of data.players) {
    if (entry.socket.readyState === entry.socket.OPEN) {
      entry.socket.send(payload);
    }
  }
}

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Furry Arena Server läuft auf http://localhost:${port}`));