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

// ---------- Einstellungen (z. B. Spielvorschau ein-/ausblendbar) ----------

app.get("/api/settings", requireLogin, async (req, res) => {
  const row = await db.get("SELECT value FROM settings WHERE key = 'show_match_banner'", []);
  const showMatchBanner = row ? row.value === "1" : true; // Standard: an
  res.json({ showMatchBanner });
});

app.post("/api/settings", requireLogin, requireAdmin, async (req, res) => {
  const { showMatchBanner } = req.body || {};
  await db.run(
    `INSERT INTO settings (key, value) VALUES ('show_match_banner', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [showMatchBanner ? "1" : "0"]
  );
  res.json({ ok: true });
});

// ---------- Saisonen ----------
//
// Trainings/Spiele werden ueber ihr Datum einer Saison zugerechnet (kein festes Feld auf der
// Trainings-/Spiele-Tabelle) - dadurch funktioniert das auch rueckwirkend fuer laengst
// bestehende Eintraege, ohne Migration.

function findCurrentSeason(seasons, todayStr) {
  return seasons.find((s) => s.start_date <= todayStr && todayStr <= s.end_date) || null;
}

app.get("/api/seasons", requireLogin, async (req, res) => {
  const seasons = await db.all("SELECT * FROM seasons ORDER BY start_date DESC", []);
  const todayStr = new Date().toISOString().slice(0, 10);
  const current = findCurrentSeason(seasons, todayStr);
  res.json({
    seasons: seasons.map((s) => ({ id: s.id, name: s.name, startDate: s.start_date, endDate: s.end_date })),
    currentSeasonId: current ? current.id : null,
  });
});

app.post("/api/seasons", requireLogin, requireAdmin, async (req, res) => {
  const { name, startDate, endDate } = req.body || {};
  if (!name || !name.trim() || !startDate || !endDate) {
    return res.status(400).json({ error: "Bitte Name, Start- und Enddatum angeben." });
  }
  if (endDate < startDate) {
    return res.status(400).json({ error: "Das Enddatum darf nicht vor dem Startdatum liegen." });
  }
  const existing = await db.all("SELECT * FROM seasons", []);
  const overlap = existing.find((s) => startDate <= s.end_date && endDate >= s.start_date);
  if (overlap) {
    return res.status(400).json({ error: `Der Zeitraum überschneidet sich mit "${overlap.name}".` });
  }
  const result = await db.run(
    "INSERT INTO seasons (name, start_date, end_date) VALUES (?, ?, ?)",
    [name.trim(), startDate, endDate]
  );
  res.json({ id: Number(result.lastInsertRowid) });
});

app.delete("/api/seasons/:id", requireLogin, requireAdmin, async (req, res) => {
  await db.run("DELETE FROM seasons WHERE id = ?", [Number(req.params.id)]);
  res.json({ ok: true });
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
  if (p.is_admin) {
    // Verhindert, dass der letzte verbleibende Trainer sich (oder ein anderer Trainer sich
    // gegenseitig) die Rolle entzieht und dadurch niemand mehr Zugriff auf die Verwaltung hat.
    const adminCountRow = await db.get("SELECT COUNT(*) AS c FROM players WHERE is_admin = 1", []);
    if (adminCountRow.c <= 1) {
      return res.status(400).json({ error: "Das ist der letzte verbleibende Trainer - mindestens einer muss bestehen bleiben." });
    }
  }
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
  // Verhindert doppelte Trainings am selben Datum/Uhrzeit - wichtig, damit beim Anlegen
  // von Serienterminen (oder versehentlichem Doppelklick) nichts doppelt entsteht.
  const existing = await db.get("SELECT id FROM trainings WHERE date = ? AND time = ?", [date, time]);
  if (existing) {
    return res.json({ id: existing.id, inserted: false });
  }
  const result = await db.run(
    "INSERT INTO trainings (date, time, ort, note) VALUES (?, ?, ?, ?)",
    [date, time, ort.trim(), (note || "").trim() || null]
  );
  res.json({ id: Number(result.lastInsertRowid), inserted: true });
});

app.put("/api/trainings/:id", requireLogin, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { date, time, ort, note } = req.body || {};
  if (!date || !time || !ort || !ort.trim()) {
    return res.status(400).json({ error: "Bitte Datum, Uhrzeit und Ort angeben." });
  }
  const existing = await db.get("SELECT id FROM trainings WHERE id = ?", [id]);
  if (!existing) return res.status(404).json({ error: "Training nicht gefunden." });
  // Duplikat-Schutz wie beim Anlegen: kein anderes Training am selben Datum/Uhrzeit
  const clash = await db.get("SELECT id FROM trainings WHERE date = ? AND time = ? AND id != ?", [date, time, id]);
  if (clash) {
    return res.status(400).json({ error: "Es gibt bereits ein anderes Training an diesem Datum/Uhrzeit." });
  }
  await db.run(
    "UPDATE trainings SET date = ?, time = ?, ort = ?, note = ? WHERE id = ?",
    [date, time, ort.trim(), (note || "").trim() || null, id]
  );
  res.json({ ok: true });
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
  let trainings = await db.all("SELECT * FROM trainings", []);
  const responses = await db.all("SELECT * FROM responses", []);

  // Saison-Eingrenzung: per ?seasonId=<id> eine bestimmte Saison anzeigen, per ?all=1
  // ausdruecklich alle Trainings ueber alle Saisonen hinweg. Ohne Angabe: automatisch die
  // Saison, in der "heute" liegt - falls keine definiert ist (z. B. Verein hat noch keine
  // Saisonen angelegt, oder gerade Sommerpause zwischen zwei Saisonen), faellt es auf
  // "alle Trainings" zurueck, damit die Statistik nie einfach leer/verwirrend wird.
  let activeSeason = null;
  if (req.query.all !== "1") {
    const seasons = await db.all("SELECT * FROM seasons", []);
    if (req.query.seasonId) {
      activeSeason = seasons.find((s) => s.id === Number(req.query.seasonId)) || null;
    } else {
      const todayStr = new Date().toISOString().slice(0, 10);
      activeSeason = findCurrentSeason(seasons, todayStr);
    }
    if (activeSeason) {
      trainings = trainings.filter((t) => t.date >= activeSeason.start_date && t.date <= activeSeason.end_date);
    }
  }

  const trainingIds = new Set(trainings.map((t) => t.id));
  const trainingCount = trainings.length;
  const scopedResponses = responses.filter((r) => trainingIds.has(r.training_id));

  // Die Quote soll nur auf Basis der bereits stattgefundenen (oder laufenden) Trainings
  // berechnet werden, nicht auf Basis aller inkl. zukuenftiger - sonst wuerde ein noch
  // bevorstehendes, unbeantwortetes Training die Quote kuenstlich nach unten ziehen.
  const now = Date.now();
  const pastTrainingIds = new Set(
    trainings
      .filter((t) => viennaDateTimeToUtc(t.date, t.time).getTime() <= now)
      .map((t) => t.id)
  );
  const pastTrainingCount = pastTrainingIds.size;

  const rows = players.map((p) => {
    const mine = scopedResponses.filter((r) => r.player_id === p.id);
    const zusagen = mine.filter((r) => r.status === "zusage").length;
    const vielleicht = mine.filter((r) => r.status === "vielleicht").length;
    const absagen = mine.filter((r) => r.status === "absage").length;
    const offen = trainingCount - zusagen - vielleicht - absagen;
    const pastZusagen = mine.filter((r) => r.status === "zusage" && pastTrainingIds.has(r.training_id)).length;
    const quote = pastTrainingCount > 0 ? Math.round((pastZusagen / pastTrainingCount) * 100) : 0;
    return { name: p.name, zusagen, vielleicht, absagen, offen: Math.max(offen, 0), quote };
  });
  rows.sort((a, b) => b.zusagen - a.zusagen);

  res.json({
    trainingCount,
    pastTrainingCount,
    rows,
    seasonName: activeSeason ? activeSeason.name : null,
  });
});

// ---------- Spielplan (von Trainern gepflegt, inkl. Logos & Schiedsrichter) ----------
//
// Ein automatischer Abruf von fan.at wurde ausprobiert, ist aber technisch nicht zuverlaessig
// moeglich: die Seite laedt ihre Inhalte erst per JavaScript im Browser nach, das kann ein
// normaler Server-Abruf grundsaetzlich nicht sehen (keine Struktur-Aenderung, sondern eine
// technische Grenze). Deshalb bewusst einfach gehalten: Trainer tragen die Spiele von Hand ein
// (auch als Sammel-Import moeglich, siehe Frontend "Saison-Vorlage importieren").

function publicMatch(row) {
  return {
    id: row.id,
    opponent: row.opponent,
    opponentLogoUrl: row.opponent_logo_url,
    date: row.date,
    time: row.time,
    isHome: !!row.is_home,
    ort: row.ort,
    referee: row.referee,
    round: row.round,
    note: row.note,
  };
}

app.get("/api/matches", requireLogin, async (req, res) => {
  const rows = await db.all("SELECT * FROM matches ORDER BY date, time", []);
  res.json({ matches: rows.map(publicMatch) });
});

app.post("/api/matches", requireLogin, requireAdmin, async (req, res) => {
  const { opponent, opponentLogoUrl, date, time, isHome, ort, referee, round, note } = req.body || {};
  if (!opponent || !opponent.trim() || !date || !time) {
    return res.status(400).json({ error: "Bitte Gegner, Datum und Uhrzeit angeben." });
  }
  try {
    const result = await db.run(
      `INSERT OR IGNORE INTO matches
         (opponent, opponent_logo_url, date, time, is_home, ort, referee, round, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        opponent.trim(),
        (opponentLogoUrl || "").trim() || null,
        date,
        time,
        isHome ? 1 : 0,
        (ort || "").trim() || null,
        (referee || "").trim() || null,
        (round || "").trim() || null,
        (note || "").trim() || null,
      ]
    );
    res.json({ ok: true, inserted: result.rowsAffected > 0 });
  } catch (e) {
    res.status(400).json({ error: "Konnte Spiel nicht speichern." });
  }
});

app.put("/api/matches/:id", requireLogin, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { opponent, opponentLogoUrl, date, time, isHome, ort, referee, round, note } = req.body || {};
  if (!opponent || !opponent.trim() || !date || !time) {
    return res.status(400).json({ error: "Bitte Gegner, Datum und Uhrzeit angeben." });
  }
  const existing = await db.get("SELECT id FROM matches WHERE id = ?", [id]);
  if (!existing) return res.status(404).json({ error: "Spiel nicht gefunden." });
  try {
    await db.run(
      `UPDATE matches SET opponent = ?, opponent_logo_url = ?, date = ?, time = ?,
         is_home = ?, ort = ?, referee = ?, round = ?, note = ? WHERE id = ?`,
      [
        opponent.trim(),
        (opponentLogoUrl || "").trim() || null,
        date,
        time,
        isHome ? 1 : 0,
        (ort || "").trim() || null,
        (referee || "").trim() || null,
        (round || "").trim() || null,
        (note || "").trim() || null,
        id,
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: "Konnte Spiel nicht speichern (evtl. gibt es dieses Datum/Uhrzeit/Gegner schon)." });
  }
});

app.delete("/api/matches/:id", requireLogin, requireAdmin, async (req, res) => {
  await db.run("DELETE FROM matches WHERE id = ?", [Number(req.params.id)]);
  res.json({ ok: true });
});

module.exports = app;
