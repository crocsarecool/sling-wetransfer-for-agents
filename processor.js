import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, statSync } from 'fs';
import { createRequire } from 'module';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import db from './db.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_CHARS = 12000;

const IMAGE_EXTS  = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const MIME_MAP    = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const TEXT_EXTS   = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.js', '.ts', '.py']);

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in .env');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function extractText(filePath, ext) {
  const e = ext.toLowerCase();

  if (TEXT_EXTS.has(e)) {
    return readFileSync(filePath, 'utf8').slice(0, MAX_CHARS);
  }

  if (e === '.pdf') {
    const buf = readFileSync(filePath);
    const data = await pdfParse(buf);
    return data.text.slice(0, MAX_CHARS);
  }

  if (['.xlsx', '.xls', '.numbers'].includes(e)) {
    const wb = XLSX.readFile(filePath);
    const parts = wb.SheetNames.map(n => `Sheet "${n}":\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n]));
    return parts.join('\n\n').slice(0, MAX_CHARS);
  }

  if (['.docx', '.doc'].includes(e)) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.slice(0, MAX_CHARS);
  }

  return null;
}

const JSON_PROMPT = `Respond ONLY with valid JSON — no markdown fences, no explanation:
{"summary":"2-3 sentence description of what this file is and contains","tags":["tag1","tag2","tag3"],"entities":["key entity 1","key entity 2"],"category":"one of: finance,legal,research,design,product,team,marketing,other"}`;

async function callClaude(client, messages) {
  const res = await client.messages.create({ model: MODEL, max_tokens: 512, messages });
  const raw = res.content[0].text.trim();
  // Strip any accidental markdown fences
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

export async function processFile(fileId, filePath, fileName, ext) {
  const client = getClient();

  try {
    const e = ext.toLowerCase();
    let result;

    if (IMAGE_EXTS.has(e)) {
      const stat = statSync(filePath);
      if (stat.size <= 5 * 1024 * 1024) {
        const imgData = readFileSync(filePath).toString('base64');
        const mediaType = MIME_MAP[e] || 'image/jpeg';
        result = await callClaude(client, [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imgData } },
            { type: 'text', text: `Analyse this image. ${JSON_PROMPT}` }
          ]
        }]);
      } else {
        result = { summary: `Large image file: ${fileName}`, tags: ['image'], entities: [], category: 'other' };
      }
    } else {
      let text = null;
      try { text = await extractText(filePath, e); } catch {}

      const contentBlock = text
        ? `File content:\n${text}`
        : '(Binary file — no text could be extracted.)';

      result = await callClaude(client, [{
        role: 'user',
        content: `You are indexing a file for an AI agent memory system.\n\nFile name: ${fileName}\nFile type: ${e}\n${contentBlock}\n\n${JSON_PROMPT}`
      }]);
    }

    db.prepare(`
      UPDATE files
      SET status   = 'ready',
          summary  = ?,
          tags     = ?,
          entities = ?,
          category = ?
      WHERE id = ?
    `).run(
      result.summary || '',
      JSON.stringify(Array.isArray(result.tags) ? result.tags : []),
      JSON.stringify(Array.isArray(result.entities) ? result.entities : []),
      result.category || 'other',
      fileId
    );

  } catch (err) {
    console.error(`[processor] ${fileName}:`, err.message);
    db.prepare(`UPDATE files SET status = 'error', summary = ? WHERE id = ?`)
      .run(`Processing failed: ${err.message}`, fileId);
  }
}
