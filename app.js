(function () {
  "use strict";

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
    const data = await api("/stats");
    state.stats = data;
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
      await loadStats(); state.loading = false; render();
    };
    const navAdmin = document.getElementById("nav-admin");
    if (navAdmin) navAdmin.onclick = async () => {
      state.view = "admin"; state.loading = true; render();
      await loadPlayers();
      if (state.matches.length === 0) await loadMatches();
      state.loading = false; render();
    };

    if (state.view === "admin") bindAdmin();
    else if (state.view === "home") bindTrainings();
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
    const homeLabel = m.isHome ? "TSV Utzenaich" : m.opponent;
    const awayLabel = m.isHome ? m.opponent : "TSV Utzenaich";
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

  async function submitRsvp(trainingId, status, reason) {
    const t = state.trainings.find((x) => String(x.id) === String(trainingId));
    if (!t) return;
    const previous = { myStatus: t.myStatus, myReason: t.myReason };

    // Optimistisch sofort anzeigen, statt auf die Serverantwort zu warten - fuehlt sich
    // dadurch unmittelbar an, unabhaengig von der Netzwerk-Latenz.
    t.myStatus = status;
    t.myReason = reason || null;
    render();

    try {
      await api(`/trainings/${trainingId}/rsvp`, { method: "POST", body: { status, reason } });
    } catch (e) {
      // Fehlgeschlagen - alten Stand wiederherstellen
      t.myStatus = previous.myStatus;
      t.myReason = previous.myReason;
      render();
      alert(e.message);
    }
  }

  // ---------- Statistik ----------

  function renderStats() {
    if (!state.stats) return `<div class="card"><p class="muted"><span class="spinner"></span> Lade …</p></div>`;
    if (state.stats.rows.length === 0) {
      return `<div class="card"><p class="empty">Noch keine Spieler registriert.</p></div>`;
    }
    return `
      <div class="card">
        <h2>Trainingsbeteiligung (${state.stats.trainingCount} Trainings gesamt)</h2>
        <table>
          <thead><tr><th>Spieler</th><th>Zusagen</th><th>Quote</th><th>Vielleicht</th><th>Absagen</th><th>Offen</th></tr></thead>
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
      </div>`;
  }

  // ---------- Verwaltung (ausschließlich für Trainer sichtbar) ----------

  function renderAdmin() {
    const visible = trainingsInCurrentWeek();
    const sortedMatches = [...state.matches].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return `
      <div class="card">
        <h2>Spielplan</h2>
        <p class="muted">Das zeitlich nächste Spiel wird automatisch oben im Trainingsplan als Banner angezeigt.</p>
        <label class="switch-row">
          <input type="checkbox" id="toggle-match-banner" ${state.showMatchBanner ? "checked" : ""}>
          Spielvorschau im Trainingsplan anzeigen
        </label>

        ${sortedMatches.length === 0 ? '<p class="empty">Noch keine Spiele eingetragen.</p>' : sortedMatches.map((m) => `
          <div class="list-item">
            <span style="display:flex;align-items:center;gap:8px;">
              ${m.opponentLogoUrl ? `<img src="${escapeHtml(m.opponentLogoUrl)}" alt="" class="match-logo-sm">` : ""}
              <span>${m.round ? `<span class="muted">${escapeHtml(m.round)}:</span> ` : ""}${m.isHome ? `TSV Utzenaich – ${escapeHtml(m.opponent)}` : `${escapeHtml(m.opponent)} – TSV Utzenaich`} <span class="muted">(${fmtDate(m.date)}, ${m.time} Uhr)</span></span>
            </span>
            <button class="small secondary btn-delete-match" data-match-id="${m.id}">Löschen</button>
          </div>`).join("")}

        <div style="margin-top:14px;"><button class="small secondary" id="btn-import-season">📥 Saison-Vorlage importieren (10 Spiele, Runde 4–13)</button></div>
        <div id="import-status" class="muted" style="margin-top:6px;"></div>

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
        <input type="text" id="nm-ort" placeholder="z. B. Sportplatz Utzenaich">
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
        <h2>Trainings verwalten &amp; Gastspieler eintragen</h2>
        ${renderWeekNav()}
        ${state.trainings.length === 0 ? '<p class="empty">Noch keine Trainings.</p>' : visible.length === 0 ? '<p class="empty">Keine Trainings in dieser Woche.</p>' : visible.map((t) => {
          const guests = t.guests || [];
          return `
          <div class="training" data-admin-id="${t.id}">
            <div class="head">
              <div>
                <div class="when">${fmtDate(t.date)} · ${t.time} Uhr</div>
                <div class="where">${escapeHtml(t.ort || "")}</div>
              </div>
              <button class="small secondary btn-delete-training">Löschen</button>
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

    // Fertige Vorlage mit den zehn kommenden Spielen inkl. Vereinslogos, so wie am
    // 01.09.2026 von fan.at abgerufen (spg-utzenaich-antiesenhofen.fan.at/spiele).
    // "INSERT OR IGNORE" auf dem Server verhindert doppelte Eintraege bei mehrfachem Klick.
    const SEASON_IMPORT = [
      { round: "Runde 4", opponent: "Union Raiba Gilgenberg", opponentLogoUrl: "https://fanat-prod.b-cdn.net/images/5a57884e-5a67-4df4-a045-c6fdae84eafd_92x92.png", date: "2026-09-06", time: "16:00", isHome: false },
      { round: "Runde 5", opponent: "Union Sanube Diersbach", opponentLogoUrl: "https://fanat-prod.b-cdn.net/images/ad138021-3906-4ff8-a52e-f50dfe9ce86d_92x92.png", date: "2026-09-12", time: "16:00", isHome: true },
      { round: "Runde 6", opponent: "TSU Jeging", opponentLogoUrl: "https://fanat-prod.b-cdn.net/images/7cdc865f-cbbd-4b6a-9f90-ee4fdd474186_92x92.png", date: "2026-09-20", time: "16:00", isHome: false },
      { round: "Runde 7", opponent: "SV Ritterbräu Neumarkt/Pötting", opponentLogoUrl: "https://fanat-prod.b-cdn.net/images/187801fd-02f2-4e1f-adf0-b424f413e0fc_92x92.png", date: "2026-09-26", time: "15:00", isHome: true },
      { round: "Runde 8", opponent: "SV Hargassner Weng", opponentLogoUrl: "https://fanat-prod.b-cdn.net/images/a6e31660-6c1b-401c-a35a-1e5a01bca3eb_92x92.png", date: "2026-10-02", time: "19:30", isHome: false },
      { round: "Runde 9", opponent: "Union Raiffeisen Gurten 1b", opponentLogoUrl: "https://fanat-prod.b-cdn.net/images/367c6b06-7fce-4e4f-bdd3-e14002a4cc12_92x92.png", date: "2026-10-10", time: "16:00", isHome: false },
      { round: "Runde 10", opponent: "USV Erler Haus Neuhofen", opponentLogoUrl: "https://fanat-prod.b-cdn.net/images/35fbb393-0850-4436-99ce-a0ef59699548_92x92.png", date: "2026-10-17", time: "15:30", isHome: true },
      { round: "Runde 11", opponent: "FC Munderfing", opponentLogoUrl: "https://fanat-prod.b-cdn.net/images/33977940-6dda-4b4e-8c60-6a4453534086_92x92.png", date: "2026-10-24", time: "14:30", isHome: false },
      { round: "Runde 12", opponent: "Union CAB Rainbach im Innkreis", opponentLogoUrl: "https://fanat-prod.b-cdn.net/images/5209198a-e844-4dca-9639-98eb014419ae_92x92.png", date: "2026-10-31", time: "14:30", isHome: true },
      { round: "Runde 13", opponent: "SPG Palting/Seeham", opponentLogoUrl: "https://fanat-prod.b-cdn.net/images/b41c0652-fa10-4d98-bdcf-1ec92d3b6543_92x92.png", date: "2026-11-08", time: "14:00", isHome: false },
    ];

    const importBtn = document.getElementById("btn-import-season");
    if (importBtn) {
      importBtn.onclick = async () => {
        importBtn.disabled = true;
        const status = document.getElementById("import-status");
        let inserted = 0;
        for (const match of SEASON_IMPORT) {
          try {
            const res = await api("/matches", { method: "POST", body: match });
            if (res.inserted) inserted++;
          } catch (e) {
            // einzelnes Spiel fehlgeschlagen - einfach mit den restlichen weitermachen
          }
        }
        status.textContent = `${inserted} von ${SEASON_IMPORT.length} Spielen neu hinzugefügt${inserted < SEASON_IMPORT.length ? " (Rest war schon vorhanden)" : ""}.`;
        importBtn.disabled = false;
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
