// Abruf des naechsten Spiels von fan.at (oeffentliche Fussball-Ergebnisseite, nicht durch
// robots.txt oder Bot-Schutz gesperrt - im Gegensatz zu ofv.at und ligaportal.at, die beide
// automatisierte Zugriffe aktiv blockieren).
//
// WICHTIGER HINWEIS FUER KUENFTIGE WARTUNG:
// Dies ist "Screen Scraping" - wir lesen die ganz normale, fuer Menschen gedachte Webseite
// aus, es gibt keine offizielle Schnittstelle dafuer. Das bedeutet: Wenn fan.at seine
// Seitenstruktur aendert, kann dieser Parser aufhoeren zu funktionieren. Das ist bewusst so
// gebaut, dass so ein Ausfall NIE die restliche App beeintraechtigt (siehe next-match.js
// Verwendung in api/index.js: immer in try/catch, mit Cache- und manuellem Fallback).
//
// Falls das hier eines Tages nicht mehr funktioniert: die Konstante FAN_AT_URL im Browser
// oeffnen, Seitenquelltext ansehen und die Parsing-Logik unten (parseNextMatchHtml)
// entsprechend der dann aktuellen Struktur anpassen.

const FAN_AT_URL = "https://spg-utzenaich-antiesenhofen.fan.at/spiele";
const FETCH_TIMEOUT_MS = 6000;

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&ouml;/g, "ö")
    .replace(/&Auml;/g, "Ä")
    .replace(/&auml;/g, "ä")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&uuml;/g, "ü")
    .replace(/&szlig;/g, "ß")
    .replace(/\s+/g, " ")
    .trim();
}

// Versucht, aus dem HTML eingebettete strukturierte Daten zu lesen (JSON-LD,
// haeufig fuer Sport-Events verwendet). Das waere der zuverlaessigste Weg, falls vorhanden.
function tryParseJsonLd(html) {
  const matches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of matches) {
    try {
      const json = JSON.parse(m[1]);
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item["@type"] === "SportsEvent" && item.startDate) {
          return jsonLdToMatch(item);
        }
      }
    } catch (e) {
      // kein gueltiges JSON an dieser Stelle - einfach weiter zur naechsten Fallback-Strategie
    }
  }
  return null;
}

function jsonLdToMatch(item) {
  const start = new Date(item.startDate);
  const home = item.homeTeam && (item.homeTeam.name || item.homeTeam);
  const away = item.awayTeam && (item.awayTeam.name || item.awayTeam);
  if (!home || !away || isNaN(start.getTime())) return null;
  const isHome = String(home).toLowerCase().includes("utzenaich");
  return {
    homeTeam: String(home),
    awayTeam: String(away),
    isHome,
    opponent: isHome ? String(away) : String(home),
    date: start.toISOString().slice(0, 10),
    time: start.toISOString().slice(11, 16),
    competition: item.superEvent ? item.superEvent.name : null,
  };
}

// Fallback-Strategie: den fuer Menschen sichtbaren Text durchsuchen. Die "Kommende Spiele"-
// Liste zeigt jede Paarung als zusammenhaengenden Block in der Form:
//   <Heimteam> Home team <Wochentag>. <TT.MM.> <HH:MM> ... Away team <Auswaertsteam>
// Wir nehmen den ERSTEN Treffer nach der Ueberschrift "Kommende Spiele" - das ist das
// zeitlich naechste Spiel.
function tryParseVisibleText(html) {
  const text = stripHtml(html);
  const stopWords = "(?=\\s*(?:Runde\\s+\\d|Bezirksliga|Mehr Spiele laden|Vergangene Spiele|$))";
  const pattern = new RegExp(
    "([A-ZÄÖÜ][^.]{2,60}?)\\s*Home team\\s*(?:Mo|Di|Mi|Do|Fr|Sa|So)\\.?\\s*(\\d{2}\\.\\d{2}\\.)\\s*(\\d{2}:\\d{2}).*?Away team\\s*([A-ZÄÖÜ][^.]{2,60}?)" + stopWords
  );
  const match = text.match(pattern);
  if (!match) return null;

  const [, homeRaw, dateRaw, timeRaw, awayRaw] = match;
  const cleanTeamName = (raw) =>
    raw
      .replace(/^.*?Runde\s+\d+\s*/i, "")
      .replace(/^Bezirksliga West\s*/i, "")
      .trim();
  const homeTeam = cleanTeamName(homeRaw);
  const awayTeam = cleanTeamName(awayRaw);

  // Datum "TT.MM." hat kein Jahr - wir nehmen an, dass es das naechste Vorkommen dieses
  // Tag/Monat ab heute ist (also dieses Jahr, oder naechstes Jahr falls das Datum heuer
  // schon vorbei waere - kommt bei "kommenden Spielen" praktisch nie vor, aber sicher ist sicher).
  const [day, monthNum] = dateRaw.split(".").map((s) => parseInt(s, 10));
  const now = new Date();
  let year = now.getFullYear();
  let candidate = new Date(`${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}T${timeRaw}:00`);
  if (candidate.getTime() < now.getTime() - 24 * 3600 * 1000) {
    year += 1;
    candidate = new Date(`${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}T${timeRaw}:00`);
  }

  const isHome = homeTeam.toLowerCase().includes("utzenaich");
  return {
    homeTeam,
    awayTeam,
    isHome,
    opponent: isHome ? awayTeam : homeTeam,
    date: `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    time: timeRaw,
    competition: "Bezirksliga West",
  };
}

async function fetchNextMatchFromFanAt() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(FAN_AT_URL, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TrainingsplanerBot/1.0)" },
    });
    if (!res.ok) throw new Error(`fan.at antwortete mit Status ${res.status}`);
    const html = await res.text();

    const viaJsonLd = tryParseJsonLd(html);
    if (viaJsonLd) return { ...viaJsonLd, sourceUrl: FAN_AT_URL };

    const viaText = tryParseVisibleText(html);
    if (viaText) return { ...viaText, sourceUrl: FAN_AT_URL };

    throw new Error("Konnte kein kommendes Spiel im HTML von fan.at erkennen (Seitenstruktur evtl. geaendert).");
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchNextMatchFromFanAt, FAN_AT_URL };
