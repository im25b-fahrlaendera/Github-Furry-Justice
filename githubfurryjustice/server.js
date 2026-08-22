"use strict";

/*
 * Minimal Multiplayer-Server für Furry Arena.
 * Verteilt die Positionen aller Spieler in einem Raum an alle anderen
 * Spieler im selben Raum. Kein Anti-Cheat, keine Kampf-Logik auf dem
 * Server — das ist ein Grundgerüst zum Testen von "mehrere Spieler
 * sehen sich gegenseitig", nicht ein fertiges Produktions-Backend.
 *
 * Start:
 *   npm install ws express
 *   node server.js
 *
 * Öffne dann http://localhost:3000 in zwei Browser-Tabs / Geräten,
 * bei beiden "Multiplayer" -> gleicher Raumcode.
 */

const express = require("express");
const path = require("path");
const { WebSocketServer } = require("ws");
const http = require("http");
const crypto = require("crypto");

const app = express();
app.use(express.static(__dirname));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// room code -> Map(clientId -> { socket, name, x, y, facing, hp, alive })
const rooms = new Map();

wss.on("connection", (socket, request) => {
  const url = new URL(request.url, "http://localhost");
  const room = (url.searchParams.get("room") || "LOBBY").toUpperCase();
  const id = crypto.randomUUID();

  if (!rooms.has(room)) rooms.set(room, new Map());
  const players = rooms.get(room);
  players.set(id, { socket, name: "Spieler", x: 0, y: 0, facing: 0, hp: 100, alive: true });

  socket.id = id;

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const player = players.get(id);
    if (!player) return;

    if (msg.type === "join" && typeof msg.name === "string") {
      player.name = msg.name.slice(0, 16);
    } else if (msg.type === "update") {
      player.name = typeof msg.name === "string" ? msg.name.slice(0, 16) : player.name;
      player.x = Number(msg.x) || 0;
      player.y = Number(msg.y) || 0;
      player.facing = Number(msg.facing) || 0;
      player.hp = Number(msg.hp) || 0;
      player.alive = Boolean(msg.alive);
    }

    broadcastState(room);
  });

  socket.on("close", () => {
    players.delete(id);
    if (players.size === 0) rooms.delete(room);
    else broadcastState(room);
  });
});

function broadcastState(room) {
  const players = rooms.get(room);
  if (!players) return;
  const payload = JSON.stringify({
    type: "state",
    players: Array.from(players.entries()).map(([id, p]) => ({
      id, name: p.name, x: p.x, y: p.y, facing: p.facing, hp: p.hp, alive: p.alive,
    })),
  });
  for (const p of players.values()) {
    if (p.socket.readyState === p.socket.OPEN) p.socket.send(payload);
  }
}

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Furry Arena Server läuft auf http://localhost:${port}`));
