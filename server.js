import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { mkdirSync, unlinkSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { processFile } from './processor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = join(__dirname, 'uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── Multer ────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const id  = uuidv4();
    const ext = extname(file.originalname);
    cb(null, `${id}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ─── Routes ────────────────────────────────────────────────────

// Upload
app.post('/api/upload', upload.array('files', 100), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files received' });

  const inserted = req.files.map(file => {
    const id  = file.filename.replace(extname(file.filename), '');
    const ext = extname(file.originalname);
    db.prepare(`
      INSERT INTO files (id, name, ext, size, path, status)
      VALUES (?, ?, ?, ?, ?, 'processing')
    `).run(id, file.originalname, ext, file.size, file.path);

    // Fire-and-forget processing
    processFile(id, file.path, file.originalname, ext).catch(console.error);

    return { id, name: file.originalname, status: 'processing' };
  });

  res.json({ files: inserted });
});

// List all files (with last interaction denormalized)
app.get('/api/files', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM files ORDER BY created_at DESC`).all();
  res.json(rows.map(parse));
});

// Get single file + interactions
app.get('/api/files/:id', (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });

  const interactions = db.prepare(
    'SELECT * FROM interactions WHERE file_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(req.params.id);

  db.prepare('UPDATE files SET last_accessed = unixepoch() WHERE id = ?').run(req.params.id);

  res.json({ ...parse(file), interactions });
});

// Serve raw file
app.get('/api/files/:id/raw', (req, res) => {
  const file = db.prepare('SELECT path, name FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  res.download(file.path, file.name);
});

// Delete file
app.delete('/api/files/:id', (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  try { unlinkSync(file.path); } catch {}
  db.prepare('DELETE FROM files WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Log interaction (from UI or MCP)
app.post('/api/interactions', (req, res) => {
  const { file_id, agent = 'agent', summary } = req.body;
  if (!file_id || !summary) return res.status(400).json({ error: 'file_id and summary required' });

  const file = db.prepare('SELECT id FROM files WHERE id = ?').get(file_id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  db.prepare('INSERT INTO interactions (file_id, agent, summary) VALUES (?, ?, ?)').run(file_id, agent, summary);
  db.prepare('UPDATE files SET last_interaction_summary = ?, last_interaction_agent = ? WHERE id = ?')
    .run(summary, agent, file_id);

  res.json({ ok: true });
});

// Search
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const p = `%${q}%`;
  const rows = db.prepare(`
    SELECT * FROM files
    WHERE status = 'ready'
      AND (name LIKE ? OR summary LIKE ? OR tags LIKE ? OR entities LIKE ? OR category LIKE ?)
    ORDER BY COALESCE(last_accessed, created_at) DESC
    LIMIT 10
  `).all(p, p, p, p, p);
  res.json(rows.map(parse));
});

// MCP config snippet for Claude Desktop
app.get('/api/mcp-config', (_req, res) => {
  const mcpPath = join(__dirname, 'mcp.js');
  res.json({
    mcpServers: {
      sling: { command: 'node', args: [mcpPath] }
    }
  });
});

// ─── Helpers ───────────────────────────────────────────────────
function parse(row) {
  return {
    ...row,
    tags:     safeJson(row.tags,     []),
    entities: safeJson(row.entities, []),
  };
}
function safeJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ─── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  const mcpPath = join(__dirname, 'mcp.js');
  console.log(`\n🚀  Sling → http://localhost:${PORT}`);
  console.log(`\nTo connect Claude Desktop, add to claude_desktop_config.json:`);
  console.log(JSON.stringify({ mcpServers: { sling: { command: 'node', args: [mcpPath] } } }, null, 2));
  console.log(`\nConfig path (macOS): ~/Library/Application Support/Claude/claude_desktop_config.json\n`);
});
