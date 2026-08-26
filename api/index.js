const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const auth = require("../auth");

const app = express();
app.use(express.json());

// Datenbank-Tabellen bei Bedarf anlegen (einmalig pro kaltem Start der Funktion,
// bei warmen Aufrufen wird das gecachte Promise sofort aufgeloest)
app.use(async (req, res, next) => {
  try {
    await db.initSchema();
    next();
  } catch (e) {
    console.error("Datenbank-Fehler:", e);
    res.status(500).json({ error: "Datenbank ist gerade nicht erreichbar." });
  }
});

// ---------- Hilfsfunktionen ----------

async function requireLogin(req, res, next) {
  const playerId = auth.getPlayerIdFromReq(req);
  if (!playerId) return res.status(401).json({ error: "Nicht angemeldet." });
  req.playerId = playerId;
  next();
}

async function requireAdmin(req, res, next) {
  const p = await db.get("SELECT is_admin FROM players WHERE id = ?", [req.playerId]);
  if (!p || !p.is_admin) return res.status(403).json({ error: "Nur fuer Trainer verfuegbar." });
  next();
}

function publicPlayer(row) {
  return { id: row.id, name: row.name, email: row.email, isAdmin: !!row.is_admin };
}

// ---------- Auth ----------

app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !name.trim() || !email || !email.includes("@") || !password || password.length < 6) {
    return res.status(400).json({ error: "Bitte Name, gueltige E-Mail und ein Passwort mit mind. 6 Zeichen angeben." });
  }
  const cleanEmail = email.trim().toLowerCase();
  const existing = await db.get("SELECT id FROM players WHERE email = ?", [cleanEmail]);
  if (existing) return res.status(409).json({ error: "Diese E-Mail ist bereits registriert." });

  const countRow = await db.get("SELECT COUNT(*) AS c FROM players", []);
  const isFirst = countRow.c === 0;
  const hash = bcrypt.hashSync(password, 10);
  const result = await db.run(
    "INSERT INTO players (name, email, password_hash, is_admin) VALUES (?, ?, ?, ?)",
    [name.trim(), cleanEmail, hash, isFirst ? 1 : 0]
  );
  const playerId = Number(result.lastInsertRowid);
  auth.setAuthCookie(res, playerId);
  const player = await db.get("SELECT * FROM players WHERE id = ?", [playerId]);
  res.json({ player: publicPlayer(player) });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Bitte E-Mail und Passwort angeben." });
  const player = await db.get("SELECT * FROM players WHERE email = ?", [email.trim().toLowerCase()]);
  if (!player || !bcrypt.compareSync(password, player.password_hash)) {
    return res.status(401).json({ error: "E-Mail oder Passwort ist falsch." });
  }
  auth.setAuthCookie(res, player.id);
  res.json({ player: publicPlayer(player) });
});

app.post("/api/logout", async (req, res) => {
  auth.clearAuthCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  const playerId = auth.getPlayerIdFromReq(req);
  if (!playerId) return res.json({ player: null });
  const player = await db.get("SELECT * FROM players WHERE id = ?", [playerId]);
  if (!player) return res.json({ player: null });
  res.json({ player: publicPlayer(player) });
});

// ---------- Spieler (nur fuer Trainer/Verwaltung sichtbar) ----------

app.get("/api/players", requireLogin, requireAdmin, async (req, res) => {
  const players = await db.all("SELECT * FROM players ORDER BY name COLLATE NOCASE", []);
  res.json({ players: players.map(publicPlayer) });
});

app.post("/api/players/:id/admin", requireLogin, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.get("SELECT * FROM players WHERE id = ?", [id]);
  if (!p) return res.status(404).json({ error: "Spieler nicht gefunden." });
  await db.run("UPDATE players SET is_admin = ? WHERE id = ?", [p.is_admin ? 0 : 1, id]);
  res.json({ ok: true });
});

// ---------- Trainings ----------

app.get("/api/trainings", requireLogin, async (req, res) => {
  const trainings = await db.all("SELECT * FROM trainings ORDER BY date, time", []);
  const responses = await db.all("SELECT * FROM responses", []);
  const guests = await db.all("SELECT * FROM training_guests ORDER BY name COLLATE NOCASE", []);

  const result = trainings.map((t) => {
    const myResp = responses.find((r) => r.training_id === t.id && r.player_id === req.playerId);
    const guestsForTraining = guests
      .filter((g) => g.training_id === t.id)
      .map((g) => ({ id: g.id, name: g.name }));
    return {
      id: t.id,
      date: t.date,
      time: t.time,
      ort: t.ort,
      note: t.note,
      myStatus: myResp ? myResp.status : null,
      myReason: myResp ? myResp.reason : null,
      guests: guestsForTraining,
    };
  });
  res.json({ trainings: result });
});

app.post("/api/trainings", requireLogin, requireAdmin, async (req, res) => {
  const { date, time, ort, note } = req.body || {};
  if (!date || !time || !ort || !ort.trim()) {
    return res.status(400).json({ error: "Bitte Datum, Uhrzeit und Ort angeben." });
  }
  const result = await db.run(
    "INSERT INTO trainings (date, time, ort, note) VALUES (?, ?, ?, ?)",
    [date, time, ort.trim(), (note || "").trim() || null]
  );
  res.json({ id: Number(result.lastInsertRowid) });
});

app.delete("/api/trainings/:id", requireLogin, requireAdmin, async (req, res) => {
  await db.run("DELETE FROM trainings WHERE id = ?", [Number(req.params.id)]);
  res.json({ ok: true });
});

app.post("/api/trainings/:id/rsvp", requireLogin, async (req, res) => {
  const trainingId = Number(req.params.id);
  const { status, reason } = req.body || {};
  if (!["zusage", "vielleicht", "absage"].includes(status)) {
    return res.status(400).json({ error: "Ungueltiger Status." });
  }
  if ((status === "vielleicht" || status === "absage") && (!reason || !reason.trim())) {
    return res.status(400).json({ error: "Bitte einen Grund angeben." });
  }
  const training = await db.get("SELECT id FROM trainings WHERE id = ?", [trainingId]);
  if (!training) return res.status(404).json({ error: "Training nicht gefunden." });

  const cleanReason = status === "zusage" ? null : reason.trim();
  await db.run(
    `INSERT INTO responses (training_id, player_id, status, reason, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(training_id, player_id)
     DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_at = datetime('now')`,
    [trainingId, req.playerId, status, cleanReason]
  );
  res.json({ ok: true });
});

// Uebersicht: fuer ein Training genau sehen, wer zu-/abgesagt hat (inkl. Gruende) und welche Gaeste zugesagt haben.
app.get("/api/trainings/:id/overview", requireLogin, async (req, res) => {
  const trainingId = Number(req.params.id);
  const training = await db.get("SELECT id FROM trainings WHERE id = ?", [trainingId]);
  if (!training) return res.status(404).json({ error: "Training nicht gefunden." });

  const players = await db.all("SELECT * FROM players ORDER BY name COLLATE NOCASE", []);
  const responses = await db.all("SELECT * FROM responses WHERE training_id = ?", [trainingId]);
  const guests = await db.all("SELECT * FROM training_guests WHERE training_id = ? ORDER BY name COLLATE NOCASE", [trainingId]);

  const byPlayer = {};
  responses.forEach((r) => { byPlayer[r.player_id] = r; });

  const groups = { zusage: [], vielleicht: [], absage: [], offen: [] };
  players.forEach((p) => {
    const r = byPlayer[p.id];
    const entry = { id: p.id, name: p.name, reason: r ? r.reason : null };
    if (!r) groups.offen.push(entry);
    else groups[r.status].push(entry);
  });

  res.json({ groups, guests: guests.map((g) => ({ id: g.id, name: g.name })) });
});

// ---------- Gastspieler pro Training (nur Zusage, kein eigener Login) ----------

app.post("/api/trainings/:id/guests", requireLogin, requireAdmin, async (req, res) => {
  const trainingId = Number(req.params.id);
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Bitte einen Namen angeben." });
  const training = await db.get("SELECT id FROM trainings WHERE id = ?", [trainingId]);
  if (!training) return res.status(404).json({ error: "Training nicht gefunden." });
  const result = await db.run(
    "INSERT INTO training_guests (training_id, name) VALUES (?, ?)",
    [trainingId, name.trim()]
  );
  res.json({ id: Number(result.lastInsertRowid) });
});

app.delete("/api/trainings/:id/guests/:guestId", requireLogin, requireAdmin, async (req, res) => {
  await db.run(
    "DELETE FROM training_guests WHERE id = ? AND training_id = ?",
    [Number(req.params.guestId), Number(req.params.id)]
  );
  res.json({ ok: true });
});

// ---------- Statistik ----------

app.get("/api/stats", requireLogin, async (req, res) => {
  const players = await db.all("SELECT * FROM players ORDER BY name COLLATE NOCASE", []);
  const trainingCountRow = await db.get("SELECT COUNT(*) AS c FROM trainings", []);
  const trainingCount = trainingCountRow.c;
  const responses = await db.all("SELECT * FROM responses", []);

  const rows = players.map((p) => {
    const mine = responses.filter((r) => r.player_id === p.id);
    const zusagen = mine.filter((r) => r.status === "zusage").length;
    const vielleicht = mine.filter((r) => r.status === "vielleicht").length;
    const absagen = mine.filter((r) => r.status === "absage").length;
    const offen = trainingCount - zusagen - vielleicht - absagen;
    return { name: p.name, zusagen, vielleicht, absagen, offen: Math.max(offen, 0) };
  });
  rows.sort((a, b) => b.zusagen - a.zusagen);

  res.json({ trainingCount, rows });
});

module.exports = app;
