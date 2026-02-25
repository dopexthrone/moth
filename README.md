<p align="center">
  <strong>◈ Rosie</strong><br/>
  <em>AI coding assistant for the terminal.</em>
</p>

<p align="center">
  <a href="#installation">Installation</a> ·
  <a href="#providers">Providers</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#tools">Tools</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#security">Security</a> ·
  <a href="#architecture">Architecture</a>
</p>

---

Rosie is a terminal-based AI coding assistant that connects to the model provider of your choice. It reads your code, runs commands, makes edits, and verifies its work through an autonomous agentic loop — you provide intent, Rosie handles execution.

Built by [Motherlabs](https://motherlabs.dev).

## Installation

### npm (recommended)

```bash
npm install -g @motherlabs/rosie
```

### GitHub CLI

```bash
gh repo clone dopexthrone/moth
cd moth && npm install && npm run build && npm link
```

### From source

```bash
git clone https://github.com/dopexthrone/moth.git
cd moth
npm install
npm run build
npm link
```

**Requirements:** Node.js 18 or later.

## Providers

Rosie is provider-agnostic. It supports five providers out of the box, plus any OpenAI-compatible endpoint.

| Provider | Models | Environment Variable |
|----------|--------|---------------------|
| **xAI** | `grok-4`, `grok-3-beta`, `grok-3-mini-beta` | `XAI_API_KEY` |
| **Anthropic** | `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` | `ANTHROPIC_API_KEY` |
| **OpenAI** | `gpt-4.5-preview`, `gpt-4.1`, `gpt-4.1-mini`, `o3`, `o3-mini`, `o4-mini` | `OPENAI_API_KEY` |
| **Google** | `gemini-3.1-pro-preview`, `gemini-3-flash`, `gemini-2.5-pro`, `gemini-2.5-flash` | `GOOGLE_API_KEY` |
| **OpenRouter** | Any model available on OpenRouter | `OPENROUTER_API_KEY` |
| **Custom** | Any OpenAI-compatible endpoint | `ROSIE_API_KEY` + `--base-url` |

Rosie auto-detects your provider from the API key prefix. You can also specify it explicitly with `--provider`.

## Usage

### Getting started

```bash
# Set your API key
export XAI_API_KEY=xai-...

# Launch
rosie
```

On first launch without an API key, Rosie walks you through an interactive setup — select a provider, paste your key, and you're in.

### CLI flags

```
rosie [options]

  --provider, -p    Provider: xai, anthropic, openai, google, openrouter, custom
  --model, -m       Model ID (e.g. grok-3-beta, claude-sonnet-4-6)
  --base-url        Custom API endpoint URL
  --no-confirm      Skip tool confirmation prompts
  --version, -v     Show version
  --help, -h        Show help
```

### Examples

```bash
rosie                                       # Default provider and model
rosie -p xai -m grok-4                      # xAI Grok 4
rosie -p anthropic -m claude-opus-4-6       # Anthropic Claude Opus
rosie -p openai -m gpt-4.1                  # OpenAI GPT-4.1
rosie -p openrouter -m x-ai/grok-4          # Grok 4 via OpenRouter
rosie -p custom --base-url http://localhost:11434/v1  # Local model
```

CLI flags apply to the current session only and do not overwrite your saved configuration.

### Session commands

| Command    | Action                              |
|------------|-------------------------------------|
| `/help`    | List available commands             |
| `/clear`   | Reset conversation and token counts |
| `/model`   | Display current provider and model  |
| `/tokens`  | Display input/output token usage    |
| `/exit`    | Quit                                |
| `Ctrl+C`   | Cancel current operation, or quit if idle |

## Tools

Rosie has seven built-in tools. Each tool operates within a security sandbox scoped to your project directory.

| Tool | Requires Confirmation | Description |
|------|:---------------------:|-------------|
| **read_file** | No | Read file contents with line numbers. Detects binary files. Supports offset and line-limit for large files. Max 10 MB. |
| **write_file** | Yes | Create or overwrite a file. Atomic writes via temp-file-then-rename. Creates parent directories automatically. |
| **edit_file** | Yes | Replace an exact string match in a file. The match must be unique. Atomic write. |
| **bash** | Yes | Execute a shell command. Dangerous patterns are blocked. Output capped at 200 KB. Timeout enforced with graceful SIGTERM escalation to SIGKILL. |
| **grep_search** | No | Search file contents using ripgrep or grep. Supports regex, glob filters, case-insensitive mode. Capped at 200 results. |
| **glob_search** | No | Find files by name pattern using `find`. Skips `node_modules`, `.git`, and `dist`. |
| **list_directory** | No | List directory contents with file sizes. Optional recursive mode (max 3 levels). |

When `--no-confirm` is not set, tools marked "Yes" require explicit `y/n` approval before execution.

## Configuration

Configuration is stored at `~/.config/rosie/config.json`.

```json
{
  "provider": "xai",
  "model": "grok-3-beta",
  "maxTokens": 8192,
  "confirmTools": true,
  "streamOutput": true
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | string | `"xai"` | Active provider ID |
| `model` | string | `"grok-3-beta"` | Model ID for the active provider |
| `maxTokens` | number | `8192` | Maximum output tokens per model response |
| `confirmTools` | boolean | `true` | Require confirmation for destructive tools |
| `streamOutput` | boolean | `true` | Stream tokens in real-time |
| `baseUrl` | string | — | Custom API endpoint (overrides provider default) |

**API key storage:** `~/.config/rosie/.api-key` with `0600` permissions (owner-only read/write).

**Environment variable precedence:**
1. Provider-specific variable (e.g. `XAI_API_KEY`)
2. `ROSIE_API_KEY` (generic fallback)
3. Stored key file

## Security

Rosie sandboxes all file and search operations to the project root directory (the directory you launched `rosie` from).

- **Path traversal protection** — All paths are resolved and validated against the project root. Attempts to access `../../etc/passwd` or similar are rejected before any I/O occurs.
- **Symlink validation** — Symbolic links that resolve outside the project root are rejected.
- **Command blocking** — Shell commands matching destructive patterns (`rm -rf /`, `mkfs`, `dd of=/dev/`, fork bombs, `curl | bash`, etc.) are blocked before execution.
- **No shell interpolation in search** — Grep and glob tools use `execFile` with argument arrays, not shell string interpolation. Search patterns cannot trigger command injection.
- **Binary file detection** — File reads check the first 8 KB for null bytes. Binary files are refused.
- **Input validation** — Tool inputs are validated against JSON Schema before execution (required fields, type checking).
- **Atomic writes** — File writes go to a temp file first, then rename. Prevents corruption on crash.
- **Confirmation prompts** — Write, edit, and bash operations require explicit user approval by default.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         CLI Entry                            │
│  meow arg parsing · Node version gate · session lifecycle    │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│                        Event Bus                             │
│  Typed pub/sub · All state transitions flow through here     │
│  25+ event types · Recursion-safe error emission             │
└────┬──────────────────┬──────────────────┬───────────────────┘
     │                  │                  │
┌────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
│ Ink/React │     │ Agent Loop  │    │   Session   │
│    TUI    │     │  (state     │    │   (JSONL    │
│           │     │   machine)  │    │  persistence│
│ streaming │     │  max 25     │    │  max 20     │
│ approval  │     │  turns/msg  │    │  sessions)  │
│ status bar│     └──────┬──────┘    └─────────────┘
└───────────┘            │
                  ┌──────▼──────┐
                  │  Provider   │
                  │  Abstraction│
                  ├─────────────┤
                  │ Anthropic   │  ← Native SDK
                  │ OpenAI-     │  ← Raw fetch + SSE
                  │ Compatible  │    (xAI, OpenAI,
                  │             │     Google, OpenRouter,
                  │             │     custom)
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │   Sandbox   │
                  │ path resolve│
                  │ symlink gate│
                  │ binary check│
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │    Tools    │
                  │ read · write│
                  │ edit · bash │
                  │ grep · glob │
                  │ list-dir    │
                  └─────────────┘
```

**Key design decisions:**

- **No SDK lock-in for most providers.** The OpenAI-compatible adapter uses raw `fetch` with manual SSE parsing. Zero dependency coupling. The Anthropic adapter uses the native SDK where it adds genuine value (streaming helpers, typed content blocks).
- **Event-driven decoupling.** The agent loop, UI, and session persistence never reference each other directly. Everything flows through typed events on a singleton bus.
- **State machine, not recursion.** The agentic loop is a `while` loop with explicit state transitions, not recursive calls. Hard ceiling of 25 turns per user message prevents runaway loops.
- **Context window management.** When conversation history approaches the token budget (estimated at 4 chars per token), old messages are trimmed from the middle — preserving the first user message and the most recent context.

## Development

```bash
npm run dev          # Watch mode — rebuilds on file change
npm run build        # Production build
npm run typecheck    # TypeScript type check (no emit)
npm run lint         # ESLint
```

### Project structure

```
src/
├── cli.tsx                     Entry point, arg parsing, React render
├── components/
│   ├── App.tsx                 Main application component
│   ├── Banner.tsx              Header with provider/model display
│   ├── Input.tsx               Text input and confirmation prompt
│   ├── Setup.tsx               First-run provider/key setup flow
│   └── StatusBar.tsx           Status indicators, token counts, timing
├── core/
│   ├── agent-loop.ts           Agentic state machine
│   ├── event-bus.ts            Typed event pub/sub
│   ├── session.ts              JSONL session persistence
│   └── providers/
│       ├── types.ts            ModelProvider interface, shared types
│       ├── catalog.ts          Model registry, defaults, detection
│       ├── index.ts            Provider factory
│       ├── anthropic.ts        Native Anthropic SDK adapter
│       └── openai-compatible.ts  Raw fetch SSE adapter
├── tools/
│   ├── types.ts                Tool and ToolResult interfaces
│   ├── index.ts                Tool registry
│   ├── validator.ts            JSON Schema input validation
│   ├── sandbox.ts              Path resolution, security gates
│   ├── bash.ts                 Shell execution with safety checks
│   ├── read-file.ts            File reading with binary detection
│   ├── write-file.ts           Atomic file creation/overwrite
│   ├── edit-file.ts            Exact-match string replacement
│   ├── search.ts               Grep and glob search tools
│   └── list-dir.ts             Directory listing
└── utils/
    ├── config.ts               Configuration load/save, API key management
    ├── theme.ts                Color palette
    └── format.ts               Terminal formatting utilities
```

## License

MIT — Motherlabs
