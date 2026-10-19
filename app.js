(function () {
  "use strict";

  // ============================================================
  // EINZIGE STELLE, DIE FÜR EINEN ANDEREN VEREIN/EINE ANDERE MANNSCHAFT
  // GEÄNDERT WERDEN MUSS: der Vereinsname. Wird überall in der App verwendet
  // (Spiel-Banner, Verwaltung, Info-Popup) - für eine neue, unabhängige
  // Installation (siehe README, Abschnitt "Für einen anderen Verein/eine
  // andere Mannschaft nutzen") reicht es, diese eine Zeile anzupassen.
  // Das Vereinslogo wird separat über die Dateien in /icons/ ausgetauscht.
  // ============================================================
  const CLUB_NAME = "TSV Utzenaich";

  // Beispiel-Format fuer den Spielplan-Massenimport - wird sowohl als Platzhalter im Textfeld
  // als auch beim "Format kopieren"-Button verwendet, damit beides garantiert identisch bleibt.
  const BULK_MATCH_FORMAT_EXAMPLE = `[
  {
    "opponent": "FC Musterheim",
    "date": "2027-03-14",
    "time": "16:00",
    "isHome": true,
    "round": "Runde 1",
    "opponentLogoUrl": "",
    "ort": "",
    "referee": "",
    "note": ""
  }
]`;

  const state = {
    me: null,
    trainings: [],
    players: [],
    stats: null,
    view: "home",
    loading: true,
    deferredInstallPrompt: null,
    installDismissed: false,
    openOverview: {}, // trainingId -> Übersichtsdaten, wenn geladen/aufgeklappt
    weekStart: null,   // Date (Montag 00:00) - welche Woche gerade angezeigt wird
    reasonBoxOpen: {}, // trainingId -> true, waehrend eine Notiz/ein Grund gerade eingegeben wird
    reasonPendingStatus: {}, // trainingId -> "vielleicht"|"absage", waehrend diese Box offen ist (leer = Zusage-Notiz)
    matches: [],       // Spielplan (manuell gepflegt), rein informativ - App laeuft auch ohne
    reasonsTrainerOnly: false, // global: Gruende bei Vielleicht/Absage nur fuer Trainer sichtbar
    clubWordRequired: null, // Login-Maske: true = Feld zeigen, false = nicht, null = unbekannt (Feld sicherheitshalber zeigen)
    clubWord: "", // nur Trainer: aktuell festgelegtes Vereinswort
    editingSeasonId: null, // welche Saison gerade in Verwaltung → Optionen bearbeitet wird
    push: {
      supported: false, standalone: false, isIOS: false, permission: "default", subscribed: false,
      available: false, publicKey: null, types: {}, prefs: { reminder: true, change: true, summary: true },
      isAdmin: false, busy: false, error: "",
    },
    optOpen: {}, // welche Bereiche in Verwaltung → Optionen aufgeklappt sind
    notifEditing: null, // welcher Benachrichtigungstext gerade bearbeitet wird
    notifCfg: null, // Trainer: Einstellungen der Benachrichtigungen (null = noch nicht geladen)
    notifDefaults: null,
    notifPlaceholders: null,
    notifStatus: null,
    notifAvailable: true,
    logEntries: null, // Protokoll (nur Trainer), null = noch nicht geladen
    logError: "",
    logFilter: "alle", // alle | rsvp | verwaltung | konto
    logShown: 150, // wie viele Eintraege gerade angezeigt werden
    adminSection: "trainings", // Unterbereich der Verwaltung: trainings | spielplan | spieler | optionen
    showMatchBanner: true, // vom Server geladene Einstellung - Trainer koennen die Spielvorschau ausblenden
    playersListOpen: false, // Spielerliste in der Verwaltung ist bei vielen Spielern lang - eingeklappt starten
    playersFilter: "",
    adminRsvpFeedback: {}, // trainingId -> Bestaetigungstext, muss ein render() (fuer frische Zaehler) ueberleben
    editingTrainingId: null, // welches Training gerade in der Verwaltung bearbeitet wird
    editingMatchId: null, // welches Spiel gerade in der Verwaltung bearbeitet wird
    seasons: [],
    currentSeasonId: null, // von Server ermittelt: welche Saison "heute" gerade laeuft
    statsSeasonId: "current", // "current" | "all" | <id> - was in der Statistik ausgewaehlt ist
    statsMatrixExpanded: false, // Tag-Matrix zeigt standardmaessig nur die letzten 15 Trainings (sonst bei 50+ zu breit)
    showPastMatches: false, // Spielplan in der Verwaltung: vergangene Spiele standardmaessig ausgeblendet
    matchesListOpen: false, // Spielplan-Liste startet eingeklappt, wie die Spielerliste
  };

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtDate(d) {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function statusLabel(s) {
    return { zusage: "Zusage", vielleicht: "Vielleicht", absage: "Absage" }[s] || "Offen";
  }
  function statusClass(s) {
    return { zusage: "zusage", vielleicht: "vielleicht", absage: "absage" }[s] || "offen";
  }

  // ---------- Datum/Zeit-Hilfsfunktionen ----------

  function trainingDateTime(t) {
    return new Date(`${t.date}T${t.time}:00`);
  }

  function isVotingClosed(t) {
    return trainingDateTime(t).getTime() - Date.now() <= 60 * 60 * 1000; // 1 Stunde vorher gesperrt
  }

  function formatCountdown(target) {
    const diff = target.getTime() - Date.now();
    if (diff <= 0) return "hat begonnen / vorbei";
    const totalMin = Math.floor(diff / 60000);
    const days = Math.floor(totalMin / (60 * 24));
    const hours = Math.floor((totalMin % (60 * 24)) / 60);
    const mins = totalMin % 60;
    if (days > 0) return `in ${days} Tag${days === 1 ? "" : "en"} ${hours} Std.`;
    if (hours > 0) return `in ${hours} Std. ${mins} Min.`;
    return `in ${mins} Min.`;
  }

  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function startOfWeek(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay(); // 0=So,1=Mo,...
    const diff = (day === 0 ? -6 : 1) - day; // auf Montag zurueckrechnen
    date.setDate(date.getDate() + diff);
    return date;
  }

  function addDays(d, n) {
    const date = new Date(d);
    date.setDate(date.getDate() + n);
    return date;
  }

  function weekRangeLabel(weekStart) {
    const weekEnd = addDays(weekStart, 6);
    const f = (d) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    return `${f(weekStart)} – ${f(weekEnd)}.${weekEnd.getFullYear()}`;
  }

  function getUpcomingSorted(trainings) {
    const now = Date.now();
    return trainings
      .filter((t) => trainingDateTime(t).getTime() >= now)
      .sort((a, b) => trainingDateTime(a) - trainingDateTime(b));
  }

  function getNextTraining() {
    const upcoming = getUpcomingSorted(state.trainings);
    return upcoming.length > 0 ? upcoming[0] : null;
  }

  function ensureDefaultWeek() {
    if (state.weekStart) return;
    const next = getNextTraining();
    state.weekStart = next ? startOfWeek(trainingDateTime(next)) : startOfWeek(new Date());
  }

  function trainingsInCurrentWeek() {
    const startStr = toISODate(state.weekStart);
    const endStr = toISODate(addDays(state.weekStart, 6));
    return state.trainings
      .filter((t) => t.date >= startStr && t.date <= endStr)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }

  // Live-Countdown aktualisieren, ohne die ganze Seite neu zu rendern
  // (sonst wuerden offene Texteingaben fuer den Absage-Grund verloren gehen).
  setInterval(() => {
    document.querySelectorAll("[data-countdown-target]").forEach((el) => {
      const target = new Date(el.getAttribute("data-countdown-target"));
      el.textContent = formatCountdown(target);
    });
  }, 30000);

  // Offene "Uebersicht"-Aufklapper werden bei jeder anderen Aktion (eigene Abstimmung,
  // Tab-Wechsel, Wochenwechsel) wieder geschlossen. So zeigt sie nie einen veralteten Stand,
  // sondern wird beim naechsten Oeffnen frisch vom Server geladen.
  function closeAllOverviews() {
    state.openOverview = {};
  }

  // ---------- Automatisches Nachladen (Zusagen anderer Spieler sichtbar machen) ----------
  // Aktualisiert Daumen-Zaehler und offene Uebersichten im Hintergrund:
  // - alle 45 Sekunden, solange die App sichtbar ist und der Trainings-Tab offen ist
  // - sofort, wenn die App aus dem Hintergrund zurueckkommt oder man zum Trainings-Tab wechselt
  // Es wird NICHT nachgeladen, waehrend jemand tippt oder gerade eine eigene Abstimmung laeuft -
  // so gehen Texteingaben (Absage-Grund) nie verloren und der eigene Status wird nicht ueberschrieben.
  const AUTO_REFRESH_MS = 45000;
  let rsvpInFlight = 0;
  let rsvpVersion = 0;
  let refreshRunning = false;
  let lastRefreshAt = 0;

  function userIsTyping() {
    const el = document.activeElement;
    const inField = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
    return inField || Object.keys(state.reasonBoxOpen).length > 0;
  }

  async function refreshTrainingsSilently(minGapMs) {
    if (refreshRunning || rsvpInFlight > 0) return;
    if (!state.me || state.loading || state.view !== "home") return;
    if (document.visibilityState === "hidden" || userIsTyping()) return;
    if (minGapMs && Date.now() - lastRefreshAt < minGapMs) return;
    refreshRunning = true;
    const versionAtStart = rsvpVersion;
    try {
      const data = await api("/trainings");
      const ids = Object.keys(state.openOverview);
      const fresh = {};
      await Promise.all(ids.map(async (id) => {
        try { fresh[id] = await api(`/trainings/${id}/overview`); } catch (e) { /* alte Uebersicht behalten */ }
      }));
      // Waehrend der Anfrage hat sich etwas getan -> Ergebnis verwerfen (naechster Durchlauf holt es nach)
      if (rsvpInFlight > 0 || versionAtStart !== rsvpVersion) return;
      if (!state.me || state.loading || state.view !== "home" || userIsTyping()) return;

      lastRefreshAt = Date.now();
      let changed = JSON.stringify(state.trainings) !== JSON.stringify(data.trainings);
      state.trainings = data.trainings;
      Object.keys(fresh).forEach((id) => {
        if (!state.openOverview[id]) return; // wurde inzwischen geschlossen
        if (JSON.stringify(state.openOverview[id]) !== JSON.stringify(fresh[id])) changed = true;
        state.openOverview[id] = fresh[id];
      });
      if (changed) render();
    } catch (e) {
      // Kurzzeitig offline oder Sitzung abgelaufen - nichts anzeigen, naechster Versuch folgt
    } finally {
      refreshRunning = false;
    }
  }

  setInterval(() => refreshTrainingsSilently(), AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshTrainingsSilently(5000);
  });
  window.addEventListener("pageshow", () => refreshTrainingsSilently(5000));

  async function api(path, opts) {
    const res = await fetch("/api" + path, {
      method: (opts && opts.method) || "GET",
      headers: Object.assign({ "Content-Type": "application/json" }, (opts && opts.headers) || {}),
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Fehler bei der Anfrage.");
    return data;
  }

  // ---------- PWA Installations-Hinweis ----------

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    render();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  function renderInstallHint() {
    if (!state.deferredInstallPrompt || state.installDismissed) return "";
    return `
      <div class="install-hint">
        <span>📲 Diese Seite kann als App auf dem Startbildschirm installiert werden.</span>
        <span>
          <button class="small" id="btn-install">Installieren</button>
          <button class="small secondary" id="btn-install-dismiss">Nicht jetzt</button>
        </span>
      </div>`;
  }

  function bindInstallHint() {
    const btn = document.getElementById("btn-install");
    if (btn) {
      btn.onclick = async () => {
        state.deferredInstallPrompt.prompt();
        await state.deferredInstallPrompt.userChoice;
        state.deferredInstallPrompt = null;
        render();
      };
    }
    const dismiss = document.getElementById("btn-install-dismiss");
    if (dismiss) dismiss.onclick = () => { state.installDismissed = true; render(); };
  }

  // ---------- Laden ----------

  async function loadPublicInfo() {
    try {
      const data = await api("/public-info");
      state.clubWordRequired = !!data.clubWordRequired;
    } catch (e) {
      state.clubWordRequired = null; // unbekannt -> Feld anzeigen, der Server prueft ohnehin
    }
  }

  async function loadMe() {
    const data = await api("/me");
    state.me = data.player;
  }

  async function loadTrainings() {
    const data = await api("/trainings");
    state.trainings = data.trainings;
    ensureDefaultWeek();
  }

  async function loadPlayers() {
    const data = await api("/players");
    state.players = data.players;
  }

  async function loadStats() {
    let query = "";
    if (state.statsSeasonId === "all") query = "?all=1";
    else if (state.statsSeasonId !== "current") query = `?seasonId=${state.statsSeasonId}`;
    const data = await api(`/stats${query}`);
    state.stats = data;
  }

  async function loadSeasons() {
    try {
      const data = await api("/seasons");
      state.seasons = data.seasons;
      state.currentSeasonId = data.currentSeasonId;
    } catch (e) {
      state.seasons = [];
      state.currentSeasonId = null;
    }
  }

  // Rein informatives Zusatz-Feature (manuell gepflegter Spielplan) - wenn das fehlschlaegt,
  // darf das den Rest der App niemals beeintraechtigen.
  async function loadMatches() {
    try {
      const data = await api("/matches");
      state.matches = data.matches;
    } catch (e) {
      state.matches = [];
    }
  }

  // Schlaegt beim Anlegen einer neuen Saison einen plausiblen Namen/Zeitraum vor (Frühjahr
  // Jan-Jun, Herbst Jul-Dez) - nur ein Vorschlag zum Vorausfuellen, der Trainer kann alles
  // frei anpassen, das hier ist bewusst keine feste Regel.
  function suggestSeasonName() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    return month <= 6 ? `Frühjahrssaison ${year}` : `Herbstsaison ${year}`;
  }

  function suggestSeasonRange() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    return month <= 6
      ? { start: `${year}-03-01`, end: `${year}-06-30` }
      : { start: `${year}-08-01`, end: `${year}-12-15` };
  }

  function getNextMatch() {
    const now = Date.now();
    const upcoming = state.matches
      .filter((m) => new Date(`${m.date}T${m.time}:00`).getTime() >= now)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return upcoming.length > 0 ? upcoming[0] : null;
  }

  async function loadSettings() {
    try {
      const data = await api("/settings");
      state.showMatchBanner = data.showMatchBanner;
      state.reasonsTrainerOnly = !!data.reasonsTrainerOnly;
      state.clubWord = data.clubWord || "";
    } catch (e) {
      state.showMatchBanner = true; // im Zweifel anzeigen
    }
  }

  // ---------- Render ----------

  function renderWhoamiBar() {
    const bar = document.getElementById("whoami-bar");
    if (!state.me) { bar.innerHTML = ""; return; }
    bar.innerHTML = `
      <div class="whoami">
        <span>Angemeldet als <b>${escapeHtml(state.me.name)}</b>${state.me.isAdmin ? '<span class="badge-admin">Trainer</span>' : ""}</span>
        <button id="btn-logout">Abmelden</button>
      </div>`;
    document.getElementById("btn-logout").onclick = async () => {
      await pushDetachOnLogout();
      await api("/logout", { method: "POST" });
      state.me = null;
      state.push.subscribed = false;
      state.notifCfg = null;
      await loadPublicInfo();
      render();
    };
  }

  async function render() {
    renderWhoamiBar();
    const app = document.getElementById("app");

    if (state.loading) {
      app.innerHTML = `<div class="card"><p class="muted"><span class="spinner"></span> Lade Daten …</p></div>`;
      return;
    }

    if (!state.me) {
      app.innerHTML = renderAuth();
      bindAuth();
      return;
    }

    app.innerHTML = renderInstallHint() + renderMain();
    bindInstallHint();
    bindMain();
  }

  // ---------- Login / Registrierung ----------

  function renderAuth() {
    return `
      <div class="card">
        <h2>Anmelden</h2>
        <label>E-Mail</label>
        <input type="email" id="login-email" autocomplete="username">
        <label>Passwort</label>
        <input type="password" id="login-password" autocomplete="current-password">
        <div id="login-error" class="error"></div>
        <div style="margin-top:12px;"><button id="btn-login">Anmelden</button></div>
      </div>
      <div class="card">
        <h2>Neu registrieren</h2>
        <label>Name</label>
        <input type="text" id="reg-name" placeholder="Vor- und Nachname">
        <label>E-Mail</label>
        <input type="email" id="reg-email" autocomplete="username">
        <label>Passwort (mind. 6 Zeichen)</label>
        <input type="password" id="reg-password" autocomplete="new-password">
        ${state.clubWordRequired !== false ? `
        <label>Vereinswort</label>
        <input type="text" id="reg-clubword" autocomplete="off" autocapitalize="off" placeholder="Habt ihr vom Trainer bekommen">` : ""}
        <div id="reg-error" class="error"></div>
        <div style="margin-top:12px;"><button id="btn-register">Registrieren</button></div>
      </div>
      <p class="muted" style="text-align:center;">Passwort vergessen? Ein Trainer kann euren Account löschen, damit ihr euch neu registrieren könnt.</p>`;
  }

  function bindAuth() {
    document.getElementById("btn-login").onclick = async () => {
      const email = document.getElementById("login-email").value.trim();
      const password = document.getElementById("login-password").value;
      const err = document.getElementById("login-error");
      err.textContent = "";
      try {
        const data = await api("/login", { method: "POST", body: { email, password } });
        state.me = data.player;
        await bootAfterLogin();
      } catch (e) {
        err.textContent = e.message;
      }
    };

    document.getElementById("btn-register").onclick = async () => {
      const name = document.getElementById("reg-name").value.trim();
      const email = document.getElementById("reg-email").value.trim();
      const password = document.getElementById("reg-password").value;
      const clubWordEl = document.getElementById("reg-clubword");
      const clubWord = clubWordEl ? clubWordEl.value.trim() : "";
      const err = document.getElementById("reg-error");
      err.textContent = "";
      try {
        const data = await api("/register", { method: "POST", body: { name, email, password, clubWord } });
        state.me = data.player;
        await bootAfterLogin();
      } catch (e) {
        err.textContent = e.message;
      }
    };
  }

  async function bootAfterLogin() {
    state.loading = true;
    render();
    await loadTrainings();
    Promise.all([loadMatches(), loadSettings(), loadPushState()]).then(render); // im Hintergrund, blockiert den Rest nicht
    state.loading = false;
    render();
  }

  // ---------- Hauptansicht ----------
  // Wichtig: Der "Verwaltung"-Tab wird nur angezeigt, wenn state.me.isAdmin true ist -
  // fuer alle anderen Spieler existiert dieser Button/Bereich im Frontend gar nicht,
  // und die zugehoerigen API-Endpunkte lehnen Nicht-Trainer serverseitig ohnehin ab.

  function renderMain() {
    const nav = `
      <div class="tabs">
        <button class="${state.view === "home" ? "" : "secondary"}" id="nav-home">Trainings</button>
        <button class="${state.view === "stats" ? "" : "secondary"}" id="nav-stats">Statistik</button>
        ${state.me.isAdmin ? `<button class="${state.view === "admin" ? "" : "secondary"}" id="nav-admin">Verwaltung</button>` : ""}
      </div>`;
    let content = "";
    if (state.view === "stats") content = renderStats();
    else if (state.view === "admin" && state.me.isAdmin) content = renderAdmin();
    else content = renderTrainings();
    return nav + content;
  }

  function bindMain() {
    document.getElementById("nav-home").onclick = () => { closeAllOverviews(); state.view = "home"; render(); refreshTrainingsSilently(); };
    document.getElementById("nav-stats").onclick = async () => {
      closeAllOverviews();
      state.view = "stats"; state.loading = true; render();
      if (state.seasons.length === 0) await loadSeasons();
      await loadStats(); state.loading = false; render();
    };
    const navAdmin = document.getElementById("nav-admin");
    if (navAdmin) navAdmin.onclick = async () => {
      closeAllOverviews();
      state.view = "admin"; state.loading = true; render();
      await loadPlayers();
      if (state.matches.length === 0) await loadMatches();
      if (state.seasons.length === 0) await loadSeasons();
      if (state.adminSection === "protokoll") await loadLog();
      await loadNotifConfig();
      state.loading = false; render();
    };

    if (state.view === "admin") bindAdmin();
    else if (state.view === "home") { bindTrainings(); bindPushCard(); }
    else if (state.view === "stats") bindStats();
  }

  // ---------- Wochen-Navigation (gemeinsam fuer Trainings- und Verwaltungs-Ansicht) ----------

  function renderWeekNav() {
    return `
      <div class="week-nav">
        <button class="small secondary" id="week-prev">◀</button>
        <span class="week-label">${weekRangeLabel(state.weekStart)}</span>
        <button class="small secondary" id="week-next">▶</button>
        <button class="small secondary" id="week-today">Aktuelle Woche</button>
      </div>`;
  }

  function bindWeekNav(afterChange) {
    document.getElementById("week-prev").onclick = () => {
      closeAllOverviews();
      state.weekStart = addDays(state.weekStart, -7);
      afterChange();
    };
    document.getElementById("week-next").onclick = () => {
      closeAllOverviews();
      state.weekStart = addDays(state.weekStart, 7);
      afterChange();
    };
    document.getElementById("week-today").onclick = () => {
      closeAllOverviews();
      state.weekStart = startOfWeek(new Date());
      afterChange();
    };
  }

  // ---------- Trainings & RSVP ----------

  function renderNextTrainingBanner() {
    const next = getNextTraining();
    if (!next) return "";
    const dt = trainingDateTime(next);
    return `
      <div class="next-training-banner">
        <div>
          <div style="font-weight:700;">⭐ Nächstes Training: ${fmtDate(next.date)} · ${next.time} Uhr</div>
          <div class="muted">${escapeHtml(next.ort || "")} — <span data-countdown-target="${dt.toISOString()}">${formatCountdown(dt)}</span></div>
        </div>
        <button class="small secondary" id="btn-jump-next">Zur Woche springen</button>
      </div>`;
  }

  function renderNextMatchBanner() {
    if (!state.showMatchBanner) return "";
    const m = getNextMatch();
    if (!m) return ""; // kein Spiel eingetragen - Banner bleibt einfach weg
    const dt = new Date(`${m.date}T${m.time}:00`);
    const heimAuswaerts = m.isHome ? "Heimspiel" : "Auswärtsspiel";
    const ownLogo = "/icons/club-logo.png";
    const oppLogo = m.opponentLogoUrl || "";
    const homeLogo = m.isHome ? ownLogo : oppLogo;
    const awayLogo = m.isHome ? oppLogo : ownLogo;
    const homeLabel = m.isHome ? CLUB_NAME : m.opponent;
    const awayLabel = m.isHome ? m.opponent : CLUB_NAME;
    return `
      <div class="next-match-banner">
        <div class="match-teams">
          <div class="match-team">
            ${homeLogo ? `<img src="${escapeHtml(homeLogo)}" alt="" class="match-logo">` : ""}
            <span>${escapeHtml(homeLabel)}</span>
          </div>
          <span class="muted">–</span>
          <div class="match-team">
            ${awayLogo ? `<img src="${escapeHtml(awayLogo)}" alt="" class="match-logo">` : ""}
            <span>${escapeHtml(awayLabel)}</span>
          </div>
        </div>
        <div>
          <div class="muted">${m.round ? `${escapeHtml(m.round)} · ` : ""}${heimAuswaerts} · ${fmtDate(m.date)} · ${m.time} Uhr${m.ort ? ` · ${escapeHtml(m.ort)}` : ""}</div>
          ${m.referee ? `<div class="muted">Schiedsrichter: ${escapeHtml(m.referee)}</div>` : ""}
          ${m.note ? `<div class="muted">${escapeHtml(m.note)}</div>` : ""}
          <span data-countdown-target="${dt.toISOString()}" class="muted">${formatCountdown(dt)}</span>
        </div>
      </div>`;
  }

  function renderTrainings() {
    const next = getNextTraining();
    const visible = trainingsInCurrentWeek();

    const list = state.trainings.length === 0
      ? `<div class="card"><p class="empty">Es sind noch keine Trainings eingetragen.</p></div>`
      : visible.length === 0
        ? `<div class="card"><p class="empty">Keine Trainings in dieser Woche.</p></div>`
        : visible.map((t) => renderTrainingCard(t, next)).join("");

    return renderNextTrainingBanner() + renderNextMatchBanner() + renderWeekNav() + list + renderPushCard();
  }

  function renderTrainingCard(t, next) {
    const status = t.myStatus || "offen";
    const overview = state.openOverview[t.id];
    const guestCount = (t.guests || []).length;
    const closed = isVotingClosed(t);
    const isNext = next && next.id === t.id;
    const dt = trainingDateTime(t);
    const boxOpen = !!state.reasonBoxOpen[t.id];
    const pendingStatus = state.reasonPendingStatus[t.id];
    const effectiveStatus = pendingStatus === "vielleicht" || pendingStatus === "absage" ? pendingStatus : "zusage";
    // Waehrend der Grund noch eingegeben wird, ist der neu gewaehlte Button schon hervorgehoben
    // (der Status oben rechts zeigt weiterhin den bisher GESPEICHERTEN Stand).
    const shownStatus = boxOpen && effectiveStatus !== "zusage" ? effectiveStatus : status;

    return `
      <div class="card training ${isNext ? "next-training" : ""}" data-id="${t.id}">
        <div class="head">
          <div>
            ${isNext ? `<div class="pill zusage" style="margin-bottom:6px;">⭐ Nächstes Training</div>` : ""}
            <div class="when">${fmtDate(t.date)} · ${t.time} Uhr</div>
            <div class="where">${escapeHtml(t.ort || "")}</div>
            ${t.note ? `<div class="muted" style="margin-top:4px;">${escapeHtml(t.note)}</div>` : ""}
            ${!closed ? `<div class="muted" style="margin-top:4px;">⏱ <span data-countdown-target="${dt.toISOString()}">${formatCountdown(dt)}</span></div>` : ""}
          </div>
          <span class="pill ${statusClass(status)}">${statusLabel(status)}</span>
        </div>
        <div class="quick-tally" data-quick-tally-id="${t.id}">
          <span class="tally-item tally-yes">👍 <span class="tally-count">${t.zusageCount || 0}</span></span>
          <span class="tally-item tally-maybe">❓ <span class="tally-count">${t.vielleichtCount || 0}</span></span>
          <span class="tally-item tally-no">👎 <span class="tally-count">${t.absageCount || 0}</span></span>
        </div>
        ${guestCount > 0 ? `<div class="muted" style="margin-top:8px;">➕ ${guestCount} Gast${guestCount === 1 ? "" : "gäste"}: ${escapeHtml((t.guests || []).map((g) => g.name).join(", "))}</div>` : ""}

        ${closed ? `
          <p class="muted" style="margin-top:12px;font-style:italic;">🔒 Abstimmung geschlossen (weniger als 1 Stunde bis Trainingsbeginn oder bereits vorbei).</p>
        ` : `
          <div class="rsvp-buttons">
            <button data-status="zusage" class="${shownStatus === "zusage" ? "active-zusage" : "inactive"}">Zusage</button>
            <button data-status="vielleicht" class="${shownStatus === "vielleicht" ? "active-vielleicht" : "inactive"}">Vielleicht</button>
            <button data-status="absage" class="${shownStatus === "absage" ? "active-absage" : "inactive"}">Absage</button>
          </div>
          ${status === "zusage" && !boxOpen ? `
          <div style="margin-top:8px;">
            <button class="small secondary btn-toggle-note">${t.myReason ? "Notiz bearbeiten" : "+ Notiz hinzufügen (optional)"}</button>
          </div>` : ""}
          <div class="reason-box" style="display:${boxOpen ? "block" : "none"};margin-top:10px;">
            <label>${effectiveStatus === "zusage" ? "Notiz (optional)" : "Grund (Pflichtfeld)"}</label>
            <textarea class="reason-input" placeholder="z. B. beruflich verhindert, verletzt, im Urlaub … (oder bei Zusage z. B. „komme 10 Minuten später“)">${effectiveStatus === "zusage" ? escapeHtml(t.myReason || "") : ""}</textarea>
            <div class="error reason-error" style="display:none;">Bitte einen Grund angeben.</div>
            <div style="margin-top:8px;">
              <button class="small save-reason">Speichern</button>
              <button class="small secondary btn-cancel-note">Abbrechen</button>
            </div>
          </div>
        `}

        <div style="margin-top:12px;">
          <button class="small secondary btn-overview">${overview ? "Übersicht ausblenden" : "Übersicht anzeigen"}</button>
        </div>
        ${overview ? renderOverview(overview) : ""}
      </div>`;
  }

  function renderOverview(data) {
    const listStyle = (count) =>
      count > 10
        ? "margin:6px 0 0;padding-left:18px;font-size:13.5px;max-height:200px;overflow-y:auto;"
        : "margin:6px 0 0;padding-left:18px;font-size:13.5px;";
    const section = (key, label, cls, showReason) => {
      const items = data.groups[key];
      return `
        <div style="margin-top:10px;">
          <div><span class="pill ${cls}">${label}</span> <b>${items.length}</b></div>
          ${items.length === 0 ? "" : `<ul style="${listStyle(items.length)}">
            ${items.map((p) => `<li>${escapeHtml(p.name)}${showReason && p.reason ? ` — <span class="muted">${escapeHtml(p.reason)}</span>` : ""}</li>`).join("")}
          </ul>`}
        </div>`;
    };
    const guestSection = data.guests && data.guests.length > 0 ? `
        <div style="margin-top:10px;">
          <div><span class="pill zusage">Gäste</span> <b>${data.guests.length}</b></div>
          <ul style="${listStyle(data.guests.length)}">
            ${data.guests.map((g) => `<li>${escapeHtml(g.name)}</li>`).join("")}
          </ul>
        </div>` : "";
    return `
      <div class="card" style="background:var(--bg);margin-top:10px;box-shadow:none;">
        ${section("zusage", "Zusage", "zusage", true)}
        ${section("vielleicht", "Vielleicht", "vielleicht", true)}
        ${section("absage", "Absage", "absage", true)}
        ${section("offen", "Offen", "offen", false)}
        ${guestSection}
      </div>`;
  }

  function bindTrainings() {
    bindWeekNav(render);

    const jumpBtn = document.getElementById("btn-jump-next");
    if (jumpBtn) {
      jumpBtn.onclick = () => {
        const next = getNextTraining();
        if (next) {
          state.weekStart = startOfWeek(trainingDateTime(next));
          render();
        }
      };
    }

    document.querySelectorAll(".training").forEach((card) => {
      const id = card.getAttribute("data-id");
      const t = state.trainings.find((x) => String(x.id) === id);
      const reasonBox = card.querySelector(".reason-box");

      if (reasonBox) {
        const reasonInput = card.querySelector(".reason-input");
        const reasonError = card.querySelector(".reason-error");

        card.querySelectorAll(".rsvp-buttons button").forEach((btn) => {
          btn.onclick = async () => {
            const clickedStatus = btn.getAttribute("data-status");
            if (clickedStatus === "zusage") {
              if (t.myStatus === "zusage") {
                // Schon zugesagt: war gerade eine Absage/ein Vielleicht in Arbeit, wird das verworfen
                // und die Ansicht springt auf die gespeicherte Zusage zurueck.
                if (state.reasonPendingStatus[id]) {
                  delete state.reasonBoxOpen[id];
                  delete state.reasonPendingStatus[id];
                  render();
                }
                return;
              }
              delete state.reasonBoxOpen[id];
              delete state.reasonPendingStatus[id];
              await submitRsvp(id, "zusage", "");
              return;
            }
            // Vielleicht/Absage: Box IMMER leer oeffnen (frisch eingeben), auch wenn
            // vorher schon einmal ein Grund gespeichert war.
            state.reasonBoxOpen[id] = true;
            state.reasonPendingStatus[id] = clickedStatus;
            render();
          };
        });

        const toggleNoteBtn = card.querySelector(".btn-toggle-note");
        if (toggleNoteBtn) {
          toggleNoteBtn.onclick = () => {
            state.reasonBoxOpen[id] = true;
            delete state.reasonPendingStatus[id]; // Zusage-Notiz, kein Pflichtfeld
            render();
          };
        }

        const cancelBtn = card.querySelector(".btn-cancel-note");
        if (cancelBtn) {
          cancelBtn.onclick = () => {
            delete state.reasonBoxOpen[id];
            delete state.reasonPendingStatus[id];
            render();
          };
        }

        card.querySelector(".save-reason").onclick = async () => {
          const pending = state.reasonPendingStatus[id];
          const targetStatus = pending === "vielleicht" || pending === "absage" ? pending : "zusage";
          const text = reasonInput.value.trim();
          if (targetStatus !== "zusage" && !text) {
            reasonError.style.display = "block";
            return;
          }
          reasonError.style.display = "none";
          delete state.reasonBoxOpen[id];
          delete state.reasonPendingStatus[id];
          await submitRsvp(id, targetStatus, text);
        };
      }

      // Uebersicht-Button ist immer vorhanden, auch wenn die Abstimmung fuer dieses Training geschlossen ist
      card.querySelector(".btn-overview").onclick = async () => {
        if (state.openOverview[id]) {
          delete state.openOverview[id];
          render();
          return;
        }
        try {
          const data = await api(`/trainings/${id}/overview`);
          state.openOverview[id] = data;
          render();
        } catch (e) {
          alert(e.message);
        }
      };
    });
  }

  function tallyKey(status) {
    return status === "zusage" ? "zusageCount" : status === "vielleicht" ? "vielleichtCount" : status === "absage" ? "absageCount" : null;
  }

  // Nach einer Admin-Rueckmeldung (Verwaltung -> "Rueckmeldung fuer Spieler eintragen") den
  // lokalen Stand konsistent halten:
  // 1. Zaehler direkt aus der Server-Antwort uebernehmen (kein zweiter Request noetig).
  // 2. Falls der Trainer dabei SEINE EIGENE Rueckmeldung gesetzt hat, muss auch die eigene
  //    Status-Pille/Hervorhebung im Trainings-Tab mitziehen - sonst bleibt sie auf dem alten
  //    Stand haengen, obwohl der neue Status schon gespeichert ist.
  // 3. Eine gerade offene "Uebersicht" fuer dieses Training invalidieren, damit sie beim
  //    naechsten Ansehen frisch nachgeladen wird statt veraltete Namen/Gruende zu zeigen.
  function applyAdminRsvpResult(trainingId, playerId, status, reason, result) {
    const trainingInState = state.trainings.find((x) => String(x.id) === String(trainingId));
    if (trainingInState) {
      trainingInState.zusageCount = result.zusageCount;
      trainingInState.vielleichtCount = result.vielleichtCount;
      trainingInState.absageCount = result.absageCount;
      if (state.me && String(playerId) === String(state.me.id)) {
        trainingInState.myStatus = status;
        trainingInState.myReason = reason || null;
      }
    }
    delete state.openOverview[trainingId];
  }

  async function submitRsvp(trainingId, status, reason) {
    const t = state.trainings.find((x) => String(x.id) === String(trainingId));
    if (!t) return;
    const previous = {
      myStatus: t.myStatus,
      myReason: t.myReason,
      zusageCount: t.zusageCount,
      vielleichtCount: t.vielleichtCount,
      absageCount: t.absageCount,
    };

    // Optimistisch sofort anzeigen, statt auf die Serverantwort zu warten - fuehlt sich
    // dadurch unmittelbar an, unabhaengig von der Netzwerk-Latenz. Die Schnellansicht
    // (Daumen-Zaehler) wird dabei gleich mit angepasst: alten Status abziehen, neuen dazuzaehlen.
    const oldKey = tallyKey(t.myStatus);
    const newKey = tallyKey(status);
    if (oldKey && t[oldKey] > 0) t[oldKey] -= 1;
    if (newKey) t[newKey] = (t[newKey] || 0) + 1;

    t.myStatus = status;
    t.myReason = reason || null;
    closeAllOverviews(); // Uebersicht wuerde sonst den alten Stand zeigen
    render();

    rsvpInFlight++;
    rsvpVersion++;
    try {
      await api(`/trainings/${trainingId}/rsvp`, { method: "POST", body: { status, reason } });
      rsvpVersion++;
    } catch (e) {
      // Fehlgeschlagen - alten Stand wiederherstellen (inkl. Zaehler)
      t.myStatus = previous.myStatus;
      t.myReason = previous.myReason;
      t.zusageCount = previous.zusageCount;
      t.vielleichtCount = previous.vielleichtCount;
      t.absageCount = previous.absageCount;
      render();
      alert(e.message);
    } finally {
      rsvpInFlight--;
      rsvpVersion++;
    }
  }

  // ---------- Statistik ----------

  function statusIcon(status) {
    if (status === "zusage") return '<span class="matrix-icon icon-yes">👍</span>';
    if (status === "vielleicht") return '<span class="matrix-icon icon-maybe">❓</span>';
    if (status === "absage") return '<span class="matrix-icon icon-no">👎</span>';
    return '<span class="matrix-icon icon-none">○</span>'; // keine Antwort gegeben
  }

  function renderStats() {
    const seasonOptions = `
      <option value="current" ${state.statsSeasonId === "current" ? "selected" : ""}>Aktuelle Saison</option>
      ${state.seasons.map((s) => `<option value="${s.id}" ${String(state.statsSeasonId) === String(s.id) ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      <option value="all" ${state.statsSeasonId === "all" ? "selected" : ""}>Alle Saisonen (gesamt)</option>
    `;
    const seasonPicker = `
      <div class="card" style="margin-bottom:12px;">
        <label>Saison</label>
        <select id="stats-season-select">${seasonOptions}</select>
      </div>`;

    if (!state.stats) return seasonPicker + `<div class="card"><p class="muted"><span class="spinner"></span> Lade …</p></div>`;
    if (state.stats.rows.length === 0) {
      return seasonPicker + `<div class="card"><p class="empty">Noch keine Spieler registriert.</p></div>`;
    }
    const seasonLabel = state.statsSeasonId === "current"
      ? (state.stats.seasonName ? `Saison "${escapeHtml(state.stats.seasonName)}"` : "keine aktive Saison hinterlegt, zeigt alle Trainings")
      : state.statsSeasonId === "all" ? "alle Saisonen" : `Saison "${escapeHtml(state.stats.seasonName || "")}"`;

    const MATRIX_LIMIT = 15;
    const allPastTrainings = state.stats.pastTrainings; // vom Server bereits neuestes zuerst sortiert
    const visibleTrainings = state.statsMatrixExpanded ? allPastTrainings : allPastTrainings.slice(0, MATRIX_LIMIT);
    const hasMore = allPastTrainings.length > MATRIX_LIMIT;

    const dateHeaders = visibleTrainings.map((t) => {
      const d = new Date(`${t.date}T00:00:00`);
      return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    });

    return seasonPicker + `
      <div class="card">
        <h2>Trainingsbeteiligung — ${seasonLabel}</h2>
        <div class="stats-summary-bar"><b>${state.stats.pastTrainingCount}</b> Trainings bereits stattgefunden${state.stats.trainingCount > state.stats.pastTrainingCount ? ` <span class="muted">(von ${state.stats.trainingCount} insgesamt geplant)</span>` : ""}</div>
        ${hasMore ? `<p class="muted" style="font-size:12px;margin:-4px 0 8px;">Matrix zeigt die letzten ${MATRIX_LIMIT} von ${allPastTrainings.length} Trainings${state.statsMatrixExpanded ? " (alle angezeigt)" : ""}.</p>` : ""}
        <div class="table-scroll">
          <table class="matrix-table">
            <thead>
              <tr>
                <th>Spieler</th>
                <th>Teilnahme</th>
                ${dateHeaders.map((d) => `<th style="text-align:center;">${d}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${state.stats.rows.map((r) => `<tr>
                <td>${escapeHtml(r.name)}</td>
                <td>${r.zusagen} <span class="muted">(${r.quote}%)</span></td>
                ${visibleTrainings.map((t) => `<td style="text-align:center;">${statusIcon(r.byTraining[t.id])}</td>`).join("")}
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
        ${hasMore ? `<div style="margin-top:10px;"><button class="small secondary" id="btn-toggle-matrix">${state.statsMatrixExpanded ? `Nur die letzten ${MATRIX_LIMIT} Trainings zeigen` : `Alle ${allPastTrainings.length} Trainings anzeigen`}</button></div>` : ""}
        <p class="muted" style="margin-top:8px;font-size:11.5px;">👍 Zusage · ❓ Vielleicht · 👎 Absage · ○ keine Antwort gegeben. Jede Spalte rechts ist ein einzelnes, bereits stattgefundenes Training (neuestes zuerst) — nach rechts wischen/scrollen für weitere. "Teilnahme" zeigt Zusagen und Quote bezogen auf alle bisherigen Trainings dieser Saison (nicht nur die sichtbaren Spalten).</p>
      </div>`;
  }

  function bindStats() {
    const toggleMatrixBtn = document.getElementById("btn-toggle-matrix");
    if (toggleMatrixBtn) {
      toggleMatrixBtn.onclick = () => {
        state.statsMatrixExpanded = !state.statsMatrixExpanded;
        render();
      };
    }

    const select = document.getElementById("stats-season-select");
    if (select) {
      select.onchange = async () => {
        state.statsSeasonId = select.value;
        state.stats = null;
        render();
        await loadStats();
        render();
      };
    }
  }

  // ---------- Verwaltung (ausschließlich für Trainer sichtbar) ----------

  // ---------- Benachrichtigungen (Spieler-Seite) ----------

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function loadPushState() {
    const p = state.push;
    p.supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    p.standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    p.isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    p.permission = p.supported ? Notification.permission : "unsupported";
    p.subscribed = false;
    try {
      const cfg = await api("/push/config");
      p.available = !!cfg.available;
      p.publicKey = cfg.publicKey;
      p.types = cfg.types || {};
      p.prefs = cfg.prefs || p.prefs;
      p.isAdmin = !!cfg.isAdmin;
    } catch (e) {
      p.available = false;
    }
    if (p.supported && p.permission === "granted") {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        p.subscribed = !!sub;
        // Gerät beim aktuell angemeldeten Spieler (neu) eintragen - z. B. nach Konto-Wechsel am selben Handy
        if (sub) await api("/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } }).catch(() => {});
      } catch (e) {
        p.subscribed = false;
      }
    }
  }

  async function enablePush() {
    const p = state.push;
    p.busy = true; p.error = "";
    render();
    try {
      const perm = await Notification.requestPermission();
      p.permission = perm;
      if (perm !== "granted") {
        p.error = perm === "denied" ? "" : "Die Erlaubnis wurde nicht erteilt.";
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const options = { userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(p.publicKey) };
        try {
          sub = await reg.pushManager.subscribe(options);
        } catch (e) {
          if (e && e.name === "InvalidStateError") {
            const old = await reg.pushManager.getSubscription();
            if (old) await old.unsubscribe();
            sub = await reg.pushManager.subscribe(options);
          } else {
            throw e;
          }
        }
      }
      await api("/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
      p.subscribed = true;
    } catch (e) {
      p.error = "Das hat nicht geklappt: " + (e && e.message ? e.message : "unbekannter Fehler");
    } finally {
      p.busy = false;
      render();
    }
  }

  async function disablePush() {
    const p = state.push;
    p.busy = true; p.error = "";
    render();
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await api("/push/unsubscribe", { method: "POST", body: { endpoint } });
      }
      p.subscribed = false;
    } catch (e) {
      p.error = "Das hat nicht geklappt: " + (e && e.message ? e.message : "unbekannter Fehler");
    } finally {
      p.busy = false;
      render();
    }
  }

  // Beim Abmelden dieses Gerät beim bisherigen Konto austragen, damit es keine fremden Nachrichten mehr bekommt
  async function pushDetachOnLogout() {
    try {
      if (!state.push.supported || Notification.permission !== "granted") return;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await api("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
    } catch (e) { /* nicht wichtig */ }
  }

  function renderPushCard() {
    const p = state.push;
    if (!p.available) return "";
    const wants = [];
    if (p.types.reminder) wants.push("eine Erinnerung, wenn du noch nicht abgestimmt hast");
    if (p.types.change) wants.push("eine Nachricht, wenn ein Training geändert oder abgesagt wird");
    if (p.types.summary) wants.push("die Übersicht der Zusagen (Trainer)");
    let body;
    if (!p.supported) {
      body = p.isIOS && !p.standalone
        ? `<p class="muted">Auf dem iPhone funktionieren Benachrichtigungen, wenn die App auf dem Home-Bildschirm liegt: In Safari auf „Teilen“ tippen, „Zum Home-Bildschirm“ wählen und die App von dort öffnen.</p>`
        : `<p class="muted">Dieses Gerät oder dieser Browser unterstützt keine Benachrichtigungen.</p>`;
    } else if (p.permission === "denied") {
      body = `<p class="muted">Benachrichtigungen sind für diese App blockiert. Erlaube sie in den Einstellungen deines Handys oder Browsers und lade die Seite neu.</p>`;
    } else if (!p.subscribed) {
      body = `
        <p class="muted">Du bekommst ${wants.join(", ")}.</p>
        <button id="btn-push-enable" ${p.busy ? "disabled" : ""}>${p.busy ? "Einen Moment …" : "Benachrichtigungen aktivieren"}</button>`;
    } else {
      const sw = (key, label) => `<label class="switch-row"><input type="checkbox" data-push-pref="${key}" ${p.prefs[key] ? "checked" : ""}> ${label}</label>`;
      body = `
        <p class="muted" style="margin-bottom:4px;">Auf diesem Gerät eingeschaltet. Du bekommst:</p>
        ${p.types.reminder ? sw("reminder", "Erinnerung, wenn ich noch nicht abgestimmt habe") : ""}
        ${p.types.change ? sw("change", "Änderungen und Absagen von Trainings") : ""}
        ${p.types.summary ? sw("summary", "Übersicht der Zusagen (Trainer)") : ""}
        <div style="margin-top:10px;"><button class="small secondary" id="btn-push-disable" ${p.busy ? "disabled" : ""}>Auf diesem Gerät ausschalten</button></div>`;
    }
    return `
      <div class="card">
        <h2>Benachrichtigungen</h2>
        ${body}
        ${p.error ? `<div class="error">${escapeHtml(p.error)}</div>` : ""}
      </div>`;
  }

  function bindPushCard() {
    const en = document.getElementById("btn-push-enable");
    if (en) en.onclick = enablePush;
    const dis = document.getElementById("btn-push-disable");
    if (dis) dis.onclick = disablePush;
    document.querySelectorAll("[data-push-pref]").forEach((cb) => {
      cb.onchange = async () => {
        const key = cb.getAttribute("data-push-pref");
        const value = cb.checked;
        state.push.prefs[key] = value;
        try {
          await api("/push/prefs", { method: "POST", body: { [key]: value } });
        } catch (e) {
          state.push.prefs[key] = !value;
          cb.checked = !value;
          alert(e.message);
        }
      };
    });
  }

  // ---------- Benachrichtigungen (Trainer-Einstellungen) ----------

  async function loadNotifConfig() {
    try {
      const data = await api("/notifications/config");
      state.notifCfg = data.config;
      state.notifDefaults = data.defaults;
      state.notifPlaceholders = data.placeholders;
      state.notifStatus = data.status;
      state.notifAvailable = data.available !== false;
    } catch (e) {
      /* bleibt auf "Lade …" bzw. alter Stand */
    }
  }

  const NOTIF_SAMPLE = {
    tag: "morgen", Tag: "Morgen", datum: "Do. 08.10.2026", zeit: "19:00", ort: "Sportplatz",
    aenderung: "Neuer Termin: Do. 08.10.2026 18:30 Uhr (vorher: Do. 08.10.2026 19:00 Uhr)",
    zusagen: 11, vielleicht: 3, absagen: 2, offen: 6, gaeste: 1,
  };
  const renderNotifTpl = (str, vars) =>
    String(str || "").replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));

  // Die drei Arten mit allem, was die Oberflaeche braucht. "bubbles" = die Texte, die man aendern kann.
  const NOTIF_KINDS = [
    { kind: "reminder", title: "Erinnerung", desc: "Geht an Spieler, die noch nicht abgestimmt haben.", hours: true,
      bubbles: [{ key: "reminder", label: "", fields: ["title", "body"], ids: ["nc-reminder-title", "nc-reminder-body"] }] },
    { kind: "change", title: "Änderung oder Absage", desc: "Geht sofort an alle, wenn du ein Training änderst oder löschst.", hours: false,
      bubbles: [
        { key: "change", label: "Bei Änderung", fields: ["title", "body"], ids: ["nc-change-title", "nc-change-body"] },
        { key: "change-cancel", label: "Bei Absage", fields: ["cancelTitle", "cancelBody"], ids: ["nc-change-ctitle", "nc-change-cbody"] },
      ] },
    { kind: "summary", title: "Zusagen-Übersicht", desc: "Geht nur an Trainer: wie viele zugesagt haben.", hours: true,
      bubbles: [{ key: "summary", label: "", fields: ["title", "body"], ids: ["nc-summary-title", "nc-summary-body"] }] },
  ];
  const NOTIF_CHIP_LABELS = {
    tag: "Tag (morgen)", Tag: "Tag (Morgen)", datum: "Datum", zeit: "Uhrzeit", ort: "Ort", aenderung: "Was sich geändert hat",
    zusagen: "Anzahl Zusagen", vielleicht: "Anzahl Vielleicht", absagen: "Anzahl Absagen", offen: "Anzahl offen", gaeste: "Anzahl Gäste",
  };

  function relTime(iso) {
    if (!iso) return null;
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 1) return "gerade eben";
    if (min < 60) return `vor ${min} Min.`;
    if (min < 60 * 24) return `vor ${Math.round(min / 60)} Std.`;
    const days = Math.round(min / 1440);
    return `vor ${days} Tag${days === 1 ? "" : "en"}`;
  }

  function notifSummaryText() {
    const c = state.notifCfg;
    if (!c) return "";
    const on = ["reminder", "change", "summary"].filter((k) => c[k].enabled).length;
    return on === 0 ? "alle aus" : `${on} von 3 an`;
  }

  // Inhalt des aufklappbaren Bereichs "Benachrichtigungen"
  function renderNotifAdminCard() {
    const c = state.notifCfg;
    if (!c) return `<p class="muted"><span class="spinner"></span> Lade …</p>`;
    const st = state.notifStatus || { devices: 0, players: 0, lastTick: null };
    const tickUrl = `${location.origin}/api/cron/tick`;
    const ageMin = st.lastTick ? (Date.now() - new Date(st.lastTick).getTime()) / 60000 : null;
    const tickClass = ageMin === null ? "warn" : ageMin <= 30 ? "ok" : "warn";
    const tickText = ageMin === null ? "Automatische Prüfung: noch nie gelaufen" : ageMin <= 30 ? `Automatische Prüfung: aktiv (${relTime(st.lastTick)})` : `Automatische Prüfung: zuletzt ${relTime(st.lastTick)}`;

    const itemHtml = (k) => {
      const cfg = c[k.kind];
      const bubblesHtml = k.bubbles.map((bub) => {
        const [fTitle, fBody] = bub.fields;
        const chips = (state.notifPlaceholders && state.notifPlaceholders[k.kind] || [])
          .filter((p) => !(bub.key === "change-cancel" && p === "aenderung"))
          .map((p) => `<button type="button" class="chip" data-insert="{${p}}">${escapeHtml(NOTIF_CHIP_LABELS[p] || p)}</button>`).join("");
        return `
          ${bub.label ? `<div class="bubble-label">${bub.label}</div>` : ""}
          <div class="notif-bubble" data-bubble="${bub.key}">
            <img class="bubble-icon" src="/icons/icon-192.png" alt="">
            <div style="min-width:0;">
              <div class="bubble-app">Trainingsplaner · jetzt</div>
              <div class="bubble-title"></div>
              <div class="bubble-body"></div>
            </div>
          </div>
          <div class="notif-actions"><button type="button" class="small secondary" data-edit-text="${bub.key}">Text ändern</button></div>
          <div class="notif-editor" id="ed-${bub.key}" ${state.notifEditing === bub.key ? "" : "hidden"}>
            <label for="${bub.ids[0]}">Überschrift</label>
            <input type="text" id="${bub.ids[0]}" maxlength="80" value="${escapeHtml(cfg[fTitle])}" data-field-of="${bub.key}">
            <label for="${bub.ids[1]}">Nachricht</label>
            <textarea id="${bub.ids[1]}" rows="2" maxlength="200" data-field-of="${bub.key}">${escapeHtml(cfg[fBody])}</textarea>
            <div class="muted" style="font-size:12px;margin-top:8px;">Antippen fügt ein Stück ein, das beim Senden automatisch ersetzt wird:</div>
            <div class="chips">${chips}</div>
            <div class="notif-actions" style="margin-top:0;">
              <button type="button" class="small" data-save-text="${bub.key}">Speichern</button>
              <button type="button" class="small secondary" data-default-text="${bub.key}">Standardtext</button>
              <button type="button" class="small secondary" data-cancel-text="${bub.key}">Abbrechen</button>
            </div>
            <div class="error" id="ed-${bub.key}-err"></div>
          </div>`;
      }).join("");
      return `
        <div class="notif-item ${cfg.enabled ? "" : "is-off"}" data-kind="${k.kind}">
          <div class="notif-head">
            <div><div class="notif-title">${k.title}</div><div class="setting-hint">${k.desc}</div></div>
            <input type="checkbox" class="toggle" id="nc-${k.kind}-enabled" aria-label="${k.title} ein- oder ausschalten" ${cfg.enabled ? "checked" : ""}>
          </div>
          ${k.hours ? `<div class="notif-when">Senden <input type="number" id="nc-${k.kind}-hours" min="1" max="72" step="1" value="${cfg.hoursBefore}" aria-label="Stunden vor dem Training"> Stunden vor dem Training</div>` : ""}
          ${bubblesHtml}
          <div class="notif-actions" style="margin-top:12px;"><button type="button" class="small secondary btn-test-notif" data-kind="${k.kind}">Test an mich senden</button></div>
        </div>`;
    };

    return `
      <div id="notif-root">
        ${state.notifAvailable ? "" : `<div class="error">Benachrichtigungen sind auf dem Server nicht verfügbar (Paket „web-push“ fehlt).</div>`}
        <p class="muted" style="margin-top:14px;">Spieler schalten Benachrichtigungen selbst auf ihrem Handy ein (Reiter „Trainings“, ganz unten).</p>
        <div class="status-chips">
          <span class="chip-info">${st.devices} Gerät${st.devices === 1 ? "" : "e"} · ${st.players} Spieler angemeldet</span>
          <span class="chip-info ${tickClass}">${tickText}</span>
        </div>
        <div class="save-flash" id="nc-flash" aria-live="polite"></div>
        ${NOTIF_KINDS.map(itemHtml).join("")}
        <details class="hint-box">
          <summary>Erinnerung und Übersicht pünktlich senden</summary>
          <p class="muted" style="margin:0 0 8px;">Diese beiden Nachrichten brauchen einen Wecker, der die App regelmäßig „nachschauen“ lässt. Das erledigt ein kostenloser Dienst:</p>
          <ol>
            <li>Auf <b>cron-job.org</b> kostenlos registrieren.</li>
            <li>Einen neuen „Cronjob“ anlegen und diese Adresse eintragen:</li>
            <li>Ausführung auf „alle 10 Minuten“ stellen.</li>
          </ol>
          <code class="url-box" id="tick-url">${escapeHtml(tickUrl)}</code>
          <div style="margin:6px 0 12px;"><button type="button" class="small secondary" id="btn-copy-tick-url">Adresse kopieren</button></div>
          <p class="muted" style="font-size:12px;margin:0 0 10px;">Ohne diesen Wecker schaut Vercel nur einmal am Tag nach, die Nachrichten kommen dann ungenau. Änderungen und Absagen werden immer sofort gesendet.</p>
        </details>
      </div>`;
  }

  function bindNotifAdminCard() {
    const root = document.getElementById("notif-root");
    if (!root) return;
    let flashTimer = null;
    const flash = (text, isError) => {
      const el = document.getElementById("nc-flash");
      if (!el) return;
      el.className = "save-flash" + (isError ? " err" : "");
      el.textContent = text;
      clearTimeout(flashTimer);
      if (!isError) flashTimer = setTimeout(() => { el.textContent = ""; }, 2500);
    };
    const savePatch = async (patch) => {
      const r = await api("/notifications/config", { method: "POST", body: patch });
      state.notifCfg = r.config;
      const sum = document.querySelector('[data-opt="notif"] .opt-status');
      if (sum) sum.textContent = notifSummaryText();
    };
    const bubbleOf = (key) => NOTIF_KINDS.flatMap((k) => k.bubbles.map((b) => Object.assign({ kind: k.kind }, b))).find((b) => b.key === key);
    const paintBubble = (key, title, body) => {
      const el = root.querySelector(`[data-bubble="${key}"]`);
      if (!el) return;
      el.querySelector(".bubble-title").textContent = renderNotifTpl(title, NOTIF_SAMPLE);
      el.querySelector(".bubble-body").textContent = renderNotifTpl(body, NOTIF_SAMPLE);
    };
    const paintFromConfig = (key) => {
      const b = bubbleOf(key); const cfg = state.notifCfg[b.kind];
      paintBubble(key, cfg[b.fields[0]], cfg[b.fields[1]]);
    };
    const paintFromInputs = (key) => {
      const b = bubbleOf(key);
      paintBubble(key, document.getElementById(b.ids[0]).value, document.getElementById(b.ids[1]).value);
    };
    NOTIF_KINDS.forEach((k) => k.bubbles.forEach((b) => paintFromConfig(b.key)));

    // Ein/Aus und Stunden speichern sofort
    NOTIF_KINDS.forEach((k) => {
      const item = root.querySelector(`.notif-item[data-kind="${k.kind}"]`);
      const cb = document.getElementById(`nc-${k.kind}-enabled`);
      cb.onchange = async () => {
        const v = cb.checked;
        item.classList.toggle("is-off", !v);
        try { await savePatch({ [k.kind]: { enabled: v } }); flash("Gespeichert ✓"); }
        catch (e) { cb.checked = !v; item.classList.toggle("is-off", v); flash(e.message, true); }
      };
      if (k.hours) {
        const h = document.getElementById(`nc-${k.kind}-hours`);
        h.onchange = async () => {
          const n = Number(h.value);
          if (!Number.isInteger(n) || n < 1 || n > 72) {
            h.value = state.notifCfg[k.kind].hoursBefore;
            flash("Bitte eine ganze Zahl zwischen 1 und 72 eintragen.", true);
            return;
          }
          try { await savePatch({ [k.kind]: { hoursBefore: n } }); flash("Gespeichert ✓"); }
          catch (e) { h.value = state.notifCfg[k.kind].hoursBefore; flash(e.message, true); }
        };
      }
    });

    // Texte: oeffnen / abbrechen / speichern / Standardtext / Bausteine einfuegen
    const openEditor = (key) => {
      state.notifEditing = key;
      root.querySelectorAll(".notif-editor").forEach((ed) => { ed.hidden = ed.id !== `ed-${key}`; });
    };
    const closeEditor = (key) => {
      const ed = document.getElementById(`ed-${key}`);
      if (ed) ed.hidden = true;
      if (state.notifEditing === key) state.notifEditing = null;
    };
    const resetInputs = (key) => {
      const b = bubbleOf(key); const cfg = state.notifCfg[b.kind];
      document.getElementById(b.ids[0]).value = cfg[b.fields[0]];
      document.getElementById(b.ids[1]).value = cfg[b.fields[1]];
      paintFromConfig(key);
    };
    const saveText = async (key) => {
      const b = bubbleOf(key);
      const err = document.getElementById(`ed-${key}-err`);
      err.textContent = "";
      try {
        await savePatch({ [b.kind]: { [b.fields[0]]: document.getElementById(b.ids[0]).value, [b.fields[1]]: document.getElementById(b.ids[1]).value } });
        resetInputs(key); // zeigt, was der Server wirklich gespeichert hat (leer = Standardtext)
        closeEditor(key);
        flash("Text gespeichert ✓");
        return true;
      } catch (e) {
        err.textContent = e.message;
        return false;
      }
    };
    root.querySelectorAll("[data-edit-text]").forEach((btn) => { btn.onclick = () => { const key = btn.getAttribute("data-edit-text"); if (state.notifEditing === key) { resetInputs(key); closeEditor(key); } else openEditor(key); }; });
    root.querySelectorAll("[data-cancel-text]").forEach((btn) => { btn.onclick = () => { const key = btn.getAttribute("data-cancel-text"); resetInputs(key); closeEditor(key); }; });
    root.querySelectorAll("[data-save-text]").forEach((btn) => { btn.onclick = () => saveText(btn.getAttribute("data-save-text")); });
    root.querySelectorAll("[data-default-text]").forEach((btn) => {
      btn.onclick = () => {
        const key = btn.getAttribute("data-default-text"); const b = bubbleOf(key); const d = state.notifDefaults[b.kind];
        document.getElementById(b.ids[0]).value = d[b.fields[0]];
        document.getElementById(b.ids[1]).value = d[b.fields[1]];
        paintFromInputs(key);
      };
    });
    const lastField = {};
    root.querySelectorAll("[data-field-of]").forEach((inp) => {
      const key = inp.getAttribute("data-field-of");
      inp.addEventListener("focus", () => { lastField[key] = inp; });
      inp.addEventListener("input", () => paintFromInputs(key));
    });
    root.querySelectorAll(".notif-editor").forEach((ed) => {
      const key = ed.id.replace("ed-", "");
      ed.querySelectorAll("[data-insert]").forEach((chip) => {
        // mousedown verhindert, dass das Textfeld beim Antippen den Fokus (und die Cursor-Position) verliert
        chip.addEventListener("mousedown", (e) => e.preventDefault());
        chip.onclick = () => {
          const b = bubbleOf(key);
          const field = lastField[key] || document.getElementById(b.ids[1]);
          const text = chip.getAttribute("data-insert");
          field.focus();
          const start = field.selectionStart == null ? field.value.length : field.selectionStart;
          const end = field.selectionEnd == null ? field.value.length : field.selectionEnd;
          field.setRangeText(text, start, end, "end");
          field.dispatchEvent(new Event("input", { bubbles: true }));
        };
      });
    });

    // Test-Nachricht (speichert einen gerade offenen Text vorher)
    root.querySelectorAll(".btn-test-notif").forEach((btn) => {
      btn.onclick = async () => {
        const kind = btn.getAttribute("data-kind");
        const k = NOTIF_KINDS.find((x) => x.kind === kind);
        for (const bub of k.bubbles) {
          if (state.notifEditing === bub.key && !(await saveText(bub.key))) return;
        }
        btn.disabled = true;
        try {
          const r = await api("/notifications/test", { method: "POST", body: { kind } });
          flash(`Test gesendet an ${r.sent} von ${r.devices} deiner Geräte.`);
        } catch (e) {
          flash(e.message, true);
        }
        btn.disabled = false;
      };
    });

    const copy = document.getElementById("btn-copy-tick-url");
    if (copy) copy.onclick = async () => {
      const url = document.getElementById("tick-url").textContent;
      try { await navigator.clipboard.writeText(url); copy.textContent = "Kopiert ✓"; }
      catch (e) {
        const range = document.createRange(); range.selectNodeContents(document.getElementById("tick-url"));
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        copy.textContent = "Markiert – jetzt kopieren";
      }
      setTimeout(() => { copy.textContent = "Adresse kopieren"; }, 2500);
    };
  }

  async function loadLog() {
    try {
      const data = await api("/log");
      state.logEntries = data.entries;
      state.logRetentionDays = data.retentionDays;
      state.logError = "";
    } catch (e) {
      state.logError = e.message;
    }
  }

  function renderLogSection() {
    if (state.logError) {
      return `<div class="card"><h2>Protokoll</h2><div class="error">${escapeHtml(state.logError)}</div>
        <div style="margin-top:10px;"><button class="small secondary" id="btn-log-refresh">Erneut versuchen</button></div></div>`;
    }
    if (!state.logEntries) {
      return `<div class="card"><h2>Protokoll</h2><p class="muted"><span class="spinner"></span> Lade …</p></div>`;
    }
    const TZ = "Europe/Vienna";
    const dayKey = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(d); // YYYY-MM-DD
    const todayKey = dayKey(new Date());
    const yesterdayKey = dayKey(new Date(Date.now() - 24 * 3600 * 1000));
    const filters = [["alle", "Alle"], ["rsvp", "Rückmeldungen"], ["verwaltung", "Verwaltung"], ["konto", "Konten"]];
    const list = state.logFilter === "alle" ? state.logEntries : state.logEntries.filter((e) => e.category === state.logFilter);
    const shown = list.slice(0, state.logShown);

    let html = "";
    let lastDay = "";
    shown.forEach((e) => {
      const d = new Date(e.createdAt);
      const key = dayKey(d);
      if (key !== lastDay) {
        lastDay = key;
        const label = key === todayKey ? "Heute" : key === yesterdayKey ? "Gestern"
          : d.toLocaleDateString("de-AT", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
        html += `<div class="log-day">${escapeHtml(label)}</div>`;
      }
      const time = d.toLocaleTimeString("de-AT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
      html += `
        <div class="log-item log-${escapeHtml(e.category)}${e.tag ? ` log-tag-${escapeHtml(e.tag)}` : ""}">
          <div class="log-time">${escapeHtml(time)}</div>
          <div class="log-body"><b>${escapeHtml(e.actor || "Nicht angemeldet")}</b> · ${escapeHtml(e.text)}</div>
        </div>`;
    });

    return `
      <div class="card">
        <div class="top-bar">
          <h2 style="margin:0;">Protokoll</h2>
          <button class="small secondary" id="btn-log-refresh">Aktualisieren</button>
        </div>
        <p class="muted" style="margin:6px 0 10px;">Alle Aktionen der letzten ${state.logRetentionDays || 7} Tage (Zeiten in Wiener Zeit). Ältere Einträge werden automatisch gelöscht.</p>
        <div class="log-filters">
          ${filters.map(([key, label]) => `<button class="small ${state.logFilter === key ? "" : "secondary"}" data-log-filter="${key}">${label}</button>`).join("")}
        </div>
        <div class="muted" style="margin:10px 0 0;">${list.length} Eintrag${list.length === 1 ? "" : "e"}</div>
        ${list.length === 0 ? `<div class="empty">Keine Einträge in diesem Zeitraum.</div>` : html}
        ${list.length > shown.length ? `<div style="margin-top:12px;"><button class="small secondary" id="btn-log-more">Mehr anzeigen (${list.length - shown.length} weitere)</button></div>` : ""}
      </div>`;
  }

  // Aufklappbarer Bereich in Verwaltung → Optionen (zeigt zugeklappt nur Titel + Kurzstatus)
  function optSection(key, title, status, bodyHtml) {
    return `
      <details class="card opt-section" data-opt="${key}" ${state.optOpen[key] ? "open" : ""}>
        <summary><span class="opt-title">${escapeHtml(title)}</span><span class="opt-status">${escapeHtml(status || "")}</span></summary>
        <div class="opt-body">${bodyHtml}</div>
      </details>`;
  }

  function renderSeasonRow(s, canDelete) {
    if (state.editingSeasonId === s.id) {
      return `
        <div class="list-item" style="display:block;" data-season-edit-id="${s.id}">
          <label>Name</label>
          <input type="text" class="se-name" value="${escapeHtml(s.name)}">
          <div class="row">
            <div><label>Von</label><input type="date" class="se-start" value="${escapeHtml(s.startDate)}"></div>
            <div><label>Bis</label><input type="date" class="se-end" value="${escapeHtml(s.endDate)}"></div>
          </div>
          <div class="error se-error"></div>
          <div style="margin-top:8px;display:flex;gap:8px;">
            <button class="small btn-save-season" data-season-id="${s.id}">Speichern</button>
            <button class="small secondary btn-cancel-season">Abbrechen</button>
          </div>
        </div>`;
    }
    return `
      <div class="list-item">
        <span>${escapeHtml(s.name)} <span class="muted">(${fmtDate(s.startDate)} – ${fmtDate(s.endDate)})</span></span>
        <span>
          <button class="small secondary btn-edit-season" data-season-id="${s.id}">Bearbeiten</button>
          ${canDelete ? `<button class="small secondary btn-delete-season" data-season-id="${s.id}">Löschen</button>` : ""}
        </span>
      </div>`;
  }

  function renderAdmin() {
    const visible = trainingsInCurrentWeek();
    const now = Date.now();
    const allMatchesSorted = [...state.matches].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const upcomingMatches = allMatchesSorted.filter((m) => new Date(`${m.date}T${m.time}:00`).getTime() >= now);
    const pastMatches = allMatchesSorted.filter((m) => new Date(`${m.date}T${m.time}:00`).getTime() < now);
    const matchesToShow = state.showPastMatches ? allMatchesSorted : upcomingMatches;

    const currentSeason = state.seasons.find((s) => s.id === state.currentSeasonId);
    const otherSeasons = state.seasons.filter((s) => s.id !== state.currentSeasonId);

    return `
      <div class="tabs admin-tabs">
          <button class="${state.adminSection === "trainings" ? "" : "secondary"}" data-admin-section="trainings">Trainings</button>
          <button class="${state.adminSection === "spielplan" ? "" : "secondary"}" data-admin-section="spielplan">Spielplan</button>
          <button class="${state.adminSection === "spieler" ? "" : "secondary"}" data-admin-section="spieler">Spieler</button>
          <button class="${state.adminSection === "optionen" ? "" : "secondary"}" data-admin-section="optionen">Optionen</button>
          <button class="${state.adminSection === "protokoll" ? "" : "secondary"}" data-admin-section="protokoll">Protokoll</button>
      </div>

      <div class="admin-section" data-section="trainings" ${state.adminSection === "trainings" ? "" : "hidden"}>
      <div class="card">
        <h2>Trainings verwalten &amp; Gastspieler eintragen</h2>
        ${renderWeekNav()}
        ${state.trainings.length === 0 ? '<p class="empty">Noch keine Trainings.</p>' : visible.length === 0 ? '<p class="empty">Keine Trainings in dieser Woche.</p>' : visible.map((t) => {
          const guests = t.guests || [];
          const isEditing = state.editingTrainingId === t.id;
          return `
          <div class="training" data-admin-id="${t.id}">
            ${isEditing ? `
            <div class="row">
              <div><label>Datum</label><input type="date" class="edit-date" value="${t.date}"></div>
              <div><label>Uhrzeit</label><input type="time" class="edit-time" value="${t.time}"></div>
            </div>
            <label>Ort</label>
            <input type="text" class="edit-ort" value="${escapeHtml(t.ort || "")}">
            <label>Hinweis (optional)</label>
            <input type="text" class="edit-note" value="${escapeHtml(t.note || "")}">
            <div class="error edit-error" style="display:none;"></div>
            <div class="row" style="margin-top:8px;">
              <button class="small btn-save-training" style="flex:0 0 auto;">Speichern</button>
              <button class="small secondary btn-cancel-edit-training" style="flex:0 0 auto;">Abbrechen</button>
            </div>
            ` : `
            <div class="head">
              <div>
                <div class="when">${fmtDate(t.date)} · ${t.time} Uhr</div>
                <div class="where">${escapeHtml(t.ort || "")}</div>
                ${t.note ? `<div class="muted" style="margin-top:4px;">${escapeHtml(t.note)}</div>` : ""}
              </div>
              <span class="row" style="max-width:200px;">
                <button class="small secondary btn-edit-training">Bearbeiten</button>
                <button class="small secondary btn-delete-training">Löschen</button>
              </span>
            </div>
            <label style="margin-top:10px;">Gastspieler für dieses Training hinzufügen</label>
            <div class="row">
              <input type="text" class="guest-name-input" placeholder="Name des Gastspielers">
              <button class="small btn-add-guest" style="flex:0 0 auto;">Hinzufügen</button>
            </div>
            <div class="guest-error error" style="display:none;"></div>
            ${guests.length > 0 ? `
            <div style="margin-top:8px;">
              ${guests.map((g) => `<span class="pill zusage" style="margin:2px 4px 2px 0;">${escapeHtml(g.name)} <a href="#" class="guest-remove" data-guest-id="${g.id}" style="color:inherit;text-decoration:none;">✕</a></span>`).join("")}
            </div>` : `<p class="muted" style="margin-top:8px;">Noch keine Gastspieler für dieses Training.</p>`}

            <label style="margin-top:14px;">Rückmeldung für einen Spieler eintragen/ändern</label>
            <p class="muted" style="font-size:11.5px;margin:2px 0 6px;">Z. B. wenn die Abstimmfrist (1 Std. vor Trainingsbeginn) schon vorbei ist, oder um rückwirkend etwas einzutragen.</p>
            <select class="admin-rsvp-player">
              <option value="">– Spieler wählen –</option>
              ${state.players.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
            </select>
            <div class="rsvp-buttons admin-rsvp-buttons" style="margin-top:8px;">
              <button data-status="zusage" class="inactive">Zusage</button>
              <button data-status="vielleicht" class="inactive">Vielleicht</button>
              <button data-status="absage" class="inactive">Absage</button>
            </div>
            <div class="admin-rsvp-reason-box" style="display:none;margin-top:8px;">
              <textarea class="admin-rsvp-reason-input" placeholder="Grund (Pflichtfeld bei Vielleicht/Absage)"></textarea>
              <div class="error admin-rsvp-reason-error" style="display:none;">Bitte einen Grund angeben.</div>
              <div style="margin-top:6px;"><button class="small admin-rsvp-save">Speichern</button></div>
            </div>
            <div class="admin-rsvp-error error" style="display:none;"></div>
            <div class="admin-rsvp-status muted" style="margin-top:4px;font-size:12px;">${escapeHtml(state.adminRsvpFeedback[t.id] || "")}</div>
            `}
          </div>`;
        }).join("")}
      </div>

      <div class="card">
        <h2>Neues Training anlegen</h2>
        <div class="row">
          <div><label>Datum</label><input type="date" id="new-date"></div>
          <div><label>Uhrzeit</label><input type="time" id="new-time" value="19:00"></div>
        </div>
        <label>Ort</label>
        <input type="text" id="new-ort" placeholder="z. B. Sportplatz Hauptplatz 1">
        <label>Hinweis (optional)</label>
        <input type="text" id="new-note" placeholder="z. B. Balldienst: Max &amp; Julia, Zusatztraining …">
        <div id="new-error" class="error"></div>
        <div style="margin-top:12px;"><button id="btn-add-training">Training anlegen</button></div>
      </div>

      <div class="card">
        <h2>Serientermine anlegen</h2>
        <p class="muted">Legt für jeden ausgewählten Wochentag im gewählten Zeitraum automatisch ein Training an — praktisch für eine ganze Saison auf einmal.</p>
        <label>Wochentage</label>
        <div class="weekday-checks">
          <label><input type="checkbox" id="series-mo" checked> Mo</label>
          <label><input type="checkbox" id="series-di" checked> Di</label>
          <label><input type="checkbox" id="series-mi"> Mi</label>
          <label><input type="checkbox" id="series-do" checked> Do</label>
          <label><input type="checkbox" id="series-fr"> Fr</label>
          <label><input type="checkbox" id="series-sa"> Sa</label>
          <label><input type="checkbox" id="series-so"> So</label>
        </div>
        <div class="row">
          <div><label>Uhrzeit</label><input type="time" id="series-time" value="19:00"></div>
          <div><label>Ort</label><input type="text" id="series-ort" placeholder="z. B. Sportplatz Hauptplatz 1"></div>
        </div>
        <label>Hinweis (optional)</label>
        <input type="text" id="series-note" placeholder="z. B. Sommer-Trainingsblock">
        <div class="row">
          <div><label>Von</label><input type="date" id="series-start"></div>
          <div><label>Bis</label><input type="date" id="series-end"></div>
        </div>
        <div id="series-error" class="error"></div>
        <div id="series-status" class="info"></div>
        <div style="margin-top:12px;"><button id="btn-create-series">Serientermine erstellen</button></div>
      </div>
      </div>

      <div class="admin-section" data-section="spielplan" ${state.adminSection === "spielplan" ? "" : "hidden"}>
      <div class="card">
        <div class="top-bar">
          <h2 style="margin:0;">Spielplan (${upcomingMatches.length} bevorstehend)</h2>
          <button class="small secondary" id="btn-toggle-matches-list">${state.matchesListOpen ? "Ausblenden" : "Anzeigen"}</button>
        </div>
        <p class="muted">Das zeitlich nächste Spiel wird automatisch oben im Trainingsplan als Banner angezeigt.</p>

        ${state.matchesListOpen ? `
        ${matchesToShow.length === 0 ? `<p class="empty">${state.showPastMatches ? "Noch keine Spiele eingetragen." : "Keine bevorstehenden Spiele eingetragen."}</p>` : matchesToShow.map((m) => {
          const isEditingMatch = state.editingMatchId === m.id;
          if (isEditingMatch) {
            return `
            <div class="training" data-match-edit-id="${m.id}">
              <div class="row">
                <div><label>Gegner</label><input type="text" class="em-opponent" value="${escapeHtml(m.opponent)}"></div>
                <div><label>Heim/Auswärts</label>
                  <select class="em-is-home">
                    <option value="1" ${m.isHome ? "selected" : ""}>Heimspiel</option>
                    <option value="0" ${!m.isHome ? "selected" : ""}>Auswärtsspiel</option>
                  </select>
                </div>
              </div>
              <div class="row">
                <div><label>Datum</label><input type="date" class="em-date" value="${m.date}"></div>
                <div><label>Uhrzeit</label><input type="time" class="em-time" value="${m.time}"></div>
              </div>
              <label>Gegner-Logo (Bild-URL, optional)</label>
              <input type="text" class="em-logo" value="${escapeHtml(m.opponentLogoUrl || "")}">
              <div class="row">
                <div><label>Runde (optional)</label><input type="text" class="em-round" value="${escapeHtml(m.round || "")}"></div>
                <div><label>Schiedsrichter (optional)</label><input type="text" class="em-referee" value="${escapeHtml(m.referee || "")}"></div>
              </div>
              <label>Ort (optional)</label>
              <input type="text" class="em-ort" value="${escapeHtml(m.ort || "")}">
              <label>Hinweis (optional)</label>
              <input type="text" class="em-note" value="${escapeHtml(m.note || "")}">
              <div class="error em-error" style="display:none;"></div>
              <div class="row" style="margin-top:8px;">
                <button class="small btn-save-match" style="flex:0 0 auto;">Speichern</button>
                <button class="small secondary btn-cancel-edit-match" style="flex:0 0 auto;">Abbrechen</button>
              </div>
            </div>`;
          }
          return `
          <div class="list-item">
            <span style="display:flex;align-items:center;gap:8px;">
              ${m.opponentLogoUrl ? `<img src="${escapeHtml(m.opponentLogoUrl)}" alt="" class="match-logo-sm">` : ""}
              <span>${m.round ? `<span class="muted">${escapeHtml(m.round)}:</span> ` : ""}${m.isHome ? `${CLUB_NAME} – ${escapeHtml(m.opponent)}` : `${escapeHtml(m.opponent)} – ${CLUB_NAME}`} <span class="muted">(${fmtDate(m.date)}, ${m.time} Uhr)</span></span>
            </span>
            <span class="row" style="max-width:200px;">
              <button class="small secondary btn-edit-match" data-match-id="${m.id}">Bearbeiten</button>
              <button class="small secondary btn-delete-match" data-match-id="${m.id}">Löschen</button>
            </span>
          </div>`;
        }).join("")}
        ${pastMatches.length > 0 ? `
        <div style="margin-top:10px;">
          <button class="small secondary" id="btn-toggle-past-matches">${state.showPastMatches ? "Vergangene Spiele ausblenden" : `${pastMatches.length} vergangene Spiele anzeigen`}</button>
        </div>` : ""}
        ` : ""}

        <details style="margin-top:16px;">
          <summary style="cursor:pointer;font-weight:600;font-size:13.5px;color:var(--grass-dark);">📥 Mehrere Spiele auf einmal importieren (z. B. für eine neue Saison)</summary>
          <p class="muted" style="margin-top:8px;">
            Praktisch für den Saisonstart: Statt jedes Spiel einzeln einzutippen, hier eine
            Liste im JSON-Format einfügen. Genau dieses Format kann z. B. eine KI (wie Claude)
            anhand des Spielplans einer neuen Saison für euch erzeugen — einfach den Spielplan
            (z. B. von fan.at) nennen und um eine Liste "in diesem exakten JSON-Format" bitten.
          </p>
          <p class="muted" style="font-size:12px;">Pflichtfelder: opponent, date (JJJJ-MM-TT), time (SS:MM), isHome (true/false). Optional: round, opponentLogoUrl, ort, referee, note.</p>
          <div style="margin-bottom:6px;">
            <button type="button" class="small secondary" id="btn-copy-format">📋 Format-Vorlage kopieren</button>
            <span id="copy-format-feedback" class="muted" style="margin-left:6px;"></span>
          </div>
          <textarea id="bulk-matches-json" rows="8" style="font-family:monospace;font-size:12px;" placeholder="${escapeHtml(BULK_MATCH_FORMAT_EXAMPLE)}"></textarea>
          <div id="bulk-import-error" class="error" style="display:none;"></div>
          <div id="bulk-import-status" class="info"></div>
          <div style="margin-top:8px;"><button class="small" id="btn-bulk-import-matches">Spiele aus JSON importieren</button></div>
        </details>

        <h2 style="margin-top:22px;">Neues Spiel eintragen</h2>
        <div class="row">
          <div><label>Gegner</label><input type="text" id="nm-opponent" placeholder="z. B. FC Münzkirchen"></div>
          <div><label>Heim/Auswärts</label>
            <select id="nm-is-home">
              <option value="1">Heimspiel</option>
              <option value="0">Auswärtsspiel</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div><label>Datum</label><input type="date" id="nm-date"></div>
          <div><label>Uhrzeit</label><input type="time" id="nm-time"></div>
        </div>
        <label>Gegner-Logo (Bild-URL, optional)</label>
        <input type="text" id="nm-logo" placeholder="https://…">
        <div class="row">
          <div><label>Runde (optional)</label><input type="text" id="nm-round" placeholder="z. B. Runde 14"></div>
          <div><label>Schiedsrichter (optional)</label><input type="text" id="nm-referee" placeholder="wird meist erst kurzfristig bekannt"></div>
        </div>
        <label>Ort (optional)</label>
        <input type="text" id="nm-ort" placeholder="z. B. Sportplatz Hauptplatz 1">
        <label>Hinweis (optional)</label>
        <input type="text" id="nm-note" placeholder="z. B. Meisterschaftsspiel">
        <div id="nm-error" class="error"></div>
        <div class="row" style="margin-top:12px;">
          <button id="btn-save-next-match" style="flex:0 0 auto;">Spiel hinzufügen</button>
        </div>
      </div>
      </div>

      <div class="admin-section" data-section="spieler" ${state.adminSection === "spieler" ? "" : "hidden"}>
      <div class="card">
        <div class="top-bar">
          <h2 style="margin:0;">Spieler (${state.players.length})</h2>
          <button class="small secondary" id="btn-toggle-players">${state.playersListOpen ? "Ausblenden" : "Anzeigen"}</button>
        </div>
        ${state.playersListOpen ? `
          <p class="muted">Passwort vergessen? Spieler hier löschen — er/sie kann sich danach mit derselben oder einer neuen E-Mail neu registrieren.</p>
          <input type="text" id="players-filter" placeholder="Spieler suchen …" value="${escapeHtml(state.playersFilter || "")}" style="margin-bottom:10px;">
          <div class="players-scroll">
          ${state.players
            .filter((p) => !state.playersFilter || p.name.toLowerCase().includes(state.playersFilter.toLowerCase()))
            .map((p) => `
          <div class="list-item">
            <span>${escapeHtml(p.name)} <span class="muted">${escapeHtml(p.email)}</span> ${p.isAdmin ? '<span class="badge-admin">Trainer</span>' : ""}</span>
            <span class="row" style="max-width:320px;">
              <button class="small secondary btn-toggle-admin" data-player-id="${p.id}">${p.isAdmin ? "Trainer entfernen" : "Zu Trainer machen"}</button>
              ${p.id !== state.me.id ? `<button class="small secondary btn-delete-player" data-player-id="${p.id}" data-player-name="${escapeHtml(p.name)}">Löschen</button>` : ""}
            </span>
          </div>`).join("")}
          </div>
        ` : ""}
      </div>
      </div>

      <div class="admin-section" data-section="protokoll" ${state.adminSection === "protokoll" ? "" : "hidden"}>
        ${renderLogSection()}
      </div>

      <div class="admin-section" data-section="optionen" ${state.adminSection === "optionen" ? "" : "hidden"}>
      ${optSection("sicht", "Sichtbarkeit", state.reasonsTrainerOnly ? "Gründe nur für Trainer" : "Gründe für alle", `
        <div class="setting-row">
          <div>
            <div class="setting-title">Gründe nur für Trainer sichtbar</div>
            <div class="setting-hint">Spieler sehen bei „Vielleicht“ und „Absage“ nur ihren eigenen Grund. Namen und Zähler bleiben für alle sichtbar.</div>
          </div>
          <input type="checkbox" class="toggle" id="toggle-reasons-trainer-only" aria-label="Gründe nur für Trainer sichtbar" ${state.reasonsTrainerOnly ? "checked" : ""}>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-title">Spielvorschau anzeigen</div>
            <div class="setting-hint">Zeigt im Trainingsplan oben das nächste Spiel.</div>
          </div>
          <input type="checkbox" class="toggle" id="toggle-match-banner" aria-label="Spielvorschau anzeigen" ${state.showMatchBanner ? "checked" : ""}>
        </div>`)}

      ${optSection("notif", "Benachrichtigungen", notifSummaryText(), renderNotifAdminCard())}

      ${optSection("wort", "Vereinswort", state.clubWord ? "festgelegt" : "nicht festgelegt", `
        <p class="muted">Wer sich neu registrieren möchte, muss dieses Wort eingeben. Bereits registrierte Spieler sind nicht betroffen. Leer lassen = kein Vereinswort nötig.</p>
        <label>Vereinswort</label>
        <input type="text" id="club-word-input" maxlength="40" autocomplete="off" value="${escapeHtml(state.clubWord)}" placeholder="z. B. Forelle">
        <div style="margin-top:10px;"><button class="small" id="btn-save-club-word">Speichern</button></div>
        <div id="club-word-msg" class="info"></div>
      `)}

      ${optSection("saison", "Saisonen", currentSeason ? currentSeason.name : "keine läuft gerade", `
        <p class="muted">Trainings/Spiele werden automatisch anhand ihres Datums der passenden Saison zugerechnet. Die Statistik startet dadurch mit jeder neuen Saison von selbst wieder bei null.</p>
        ${currentSeason
          ? `<p style="margin-bottom:2px;">Aktuell läuft:</p>${renderSeasonRow(currentSeason, false)}`
          : `<p class="muted">Gerade ist keine Saison als "aktuell" hinterlegt (z. B. zwischen zwei Saisonen). Statistik zeigt in dem Fall automatisch alle Trainings.</p>`}
        ${otherSeasons.length > 0 ? `
          <details style="margin:8px 0;" ${otherSeasons.some((x) => x.id === state.editingSeasonId) ? "open" : ""}>
            <summary class="muted" style="cursor:pointer;">${otherSeasons.length} weitere Saison${otherSeasons.length === 1 ? "" : "en"} anzeigen</summary>
            ${otherSeasons.map((x) => renderSeasonRow(x, true)).join("")}
          </details>` : ""}
        <p class="muted" style="font-size:12px;">Tipp: Findet ein Training außerhalb des Zeitraums statt (z. B. noch im Jänner), den Zeitraum der Saison über „Bearbeiten“ anpassen — sonst zählt es in keiner Saison-Statistik.</p>
        <label style="margin-top:10px;">Neue Saison anlegen</label>
        <input type="text" id="season-name" placeholder="z. B. Herbstsaison 2026" value="${escapeHtml(suggestSeasonName())}">
        <div class="row">
          <div><label>Von</label><input type="date" id="season-start" value="${suggestSeasonRange().start}"></div>
          <div><label>Bis</label><input type="date" id="season-end" value="${suggestSeasonRange().end}"></div>
        </div>
        <div id="season-error" class="error"></div>
        <div style="margin-top:10px;"><button class="small" id="btn-add-season">Saison anlegen</button></div>
      `)}
      </div>
    `;
  }

  function bindAdmin() {
    bindWeekNav(render);

    const addSeasonBtn = document.getElementById("btn-add-season");
    if (addSeasonBtn) {
      addSeasonBtn.onclick = async () => {
        const name = document.getElementById("season-name").value.trim();
        const startDate = document.getElementById("season-start").value;
        const endDate = document.getElementById("season-end").value;
        const err = document.getElementById("season-error");
        err.textContent = "";
        try {
          await api("/seasons", { method: "POST", body: { name, startDate, endDate } });
          await loadSeasons();
          await loadStats(); // Statistik-Standardauswahl "Aktuelle Saison" kann sich jetzt aendern
          render();
        } catch (e) {
          err.textContent = e.message;
        }
      };
    }

    document.querySelectorAll(".btn-edit-season").forEach((btn) => {
      btn.onclick = () => {
        state.editingSeasonId = Number(btn.getAttribute("data-season-id"));
        render();
      };
    });
    document.querySelectorAll(".btn-cancel-season").forEach((btn) => {
      btn.onclick = () => { state.editingSeasonId = null; render(); };
    });
    document.querySelectorAll(".btn-save-season").forEach((btn) => {
      btn.onclick = async () => {
        const row = btn.closest("[data-season-edit-id]");
        const err = row.querySelector(".se-error");
        err.textContent = "";
        const body = {
          name: row.querySelector(".se-name").value.trim(),
          startDate: row.querySelector(".se-start").value,
          endDate: row.querySelector(".se-end").value,
        };
        try {
          await api(`/seasons/${btn.getAttribute("data-season-id")}`, { method: "PUT", body });
          state.editingSeasonId = null;
          await loadSeasons();
          await loadStats(); // Statistik zaehlt jetzt andere Trainings mit
          render();
        } catch (e) {
          err.textContent = e.message;
        }
      };
    });

    document.querySelectorAll(".btn-delete-season").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Diese Saison wirklich löschen? Die Trainings/Spiele selbst bleiben erhalten, zählen danach aber zu keiner Saison mehr.")) return;
        try {
          await api(`/seasons/${btn.getAttribute("data-season-id")}`, { method: "DELETE" });
          await loadSeasons();
          render();
        } catch (e) {
          alert(e.message);
        }
      };
    });

    const togglePastMatchesBtn = document.getElementById("btn-toggle-past-matches");
    if (togglePastMatchesBtn) {
      togglePastMatchesBtn.onclick = () => {
        state.showPastMatches = !state.showPastMatches;
        render();
      };
    }

    const toggleMatchesListBtn = document.getElementById("btn-toggle-matches-list");
    if (toggleMatchesListBtn) {
      toggleMatchesListBtn.onclick = () => {
        state.matchesListOpen = !state.matchesListOpen;
        render();
      };
    }

    document.querySelectorAll("[data-admin-section]").forEach((btn) => {
      btn.onclick = async () => {
        state.adminSection = btn.getAttribute("data-admin-section");
        render();
        window.scrollTo(0, 0);
        if (state.adminSection === "protokoll") {
          await loadLog(); // beim Oeffnen immer frisch laden
          render();
        }
      };
    });

    document.querySelectorAll("[data-log-filter]").forEach((btn) => {
      btn.onclick = () => {
        state.logFilter = btn.getAttribute("data-log-filter");
        state.logShown = 150;
        render();
      };
    });
    const logRefreshBtn = document.getElementById("btn-log-refresh");
    if (logRefreshBtn) logRefreshBtn.onclick = async () => {
      logRefreshBtn.disabled = true;
      await loadLog();
      render();
    };
    const logMoreBtn = document.getElementById("btn-log-more");
    if (logMoreBtn) logMoreBtn.onclick = () => {
      state.logShown += 150;
      render();
    };

    document.querySelectorAll("details.opt-section").forEach((d) => {
      d.addEventListener("toggle", () => { state.optOpen[d.getAttribute("data-opt")] = d.open; });
    });
    bindNotifAdminCard();

    const saveClubWordBtn = document.getElementById("btn-save-club-word");
    if (saveClubWordBtn) {
      saveClubWordBtn.onclick = async () => {
        const msg = document.getElementById("club-word-msg");
        const word = document.getElementById("club-word-input").value.trim();
        msg.className = "info";
        msg.textContent = "";
        try {
          await api("/settings", { method: "POST", body: { clubWord: word } });
          state.clubWord = word;
          msg.textContent = word ? "Gespeichert. Neue Spieler brauchen jetzt dieses Wort." : "Vereinswort entfernt. Neue Spieler können sich ohne Wort registrieren.";
        } catch (e) {
          msg.className = "error";
          msg.textContent = e.message;
        }
      };
    }

    const toggleReasonsCb = document.getElementById("toggle-reasons-trainer-only");
    if (toggleReasonsCb) {
      toggleReasonsCb.onchange = async () => {
        const checked = toggleReasonsCb.checked;
        state.reasonsTrainerOnly = checked; // optimistisch sofort uebernehmen
        try {
          await api("/settings", { method: "POST", body: { reasonsTrainerOnly: checked } });
          closeAllOverviews(); // geoeffnete Uebersichten wuerden sonst noch den alten Stand zeigen
        } catch (e) {
          state.reasonsTrainerOnly = !checked; // bei Fehler zurueckdrehen
          alert(e.message);
        }
        render();
      };
    }

    const toggleBannerCb = document.getElementById("toggle-match-banner");
    if (toggleBannerCb) {
      toggleBannerCb.onchange = async () => {
        const checked = toggleBannerCb.checked;
        state.showMatchBanner = checked; // optimistisch sofort uebernehmen
        try {
          await api("/settings", { method: "POST", body: { showMatchBanner: checked } });
        } catch (e) {
          state.showMatchBanner = !checked; // bei Fehler zurueckdrehen
          alert(e.message);
        }
        render();
      };
    }

    const togglePlayersBtn = document.getElementById("btn-toggle-players");
    if (togglePlayersBtn) {
      togglePlayersBtn.onclick = () => {
        state.playersListOpen = !state.playersListOpen;
        render();
      };
    }

    const playersFilterInput = document.getElementById("players-filter");
    if (playersFilterInput) {
      playersFilterInput.oninput = () => {
        state.playersFilter = playersFilterInput.value;
        render();
        // Fokus geht beim Neu-Rendern verloren - direkt danach wiederherstellen
        const el = document.getElementById("players-filter");
        if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
      };
    }

    // Generischer JSON-Import fuer mehrere Spiele auf einmal - funktioniert fuer jede Saison,
    // nicht auf eine bestimmte fest einprogrammiert. Das JSON kann z. B. von einer KI anhand
    // eines Spielplans erzeugt werden (Format siehe Platzhaltertext im Textfeld).
    const copyFormatBtn = document.getElementById("btn-copy-format");
    if (copyFormatBtn) {
      copyFormatBtn.onclick = async () => {
        const feedback = document.getElementById("copy-format-feedback");
        try {
          await navigator.clipboard.writeText(BULK_MATCH_FORMAT_EXAMPLE);
          feedback.textContent = "✓ In Zwischenablage kopiert!";
        } catch (e) {
          feedback.textContent = "Kopieren nicht möglich - Text im Feld bitte manuell markieren.";
        }
        setTimeout(() => { feedback.textContent = ""; }, 3000);
      };
    }

    const bulkImportBtn = document.getElementById("btn-bulk-import-matches");
    if (bulkImportBtn) {
      bulkImportBtn.onclick = async () => {
        const textarea = document.getElementById("bulk-matches-json");
        const err = document.getElementById("bulk-import-error");
        const status = document.getElementById("bulk-import-status");
        err.style.display = "none";
        status.textContent = "";

        let data;
        try {
          data = JSON.parse(textarea.value.trim());
        } catch (e) {
          err.textContent = "Das ist kein gültiges JSON. Bitte das Format genau prüfen (z. B. mit einem Online-JSON-Validator).";
          err.style.display = "block";
          return;
        }
        if (!Array.isArray(data)) {
          err.textContent = 'Das JSON muss eine Liste sein, also in eckigen Klammern: [ {...}, {...} ]';
          err.style.display = "block";
          return;
        }
        if (data.length === 0) {
          err.textContent = "Die Liste ist leer.";
          err.style.display = "block";
          return;
        }
        if (data.length > 100) {
          err.textContent = `Zu viele Einträge (${data.length}) auf einmal - bitte in Blöcken von max. 100 importieren.`;
          err.style.display = "block";
          return;
        }

        bulkImportBtn.disabled = true;
        status.textContent = `Importiere ${data.length} Spiele …`;

        let created = 0, skipped = 0, invalid = 0;
        for (const item of data) {
          const valid = item && typeof item === "object" && item.opponent && item.date && item.time && typeof item.isHome !== "undefined";
          if (!valid) { invalid++; continue; }
          try {
            const res = await api("/matches", {
              method: "POST",
              body: {
                opponent: item.opponent,
                date: item.date,
                time: item.time,
                isHome: !!item.isHome,
                round: item.round || "",
                opponentLogoUrl: item.opponentLogoUrl || "",
                ort: item.ort || "",
                referee: item.referee || "",
                note: item.note || "",
              },
              headers: { "X-Log-Batch": "1" },
            });
            if (res.inserted) created++; else skipped++;
          } catch (e) {
            invalid++;
          }
        }

        if (created > 0) {
          try {
            await api("/log/batch", { method: "POST", body: { kind: "match-import", count: created, skipped, invalid } });
          } catch (e) { /* Protokoll ist nur Zusatz */ }
        }
        status.textContent = `Fertig: ${created} Spiele hinzugefügt${skipped > 0 ? `, ${skipped} bereits vorhanden übersprungen` : ""}${invalid > 0 ? `, ${invalid} Einträge waren unvollständig/ungültig` : ""}.`;
        bulkImportBtn.disabled = false;
        await loadMatches();
        render();
      };
    }

    document.querySelectorAll(".btn-delete-match").forEach((btn) => {
      btn.onclick = async () => {
        const matchId = btn.getAttribute("data-match-id");
        if (!confirm("Dieses Spiel wirklich löschen?")) return;
        try {
          await api(`/matches/${matchId}`, { method: "DELETE" });
          await loadMatches();
          render();
        } catch (e) {
          alert(e.message);
        }
      };
    });

    document.querySelectorAll(".btn-edit-match").forEach((btn) => {
      btn.onclick = () => {
        state.editingMatchId = Number(btn.getAttribute("data-match-id"));
        render();
      };
    });

    document.querySelectorAll(".btn-cancel-edit-match").forEach((btn) => {
      btn.onclick = () => {
        state.editingMatchId = null;
        render();
      };
    });

    document.querySelectorAll(".btn-save-match").forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest("[data-match-edit-id]");
        const id = card.getAttribute("data-match-edit-id");
        const opponent = card.querySelector(".em-opponent").value.trim();
        const isHome = card.querySelector(".em-is-home").value === "1";
        const date = card.querySelector(".em-date").value;
        const time = card.querySelector(".em-time").value;
        const opponentLogoUrl = card.querySelector(".em-logo").value.trim();
        const round = card.querySelector(".em-round").value.trim();
        const referee = card.querySelector(".em-referee").value.trim();
        const ort = card.querySelector(".em-ort").value.trim();
        const note = card.querySelector(".em-note").value.trim();
        const err = card.querySelector(".em-error");
        err.style.display = "none";
        if (!opponent || !date || !time) {
          err.textContent = "Bitte Gegner, Datum und Uhrzeit angeben.";
          err.style.display = "block";
          return;
        }
        try {
          await api(`/matches/${id}`, { method: "PUT", body: { opponent, isHome, date, time, opponentLogoUrl, round, referee, ort, note } });
          state.editingMatchId = null;
          await loadMatches();
          render();
        } catch (e) {
          err.textContent = e.message;
          err.style.display = "block";
        }
      };
    });

    const saveNmBtn = document.getElementById("btn-save-next-match");
    if (saveNmBtn) {
      saveNmBtn.onclick = async () => {
        const opponent = document.getElementById("nm-opponent").value.trim();
        const isHome = document.getElementById("nm-is-home").value === "1";
        const date = document.getElementById("nm-date").value;
        const time = document.getElementById("nm-time").value;
        const opponentLogoUrl = document.getElementById("nm-logo").value.trim();
        const round = document.getElementById("nm-round").value.trim();
        const referee = document.getElementById("nm-referee").value.trim();
        const ort = document.getElementById("nm-ort").value.trim();
        const note = document.getElementById("nm-note").value.trim();
        const err = document.getElementById("nm-error");
        err.textContent = "";
        try {
          await api("/matches", { method: "POST", body: { opponent, isHome, date, time, opponentLogoUrl, round, referee, ort, note } });
          await loadMatches();
          render();
        } catch (e) {
          err.textContent = e.message;
        }
      };
    }

    document.getElementById("btn-create-series").onclick = async () => {
      const weekdayIds = [
        ["series-so", 0], ["series-mo", 1], ["series-di", 2], ["series-mi", 3],
        ["series-do", 4], ["series-fr", 5], ["series-sa", 6],
      ];
      const selectedDays = weekdayIds
        .filter(([id]) => document.getElementById(id).checked)
        .map(([, dayNum]) => dayNum);

      const time = document.getElementById("series-time").value;
      const ort = document.getElementById("series-ort").value.trim();
      const note = document.getElementById("series-note").value.trim();
      const startVal = document.getElementById("series-start").value;
      const endVal = document.getElementById("series-end").value;
      const err = document.getElementById("series-error");
      const status = document.getElementById("series-status");
      err.textContent = "";
      status.textContent = "";

      if (selectedDays.length === 0) { err.textContent = "Bitte mindestens einen Wochentag auswählen."; return; }
      if (!time || !ort || !startVal || !endVal) { err.textContent = "Bitte Uhrzeit, Ort sowie Start- und Enddatum angeben."; return; }
      const start = new Date(`${startVal}T00:00:00`);
      const end = new Date(`${endVal}T00:00:00`);
      if (end < start) { err.textContent = "Das Enddatum darf nicht vor dem Startdatum liegen."; return; }

      const dates = [];
      for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
        if (selectedDays.includes(d.getDay())) dates.push(toISODate(d));
      }
      if (dates.length === 0) { err.textContent = "Im gewählten Zeitraum liegt kein passender Wochentag."; return; }
      if (dates.length > 150) { err.textContent = `Das wären ${dates.length} Termine — bitte den Zeitraum eingrenzen (max. 150 auf einmal).`; return; }

      const btn = document.getElementById("btn-create-series");
      btn.disabled = true;
      status.textContent = `Lege ${dates.length} Termine an …`;

      let created = 0, skipped = 0;
      for (const date of dates) {
        try {
          const res = await api("/trainings", { method: "POST", body: { date, time, ort, note }, headers: { "X-Log-Batch": "1" } });
          if (res.inserted) created++; else skipped++;
        } catch (e) {
          // einzelner Termin fehlgeschlagen - einfach mit den restlichen weitermachen
        }
      }
      if (created > 0) {
        try {
          await api("/log/batch", { method: "POST", body: { kind: "series", count: created, skipped, from: dates[0], to: dates[dates.length - 1], time, ort } });
        } catch (e) { /* Protokoll ist nur Zusatz - ein Fehler hier stoert nicht */ }
      }
      status.textContent = `Fertig: ${created} Trainings angelegt${skipped > 0 ? `, ${skipped} bereits vorhanden übersprungen` : ""}.`;
      btn.disabled = false;
      state.weekStart = startOfWeek(start);
      await loadTrainings();
      render();
    };

    document.getElementById("btn-add-training").onclick = async () => {
      const date = document.getElementById("new-date").value;
      const time = document.getElementById("new-time").value;
      const ort = document.getElementById("new-ort").value.trim();
      const note = document.getElementById("new-note").value.trim();
      const err = document.getElementById("new-error");
      err.textContent = "";
      try {
        await api("/trainings", { method: "POST", body: { date, time, ort, note } });
        if (date) state.weekStart = startOfWeek(new Date(`${date}T00:00:00`));
        await loadTrainings();
        render();
      } catch (e) {
        err.textContent = e.message;
      }
    };

    document.querySelectorAll(".btn-delete-training").forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest("[data-admin-id]");
        const id = card.getAttribute("data-admin-id");
        if (!confirm("Dieses Training wirklich löschen?")) return;
        try {
          await api(`/trainings/${id}`, { method: "DELETE" });
          await loadTrainings();
          render();
        } catch (e) {
          alert(e.message);
        }
      };
    });

    document.querySelectorAll(".btn-edit-training").forEach((btn) => {
      btn.onclick = () => {
        const card = btn.closest("[data-admin-id]");
        state.editingTrainingId = Number(card.getAttribute("data-admin-id"));
        render();
      };
    });

    document.querySelectorAll(".btn-cancel-edit-training").forEach((btn) => {
      btn.onclick = () => {
        state.editingTrainingId = null;
        render();
      };
    });

    document.querySelectorAll(".btn-save-training").forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest("[data-admin-id]");
        const id = card.getAttribute("data-admin-id");
        const date = card.querySelector(".edit-date").value;
        const time = card.querySelector(".edit-time").value;
        const ort = card.querySelector(".edit-ort").value.trim();
        const note = card.querySelector(".edit-note").value.trim();
        const err = card.querySelector(".edit-error");
        err.style.display = "none";
        if (!date || !time || !ort) {
          err.textContent = "Bitte Datum, Uhrzeit und Ort angeben.";
          err.style.display = "block";
          return;
        }
        try {
          await api(`/trainings/${id}`, { method: "PUT", body: { date, time, ort, note } });
          state.editingTrainingId = null;
          delete state.openOverview[id]; // Termin/Ort geaendert - eine offene Uebersicht muss frisch geladen werden
          await loadTrainings();
          render();
        } catch (e) {
          err.textContent = e.message;
          err.style.display = "block";
        }
      };
    });

    document.querySelectorAll(".btn-add-guest").forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest("[data-admin-id]");
        const id = card.getAttribute("data-admin-id");
        const input = card.querySelector(".guest-name-input");
        const err = card.querySelector(".guest-error");
        const name = input.value.trim();
        err.style.display = "none";
        if (!name) {
          err.textContent = "Bitte einen Namen angeben.";
          err.style.display = "block";
          return;
        }
        try {
          await api(`/trainings/${id}/guests`, { method: "POST", body: { name } });
          delete state.openOverview[id]; // neuer Gast - eine offene Uebersicht muss ihn mit anzeigen
          await loadTrainings();
          render();
        } catch (e) {
          err.textContent = e.message;
          err.style.display = "block";
        }
      };
    });

    document.querySelectorAll(".guest-remove").forEach((a) => {
      a.onclick = async (ev) => {
        ev.preventDefault();
        const guestId = a.getAttribute("data-guest-id");
        const card = a.closest("[data-admin-id]");
        const id = card.getAttribute("data-admin-id");
        try {
          await api(`/trainings/${id}/guests/${guestId}`, { method: "DELETE" });
          delete state.openOverview[id]; // Gast entfernt - eine offene Uebersicht darf ihn nicht mehr zeigen
          await loadTrainings();
          render();
        } catch (e) {
          alert(e.message);
        }
      };
    });

    document.querySelectorAll(".admin-rsvp-buttons button").forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest("[data-admin-id]");
        const id = card.getAttribute("data-admin-id");
        const select = card.querySelector(".admin-rsvp-player");
        const reasonBox = card.querySelector(".admin-rsvp-reason-box");
        const errBox = card.querySelector(".admin-rsvp-error");
        const statusEl = card.querySelector(".admin-rsvp-status");
        errBox.style.display = "none";
        statusEl.textContent = "";
        const playerId = select.value;
        if (!playerId) {
          errBox.textContent = "Bitte zuerst einen Spieler auswählen.";
          errBox.style.display = "block";
          return;
        }
        const status = btn.getAttribute("data-status");
        if (status === "zusage") {
          try {
            const result = await api(`/trainings/${id}/rsvp-for/${playerId}`, { method: "POST", body: { status: "zusage", reason: "" } });
            state.adminRsvpFeedback[id] = `Gespeichert: ${select.options[select.selectedIndex].text} → Zusage.`;
            applyAdminRsvpResult(id, playerId, "zusage", "", result);
            render();
          } catch (e) {
            errBox.textContent = e.message;
            errBox.style.display = "block";
          }
          return;
        }
        reasonBox.style.display = "block";
        reasonBox.dataset.pending = status;
        card.querySelector(".admin-rsvp-reason-input").focus();
      };
    });

    document.querySelectorAll(".admin-rsvp-save").forEach((btn) => {
      btn.onclick = async () => {
        const card = btn.closest("[data-admin-id]");
        const id = card.getAttribute("data-admin-id");
        const select = card.querySelector(".admin-rsvp-player");
        const reasonBox = card.querySelector(".admin-rsvp-reason-box");
        const reasonInput = card.querySelector(".admin-rsvp-reason-input");
        const reasonError = card.querySelector(".admin-rsvp-reason-error");
        const errBox = card.querySelector(".admin-rsvp-error");
        const playerId = select.value;
        const pending = reasonBox.dataset.pending;
        const text = reasonInput.value.trim();
        errBox.style.display = "none";
        if (!text) {
          reasonError.style.display = "block";
          return;
        }
        reasonError.style.display = "none";
        try {
          const playerLabel = select.options[select.selectedIndex].text;
          const result = await api(`/trainings/${id}/rsvp-for/${playerId}`, { method: "POST", body: { status: pending, reason: text } });
          state.adminRsvpFeedback[id] = `Gespeichert: ${playerLabel} → ${statusLabel(pending)}.`;
          applyAdminRsvpResult(id, playerId, pending, text, result);
          render();
        } catch (e) {
          errBox.textContent = e.message;
          errBox.style.display = "block";
        }
      };
    });

    document.querySelectorAll(".btn-toggle-admin").forEach((btn) => {
      btn.onclick = async () => {
        const playerId = btn.getAttribute("data-player-id");
        try {
          await api(`/players/${playerId}/admin`, { method: "POST" });
          await loadPlayers();
          render();
        } catch (e) {
          alert(e.message);
        }
      };
    });

    document.querySelectorAll(".btn-delete-player").forEach((btn) => {
      btn.onclick = async () => {
        const playerId = btn.getAttribute("data-player-id");
        const name = btn.getAttribute("data-player-name");
        if (!confirm(`${name} wirklich löschen? Alle bisherigen Zu-/Absagen dieser Person gehen dabei verloren.`)) return;
        try {
          await api(`/players/${playerId}`, { method: "DELETE" });
          await loadPlayers();
          await loadTrainings();
          render();
        } catch (e) {
          alert(e.message);
        }
      };
    });
  }

  // ---------- Info-Popup (statisches UI-Element, unabhaengig vom Login-Status nutzbar) ----------

  function bindInfoOverlay() {
    const overlay = document.getElementById("info-overlay");
    const openBtn = document.getElementById("btn-info");
    const closeBtn = document.getElementById("btn-info-close");
    const desc = document.getElementById("info-club-description");
    if (desc) desc.textContent = `Trainingsanmeldung (Zusage/Vielleicht/Absage), Spielplan und Teilnahme-Statistik für den ${CLUB_NAME}.`;
    if (!overlay || !openBtn || !closeBtn) return;
    openBtn.onclick = () => { overlay.style.display = "flex"; };
    closeBtn.onclick = () => { overlay.style.display = "none"; };
    overlay.onclick = (ev) => { if (ev.target === overlay) overlay.style.display = "none"; };
  }
  bindInfoOverlay();

  // ---------- Start ----------

  (async function init() {
    try {
      await loadMe();
      if (!state.me) await loadPublicInfo();
      if (state.me) {
        await loadTrainings();
        Promise.all([loadMatches(), loadSettings(), loadPushState()]).then(render); // im Hintergrund, blockiert den Rest nicht
      }
    } catch (e) {
      // ignore
    }
    state.loading = false;
    render();
  })();
})();
