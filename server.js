
const express = require("express");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use("/static", express.static(path.join(__dirname, "static")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "static", "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

// ---------------------------------------------------------------
// Spielkonstanten
// ---------------------------------------------------------------
const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;
const PLAYER_SPEED = 260; // Pixel pro Sekunde
const PLAYER_RADIUS = 20;
const TICK_RATE = 30; // Server-Updates pro Sekunde

// Tier-Skins fürs Furry-Theme - kann beliebig erweitert werden
const ANIMAL_SKINS = ["fox", "wolf", "raccoon", "otter", "bear", "cat"];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

class Player {
  constructor(id) {
    this.id = id;
    this.x = randomFloat(100, WORLD_WIDTH - 100);
    this.y = randomFloat(100, WORLD_HEIGHT - 100);
    this.animal = randomChoice(ANIMAL_SKINS);
    this.color = `hsl(${randomInt(0, 360)}, 70%, 55%)`;
    // Aktuell gedrückte Richtungstasten, vom Client geschickt
    this.inputUp = false;
    this.inputDown = false;
    this.inputLeft = false;
    this.inputRight = false;
    this.score = 0;
  }

  toJSON() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      animal: this.animal,
      color: this.color,
      score: this.score,
    };
  }
}

class GameState {
  constructor() {
    this.players = new Map(); // id -> Player
  }

  addPlayer(playerId) {
    const player = new Player(playerId);
    this.players.set(playerId, player);
    return player;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
  }

  applyInput(playerId, data) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.inputUp = !!data.up;
    p.inputDown = !!data.down;
    p.inputLeft = !!data.left;
    p.inputRight = !!data.right;
  }

  tick(dt) {
    for (const p of this.players.values()) {
      const dx = (p.inputRight ? 1 : 0) - (p.inputLeft ? 1 : 0);
      const dy = (p.inputDown ? 1 : 0) - (p.inputUp ? 1 : 0);
      if (dx || dy) {
        // Diagonalbewegung normalisieren, damit sie nicht schneller ist
        const length = Math.sqrt(dx * dx + dy * dy);
        const nx = dx / length;
        const ny = dy / length;
        p.x = Math.max(
          PLAYER_RADIUS,
          Math.min(WORLD_WIDTH - PLAYER_RADIUS, p.x + nx * PLAYER_SPEED * dt)
        );
        p.y = Math.max(
          PLAYER_RADIUS,
          Math.min(WORLD_HEIGHT - PLAYER_RADIUS, p.y + ny * PLAYER_SPEED * dt)
        );
      }
    }
  }

  snapshot() {
    return {
      type: "state",
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      players: Array.from(this.players.values()).map((p) => p.toJSON()),
    };
  }
}

const state = new GameState();
const connections = new Map(); // id -> WebSocket

wss.on("connection", (ws) => {
  const playerId = `p${randomInt(1000, 999999)}`;
  connections.set(playerId, ws);
  state.addPlayer(playerId);

  ws.send(JSON.stringify({ type: "welcome", id: playerId }));

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === "input") {
        state.applyInput(playerId, data);
      }
    } catch (err) {
      // Ungültige Nachricht ignorieren
    }
  });

  ws.on("close", () => {
    state.removePlayer(playerId);
    connections.delete(playerId);
  });
});

// ---------------------------------------------------------------
// Game-Loop: läuft dauerhaft im Hintergrund, bewegt Spieler und
// sendet Updates an alle verbundenen Clients.
// ---------------------------------------------------------------
let lastTime = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  state.tick(dt);
  const snapshot = JSON.stringify(state.snapshot());

  for (const [pid, ws] of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(snapshot);
    } else {
      connections.delete(pid);
      state.removePlayer(pid);
    }
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
