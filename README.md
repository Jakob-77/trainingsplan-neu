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

## Für einen anderen Verein oder eine andere Mannschaft nutzen

Der Code ist bewusst so gebaut, dass er sich leicht für einen komplett anderen Verein oder eine
eigenständige Mannschaft (z. B. eine Jugendmannschaft mit eigenem Login, unabhängig von der
Kampfmannschaft) wiederverwenden lässt — als **eigene, unabhängige Installation** (eigenes
GitHub-Repository, eigenes Vercel-Projekt, eigene Turso-Datenbank; die Schritte dafür stehen
weiter oben). Kostenmäßig ändert das nichts, jede Installation läuft für sich im kostenlosen
Rahmen.

Nur zwei Dinge müssen dafür angepasst werden:

1. **Vereinsname**: ganz oben in `app.js` steht `const CLUB_NAME = "TSV Utzenaich";` — das ist
   die einzige Stelle im gesamten Code, die den Vereinsnamen enthält (wird automatisch überall
   verwendet: Spiel-Banner, Verwaltung, Info-Popup). Einfach den Namen in dieser einen Zeile
   ändern, fertig.
2. **Vereinslogo**: die fünf Bild-Dateien im Ordner `icons/` durch das neue Logo ersetzen
   (gleicher Dateiname, gleiche Bildgröße beibehalten):

   | Datei | Größe | Wofür |
   |---|---|---|
   | `club-logo.png` | ca. 160×160 px | Logo oben im Header |
   | `icon-192.png` | 192×192 px | App-Icon (klein) |
   | `icon-512.png` | 512×512 px | App-Icon (groß) |
   | `icon-maskable-512.png` | 512×512 px | App-Icon Android (Motiv mittig, Rand kann abgeschnitten werden) |
   | `apple-touch-icon.png` | 180×180 px | App-Icon iPhone/iPad |

Alles andere (Trainingsanmeldung, Spielplan, Statistik, Saisonen, Verwaltung) funktioniert
identisch, unabhängig vom Verein.

## Saisonen (Statistik-Reset & Übersichtlichkeit über Jahre hinweg)

Damit die App auch nach Jahren mit vielen Trainings/Spielen übersichtlich bleibt und die
Statistik nicht ewig weiterzählt, gibt es ein Saison-Konzept:

- Trainer legen in der Verwaltung Saisonen an (Name + Zeitraum, z. B. "Herbstsaison 2026",
  01.08.–15.12.2026). Beim Anlegen wird automatisch ein plausibler Name/Zeitraum vorgeschlagen
  (Jän–Jun → Frühjahrssaison, Jul–Dez → Herbstsaison), lässt sich aber frei anpassen.
- Trainings und Spiele werden **automatisch anhand ihres Datums** der passenden Saison
  zugerechnet — es gibt kein extra Feld dafür, das befüllt werden müsste, und es musste keine
  bestehende Datenbank migriert werden.
- Die **Statistik zeigt standardmäßig nur die aktuell laufende Saison** (per Dropdown auch
  gezielt eine andere Saison oder "alle Saisonen gesamt" wählbar). Mit jeder neuen Saison
  "startet" die Quote dadurch von selbst wieder bei null.
- Der **Spielplan in der Verwaltung zeigt standardmäßig nur bevorstehende Spiele** (vergangene
  lassen sich über einen Button bei Bedarf einblenden) — wächst dadurch nicht endlos.
- Die **Trainings-Verwaltung ist ohnehin schon wochenweise navigierbar** (siehe weiter oben) und
  springt bei jedem Öffnen automatisch zur Woche des nächsten Trainings — alte Wochen bleiben
  über "◀ Vorherige Woche" erreichbar, drängen sich aber nie in die Standardansicht.
- Eine Saison löschen entfernt nur die Saison-Definition selbst, keine Trainings/Spiele — die
  bleiben in der Datenbank erhalten, zählen danach nur zu keiner Saison mehr.

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

**Neue Saison eintragen — Massen-Import per JSON:** Unter Verwaltung → Spielplan → "Mehrere Spiele
auf einmal importieren" gibt es ein Textfeld für ein JSON-Format, mit dem sich ein ganzer Spielplan
auf einen Schlag einfügen lässt — unabhängig von der Saison, kein Code-Update nötig. Praktisch:
genau dieses Format kann eine KI (z. B. Claude) für euch erzeugen — einfach den neuen Spielplan
nennen (z. B. Link zu fan.at oder die Liste der Spiele) und um eine Ausgabe "in diesem exakten
JSON-Format" bitten:

```json
[
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
]
```

Pflichtfelder: `opponent`, `date` (JJJJ-MM-TT), `time` (SS:MM, 24h), `isHome` (`true` = Heimspiel
für TSV Utzenaich, `false` = Auswärtsspiel). Alle anderen Felder sind optional und können auch
ganz weggelassen werden. Mehrfaches Importieren derselben Liste erzeugt keine doppelten Einträge
(Duplikat-Schutz über Gegner+Datum+Uhrzeit). Schiedsrichter werden auf fan.at erst nach dem Spiel
im Nachhinein bekannt gegeben — das Feld bleibt bei zukünftigen Spielen deshalb meist leer.

Falls ihr das doch noch automatisieren wollt, wäre der zuverlässige Weg das offizielle
"Vereins-Widget" des Oberösterreichischen Fußballverbands (fussballoesterreich.at, Bereich
Verein → Vereins-Widgets → "Spielplan pro Mannschaft") — das ist speziell zum Einbetten gedacht
und dafür nicht durch Bot-Schutz blockiert.

## Funktionsübersicht

- Registrierung mit Name, E-Mail und Passwort. Der erste Account wird automatisch Trainer.
- Login bleibt 180 Tage bestehen und verlängert sich bei jedem Besuch automatisch.
- Trainer legen Trainings an (Datum, Uhrzeit — Standard 19:00 Uhr —, Ort, optionaler Hinweis),
  können sie **jederzeit nachträglich bearbeiten** (z. B. Datum verschieben, Hinweis ergänzen)
  und bei Bedarf löschen. **Serientermine**: Wochentage auswählen (Standard: Montag, Dienstag,
  Donnerstag), Uhrzeit/Ort/Hinweis sowie Start- und Enddatum angeben — legt für den ganzen
  Zeitraum automatisch alle passenden Trainings an (z. B. eine ganze Saison auf einen Schlag,
  maximal 150 auf einmal). Bereits vorhandene Termine am selben Datum/Uhrzeit werden dabei
  übersprungen statt doppelt angelegt.
- Spieler wählen pro Training Zusage, Vielleicht oder Absage — bei Vielleicht/Absage ist ein
  Grund Pflicht, das Eingabefeld schließt sich danach automatisch wieder. Bei Zusage kann
  optional eine kurze Notiz hinterlegt werden (z. B. "komme 10 Minuten später") — jederzeit
  über "Notiz bearbeiten" änderbar. **Die Abstimmung schließt automatisch 1 Stunde vor
  Trainingsbeginn** (serverseitig abgesichert, nicht nur im Frontend).
- **Spielplan**: Trainer pflegen ihn in der Verwaltung (Gegner inkl. optionalem Logo, Heim/Auswärts,
  Datum, Uhrzeit, Runde, Schiedsrichter, Ort, Hinweis), einzeln oder per JSON-Massen-Import für
  eine ganze Saison auf einmal (Format siehe eigener Abschnitt oben — wiederverwendbar für jede
  künftige Saison, kein Code-Update nötig), jeder Eintrag jederzeit bearbeitbar oder löschbar. Das
  nächste Spiel erscheint automatisch oben im Trainingsplan als Banner mit beiden Vereinslogos
  und Countdown, lässt sich über einen Schalter in der Verwaltung bei Bedarf auch ganz
  ausblenden. (Ein automatischer Abruf von fan.at wurde ausprobiert, ist aber technisch nicht
  zuverlässig möglich — siehe eigener Abschnitt oben.)
- Zu-/Vielleicht-/Absagen werden sofort im Bild angezeigt (optimistisches UI-Update), ohne auf
  die Serverantwort warten zu müssen. Bei einem seltenen Netzwerkfehler wird der vorherige Stand
  automatisch wiederhergestellt.
- Die Spielerliste in der Verwaltung ist eingeklappt und lässt sich mit einem Klick aufklappen —
  inklusive Suchfeld, damit das auch bei 50+ Spielern übersichtlich bleibt.
- Das **nächste bevorstehende Training wird oben als Banner mit Live-Countdown angezeigt** und in
  der Liste optisch hervorgehoben.
- **Wochenweise Navigation** (◀ / ▶ / "Aktuelle Woche") sowohl bei den Trainings als auch in der
  Verwaltung — damit die Liste auch bei 50+ Trainings pro Saison übersichtlich bleibt.
- **Schnellansicht** (👍 ❓ 👎) direkt bei jedem Training zeigt auf einen Blick, wie viele Spieler
  aktuell zu-, vielleicht- oder abgesagt haben — aktualisiert sich bei der eigenen Abstimmung
  sofort, ohne Wartezeit. Bleibt auch korrekt synchron, wenn ein Trainer über die Verwaltung eine
  Rückmeldung für einen anderen Spieler einträgt (die Zähler kommen dabei direkt mit der
  Server-Antwort zurück, kein zusätzlicher, verlangsamender Request nötig). Für Namen und die
  angegebenen Gründe gibt es weiterhin den Button "Übersicht anzeigen" bei jedem Training, der
  genau zeigt, wie viele Spieler zu-, vielleicht- oder abgesagt haben (mit Namen und bei
  Vielleicht/Absage dem angegebenen Grund) sowie zugesagte Gastspieler.
- Trainer tragen direkt bei einem Training Gastspieler ein (reine Zusage, kein Login) und können
  sie dort auch wieder entfernen.
- **Trainer können außerdem für jeden registrierten Spieler die Rückmeldung (Zusage/Vielleicht/
  Absage) direkt in der Verwaltung eintragen oder ändern** — bewusst ohne die 1-Stunde-Sperre,
  die für die Selbst-Abstimmung der Spieler gilt. Praktisch, wenn jemand kurzfristig telefonisch
  absagt/zusagt, nachdem die Abstimmung schon geschlossen ist, oder um rückwirkend etwas zu
  korrigieren.
- Statistik-Ansicht zeigt pro (registriertem) Spieler die Anzahl Zusagen/Vielleicht/Absagen/Offen
  sowie die Zusage-Quote in Prozent — standardmäßig nur für die aktuelle Saison, per Dropdown
  auch für andere Saisonen oder alle zusammen wählbar (siehe eigener Abschnitt "Saisonen" oben).
- Trainer können weitere Spieler zu Trainern machen/die Rolle entziehen, und **Spieler auch
  komplett löschen** — z. B. bei einem vergessenen Passwort (der Spieler kann sich danach mit
  derselben oder einer neuen E-Mail neu registrieren) oder wenn jemand den Verein verlässt. Ein
  Trainer kann sich dabei nicht selbst löschen (Schutz vor versehentlichem Aussperren).
- Verwaltung ist ausschließlich für Trainer sichtbar und nutzbar — sowohl im Menü als auch
  serverseitig abgesichert.
- Als App installierbar (PWA), inkl. eurem Vereinswappen als App-Icon. Kleines "i"-Symbol
  oben im Header öffnet ein kompaktes Info-Popup mit kurzer App-Beschreibung, den verwendeten
  Diensten (GitHub, Vercel, Turso), einem kurzen Hinweis, wie Änderungswünsche funktionieren
  (Claude beschreiben → aktualisierte ZIP-Datei → auf GitHub hochladen → Vercel deployt
  automatisch), und dem Hinweis "powered by Jakob Danecker" (dezent, nicht mehr dauerhaft
  sichtbar im Header selbst).
- Mobile Ansicht überarbeitet: Statistik-Tabelle scrollt bei Bedarf horizontal innerhalb der
  Karte statt das Layout zu sprengen, nebeneinanderliegende Formularfelder stapeln sich auf
  schmalen Bildschirmen automatisch untereinander, Tab-Leiste/Wochen-Navigation angepasst.
- Spielplan-Liste in der Verwaltung ist eingeklappt (zeigt nur die Anzahl bevorstehender Spiele)
  und lässt sich mit einem Klick aufklappen, analog zur Spielerliste — bleibt dadurch auch nach
  Jahren mit vielen Spielen übersichtlich. Beim JSON-Massenimport gibt es außerdem einen
  "Format-Vorlage kopieren"-Button, um die genaue Formatvorlage z. B. direkt an eine KI
  weiterzugeben.

## Code-Review (Stand: aktuelle Version)

Bei einem vollständigen Durchgang durch die App wurden zwei echte Lücken gefunden und behoben:
- **Letzter Trainer war nicht geschützt**: Ein Trainer konnte sich (oder ein anderer Trainer sich
  gegenseitig) die Trainer-Rolle entziehen, auch wenn dadurch niemand mehr Zugriff auf die
  Verwaltung gehabt hätte. Jetzt blockiert, analog zum bestehenden Schutz vor Selbstlöschung.
- **Spielplan-Einträge waren nicht bearbeitbar**, nur lösch- und neu anlegbar. Jetzt wie bei
  Trainings vollständig bearbeitbar.

Zusätzlich geprüft und für in Ordnung befunden: Nutzereingaben werden überall konsequent
escaped (kein XSS), alle API-Endpunkte sind serverseitig korrekt gegen Trainer-Rechte abgesichert
(nicht nur im Frontend versteckt), alle package.json-Abhängigkeiten werden tatsächlich verwendet
(keine überflüssigen oder fehlenden), Service-Worker-Cache-Version wurde nach den vielen
Änderungen erhöht.

**Ideen für später** (nicht umgesetzt, nur als Anregung):
- E-Mail- oder Push-Erinnerung vor einem Training (bräuchte einen zusätzlichen Versanddienst)
- Mehrere Mannschaften/Gruppen mit getrennten Trainingsplänen
- Einfache Rate-Begrenzung beim Login (Schutz vor automatisiertem Passwort-Erraten — bei einer
  kleinen, wenig frequentierten Vereins-App ein geringes Risiko, aber möglich nachzurüsten)
- Export der Statistik als CSV/Excel

## Hinweis zum Test in dieser Umgebung

Der Code wurde auf Syntaxfehler geprüft (`node --check` für jede Datei, JSON-Dateien validiert).
Ein vollständiger Live-Test mit `npm install` gegen eine echte Turso-Datenbank war in dieser
Umgebung nicht möglich, da hier kein Internetzugriff besteht. Macht nach dem ersten Deployment
einen kurzen Durchklick-Test: Registrieren → Training anlegen → Zusage/Absage mit Grund →
Übersicht ansehen → Gastspieler hinzufügen/löschen → Statistik ansehen.
