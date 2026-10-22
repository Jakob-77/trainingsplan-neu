// Englische Fassungen von Server-Texten: Fehlermeldungen und Protokoll-Eintraege.
// Die Texte im Code bleiben Deutsch (Schluessel); der Browser schickt seine Sprache im Header "X-Lang".
// Benachrichtigungstexte stehen dagegen in push.js (pro Sprache eigene, vom Trainer aenderbare Vorlagen).

const ERRORS = {
  "Datenbank ist gerade nicht erreichbar.": "The database is currently unavailable.",
  "Nicht angemeldet.": "Not signed in.",
  "Nur fuer Trainer verfuegbar.": "Only available to coaches.",
  "Das Vereinswort stimmt nicht. Bitte beim Trainer nachfragen.": "The club word is wrong. Please ask your coach.",
  "Bitte Name, gueltige E-Mail und ein Passwort mit mind. 6 Zeichen angeben.": "Please enter a name, a valid email and a password with at least 6 characters.",
  "Diese E-Mail ist bereits registriert.": "This email is already registered.",
  "Bitte E-Mail und Passwort angeben.": "Please enter email and password.",
  "E-Mail oder Passwort ist falsch.": "Email or password is wrong.",
  "Das Vereinswort darf höchstens 40 Zeichen lang sein.": "The club word may be at most 40 characters long.",
  "Bitte Name, Start- und Enddatum angeben.": "Please enter a name, start date and end date.",
  "Das Enddatum darf nicht vor dem Startdatum liegen.": "The end date must not be before the start date.",
  "Saison nicht gefunden.": "Season not found.",
  "Spieler nicht gefunden.": "Player not found.",
  "Das ist der letzte verbleibende Trainer - mindestens einer muss bestehen bleiben.": "This is the last remaining coach — at least one must remain.",
  "Du kannst dich nicht selbst löschen.": "You can’t delete yourself.",
  "Bitte Datum, Uhrzeit und Ort angeben.": "Please enter date, time and place.",
  "Training nicht gefunden.": "Training not found.",
  "Es gibt bereits ein anderes Training an diesem Datum/Uhrzeit.": "There is already another training at this date/time.",
  "Ungueltiger Status.": "Invalid status.",
  "Bitte einen Grund angeben.": "Please enter a reason.",
  "Die Abstimmung ist geschlossen (weniger als 1 Stunde bis Trainingsbeginn).": "Voting is closed (less than 1 hour until the start).",
  "Bitte einen Namen angeben.": "Please enter a name.",
  "Bitte Gegner, Datum und Uhrzeit angeben.": "Please enter opponent, date and time.",
  "Konnte Spiel nicht speichern.": "Could not save the match.",
  "Spiel nicht gefunden.": "Match not found.",
  "Konnte Spiel nicht speichern (evtl. gibt es dieses Datum/Uhrzeit/Gegner schon).": "Could not save the match (perhaps this date/time/opponent already exists).",
  "Unbekannte Art von Sammel-Eintrag.": "Unknown kind of batch entry.",
  "Ungültige Anmeldung für Benachrichtigungen.": "Invalid notification registration.",
  "Ungültige Anfrage.": "Invalid request.",
  "Tick fehlgeschlagen.": "Check failed.",
  "Ungültige Sprache.": "Invalid language.",
  // aus push.js
  "Ungültige Einstellungen.": "Invalid settings.",
  "Für Änderungen gibt es keine Vorlaufzeit.": "Changes have no lead time.",
  "Die Vorlaufzeit muss eine ganze Zahl zwischen 1 und 72 Stunden sein.": "The lead time must be a whole number between 1 and 72 hours.",
  "Benachrichtigungen sind auf dem Server nicht verfügbar.": "Notifications are not available on the server.",
  "Unbekannte Art von Benachrichtigung.": "Unknown kind of notification.",
  "Auf deinem Konto ist noch kein Gerät für Benachrichtigungen angemeldet. Aktiviere sie zuerst im Reiter „Trainings“ ganz unten.": "No device is registered for notifications on your account yet. Turn them on first in the “Trainings” tab at the very bottom.",
};
const ERROR_PATTERNS = [
  [/^Der Zeitraum überschneidet sich mit "(.*)"\.$/, (m) => `The period overlaps with “${m[1]}”.`],
  [/^Der Text ist zu lang \(höchstens (\d+) Zeichen\)\.$/, (m) => `The text is too long (at most ${m[1]} characters).`],
];

function translateError(msg) {
  if (typeof msg !== "string") return msg;
  if (Object.prototype.hasOwnProperty.call(ERRORS, msg)) return ERRORS[msg];
  for (const [re, fn] of ERROR_PATTERNS) {
    const m = msg.match(re);
    if (m) return fn(m);
  }
  return msg;
}

// Protokoll: feste Satzteile werden ersetzt (Namen, Zahlen und eigene Texte bleiben unveraendert).
const LOG_PHRASES = [
  ["Registrierung mit falschem Vereinswort versucht", "Registration attempted with wrong club word"],
  ["Neu registriert (erster Spieler, automatisch Trainer)", "Registered (first player, automatically coach)"],
  ["Neu registriert", "Registered"],
  ["Fehlgeschlagene Anmeldung", "Failed sign-in"],
  ["E-Mail:", "Email:"],
  ["Angemeldet", "Signed in"],
  ["Abgemeldet", "Signed out"],
  ["Vereinswort geändert", "Club word changed"],
  ["Vereinswort festgelegt", "Club word set"],
  ["Vereinswort entfernt", "Club word removed"],
  ["Einstellung: Spielvorschau im Trainingsplan", "Setting: match preview in the training schedule"],
  ["Einstellung: Gründe nur für Trainer sichtbar", "Setting: reasons visible to coaches only"],
  ["Benachrichtigungen auf einem Gerät eingeschaltet", "Notifications turned on on a device"],
  ["Benachrichtigungen auf einem Gerät ausgeschaltet", "Notifications turned off on a device"],
  ["eingeschaltet", "turned on"],
  ["ausgeschaltet", "turned off"],
  ["Saison angelegt:", "Season created:"],
  ["Saison bearbeitet", "Season edited"],
  ["Saison gelöscht:", "Season deleted:"],
  ["Trainer-Rolle entzogen:", "Coach role removed:"],
  ["Zum Trainer ernannt:", "Made coach:"],
  ["Spieler gelöscht:", "Player deleted:"],
  ["Rückmeldungen mit entfernt", "responses removed as well"],
  ["Training angelegt:", "Training created:"],
  ["Training bearbeitet", "Training edited"],
  ["Training gelöscht:", "Training deleted:"],
  ["Trainer-Eintrag für", "Coach entry for"],
  ["Zusage für Training", "Going for training"],
  ["Vielleicht für Training", "Maybe for training"],
  ["Absage für Training", "Not going for training"],
  ["vorher: Zusage", "was: Going"],
  ["vorher: Vielleicht", "was: Maybe"],
  ["vorher: Absage", "was: Not going"],
  ["Grund:", "Reason:"],
  ["Gastspieler hinzugefügt:", "Guest player added:"],
  ["Gastspieler entfernt:", "Guest player removed:"],
  ["Spiel angelegt:", "Match created:"],
  ["Spiel bearbeitet", "Match edited"],
  ["Spiel gelöscht:", "Match deleted:"],
  ["Spiel (Heim) gegen", "Match (home) against"],
  ["Spiel (Auswärts) gegen", "Match (away) against"],
  ["Heim → Auswärts", "Home → Away"],
  ["Auswärts → Heim", "Away → Home"],
  ["Heim/Auswärts:", "Home/Away:"],
  ["Termin:", "Date:"],
  ["Ort:", "Place:"],
  ["Notiz:", "Note:"],
  ["Ende:", "End:"],
  ["Gegner:", "Opponent:"],
  ["Schiedsrichter:", "Referee:"],
  ["Runde:", "Round:"],
  ["Logo-Link:", "Logo link:"],
  ["Serientermine angelegt:", "Recurring trainings created:"],
  ["bereits vorhanden übersprungen", "already existed and were skipped"],
  ["Spielplan importiert:", "Fixtures imported:"],
  ["Spiele hinzugefügt", "matches added"],
  [" Trainings (", " trainings ("],
  ["ungültig", "invalid"],
  ["Benachrichtigungen:", "Notifications:"],
  ["Benachrichtigung gesendet (Zusagen-Übersicht)", "Notification sent (response summary)"],
  ["Benachrichtigung gesendet (Erinnerung)", "Notification sent (reminder)"],
  ["Benachrichtigung gesendet (Änderung)", "Notification sent (change)"],
  ["Benachrichtigung gesendet (Absage)", "Notification sent (cancellation)"],
  ["Erinnerung", "Reminder"],
  ["Änderung", "Change"],
  ["Zusagen-Übersicht", "Response summary"],
  ["Text geändert", "Text changed"],
  ["Vorlaufzeit", "lead time"],
  ["Std.", "h"],
  [" für Training ", " for training "],
  ["(Training ", "(training "],
];
LOG_PHRASES.sort((a, b) => b[0].length - a[0].length); // laengste (spezifischste) zuerst
const WD = { "Mo.": "Mon", "Di.": "Tue", "Mi.": "Wed", "Do.": "Thu", "Fr.": "Fri", "Sa.": "Sat", "So.": "Sun" };

function translateLog(text) {
  let out = String(text);
  for (const [de, en] of LOG_PHRASES) if (out.includes(de)) out = out.split(de).join(en);
  out = out.replace(/(\d+) von (\d+) Geräten/g, "$1 of $2 devices").replace(/teilweise von (\d+) Geräten/g, "partially of $1 devices");
  out = out.replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So)\. (?=\d\d\.\d\d\.)/g, (m, d) => WD[d + "."] + " ");
  out = out.replace(/ Uhr\b/g, "");
  return out;
}

module.exports = { translateError, translateLog };
