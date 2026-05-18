import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = join(__dirname, 'data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'sling.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    ext         TEXT,
    size        INTEGER,
    path        TEXT NOT NULL,
    status      TEXT DEFAULT 'processing',
    summary     TEXT,
    tags        TEXT DEFAULT '[]',
    entities    TEXT DEFAULT '[]',
    category    TEXT DEFAULT 'other',
    created_at  INTEGER DEFAULT (unixepoch()),
    last_accessed INTEGER,
    last_interaction_summary TEXT,
    last_interaction_agent   TEXT
  );

  CREATE TABLE IF NOT EXISTS interactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    agent      TEXT DEFAULT 'agent',
    summary    TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

export default db;
