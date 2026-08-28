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

## Nächstes Spiel (fan.at-Anbindung)

Diese Funktion ruft die öffentliche Spielplan-Seite von fan.at ab (`next-match.js`) — anders als
ofv.at und ligaportal.at blockiert fan.at automatisierte Zugriffe nicht. Es gibt dafür aber
**keine offizielle Schnittstelle**, das ist technisch gesehen das Auslesen einer für Menschen
gedachten Webseite ("Screen Scraping").

**Das bedeutet konkret:**
- Es funktioniert zuverlässig, solange sich der Seitenaufbau von fan.at nicht ändert.
- Falls es doch mal aufhört zu funktionieren, merkt ihr das höchstens daran, dass das
  "Nächstes Spiel"-Banner verschwindet bzw. in der Verwaltung ein Warnhinweis erscheint — **die
  restliche App (Trainingsanmeldung, Statistik, alles andere) ist davon zu keinem Zeitpunkt
  betroffen.** Das war ausdrücklich so gewünscht und ist bewusst so gebaut (mehrfache
  Absicherung: Zwischenspeicher, mehrere Erkennungsversuche, überall try/catch).
- Als Rückfalloption könnt ihr das nächste Spiel jederzeit unter Verwaltung → "Nächstes Spiel"
  manuell eintragen — das hat automatisch Vorrang vor den fan.at-Daten. Über den Button "Jetzt
  erneut von fan.at versuchen" könnt ihr einen frischen Abrufversuch auslösen, ohne auf ein neues
  Deployment warten zu müssen. Bei einem Fehlschlag zeigt euch die Verwaltung die genaue technische
  Fehlermeldung an (klein, grau) — die hilft bei der Diagnose, falls mal etwas angepasst werden muss.
- Falls eine Reparatur nötig wird: die Datei `next-match.js` enthält die Erkennungslogik
  (`tryParseVisibleText` / `tryParseJsonLd`) mit ausführlichen Kommentaren, wo genau angesetzt
  werden müsste.

**Ehrlicher Hinweis zum Entwicklungsstand:** Diese Erkennungslogik wurde anhand einer Kopie des
sichtbaren Seiteninhalts entwickelt und mit nachgebauten Beispiel-HTML-Strukturen getestet, aber
nicht gegen die tatsächliche, aktuelle Rohdatei von fan.at (dafür bestand in dieser Umgebung kein
Internetzugriff). Es ist gut möglich, dass nach dem ersten Deployment noch eine kleine Anpassung
nötig ist, falls das echte HTML anders aufgebaut ist als angenommen — dank der Fallback-Logik geht
dabei aber nichts an der übrigen App kaputt.

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
- **Nächstes Spiel**: wird automatisch von fan.at abgerufen und oben im Trainingsplan als
  Banner angezeigt (Gegner, Heim/Auswärts, Datum, Uhrzeit), mit kleinem Hinweis "Quelle: fan.at".
  Falls der Abruf mal nicht klappt (Seite nicht erreichbar oder Struktur geändert), bleibt die
  restliche App komplett unbeeinträchtigt — es ist reines Zusatz-Feature. Trainer sehen in der
  Verwaltung den aktuellen Status und können das nächste Spiel jederzeit manuell eintragen
  (hat dann automatisch Vorrang vor den fan.at-Daten, bis wieder gelöscht).
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
