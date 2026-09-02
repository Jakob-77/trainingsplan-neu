# Trainingsplaner (Vercel + Turso Version)

Web-App für den Verein: Trainingsanmeldung (Zusage / Vielleicht / Absage mit Pflicht-Begründung),
Übersicht pro Training und Teilnahme-Statistik. Als PWA installierbar (Icon am Handy-Startbildschirm).

**Was sich gegenüber der Render-Version geändert hat:**
- Läuft jetzt auf **Vercel** (kostenlos, kein Einschlafen, kein Kreditkarten-Risiko) statt Render.
- Die Datenbank läuft bei **Turso** (SQLite-kompatibel, aber übers Netz erreichbar — nötig, weil
  Vercel keinen dauerhaften Server-Prozess mit lokaler Festplatte kennt, sondern Code nur kurz bei
  Bedarf ausführt).
- Der Login läuft über ein signiertes Cookie statt einer Sitzungs-Datenbanktabelle — technisch
  einfacher und passt besser zu dieser Umgebung. Login hält weiterhin 180 Tage und verlängert sich
  bei jedem Besuch.
- **Balldienst wurde entfernt** — trägt die Info einfach ins "Hinweis"-Feld beim jeweiligen
  Training ein (z. B. "Balldienst: Max & Julia").
- **Gastspieler sind jetzt pro Training**, nicht mehr dauerhaft in der Spielerliste: Trainer tragen
  im Verwaltungsbereich bei jedem einzelnen Training direkt einen oder mehrere Gastspieler-Namen
  ein (reine Zusage, kein Login, kein Vielleicht/Absage nötig) und können sie dort auch wieder
  löschen.
- Die Verwaltung (Trainings anlegen/löschen, Gastspieler, Trainer ernennen) ist strikt auf Trainer
  beschränkt — sowohl im sichtbaren Menü als auch serverseitig bei jedem einzelnen Vorgang
  geprüft. Normale Spieler bekommen den Bereich gar nicht angezeigt und können die zugehörigen
  Aktionen auch nicht direkt aufrufen.

## Schritt 1: Turso-Datenbank anlegen

1. Auf https://turso.tech kostenlos registrieren (der Gratis-Tarif reicht für einen Verein locker aus).
2. Die Turso-Kommandozeile installieren (Anleitung auf der Turso-Webseite, je nach Betriebssystem
   unterschiedlich) und einloggen.
3. Neue Datenbank anlegen:
   ```
   turso db create trainingsplaner
   ```
4. Verbindungsdaten holen:
   ```
   turso db show trainingsplaner --url
   turso db tokens create trainingsplaner
   ```
   Beide Werte notieren — die braucht ihr gleich bei Vercel.

**Falls ihr schon Daten aus der alten Render-Version habt** und die behalten wollt: die Datei
`data.sqlite` von eurem Render-Dienst herunterladen, dann statt Schritt 3:
```
turso db create trainingsplaner --from-file data.sqlite
```
Das übernimmt Spieler, Trainings und Rückmeldungen 1:1. Alte, nicht mehr genutzte Spalten/Tabellen
(z. B. der frühere Balldienst) stören dabei nicht, sie werden einfach ignoriert.

## Schritt 2: Bei Vercel deployen

1. Projekt auf GitHub hochladen (wie beim letzten Mal: neues Repository anlegen, alle Dateien
   aus diesem Paket per Drag & Drop hochladen).
2. Auf https://vercel.com mit dem GitHub-Konto anmelden.
3. "Add New" → "Project" → euer Repository auswählen → "Import".
4. Bei "Environment Variables" drei Werte eintragen:
   - `TURSO_DATABASE_URL` → der Wert von `turso db show ... --url` (beginnt mit `libsql://`)
   - `TURSO_AUTH_TOKEN` → der Wert von `turso db tokens create ...`
   - `SESSION_SECRET` → ein beliebiger langer Zufallstext (z. B. 40 zufällige Zeichen eintippen)
5. Auf "Deploy" klicken. Nach ein bis zwei Minuten bekommt ihr eine Adresse wie
   `https://trainingsplaner.vercel.app` — das ist euer dauerhafter Link.
6. Am Handy öffnen und über das Browser-Menü "Zum Startbildschirm hinzufügen" bzw.
   "App installieren" auswählen.

Das war's — kein Einschlafen, keine Persistent Disk nötig, keine laufenden Kosten.

## Änderungen später vornehmen

Gleicher Ablauf wie gewohnt: Datei auf GitHub bearbeiten → "Commit changes" → Vercel deployt
automatisch neu (dauert meist unter einer Minute).

## Lokal testen (optional)

Voraussetzung: Node.js (Version 18+).

```
npm install
```

Eine Datei `.env` im Projektordner anlegen mit euren Turso-Zugangsdaten:
```
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
SESSION_SECRET=irgendein-langer-zufallstext
```

Dann:
```
npm start
```

Danach im Browser: http://localhost:3000

## Projektstruktur

```
index.html, style.css, app.js       Frontend (wird von Vercel automatisch als statische Dateien ausgeliefert)
manifest.json, sw.js                 PWA-Funktionalität (installierbar)
icons/                                App-Icons mit eurem Vereinswappen
api/index.js                          Die komplette Backend-Logik als eine Vercel-Funktion
db.js                                 Datenbankzugriff (Turso)
auth.js                               Login über signiertes Cookie
dev-server.js                         Nur für lokale Tests, auf Vercel nicht verwendet
vercel.json                           Sorgt dafür, dass alle /api/... Aufrufe zur Funktion finden
```

## Spielplan

Ein automatischer Abruf von der öffentlichen Spielplan-Seite fan.at wurde ausprobiert. Anders als
ofv.at und ligaportal.at (die automatisierte Zugriffe aktiv blockieren) lässt fan.at den Abruf
zwar zu, baut seine Inhalte aber erst per JavaScript im Browser zusammen — ein normaler
Server-Abruf (wie ihn diese App macht) bekommt deshalb nur eine leere Seiten-Hülle ohne die
eigentlichen Spieldaten zu sehen. Das ist keine Kleinigkeit, die sich mit einer Regel-Anpassung
beheben ließe, sondern eine grundsätzliche technische Grenze — eine echte Lösung bräuchte einen
"Browser im Hintergrund" (z. B. Puppeteer/Chromium), was für dieses Zusatz-Feature unverhältnismäßig
aufwendig und störanfällig wäre.

Deshalb bewusst einfach gehalten: **Trainer pflegen den Spielplan unter Verwaltung → "Spielplan"**
(Gegner, Heim/Auswärts, Datum, Uhrzeit, optional Gegner-Logo als Bild-URL, Runde, Schiedsrichter,
Ort, Hinweis). Das zeitlich nächste eingetragene Spiel erscheint automatisch oben im Trainingsplan
als Banner mit beiden Vereinslogos und Countdown.

**Schnellstart:** Der Button "Saison-Vorlage importieren" trägt auf einen Klick die zehn zum
Zeitpunkt der Entwicklung (01.09.2026) bekannten kommenden Spiele (Runde 4–13) samt der offiziellen
Vereinslogos von fan.at ein — spart beim ersten Einrichten das einzelne Abtippen. Mehrfaches
Klicken erzeugt keine doppelten Einträge. Danach einfach über das Formular ergänzen, sobald neue
Runden feststehen. Schiedsrichter werden auf fan.at erst nach dem Spiel im Nachhinein bekannt
gegeben — das Feld ist deshalb bei zukünftigen Spielen meist leer, kann aber jederzeit von Hand
nachgetragen werden, sobald ihr es selbst wisst.

Falls ihr das doch noch automatisieren wollt, wäre der zuverlässige Weg das offizielle
"Vereins-Widget" des Oberösterreichischen Fußballverbands (fussballoesterreich.at, Bereich
Verein → Vereins-Widgets → "Spielplan pro Mannschaft") — das ist speziell zum Einbetten gedacht
und dafür nicht durch Bot-Schutz blockiert.

## Funktionsübersicht

- Registrierung mit Name, E-Mail und Passwort. Der erste Account wird automatisch Trainer.
- Login bleibt 180 Tage bestehen und verlängert sich bei jedem Besuch automatisch.
- Trainer legen Trainings an (Datum, Uhrzeit — Standard 19:00 Uhr —, Ort, optionaler Hinweis)
  und löschen sie bei Bedarf.
- Spieler wählen pro Training Zusage, Vielleicht oder Absage — bei Vielleicht/Absage ist ein
  Grund Pflicht, das Eingabefeld schließt sich danach automatisch wieder. Bei Zusage kann
  optional eine kurze Notiz hinterlegt werden (z. B. "komme 10 Minuten später") — jederzeit
  über "Notiz bearbeiten" änderbar. **Die Abstimmung schließt automatisch 1 Stunde vor
  Trainingsbeginn** (serverseitig abgesichert, nicht nur im Frontend).
- **Spielplan**: Trainer pflegen ihn in der Verwaltung (Gegner inkl. optionalem Logo, Heim/Auswärts,
  Datum, Uhrzeit, Runde, Schiedsrichter, Ort, Hinweis) — auf Knopfdruck mit einer vorbereiteten
  Saison-Vorlage (10 Spiele) befüllbar. Das nächste Spiel erscheint automatisch oben im
  Trainingsplan als Banner mit beiden Vereinslogos und Countdown, lässt sich über einen Schalter
  in der Verwaltung bei Bedarf auch ganz ausblenden. (Ein automatischer Abruf von fan.at wurde
  ausprobiert, ist aber technisch nicht zuverlässig möglich — siehe eigener Abschnitt oben.)
- Zu-/Vielleicht-/Absagen werden sofort im Bild angezeigt (optimistisches UI-Update), ohne auf
  die Serverantwort warten zu müssen. Bei einem seltenen Netzwerkfehler wird der vorherige Stand
  automatisch wiederhergestellt.
- Die Spielerliste in der Verwaltung ist eingeklappt und lässt sich mit einem Klick aufklappen —
  inklusive Suchfeld, damit das auch bei 50+ Spielern übersichtlich bleibt.
- Das **nächste bevorstehende Training wird oben als Banner mit Live-Countdown angezeigt** und in
  der Liste optisch hervorgehoben.
- **Wochenweise Navigation** (◀ / ▶ / "Aktuelle Woche") sowohl bei den Trainings als auch in der
  Verwaltung — damit die Liste auch bei 50+ Trainings pro Saison übersichtlich bleibt.
- Button "Übersicht anzeigen" bei jedem Training zeigt genau, wie viele Spieler zu-, vielleicht-
  oder abgesagt haben (mit Namen und bei Vielleicht/Absage dem angegebenen Grund) sowie zugesagte
  Gastspieler.
- Trainer tragen direkt bei einem Training Gastspieler ein (reine Zusage, kein Login) und können
  sie dort auch wieder entfernen.
- Statistik-Ansicht zeigt pro (registriertem) Spieler die Anzahl Zusagen/Vielleicht/Absagen/Offen
  sowie die Zusage-Quote in Prozent über alle Trainings.
- Trainer können weitere Spieler zu Trainern machen/die Rolle entziehen, und **Spieler auch
  komplett löschen** — z. B. bei einem vergessenen Passwort (der Spieler kann sich danach mit
  derselben oder einer neuen E-Mail neu registrieren) oder wenn jemand den Verein verlässt. Ein
  Trainer kann sich dabei nicht selbst löschen (Schutz vor versehentlichem Aussperren).
- Verwaltung ist ausschließlich für Trainer sichtbar und nutzbar — sowohl im Menü als auch
  serverseitig abgesichert.
- Als App installierbar (PWA), inkl. eurem Vereinswappen als App-Icon. Kleiner Hinweis
  "powered by Jakob Danecker" im Header.

## Hinweis zum Test in dieser Umgebung

Der Code wurde auf Syntaxfehler geprüft (`node --check` für jede Datei, JSON-Dateien validiert).
Ein vollständiger Live-Test mit `npm install` gegen eine echte Turso-Datenbank war in dieser
Umgebung nicht möglich, da hier kein Internetzugriff besteht. Macht nach dem ersten Deployment
einen kurzen Durchklick-Test: Registrieren → Training anlegen → Zusage/Absage mit Grund →
Übersicht ansehen → Gastspieler hinzufügen/löschen → Statistik ansehen.
