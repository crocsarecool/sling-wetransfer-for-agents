# Sling — WeTransfer for Agents

> Drop once. Every agent remembers.

---

## Vision

AI agents are becoming genuinely useful — but they have a memory problem. Every time you open a new chat, start a Cursor session, or ask a different tool, your files and context vanish. You re-upload the same deck, re-explain the same spreadsheet, re-paste the same contract.

**Sling is a universal file memory layer for AI agents.**

Drop your files into Sling once. Every agent — Claude, Cursor, Windsurf, any MCP-compatible tool — can search, recall, and work with them. Sling indexes each file with an AI summary, extracts key entities and tags, and keeps a running memory of every interaction any agent has ever had with that file.

Think of it as a shared long-term memory that lives outside any one tool or session. Your agents finally know what you've been working on.

---

## What it does

- **Universal drop zone** — drag any file (PDFs, Excel, images, docs, code, CSVs) into Sling's WeTransfer-style interface
- **Instant AI indexing** — Claude reads each file and generates a summary, tags, key entities, and a category
- **Persistent interaction memory** — every time an agent works with a file, it logs what it did; future agents can see that history
- **MCP server** — a single `node mcp.js` command exposes your entire library to any MCP-compatible agent
- **Cross-agent** — works with Claude Desktop, Cursor, Windsurf, or any tool that supports MCP

---

## Current MVP

The MVP runs locally. It's a full-stack app: an Express server, a SQLite database, a vanilla-JS frontend, and an MCP stdio server.

### Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, no build step |
| Backend | Node.js + Express |
| Database | SQLite via better-sqlite3 |
| AI | Claude Haiku (summaries) + Claude Vision (images) |
| Agent protocol | MCP via @modelcontextprotocol/sdk |
| File parsing | pdf-parse, SheetJS, mammoth |

### File support

| Type | Handling |
|---|---|
| PDF | Text extracted via pdf-parse |
| Excel / Numbers | SheetJS → CSV per sheet |
| Word (docx) | mammoth text extraction |
| Images (jpg, png, webp, gif) | Claude Vision (files ≤ 5MB) |
| Text / code / CSV / JSON / HTML | Raw text read directly |

### Agent tools (MCP)

| Tool | Description |
|---|---|
| `search_files` | Search by filename, topic, keyword, or entity |
| `get_file` | Get full summary, entities, tags, and interaction memory for a file |
| `list_recent` | List recently accessed files — useful at conversation start |
| `log_interaction` | Record what was done with a file, building persistent memory |

---

## Setup

### Prerequisites

- Node.js 18+
- An Anthropic API key

### Run

```bash
git clone https://github.com/crocsarecool/sling-wetransfer-for-agents
cd sling-wetransfer-for-agents

cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env

npm install
npm start
```

Open **http://localhost:3000**.

### Connect to Claude Desktop

When the server starts, it prints the MCP config block. Copy it into your Claude Desktop config:

```
~/Library/Application Support/Claude/claude_desktop_config.json   # macOS
%APPDATA%\Claude\claude_desktop_config.json                        # Windows
```

Config block:

```json
{
  "mcpServers": {
    "sling": {
      "command": "node",
      "args": ["/absolute/path/to/sling/mcp.js"]
    }
  }
}
```

Restart Claude Desktop. Your agent now has access to your full Sling file library.

---

## Project structure

```
sling/
├── server.js        Express API + file upload
├── mcp.js           MCP stdio server (agent tools)
├── processor.js     Claude-powered file indexing
├── db.js            SQLite schema + connection
├── public/
│   └── index.html   Full UI (WeTransfer-inspired)
├── uploads/         Uploaded files (gitignored)
├── data/            SQLite database (gitignored)
└── .env.example     Environment template
```

---

## Roadmap

- [ ] Cloud hosting (Sling as a service, not just local)
- [ ] Shareable workspaces — invite a team, agents share the same library
- [ ] Webhook notifications when a file is accessed by an agent
- [ ] More agent integrations (OpenAI Assistants, Gemini)
- [ ] File versioning — track when a file changes and what agents noticed
- [ ] Search quality improvements (embeddings / vector search)

---

## License

MIT
