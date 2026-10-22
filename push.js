// Benachrichtigungen (Web-Push) fuer den Trainingsplaner.
// Drei Arten, jeweils vom Trainer ein-/ausschaltbar und mit eigenen Texten:
//   reminder - Erinnerung an Spieler, die noch nicht abgestimmt haben (X Stunden vor Trainingsbeginn)
//   change   - Training geaendert/abgesagt (sofort, an alle angemeldeten Spieler)
//   summary  - Uebersicht der Zusagen fuer Trainer (X Stunden vor Trainingsbeginn)
// Die zeitgesteuerten Arten werden von tick() ausgeloest, das von aussen regelmaessig aufgerufen wird
// (siehe /api/cron/tick). tick() ist idempotent: jede Benachrichtigung wird pro Training nur einmal gesendet.

const db = require("./db");

let webpush = null;
try {
  webpush = require("web-push");
} catch (e) {
  console.warn("Paket 'web-push' nicht installiert - Benachrichtigungen sind deaktiviert.");
}

let logger = async () => {};
function setLogger(fn) {
  logger = fn;
}
const SYSTEM = { id: null, name: "System" };

// ---------- Hilfsfunktionen (Wiener Zeit) ----------

const WEEKDAYS = ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."];
const fmtDate = (dateStr) => {
  const [y, m, d] = String(dateStr).split("-");
  return `${WEEKDAYS[new Date(`${dateStr}T12:00:00Z`).getUTCDay()]} ${d}.${m}.${y}`;
};
const viennaDateStr = (date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna" }).format(date);

function viennaDateTimeToUtc(dateStr, timeStr) {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Vienna", timeZoneName: "shortOffset" });
  const part = fmt.formatToParts(naive).find((p) => p.type === "timeZoneName");
  const match = part && part.value.match(/GMT([+-]\d+)/);
  const offsetHours = match ? parseInt(match[1], 10) : 1;
  return new Date(naive.getTime() - offsetHours * 3600 * 1000);
}

const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDateL = (dateStr, lang) => {
  if (lang !== "en") return fmtDate(dateStr);
  const [y, m, d] = String(dateStr).split("-");
  return `${WEEKDAYS_EN[new Date(`${dateStr}T12:00:00Z`).getUTCDay()]} ${d}/${m}/${y}`;
};

function dayWord(dateStr, now, lang) {
  const today = new Date(`${viennaDateStr(now)}T12:00:00Z`).getTime();
  const that = new Date(`${dateStr}T12:00:00Z`).getTime();
  const diff = Math.round((that - today) / 86400000);
  if (diff === 0) return lang === "en" ? "today" : "heute";
  if (diff === 1) return lang === "en" ? "tomorrow" : "morgen";
  const [, m, d] = dateStr.split("-");
  const names = lang === "en" ? WEEKDAYS_EN : WEEKDAYS;
  return `${names[new Date(`${dateStr}T12:00:00Z`).getUTCDay()]} ${d}.${m}.`;
}
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clip = (v, n) => {
  const t = String(v == null ? "" : v).trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

function trainingVars(t, now, lang) {
  const tag = dayWord(t.date, now, lang);
  return { tag, Tag: capitalize(tag), datum: fmtDateL(t.date, lang), zeit: lang === "en" ? t.time : t.time, ort: t.ort || "" };
}

const fieldName = (lang, f) => (lang === "en" ? f + "En" : f); // welche Textvorlage (Deutsch/Englisch) gilt
const langOf = (row) => (row && row.lang === "en" ? "en" : "de");

function renderTemplate(str, vars) {
  return String(str || "").replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

// ---------- Einstellungen (vom Trainer aenderbar) ----------

const DEFAULTS = {
  reminder: {
    enabled: true,
    hoursBefore: 24,
    title: "Training {tag} um {zeit} Uhr",
    body: "{ort} · Du hast noch nicht abgestimmt. Kommst du?",
    titleEn: "Training {tag} at {zeit}",
    bodyEn: "{ort} · You haven't responded yet. Are you coming?",
  },
  change: {
    enabled: true,
    title: "Training {tag} geändert",
    body: "{aenderung}",
    cancelTitle: "Training abgesagt",
    cancelBody: "Das Training am {datum} um {zeit} Uhr entfällt.",
    titleEn: "Training {tag} changed",
    bodyEn: "{aenderung}",
    cancelTitleEn: "Training cancelled",
    cancelBodyEn: "The training on {datum} at {zeit} has been cancelled.",
  },
  summary: {
    enabled: true,
    hoursBefore: 3,
    title: "{Tag} {zeit} Uhr: {zusagenText}",
    body: "{vielleichtText}, {absagenText}, {offenText}.",
    titleEn: "{Tag} {zeit}: {zusagenText}",
    bodyEn: "{vielleichtText}, {absagenText}, {offenText}.",
  },
};

const PLACEHOLDERS = {
  reminder: ["tag", "Tag", "datum", "zeit", "ort"],
  change: ["tag", "Tag", "datum", "zeit", "ort", "aenderung"],
  summary: ["tag", "Tag", "datum", "zeit", "ort", "zusagenText", "vielleichtText", "absagenText", "offenText", "gaesteText"],
};

const TEXT_FIELDS = {
  reminder: ["title", "body", "titleEn", "bodyEn"],
  change: ["title", "body", "cancelTitle", "cancelBody", "titleEn", "bodyEn", "cancelTitleEn", "cancelBodyEn"],
  summary: ["title", "body", "titleEn", "bodyEn"],
};
const LIMITS = { title: 80, cancelTitle: 80, body: 200, cancelBody: 200, titleEn: 80, cancelTitleEn: 80, bodyEn: 200, cancelBodyEn: 200 };

function mergeConfig(stored) {
  const out = {};
  for (const kind of Object.keys(DEFAULTS)) {
    out[kind] = Object.assign({}, DEFAULTS[kind], (stored && stored[kind]) || {});
  }
  return out;
}

// Fruehere Standardtexte: Wurden sie unveraendert gespeichert, gilt automatisch der neue Standardtext.
const OLD_DEFAULTS = [
  ["change", "title", "Training geändert"],
  ["summary", "title", "{Tag}: {zusagen} Zusagen"],
  ["summary", "body", "{vielleicht} Vielleicht, {absagen} Absagen, {offen} noch offen."],
];

async function readConfig() {
  const row = await db.get("SELECT value FROM settings WHERE key = 'notifications'", []);
  let stored = {};
  try {
    stored = row ? JSON.parse(row.value) : {};
  } catch (e) {
    stored = {};
  }
  for (const [kind, field, oldValue] of OLD_DEFAULTS) {
    if (stored[kind] && stored[kind][field] === oldValue) delete stored[kind][field];
  }
  return mergeConfig(stored);
}

// Zahl + Wort in richtiger Einzahl/Mehrzahl ("1 Zusage", "3 Zusagen")
const countWord = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Texte der Zusagen-Uebersicht: Zahl + Wort in der richtigen Sprache/Einzahl/Mehrzahl
function summaryWords(v, lang) {
  if (lang === "en") {
    return {
      zusagenText: `${v.zusagen} going`,
      vielleichtText: `${v.vielleicht} maybe`,
      absagenText: `${v.absagen} not going`,
      offenText: `${v.offen} still open`,
      gaesteText: countWord(v.gaeste, "guest", "guests"),
    };
  }
  return {
    zusagenText: countWord(v.zusagen, "Zusage", "Zusagen"),
    vielleichtText: `${v.vielleicht} Vielleicht`,
    absagenText: countWord(v.absagen, "Absage", "Absagen"),
    offenText: `${v.offen} noch offen`,
    gaesteText: countWord(v.gaeste, "Gast", "Gäste"),
  };
}

// Aenderungstext (Termin/Ort/Hinweis) in der Sprache des Empfaengers
function changeParts(before, after, lang) {
  const en = lang === "en";
  const parts = [];
  if (before.date !== after.date) {
    parts.push(en
      ? `New date: ${fmtDateL(after.date, lang)} ${after.time} (was: ${fmtDateL(before.date, lang)} ${before.time})`
      : `Neuer Termin: ${fmtDate(after.date)} ${after.time} Uhr (vorher: ${fmtDate(before.date)} ${before.time} Uhr)`);
  } else if (before.time !== after.time) {
    parts.push(en ? `New time: ${after.time} (was: ${before.time})` : `Neue Uhrzeit: ${after.time} Uhr (vorher: ${before.time} Uhr)`);
  }
  if ((before.ort || "") !== (after.ort || "")) parts.push(en ? `New place: ${after.ort} (was: ${before.ort})` : `Neuer Ort: ${after.ort} (vorher: ${before.ort})`);
  if ((before.note || "") !== (after.note || "")) parts.push(after.note ? (en ? `Note: ${after.note}` : `Hinweis: ${after.note}`) : (en ? "Note removed" : "Hinweis entfernt"));
  return parts;
}

// Prueft eine (teilweise) Einstellungs-Aenderung. Leerer Text = auf Standardtext zuruecksetzen.
function validatePatch(patch) {
  const clean = {};
  for (const kind of Object.keys(DEFAULTS)) {
    const p = patch && patch[kind];
    if (p === undefined) continue;
    if (!p || typeof p !== "object") return { error: "Ungültige Einstellungen." };
    clean[kind] = {};
    if (p.enabled !== undefined) clean[kind].enabled = !!p.enabled;
    if (p.hoursBefore !== undefined) {
      if (kind === "change") return { error: "Für Änderungen gibt es keine Vorlaufzeit." };
      const h = Number(p.hoursBefore);
      if (!Number.isInteger(h) || h < 1 || h > 72) return { error: "Die Vorlaufzeit muss eine ganze Zahl zwischen 1 und 72 Stunden sein." };
      clean[kind].hoursBefore = h;
    }
    for (const f of TEXT_FIELDS[kind]) {
      if (p[f] === undefined) continue;
      const v = typeof p[f] === "string" ? p[f].trim() : "";
      if (v.length > LIMITS[f]) return { error: `Der Text ist zu lang (höchstens ${LIMITS[f]} Zeichen).` };
      clean[kind][f] = v || DEFAULTS[kind][f];
    }
  }
  return { clean };
}

async function saveConfig(clean) {
  const current = await readConfig();
  for (const kind of Object.keys(clean)) Object.assign(current[kind], clean[kind]);
  await db.run(
    `INSERT INTO settings (key, value) VALUES ('notifications', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(current)]
  );
  return current;
}

// ---------- VAPID-Schluessel (Absender-Kennung fuer Web-Push) ----------
// Werden beim ersten Gebrauch automatisch erzeugt und in der Datenbank gespeichert - der Trainer muss nichts
// einrichten. Wer will, kann sie stattdessen als VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in Vercel hinterlegen.

let vapidCache = null;

async function getVapid() {
  if (!webpush) return null;
  if (vapidCache) return vapidCache;
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    let row = await db.get("SELECT value FROM settings WHERE key = 'vapid_keys'", []);
    if (!row) {
      const keys = webpush.generateVAPIDKeys();
      // INSERT OR IGNORE + erneutes Lesen: wenn zwei Server gleichzeitig starten, gewinnt genau ein Schluesselpaar
      await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_keys', ?)", [JSON.stringify(keys)]);
      row = await db.get("SELECT value FROM settings WHERE key = 'vapid_keys'", []);
    }
    const stored = JSON.parse(row.value);
    publicKey = stored.publicKey;
    privateKey = stored.privateKey;
  }
  let subject = process.env.VAPID_SUBJECT;
  if (!subject && process.env.VERCEL_PROJECT_PRODUCTION_URL) subject = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (!subject) {
    const admin = await db.get("SELECT email FROM players WHERE is_admin = 1 ORDER BY id LIMIT 1", []);
    subject = `mailto:${admin ? admin.email : "trainer@example.com"}`;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidCache = { publicKey };
  return vapidCache;
}

function isAvailable() {
  return !!webpush;
}

// ---------- Senden ----------

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), ms))]);

async function subscriptionsFor(kind, { onlyAdmins = false, excludePlayerId = null, onlyPlayerId = null, ignorePrefs = false } = {}) {
  const col = { reminder: "pref_reminder", change: "pref_change", summary: "pref_summary" }[kind];
  const rows = await db.all(
    `SELECT s.id, s.player_id, s.endpoint, s.p256dh, s.auth, p.is_admin, p.lang
       FROM push_subscriptions s
       JOIN players p ON p.id = s.player_id
       LEFT JOIN notify_prefs n ON n.player_id = s.player_id
      WHERE ${ignorePrefs ? "1 = 1" : `COALESCE(n.${col}, 1) = 1`}`,
    []
  );
  return rows.filter(
    (r) =>
      (!onlyAdmins || r.is_admin) &&
      (excludePlayerId == null || r.player_id !== excludePlayerId) &&
      (onlyPlayerId == null || r.player_id === onlyPlayerId)
  );
}

async function sendPayload(subs, payload, ttlSeconds) {
  const result = { sent: 0, failed: 0, removed: 0 };
  if (!webpush || subs.length === 0) return result;
  await getVapid();
  const body = JSON.stringify(payload);
  const queue = subs.slice();
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: ttlSeconds, urgency: "normal", timeout: 6000 }
        );
        result.sent++;
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          // Gerät hat sich abgemeldet / App deinstalliert -> Eintrag aufräumen
          await db.run("DELETE FROM push_subscriptions WHERE id = ?", [s.id]);
          result.removed++;
        } else {
          result.failed++;
          console.error("Push fehlgeschlagen:", e && (e.statusCode || e.message));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, subs.length) }, worker));
  return result;
}

// Sendet pro Sprache eine eigene Fassung: buildPayload(lang) liefert die Nachricht in der jeweiligen Sprache
async function sendLocalized(subs, buildPayload, ttlSeconds) {
  const total = { sent: 0, failed: 0, removed: 0 };
  for (const lang of ["de", "en"]) {
    const group = subs.filter((s) => langOf(s) === lang);
    if (group.length === 0) continue;
    const r = await sendPayload(group, buildPayload(lang), ttlSeconds);
    total.sent += r.sent; total.failed += r.failed; total.removed += r.removed;
  }
  return total;
}

// ---------- Zeitgesteuert (Erinnerung + Trainer-Uebersicht) ----------

let lastTickAt = 0;
const TICK_MIN_GAP_MS = process.env.TICK_MIN_GAP_MS !== undefined ? Number(process.env.TICK_MIN_GAP_MS) : 15000; // Schutz vor Dauerfeuer

async function claim(kind, trainingId) {
  const r = await db.run("INSERT OR IGNORE INTO notification_sent (kind, training_id) VALUES (?, ?)", [kind, trainingId]);
  return r.rowsAffected > 0;
}

async function tick(now = new Date(), { force = false } = {}) {
  const out = { ran: true, reminders: 0, summaries: 0 };
  if (!webpush) return Object.assign(out, { ran: false, reason: "web-push nicht installiert" });
  if (!force && Date.now() - lastTickAt < TICK_MIN_GAP_MS) return Object.assign(out, { ran: false, reason: "zu kurz nach dem letzten Aufruf" });
  lastTickAt = Date.now();
  // Merken, wann zuletzt "nachgeschaut" wurde - die Verwaltung zeigt damit, ob der regelmaessige Aufruf eingerichtet ist
  try {
    await db.run(
      `INSERT INTO settings (key, value) VALUES ('last_tick', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [new Date().toISOString()]
    );
  } catch (e) {
    console.error("last_tick nicht gespeichert:", e);
  }

  const cfg = await readConfig();
  if (!cfg.reminder.enabled && !cfg.summary.enabled) return out;

  const from = viennaDateStr(new Date(now.getTime() - 24 * 3600 * 1000));
  const to = viennaDateStr(new Date(now.getTime() + 5 * 24 * 3600 * 1000));
  const trainings = await db.all("SELECT * FROM trainings WHERE date >= ? AND date <= ? ORDER BY date, time", [from, to]);
  if (trainings.length === 0) return out;
  const totalPlayers = (await db.get("SELECT COUNT(*) AS c FROM players", [])).c;

  for (const t of trainings) {
    const start = viennaDateTimeToUtc(t.date, t.time).getTime();
    if (cfg.reminder.enabled) {
      const due = start - cfg.reminder.hoursBefore * 3600 * 1000;
      const votingCloses = start - 3600 * 1000; // danach kann niemand mehr abstimmen
      if (now.getTime() >= due && now.getTime() < votingCloses && (await claim("reminder", t.id))) {
        const responded = new Set((await db.all("SELECT player_id FROM responses WHERE training_id = ?", [t.id])).map((r) => r.player_id));
        const subs = (await subscriptionsFor("reminder")).filter((s) => !responded.has(s.player_id));
        const res = await sendLocalized(
          subs,
          (lang) => {
            const vars = trainingVars(t, now, lang);
            return { title: renderTemplate(cfg.reminder[fieldName(lang, "title")], vars), body: renderTemplate(cfg.reminder[fieldName(lang, "body")], vars), url: "/", tag: `reminder-${t.id}` };
          },
          Math.max(600, Math.floor((votingCloses - now.getTime()) / 1000))
        );
        out.reminders += res.sent;
        if (subs.length) await logger(SYSTEM, "verwaltung", `Benachrichtigung gesendet (Erinnerung) für Training ${fmtDate(t.date)} ${t.time}: ${res.sent} von ${subs.length} Geräten`);
      }
    }

    if (cfg.summary.enabled) {
      const due = start - cfg.summary.hoursBefore * 3600 * 1000;
      if (now.getTime() >= due && now.getTime() < start && (await claim("summary", t.id))) {
        const resp = await db.all("SELECT player_id, status FROM responses WHERE training_id = ?", [t.id]);
        const count = (s) => resp.filter((r) => r.status === s).length;
        const guests = (await db.get("SELECT COUNT(*) AS c FROM training_guests WHERE training_id = ?", [t.id])).c;
        const counts = {
          zusagen: count("zusage"),
          vielleicht: count("vielleicht"),
          absagen: count("absage"),
          offen: Math.max(0, totalPlayers - resp.length),
          gaeste: guests,
        };
        const subs = await subscriptionsFor("summary", { onlyAdmins: true });
        const res = await sendLocalized(
          subs,
          (lang) => {
            const v = Object.assign({}, trainingVars(t, now, lang), counts, summaryWords(counts, lang));
            return { title: renderTemplate(cfg.summary[fieldName(lang, "title")], v), body: renderTemplate(cfg.summary[fieldName(lang, "body")], v), url: "/", tag: `summary-${t.id}` };
          },
          Math.max(600, Math.floor((start - now.getTime()) / 1000))
        );
        out.summaries += res.sent;
        if (subs.length) await logger(SYSTEM, "verwaltung", `Benachrichtigung gesendet (Zusagen-Übersicht) für Training ${fmtDate(t.date)} ${t.time}: ${res.sent} von ${subs.length} Geräten`);
      }
    }
  }
  return out;
}

// ---------- Sofort (Training geaendert / abgesagt) ----------

async function notifyTrainingChanged({ before, after, actorId }) {
  if (!webpush) return;
  const cfg = await readConfig();
  if (!cfg.change.enabled) return;
  const now = new Date();
  if (viennaDateTimeToUtc(after.date, after.time).getTime() < now.getTime()) return; // vergangene Trainings: nichts melden

  if (changeParts(before, after, "de").length === 0) return;

  const subs = await subscriptionsFor("change", { excludePlayerId: actorId });
  const res = await withTimeout(
    sendLocalized(
      subs,
      (lang) => {
        const vars = Object.assign(trainingVars(after, now, lang), { aenderung: clip(changeParts(before, after, lang).join(" · "), 240) });
        return { title: renderTemplate(cfg.change[fieldName(lang, "title")], vars), body: renderTemplate(cfg.change[fieldName(lang, "body")], vars), url: "/", tag: `change-${after.id}` };
      },
      6 * 3600
    ),
    8000
  );
  if (subs.length) await logger(SYSTEM, "verwaltung", `Benachrichtigung gesendet (Änderung) für Training ${fmtDate(after.date)} ${after.time}: ${res.timedOut ? "teilweise" : res.sent} von ${subs.length} Geräten`);
}

async function notifyTrainingCancelled({ training, actorId }) {
  if (!webpush) return;
  const cfg = await readConfig();
  if (!cfg.change.enabled) return;
  const now = new Date();
  if (viennaDateTimeToUtc(training.date, training.time).getTime() < now.getTime()) return;
  const subs = await subscriptionsFor("change", { excludePlayerId: actorId });
  const res = await withTimeout(
    sendLocalized(
      subs,
      (lang) => {
        const vars = trainingVars(training, now, lang);
        return { title: renderTemplate(cfg.change[fieldName(lang, "cancelTitle")], vars), body: renderTemplate(cfg.change[fieldName(lang, "cancelBody")], vars), url: "/", tag: `change-${training.id}` };
      },
      6 * 3600
    ),
    8000
  );
  if (subs.length) await logger(SYSTEM, "verwaltung", `Benachrichtigung gesendet (Absage) für Training ${fmtDate(training.date)} ${training.time}: ${res.timedOut ? "teilweise" : res.sent} von ${subs.length} Geräten`);
}

// ---------- Test + Status (Verwaltung) ----------

async function sendTest(playerId, kind, lang) {
  lang = lang === "en" ? "en" : "de";
  if (!webpush) return { error: "Benachrichtigungen sind auf dem Server nicht verfügbar." };
  const cfg = await readConfig();
  if (!DEFAULTS[kind]) return { error: "Unbekannte Art von Benachrichtigung." };
  const now = new Date();
  const tomorrow = viennaDateStr(new Date(now.getTime() + 24 * 3600 * 1000));
  const sample = { date: tomorrow, time: "19:00", ort: lang === "en" ? "Sports ground" : "Sportplatz" };
  const counts = { zusagen: 11, vielleicht: 3, absagen: 2, offen: 6, gaeste: 1 };
  const vars = Object.assign(trainingVars(sample, now, lang), counts, summaryWords(counts, lang), {
    aenderung: lang === "en" ? "New time: 18:30 (was: 19:00)" : "Neue Uhrzeit: 18:30 Uhr (vorher: 19:00 Uhr)",
  });
  const title = cfg[kind][fieldName(lang, "title")];
  const body = cfg[kind][fieldName(lang, "body")];
  const subs = await subscriptionsFor(kind, { onlyPlayerId: playerId, ignorePrefs: true });
  if (subs.length === 0) return { error: "Auf deinem Konto ist noch kein Gerät für Benachrichtigungen angemeldet. Aktiviere sie zuerst im Reiter „Trainings“ ganz unten." };
  const res = await sendPayload(subs, { title: `Test: ${renderTemplate(title, vars)}`, body: renderTemplate(body, vars), url: "/", tag: `test-${kind}` }, 600);
  return { sent: res.sent, failed: res.failed, devices: subs.length };
}

async function getStatus() {
  const row = await db.get("SELECT COUNT(*) AS devices, COUNT(DISTINCT player_id) AS players FROM push_subscriptions", []);
  const tick = await db.get("SELECT value FROM settings WHERE key = 'last_tick'", []);
  return { devices: row ? row.devices : 0, players: row ? row.players : 0, lastTick: tick ? tick.value : null };
}

module.exports = {
  DEFAULTS,
  PLACEHOLDERS,
  setLogger,
  isAvailable,
  getVapid,
  readConfig,
  validatePatch,
  saveConfig,
  renderTemplate,
  tick,
  notifyTrainingChanged,
  notifyTrainingCancelled,
  sendTest,
  getStatus,
};
