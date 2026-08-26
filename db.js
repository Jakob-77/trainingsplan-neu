// Datenbankzugriff ueber Turso (SQLite-kompatibel, aber ueber das Netzwerk erreichbar).
// Anders als eine lokale Datei passt das zur "serverless"-Welt von Vercel: der Code hier
// laeuft bei jedem Aufruf ggf. in einer neuen, kurzlebigen Umgebung - nur die Datenbank
// selbst ist dauerhaft, nicht der Server drumherum.

const { createClient } = require("@libsql/client");

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.warn(
    "TURSO_DATABASE_URL ist nicht gesetzt. Ohne diese Umgebungsvariable kann die App keine Daten speichern."
  );
}

const client = createClient({ url, authToken });

async function run(sql, args = []) {
  return client.execute({ sql, args });
}

async function get(sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows[0] || null;
}

async function all(sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows;
}

async function ensureColumn(table, column, definition) {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  const exists = info.rows.some((c) => c.name === column);
  if (!exists) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

let schemaPromise = null;

function initSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS players (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          is_admin INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS trainings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          time TEXT NOT NULL,
          ort TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS responses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK(status IN ('zusage','vielleicht','absage')),
          reason TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(training_id, player_id)
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS training_guests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      // Migration fuer Datenbanken aus der Vor-Vercel-Version (falls per --from-file importiert):
      // is_guest wird nicht mehr gebraucht, macht aber nichts, wenn die Spalte noch existiert.
      await ensureColumn("players", "is_admin", "INTEGER NOT NULL DEFAULT 0");
    })();
  }
  return schemaPromise;
}

module.exports = { client, run, get, all, initSchema };
