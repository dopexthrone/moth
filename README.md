# ◈ moth

AI coding assistant for the terminal — powered by Claude.

```bash
npm install -g @motherlabs/moth
moth
```

## What is Moth?

Moth is a terminal-based AI coding assistant built by [Motherlabs](https://motherlabs.dev). It uses Anthropic's Claude models to help you write, debug, and understand code — directly from your terminal.

**Not a chatbot.** Moth is an agentic loop — it reads your code, runs commands, makes edits, and verifies its work. You provide intent. Moth handles the translation to working software.

## Architecture

```
                    ┌──────────────┐
                    │   CLI Entry  │  ← meow args, Node version check
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Event Bus  │  ← typed events, all state flows here
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐ ┌──▼──────┐ ┌──▼─────────┐
       │ Agent Loop   │ │ Session │ │  Ink UI     │
       │ (state       │ │ (JSONL  │ │ (React      │
       │  machine)    │ │  persist│ │  terminal)  │
       └──────┬───────┘ └─────────┘ └────────────┘
              │
       ┌──────▼──────┐
       │  Sandbox    │  ← path validation, security
       └──────┬──────┘
              │
       ┌──────▼──────┐
       │   Tools     │  ← read, write, edit, bash, search, list
       └─────────────┘
```

## Features

- **Agentic loop** — multi-turn tool use with automatic continuation
- **Real-time streaming** — token-by-token display as Claude responds
- **Proactive suggestions** — surfaces bugs, failing tests, code quality issues
- **Sandboxed tools** — path traversal protection, command blocking, input validation
- **Session persistence** — conversations saved to JSONL, survive crashes
- **Context management** — automatic sliding window when approaching token limits
- **Cancellation** — Ctrl+C cancels in-progress operations gracefully
- **Tool confirmation** — destructive operations require explicit approval
- **Event-driven** — clean separation between AI logic and UI rendering

## Quick Start

```bash
# Install globally
npm install -g @motherlabs/moth

# Run — prompts for API key on first launch
moth

# Or set your key first
export ANTHROPIC_API_KEY=sk-ant-...
moth

# Use a specific model
moth --model claude-opus-4-6

# Skip tool confirmation prompts
moth --no-confirm
```

## Requirements

- Node.js >= 18
- An [Anthropic API key](https://console.anthropic.com/settings/keys)

## Commands

| Command   | Description                |
|-----------|----------------------------|
| `/help`   | Show available commands    |
| `/clear`  | Clear conversation history |
| `/model`  | Show current model         |
| `/tokens` | Show token usage           |
| `/exit`   | Exit moth                  |
| `Ctrl+C`  | Cancel operation or exit   |

## Configuration

Stored at `~/.config/moth/config.json`:

```json
{
  "model": "claude-sonnet-4-6",
  "maxTokens": 8192,
  "confirmTools": true,
  "streamOutput": true
}
```

## Tools

| Tool             | Confirmation | Description                         |
|------------------|:------------:|-------------------------------------|
| `read_file`      | No           | Read files with line numbers        |
| `write_file`     | Yes          | Create/overwrite files atomically   |
| `edit_file`      | Yes          | String replacement editing          |
| `bash`           | Yes          | Execute shell commands              |
| `grep_search`    | No           | Search file contents (rg/grep)      |
| `glob_search`    | No           | Find files by pattern               |
| `list_directory` | No           | List directory contents             |

## Security

- All file operations sandboxed to project root (no path traversal)
- Shell commands use `execFile` where possible (no shell injection in search tools)
- Dangerous commands blocked by pattern matching
- Symlinks that escape the sandbox are rejected
- Binary files detected and refused
- API keys stored with 0600 permissions

## Development

```bash
git clone https://github.com/motherlabs/moth.git
cd moth
npm install
npm run dev     # watch mode
npm run build   # production build
npx tsc --noEmit  # type check
```

## GitHub CLI Installation

```bash
gh repo clone motherlabs/moth
cd moth && npm install && npm run build && npm link
moth
```

## License

MIT — Motherlabs
