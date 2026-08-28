const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const auth = require("../auth");
const { fetchNextMatchFromFanAt, FAN_AT_URL } = require("../next-match");

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

// Der Vercel-Server laeuft intern in UTC, Trainingszeiten sind aber als Wiener Ortszeit
// gemeint. Diese Funktion rechnet "Datum + Uhrzeit in Wien" in den tatsaechlichen
// UTC-Zeitpunkt um (beruecksichtigt Sommer-/Winterzeit automatisch).
function viennaDateTimeToUtc(dateStr, timeStr) {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Vienna", timeZoneName: "shortOffset" });
  const part = fmt.formatToParts(naive).find((p) => p.type === "timeZoneName");
  const match = part && part.value.match(/GMT([+-]\d+)/);
  const offsetHours = match ? parseInt(match[1], 10) : 1;
  return new Date(naive.getTime() - offsetHours * 3600 * 1000);
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

// Spieler loeschen - z. B. bei vergessenem Passwort (Spieler kann sich danach mit
// derselben oder einer anderen E-Mail neu registrieren) oder wenn jemand den Verein
// verlassen hat. Ein Admin kann sich nicht selbst loeschen (Schutz vor versehentlichem
// Aussperren, falls er der einzige Trainer ist) - dafuer stattdessen die Trainer-Rolle
// abgeben und einen anderen Trainer bitten, den Account zu entfernen.
app.delete("/api/players/:id", requireLogin, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.playerId) {
    return res.status(400).json({ error: "Du kannst dich nicht selbst löschen." });
  }
  const p = await db.get("SELECT id FROM players WHERE id = ?", [id]);
  if (!p) return res.status(404).json({ error: "Spieler nicht gefunden." });
  await db.run("DELETE FROM players WHERE id = ?", [id]);
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
  const training = await db.get("SELECT id, date, time FROM trainings WHERE id = ?", [trainingId]);
  if (!training) return res.status(404).json({ error: "Training nicht gefunden." });

  const trainingStart = viennaDateTimeToUtc(training.date, training.time);
  const cutoff = new Date(trainingStart.getTime() - 60 * 60 * 1000); // 1 Stunde vorher
  if (Date.now() >= cutoff.getTime()) {
    return res.status(400).json({ error: "Die Abstimmung ist geschlossen (weniger als 1 Stunde bis Trainingsbeginn)." });
  }

  const cleanReason = reason && reason.trim() ? reason.trim() : null;
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
    const quote = trainingCount > 0 ? Math.round((zusagen / trainingCount) * 100) : 0;
    return { name: p.name, zusagen, vielleicht, absagen, offen: Math.max(offen, 0), quote };
  });
  rows.sort((a, b) => b.zusagen - a.zusagen);

  res.json({ trainingCount, rows });
});

// ---------- Nächstes Spiel (von fan.at, mit Cache und manuellem Fallback) ----------
//
// Reihenfolge, in der die Daten ermittelt werden:
// 1. Manuelle Eingabe eines Trainers, falls vorhanden -> hat immer Vorrang (volle Kontrolle
//    fuer den Fall, dass der automatische Abruf mal nicht stimmt oder nicht klappt).
// 2. Frisch von fan.at abgerufene Daten (mit Zwischenspeicher, damit nicht bei jedem
//    Seitenaufruf neu abgerufen werden muss).
// 3. Falls der Abruf fehlschlaegt: der zuletzt bekannte Zwischenspeicher-Stand, auch wenn
//    er nicht mehr ganz frisch ist - besser als gar nichts anzuzeigen.
// 4. Wenn nichts davon verfuegbar ist: "not_available" - die App selbst funktioniert davon
//    komplett unbeeintraechtigt weiter, das ist nur ein Zusatz-Feature.

const NEXT_MATCH_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 Stunden

app.get("/api/next-match", requireLogin, async (req, res) => {
  const manual = await db.get("SELECT * FROM next_match_manual WHERE id = 1", []);
  if (manual) {
    return res.json({
      source: "manual",
      match: {
        opponent: manual.opponent,
        date: manual.date,
        time: manual.time,
        isHome: !!manual.is_home,
        ort: manual.ort,
        note: manual.note,
      },
    });
  }

  const force = req.query.force === "1";
  const cached = await db.get("SELECT * FROM next_match_cache WHERE id = 1", []);
  const cachedData = cached ? JSON.parse(cached.data) : null;
  const cacheAge = cached ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;

  if (!force && cachedData && cacheAge < NEXT_MATCH_CACHE_TTL_MS) {
    return res.json({ source: "fan.at", match: cachedData, cached: true });
  }

  try {
    const fresh = await fetchNextMatchFromFanAt();
    await db.run(
      `INSERT INTO next_match_cache (id, data, fetched_at) VALUES (1, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
      [JSON.stringify(fresh)]
    );
    return res.json({ source: "fan.at", match: fresh, cached: false });
  } catch (e) {
    console.error("fan.at Abruf fehlgeschlagen:", e.message);
    if (cachedData) {
      // Lieber leicht veraltete Daten zeigen als gar keine
      return res.json({ source: "fan.at", match: cachedData, cached: true, stale: true });
    }
    return res.json({ source: "not_available", match: null, error: e.message });
  }
});

app.post("/api/next-match/manual", requireLogin, requireAdmin, async (req, res) => {
  const { opponent, date, time, isHome, ort, note } = req.body || {};
  if (!opponent || !opponent.trim() || !date || !time) {
    return res.status(400).json({ error: "Bitte Gegner, Datum und Uhrzeit angeben." });
  }
  await db.run(
    `INSERT INTO next_match_manual (id, opponent, date, time, is_home, ort, note, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET opponent = excluded.opponent, date = excluded.date,
       time = excluded.time, is_home = excluded.is_home, ort = excluded.ort,
       note = excluded.note, updated_at = datetime('now')`,
    [opponent.trim(), date, time, isHome ? 1 : 0, (ort || "").trim() || null, (note || "").trim() || null]
  );
  res.json({ ok: true });
});

app.delete("/api/next-match/manual", requireLogin, requireAdmin, async (req, res) => {
  await db.run("DELETE FROM next_match_manual WHERE id = 1", []);
  res.json({ ok: true });
});

module.exports = app;
