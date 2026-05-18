#!/usr/bin/env node
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import db from './db.js';

const server = new Server(
  { name: 'sling', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ─── Tool list ─────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_files',
      description: 'Search the Sling file library. Returns matching files with AI summaries and last conversation context. Use this first when the user mentions a file, document, or topic.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — filename, topic, keyword, or entity' }
        },
        required: ['query']
      }
    },
    {
      name: 'get_file',
      description: 'Get a specific file by ID with its full summary, key entities, tags, and conversation memory. Always call log_interaction after using a file.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'File ID (from search_files results)' }
        },
        required: ['id']
      }
    },
    {
      name: 'list_recent',
      description: 'List recently accessed files from the Sling library. Useful at the start of a conversation to understand what the user has been working on.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max files to return (default 6)' }
        }
      }
    },
    {
      name: 'log_interaction',
      description: 'Record what you did with a file. Call this after working with any file — it builds the memory that makes future agent interactions smarter.',
      inputSchema: {
        type: 'object',
        properties: {
          file_id: { type: 'string', description: 'File ID' },
          summary: { type: 'string', description: 'Plain-language summary of what was discussed or done (1-2 sentences)' }
        },
        required: ['file_id', 'summary']
      }
    }
  ]
}));

// ─── Tool handlers ─────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'search_files') {
      const q = (args.query || '').trim();
      if (!q) return text('Provide a search query.');

      const p = `%${q}%`;
      const files = db.prepare(`
        SELECT id, name, ext, category, summary, last_accessed, created_at,
               last_interaction_summary, last_interaction_agent
        FROM files
        WHERE status = 'ready'
          AND (name LIKE ? OR summary LIKE ? OR tags LIKE ? OR entities LIKE ? OR category LIKE ?)
        ORDER BY COALESCE(last_accessed, created_at) DESC
        LIMIT 8
      `).all(p, p, p, p, p);

      if (!files.length) return text(`No files found matching "${q}". Try a broader term.`);

      const lines = files.map(f => {
        let out = `**${f.name}** [${f.category}]  ID: \`${f.id}\`\n${f.summary || '(no summary)'}`;
        if (f.last_interaction_summary) {
          out += `\n_Last used ${relTime(f.last_accessed)} by ${f.last_interaction_agent || 'agent'}: "${f.last_interaction_summary}"_`;
        }
        return out;
      });

      return text(lines.join('\n\n---\n\n'));
    }

    if (name === 'get_file') {
      const file = db.prepare('SELECT * FROM files WHERE id = ?').get(args.id);
      if (!file) return text(`File not found: ${args.id}`);

      db.prepare('UPDATE files SET last_accessed = unixepoch() WHERE id = ?').run(args.id);

      const interactions = db.prepare(
        'SELECT agent, summary, created_at FROM interactions WHERE file_id = ? ORDER BY created_at DESC LIMIT 5'
      ).all(args.id);

      const tags     = safeJson(file.tags,     []);
      const entities = safeJson(file.entities, []);

      let out = `## ${file.name}\n**Category:** ${file.category}  |  **Size:** ${kb(file.size)}`;
      out += `\n\n**Summary:** ${file.summary || '(processing)'}`;
      if (entities.length) out += `\n\n**Key entities:** ${entities.join(', ')}`;
      if (tags.length)     out += `\n**Tags:** ${tags.join(', ')}`;

      if (interactions.length) {
        out += '\n\n**Memory:**';
        for (const i of interactions) {
          out += `\n- ${i.agent || 'agent'} (${relTime(i.created_at)} ago): ${i.summary}`;
        }
      } else {
        out += '\n\n_No memory yet — call log_interaction after using this file._';
      }

      out += `\n\n**Raw file:** http://localhost:${process.env.PORT || 3000}/api/files/${file.id}/raw`;
      return text(out);
    }

    if (name === 'list_recent') {
      const limit = Math.min(Number(args.limit) || 6, 20);
      const files = db.prepare(`
        SELECT id, name, category, summary, last_accessed, created_at
        FROM files WHERE status = 'ready'
        ORDER BY COALESCE(last_accessed, created_at) DESC
        LIMIT ?
      `).all(limit);

      if (!files.length) return text('No files indexed yet. Visit http://localhost:3000 to add files.');

      const lines = files.map(f =>
        `- **${f.name}** [${f.category}] — ${(f.summary || '').slice(0, 90)}…  \`${f.id}\``
      );
      return text(`**${files.length} recent files:**\n\n${lines.join('\n')}`);
    }

    if (name === 'log_interaction') {
      const file = db.prepare('SELECT id, name FROM files WHERE id = ?').get(args.file_id);
      if (!file) return text(`File not found: ${args.file_id}`);

      db.prepare('INSERT INTO interactions (file_id, agent, summary) VALUES (?, ?, ?)')
        .run(args.file_id, 'Claude', args.summary);
      db.prepare('UPDATE files SET last_interaction_summary = ?, last_interaction_agent = ? WHERE id = ?')
        .run(args.summary, 'Claude', args.file_id);

      return text(`Memory saved for "${file.name}".`);
    }

    return text(`Unknown tool: ${name}`);

  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

// ─── Helpers ───────────────────────────────────────────────────
function text(str) { return { content: [{ type: 'text', text: str }] }; }
function safeJson(s, fb) { try { return JSON.parse(s); } catch { return fb; } }
function kb(bytes) { return bytes ? `${Math.round(bytes / 1024)} KB` : 'unknown'; }
function relTime(ts) {
  if (!ts) return 'unknown time';
  const s = Math.floor(Date.now() / 1000) - Number(ts);
  if (s < 60)     return 'just now';
  if (s < 3600)   return `${Math.floor(s / 60)}m`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

// ─── Connect ───────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
