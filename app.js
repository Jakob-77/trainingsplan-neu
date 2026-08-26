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
  }

  async function loadPlayers() {
    const data = await api("/players");
    state.players = data.players;
  }

  async function loadStats() {
    const data = await api("/stats");
    state.stats = data;
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
      </div>`;
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
      await loadPlayers(); state.loading = false; render();
    };

    if (state.view === "admin") bindAdmin();
    else if (state.view === "home") bindTrainings();
  }

  // ---------- Trainings & RSVP ----------

  function renderTrainings() {
    if (state.trainings.length === 0) {
      return `<div class="card"><p class="empty">Es sind noch keine Trainings eingetragen.</p></div>`;
    }
    return state.trainings.map((t) => {
      const status = t.myStatus || "offen";
      const overview = state.openOverview[t.id];
      const guestCount = (t.guests || []).length;
      return `
        <div class="card training" data-id="${t.id}">
          <div class="head">
            <div>
              <div class="when">${fmtDate(t.date)} · ${t.time} Uhr</div>
              <div class="where">${escapeHtml(t.ort || "")}</div>
              ${t.note ? `<div class="muted" style="margin-top:4px;">${escapeHtml(t.note)}</div>` : ""}
            </div>
            <span class="pill ${statusClass(status)}">${statusLabel(status)}</span>
          </div>
          ${guestCount > 0 ? `<div class="muted" style="margin-top:8px;">➕ ${guestCount} Gast${guestCount === 1 ? "" : "gäste"}: ${escapeHtml((t.guests || []).map((g) => g.name).join(", "))}</div>` : ""}
          <div class="rsvp-buttons">
            <button data-status="zusage" class="${status === "zusage" ? "active-zusage" : "inactive"}">Zusage</button>
            <button data-status="vielleicht" class="${status === "vielleicht" ? "active-vielleicht" : "inactive"}">Vielleicht</button>
            <button data-status="absage" class="${status === "absage" ? "active-absage" : "inactive"}">Absage</button>
          </div>
          <div class="reason-box" style="display:${status === "vielleicht" || status === "absage" ? "block" : "none"};margin-top:10px;">
            <label>Grund (Pflichtfeld)</label>
            <textarea class="reason-input" placeholder="z. B. beruflich verhindert, verletzt, im Urlaub …">${escapeHtml(t.myReason || "")}</textarea>
            <div class="error reason-error" style="display:none;">Bitte einen Grund angeben.</div>
            <div style="margin-top:8px;"><button class="small save-reason">Speichern</button></div>
          </div>
          <div style="margin-top:12px;">
            <button class="small secondary btn-overview">${overview ? "Übersicht ausblenden" : "Übersicht anzeigen"}</button>
          </div>
          ${overview ? renderOverview(overview) : ""}
        </div>`;
    }).join("");
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
        ${section("zusage", "Zusage", "zusage", false)}
        ${section("vielleicht", "Vielleicht", "vielleicht", true)}
        ${section("absage", "Absage", "absage", true)}
        ${section("offen", "Offen", "offen", false)}
        ${guestSection}
      </div>`;
  }

  function bindTrainings() {
    document.querySelectorAll(".training").forEach((card) => {
      const id = card.getAttribute("data-id");
      const reasonBox = card.querySelector(".reason-box");
      const reasonInput = card.querySelector(".reason-input");
      const reasonError = card.querySelector(".reason-error");
      const t = state.trainings.find((x) => String(x.id) === id);

      card.querySelectorAll(".rsvp-buttons button").forEach((btn) => {
        btn.onclick = async () => {
          const status = btn.getAttribute("data-status");
          if (status === "zusage") {
            await submitRsvp(id, "zusage", "");
            return;
          }
          reasonBox.style.display = "block";
          reasonBox.dataset.pending = status;
          reasonInput.focus();
        };
      });

      card.querySelector(".save-reason").onclick = async () => {
        const pending = reasonBox.dataset.pending || t.myStatus;
        const status = pending === "vielleicht" || pending === "absage" ? pending : "vielleicht";
        const text = reasonInput.value.trim();
        if (!text) { reasonError.style.display = "block"; return; }
        reasonError.style.display = "none";
        await submitRsvp(id, status, text);
      };

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
    try {
      await api(`/trainings/${trainingId}/rsvp`, { method: "POST", body: { status, reason } });
      await loadTrainings();
      render();
    } catch (e) {
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
          <thead><tr><th>Spieler</th><th>Zusagen</th><th>Vielleicht</th><th>Absagen</th><th>Offen</th></tr></thead>
          <tbody>
            ${state.stats.rows.map((r) => `<tr>
              <td>${escapeHtml(r.name)}</td>
              <td>${r.zusagen}</td>
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
    return `
      <div class="card">
        <h2>Neues Training anlegen</h2>
        <div class="row">
          <div><label>Datum</label><input type="date" id="new-date"></div>
          <div><label>Uhrzeit</label><input type="time" id="new-time" value="18:30"></div>
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
        ${state.trainings.length === 0 ? '<p class="empty">Noch keine Trainings.</p>' : state.trainings.map((t) => {
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
        <h2>Spieler (${state.players.length})</h2>
        ${state.players.map((p) => `
          <div class="list-item">
            <span>${escapeHtml(p.name)} <span class="muted">${escapeHtml(p.email)}</span> ${p.isAdmin ? '<span class="badge-admin">Trainer</span>' : ""}</span>
            <button class="small secondary btn-toggle-admin" data-player-id="${p.id}">${p.isAdmin ? "Trainer entfernen" : "Zu Trainer machen"}</button>
          </div>`).join("")}
      </div>`;
  }

  function bindAdmin() {
    document.getElementById("btn-add-training").onclick = async () => {
      const date = document.getElementById("new-date").value;
      const time = document.getElementById("new-time").value;
      const ort = document.getElementById("new-ort").value.trim();
      const note = document.getElementById("new-note").value.trim();
      const err = document.getElementById("new-error");
      err.textContent = "";
      try {
        await api("/trainings", { method: "POST", body: { date, time, ort, note } });
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
  }

  // ---------- Start ----------

  (async function init() {
    try {
      await loadMe();
      if (state.me) await loadTrainings();
    } catch (e) {
      // ignore
    }
    state.loading = false;
    render();
  })();
})();
