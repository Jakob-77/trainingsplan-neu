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
    showMatchBanner: true, // vom Server geladene Einstellung - Trainer koennen die Spielvorschau ausblenden
    playersListOpen: false, // Spielerliste in der Verwaltung ist bei vielen Spielern lang - eingeklappt starten
    playersFilter: "",
    editingTrainingId: null, // welches Training gerade in der Verwaltung bearbeitet wird
    editingMatchId: null, // welches Spiel gerade in der Verwaltung bearbeitet wird
    seasons: [],
    currentSeasonId: null, // von Server ermittelt: welche Saison "heute" gerade laeuft
    statsSeasonId: "current", // "current" | "all" | <id> - was in der Statistik ausgewaehlt ist
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

  async function api(path, opts) {
    const res = await fetch("/api" + path, {
      method: (opts && opts.method) || "GET",
      headers: { "Content-Type": "application/json" },
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
      await api("/logout", { method: "POST" });
      state.me = null;
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
      const err = document.getElementById("reg-error");
      err.textContent = "";
      try {
        const data = await api("/register", { method: "POST", body: { name, email, password } });
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
    Promise.all([loadMatches(), loadSettings()]).then(render); // im Hintergrund, blockiert den Rest nicht
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
    document.getElementById("nav-home").onclick = () => { state.view = "home"; render(); };
    document.getElementById("nav-stats").onclick = async () => {
      state.view = "stats"; state.loading = true; render();
      if (state.seasons.length === 0) await loadSeasons();
      await loadStats(); state.loading = false; render();
    };
    const navAdmin = document.getElementById("nav-admin");
    if (navAdmin) navAdmin.onclick = async () => {
      state.view = "admin"; state.loading = true; render();
      await loadPlayers();
      if (state.matches.length === 0) await loadMatches();
      if (state.seasons.length === 0) await loadSeasons();
      state.loading = false; render();
    };

    if (state.view === "admin") bindAdmin();
    else if (state.view === "home") bindTrainings();
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
      state.weekStart = addDays(state.weekStart, -7);
      afterChange();
    };
    document.getElementById("week-next").onclick = () => {
      state.weekStart = addDays(state.weekStart, 7);
      afterChange();
    };
    document.getElementById("week-today").onclick = () => {
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

    return renderNextTrainingBanner() + renderNextMatchBanner() + renderWeekNav() + list;
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
            <button data-status="zusage" class="${status === "zusage" ? "active-zusage" : "inactive"}">Zusage</button>
            <button data-status="vielleicht" class="${status === "vielleicht" ? "active-vielleicht" : "inactive"}">Vielleicht</button>
            <button data-status="absage" class="${status === "absage" ? "active-absage" : "inactive"}">Absage</button>
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
    const section = (key, label, cls, showReason) => {
      const items = data.groups[key];
      return `
        <div style="margin-top:10px;">
          <div><span class="pill ${cls}">${label}</span> <b>${items.length}</b></div>
          ${items.length === 0 ? "" : `<ul style="margin:6px 0 0;padding-left:18px;font-size:13.5px;">
            ${items.map((p) => `<li>${escapeHtml(p.name)}${showReason && p.reason ? ` — <span class="muted">${escapeHtml(p.reason)}</span>` : ""}</li>`).join("")}
          </ul>`}
        </div>`;
    };
    const guestSection = data.guests && data.guests.length > 0 ? `
        <div style="margin-top:10px;">
          <div><span class="pill zusage">Gäste</span> <b>${data.guests.length}</b></div>
          <ul style="margin:6px 0 0;padding-left:18px;font-size:13.5px;">
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
              if (t.myStatus === "zusage") return; // schon zugesagt, nichts zu tun
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
    render();

    try {
      await api(`/trainings/${trainingId}/rsvp`, { method: "POST", body: { status, reason } });
    } catch (e) {
      // Fehlgeschlagen - alten Stand wiederherstellen (inkl. Zaehler)
      t.myStatus = previous.myStatus;
      t.myReason = previous.myReason;
      t.zusageCount = previous.zusageCount;
      t.vielleichtCount = previous.vielleichtCount;
      t.absageCount = previous.absageCount;
      render();
      alert(e.message);
    }
  }

  // ---------- Statistik ----------

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
    return seasonPicker + `
      <div class="card">
        <h2>Trainingsbeteiligung — ${seasonLabel}</h2>
        <p class="muted" style="margin-top:-8px;">${state.stats.trainingCount} Trainings gesamt, davon ${state.stats.pastTrainingCount} bereits stattgefunden.</p>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Spieler</th><th>Zusagen</th><th>Quote*</th><th>Vielleicht</th><th>Absagen</th><th>Offen</th></tr></thead>
            <tbody>
              ${state.stats.rows.map((r) => `<tr>
                <td>${escapeHtml(r.name)}</td>
                <td>${r.zusagen}</td>
                <td>${r.quote}%</td>
                <td>${r.vielleicht}</td>
                <td>${r.absagen}</td>
                <td>${r.offen}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:8px;font-size:11.5px;">*Quote = Zusagen bezogen auf die bisher bereits stattgefundenen Trainings dieser Saison (zukünftige, noch offene Trainings zählen nicht mit).</p>
      </div>`;
  }

  function bindStats() {
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
      <div class="card">
        <h2>Saison</h2>
        <p class="muted">Trainings/Spiele werden automatisch anhand ihres Datums der passenden Saison zugerechnet. Die Statistik startet dadurch mit jeder neuen Saison von selbst wieder bei null.</p>
        ${currentSeason
          ? `<p>Aktuell läuft: <b>${escapeHtml(currentSeason.name)}</b> (${fmtDate(currentSeason.startDate)} – ${fmtDate(currentSeason.endDate)})</p>`
          : `<p class="muted">Gerade ist keine Saison als "aktuell" hinterlegt (z. B. zwischen zwei Saisonen). Statistik zeigt in dem Fall automatisch alle Trainings.</p>`}
        ${otherSeasons.length > 0 ? `
          <details style="margin:8px 0;">
            <summary class="muted" style="cursor:pointer;">${otherSeasons.length} weitere Saison${otherSeasons.length === 1 ? "" : "en"} anzeigen</summary>
            ${otherSeasons.map((s) => `
              <div class="list-item">
                <span>${escapeHtml(s.name)} <span class="muted">(${fmtDate(s.startDate)} – ${fmtDate(s.endDate)})</span></span>
                <button class="small secondary btn-delete-season" data-season-id="${s.id}">Löschen</button>
              </div>`).join("")}
          </details>` : ""}
        <label style="margin-top:10px;">Neue Saison anlegen</label>
        <input type="text" id="season-name" placeholder="z. B. Herbstsaison 2026" value="${escapeHtml(suggestSeasonName())}">
        <div class="row">
          <div><label>Von</label><input type="date" id="season-start" value="${suggestSeasonRange().start}"></div>
          <div><label>Bis</label><input type="date" id="season-end" value="${suggestSeasonRange().end}"></div>
        </div>
        <div id="season-error" class="error"></div>
        <div style="margin-top:10px;"><button class="small" id="btn-add-season">Saison anlegen</button></div>
      </div>

      <div class="card">
        <div class="top-bar">
          <h2 style="margin:0;">Spielplan (${upcomingMatches.length} bevorstehend)</h2>
          <button class="small secondary" id="btn-toggle-matches-list">${state.matchesListOpen ? "Ausblenden" : "Anzeigen"}</button>
        </div>
        <p class="muted">Das zeitlich nächste Spiel wird automatisch oben im Trainingsplan als Banner angezeigt.</p>
        <label class="switch-row">
          <input type="checkbox" id="toggle-match-banner" ${state.showMatchBanner ? "checked" : ""}>
          Spielvorschau im Trainingsplan anzeigen
        </label>

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
            <div class="admin-rsvp-status muted" style="margin-top:4px;font-size:12px;"></div>
            `}
          </div>`;
        }).join("")}
      </div>

      <div class="card">
        <div class="top-bar">
          <h2 style="margin:0;">Spieler (${state.players.length})</h2>
          <button class="small secondary" id="btn-toggle-players">${state.playersListOpen ? "Ausblenden" : "Anzeigen"}</button>
        </div>
        ${state.playersListOpen ? `
          <p class="muted">Passwort vergessen? Spieler hier löschen — er/sie kann sich danach mit derselben oder einer neuen E-Mail neu registrieren.</p>
          <input type="text" id="players-filter" placeholder="Spieler suchen …" value="${escapeHtml(state.playersFilter || "")}" style="margin-bottom:10px;">
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
        ` : ""}
      </div>`;
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
            });
            if (res.inserted) created++; else skipped++;
          } catch (e) {
            invalid++;
          }
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
          const res = await api("/trainings", { method: "POST", body: { date, time, ort, note } });
          if (res.inserted) created++; else skipped++;
        } catch (e) {
          // einzelner Termin fehlgeschlagen - einfach mit den restlichen weitermachen
        }
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
            await api(`/trainings/${id}/rsvp-for/${playerId}`, { method: "POST", body: { status: "zusage", reason: "" } });
            statusEl.textContent = `Gespeichert: ${select.options[select.selectedIndex].text} → Zusage.`;
            select.value = "";
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
        const statusEl = card.querySelector(".admin-rsvp-status");
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
          await api(`/trainings/${id}/rsvp-for/${playerId}`, { method: "POST", body: { status: pending, reason: text } });
          statusEl.textContent = `Gespeichert: ${select.options[select.selectedIndex].text} → ${statusLabel(pending)}.`;
          reasonBox.style.display = "none";
          reasonInput.value = "";
          select.value = "";
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
      if (state.me) {
        await loadTrainings();
        Promise.all([loadMatches(), loadSettings()]).then(render); // im Hintergrund, blockiert den Rest nicht
      }
    } catch (e) {
      // ignore
    }
    state.loading = false;
    render();
  })();
})();
