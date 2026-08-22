# Furry Arena

Furry Arena ist ein schnelles Top‑Down‑Shooter‑Game für den Browser.  
Es bietet einen **Solo‑Modus** mit Bots sowie einen **Multiplayer‑Modus**, der über einen eigenen Node.js‑WebSocket‑Server läuft.

Das Projekt besteht aus:
- einem **Client** (HTML + Canvas + game.js)
- einem **Server** (Express + WebSocket)
- einem einfachen **Room‑System** für Multiplayer

---

## Features

### Solo‑Modus
- 5 Bots mit eigenem Verhalten (Aggro, Flucht, Wandern)
- Loot‑System (Heilung & Munition)
- Props / Hindernisse
- Shrinking Zone mit 5 Phasen
- Treffer‑System, Ammo‑System, Kills, End‑Screen

### Multiplayer‑Modus
- Raum erstellen / Raum beitreten
- 4‑stellige Codes (A–Z, ohne I/O)
- WebSocket‑Sync (`/ws?room=CODE`)
- Remote‑Player‑Rendering
- Host startet die Runde

### Technik
- Canvas‑Rendering (1280×720)
- Maus‑Aim, Crosshair, WASD‑Movement
- Bullets mit Geschwindigkeit, Range & Damage
- Game‑Loop via `requestAnimationFrame`
- HUD (HP, Ammo, Kills, Remaining Players)
- Toast‑System für Hinweise
- Vollständige Input‑Steuerung (WASD, Maus, Pickup, Enter‑Shortcuts)

---

## Contributors

- Matthieu  
- Louis
- David
- Alan

---

## Projektstruktur
/githubfurryjustice
index.html        # UI, Screens, Canvas, Multiplayer-UI
game.js           # Spiellogik, Rendering, Bots, Multiplayer, Zone, Input
server.js         # Express + WebSocket Multiplayer-Server
package.json      # Start-Skript + Dependencies

