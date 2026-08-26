// Nur fuer lokale Tests auf dem eigenen Computer gedacht ("npm start").
// WICHTIG: Diese Datei heisst bewusst NICHT "server.js" oder "index.js" und liegt
// nicht im /api-Ordner, damit Vercel sie unter keinen Umstaenden automatisch als
// Funktion erkennt und ausfuehrt. Auf Vercel wird ausschliesslich api/index.js
// verwendet - diese Datei hier spielt dort ueberhaupt keine Rolle.
try {
  require("dotenv").config();
} catch (e) {
  // dotenv ist optional - wenn keine .env-Datei/Paket vorhanden ist, einfach weitermachen
  // und die Umgebungsvariablen muessen dann manuell gesetzt sein
}

const app = require("./api/index.js");
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Trainingsplaner laeuft lokal auf http://localhost:${PORT}`);
});
