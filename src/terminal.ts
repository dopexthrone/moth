/**
 * Interactive terminal for Rosie.
 * Pure Node.js readline — no Ink, no React, no TTY requirement.
 * Works everywhere: terminal emulators, SSH, tmux, pipes, CI.
 *
 * Drives the same AgentLoop, EventBus, and provider system as the Ink UI.
 */

import readline from 'node:readline';
import { bus } from './core/event-bus.js';
import { AgentLoop } from './core/agent-loop.js';
import { SessionManager } from './core/session.js';
import { allTools } from './tools/index.js';
import { createProvider } from './core/providers/index.js';
import { loadConfig, getApiKey, saveApiKey, saveConfig, type RosieConfig } from './utils/config.js';
import { setProjectRoot } from './tools/sandbox.js';
import { detectProviderFromKey, getDefaultModel } from './core/providers/catalog.js';
import type { ProviderID } from './core/providers/types.js';

// ── ANSI helpers ──

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  purple: '\x1b[38;5;135m',
  coral: '\x1b[38;5;203m',
  green: '\x1b[38;5;35m',
  red: '\x1b[38;5;160m',
  amber: '\x1b[38;5;172m',
  gray: '\x1b[38;5;245m',
  lightGray: '\x1b[38;5;250m',
  indigo: '\x1b[38;5;55m',
};

function purple(s: string): string { return `${c.purple}${s}${c.reset}`; }
function coral(s: string): string { return `${c.coral}${s}${c.reset}`; }
function green(s: string): string { return `${c.green}${s}${c.reset}`; }
function red(s: string): string { return `${c.red}${s}${c.reset}`; }
function amber(s: string): string { return `${c.amber}${s}${c.reset}`; }
function gray(s: string): string { return `${c.gray}${s}${c.reset}`; }
function dim(s: string): string { return `${c.dim}${s}${c.reset}`; }
function bold(s: string): string { return `${c.bold}${s}${c.reset}`; }

function tokenStr(n: number): string {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

// ── Setup flow (no TTY needed — works with basic line input) ──

async function runSetup(rl: readline.Interface): Promise<{ apiKey: string; provider: ProviderID }> {
  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  console.log('');
  console.log(purple(`  ◈ rosie setup`));
  console.log(dim('  ─────────────────────────────────────────'));
  console.log('');
  console.log('  Select your AI provider:');
  console.log('');
  console.log(`    ${bold('1')}  xAI (Grok)`);
  console.log(`    ${bold('2')}  Anthropic (Claude)`);
  console.log(`    ${bold('3')}  OpenAI (GPT)`);
  console.log(`    ${bold('4')}  OpenRouter (any model)`);
  console.log(`    ${bold('5')}  Google (Gemini)`);
  console.log('');

  const providerMap: Record<string, ProviderID> = {
    '1': 'xai', '2': 'anthropic', '3': 'openai', '4': 'openrouter', '5': 'google',
  };

  let provider: ProviderID = 'xai';
  while (true) {
    const choice = await ask(purple('  ▸ ') + 'Provider (1-5): ');
    if (providerMap[choice.trim()]) {
      provider = providerMap[choice.trim()]!;
      break;
    }
    console.log(red('  Invalid choice. Enter 1-5.'));
  }

  console.log('');
  const envVars: Record<ProviderID, string> = {
    xai: 'XAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY', google: 'GOOGLE_API_KEY', custom: 'ROSIE_API_KEY',
  };
  console.log(dim(`  Paste your API key (or set ${envVars[provider]} in your shell).`));

  let apiKey = '';
  while (true) {
    apiKey = (await ask(purple('  ▸ ') + 'API Key: ')).trim();
    if (apiKey.length >= 10) break;
    console.log(red('  Key looks too short. Try again.'));
  }

  // Auto-detect provider from key prefix
  const detected = detectProviderFromKey(apiKey);
  if (detected) provider = detected;

  const model = getDefaultModel(provider);
  saveApiKey(apiKey);
  saveConfig({ provider, model });

  console.log('');
  console.log(green('  ✓') + ` Saved. Provider: ${bold(provider)}, Model: ${bold(model)}`);
  console.log(dim('  Key stored at ~/.config/rosie/.api-key'));
  console.log('');

  return { apiKey, provider };
}

// ── Main terminal ──

export async function startTerminal(cliOverrides: Partial<RosieConfig> = {}): Promise<void> {
  setProjectRoot(process.cwd());

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });

  // ── Resolve API key ──
  let apiKey = getApiKey();
  if (!apiKey) {
    const result = await runSetup(rl);
    apiKey = result.apiKey;
  }

  const config = { ...loadConfig(), ...cliOverrides };

  // ── Banner ──
  console.log('');
  console.log(purple(`  ◈ rosie `) + dim('v0.1.0') + dim(' — ') + coral(config.provider) + dim(`/${config.model}`));
  console.log(dim('  ─────────────────────────────────────────'));
  console.log(dim('  Type a message to start. /help for commands. Ctrl+C to exit.'));
  console.log('');

  // ── Initialize agent ──
  const provider = createProvider({
    provider: config.provider,
    apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
  });

  const agent = new AgentLoop(provider, allTools, {
    maxTokens: config.maxTokens,
    confirmDestructive: config.confirmTools,
  });

  const session = new SessionManager();
  session.start();

  // ── State ──
  let isBusy = false;
  let streamingText = '';
  let currentLine = '';
  let isShowingThinking = false;

  /** Clear the "thinking..." spinner line if it's showing */
  function clearThinking(): void {
    if (isShowingThinking) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      isShowingThinking = false;
    }
  }

  // ── Wire up event bus → terminal output ──

  bus.on('agent:thinking', () => {
    isShowingThinking = true;
    process.stdout.write(dim('  ◌ thinking...'));
  });

  bus.on('agent:text', (e) => {
    // Clear "thinking..." on first text delta
    if (!streamingText) {
      clearThinking();
      process.stdout.write(purple(`  ◈ rosie\n`) + '  ');
    }

    streamingText += e.delta;

    // Write delta, tracking line position for clean output
    const parts = e.delta.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        process.stdout.write('\n  '); // indent continuation lines
        currentLine = '';
      }
      process.stdout.write(parts[i]!);
      currentLine += parts[i];
    }
  });

  bus.on('agent:text:done', () => {
    if (streamingText) {
      process.stdout.write('\n\n');
    }
    streamingText = '';
    currentLine = '';
  });

  bus.on('agent:turn_complete', (e) => {
    clearThinking();
    const usage = e.usage;
    if (usage.inputTokens > 0 || usage.outputTokens > 0) {
      console.log(dim(`  tokens: ↑${tokenStr(usage.inputTokens)} ↓${tokenStr(usage.outputTokens)}`));
    }
  });

  bus.on('agent:error', (e) => {
    clearThinking();
    // Clear any in-progress streaming output
    if (streamingText) {
      process.stdout.write('\n');
      streamingText = '';
    }
    console.log(red(`  ✗ ${e.error.message}`));
    isBusy = false;
  });

  bus.on('tool:executing', (e) => {
    clearThinking();
    process.stdout.write(amber(`  ⚙ ${e.toolName}`) + dim(' running...\n'));
  });

  bus.on('tool:complete', (e) => {
    const symbol = e.isError ? red('✗') : green('✓');
    const duration = e.durationMs ? dim(` (${e.durationMs}ms)`) : '';
    const preview = e.isError ? dim(` ${e.content.slice(0, 120)}`) : '';
    console.log(`  ${symbol} ${gray(e.toolId.slice(0, 12))}${duration}${preview}`);
  });

  bus.on('tool:approval_required', (e) => {
    const summary = summarizeTool(e.toolName, e.input);
    console.log('');
    console.log(coral(`  ⚠ ${e.toolName}`) + (summary ? dim(` ${summary}`) : ''));
    rl.question(coral('  Allow? ') + dim('(y/n) '), (answer) => {
      const approved = answer.trim().toLowerCase() === 'y';
      if (approved) {
        bus.emit({ type: 'tool:approved', toolId: e.toolId, timestamp: Date.now() });
      } else {
        bus.emit({ type: 'tool:denied', toolId: e.toolId, timestamp: Date.now() });
        console.log(dim('  denied.'));
      }
    });
  });

  bus.on('session:context_trimmed', (e) => {
    console.log(dim(`  context trimmed: removed ${e.removedMessages} old messages.`));
  });

  // ── Slash commands ──

  function handleSlashCommand(cmd: string): boolean {
    switch (cmd) {
      case 'help':
        console.log(dim('  /help    — show commands'));
        console.log(dim('  /clear   — reset conversation'));
        console.log(dim('  /model   — show provider and model'));
        console.log(dim('  /tokens  — show usage stats'));
        console.log(dim('  /exit    — quit'));
        return true;
      case 'clear':
        agent.clearHistory();
        console.log(dim('  conversation cleared.'));
        return true;
      case 'model':
        console.log(dim(`  Provider: ${config.provider} | Model: ${config.model}`));
        return true;
      case 'tokens': {
        const u = agent.usage;
        console.log(dim(`  Tokens — in: ${tokenStr(u.inputTokens)}, out: ${tokenStr(u.outputTokens)}`));
        return true;
      }
      case 'exit':
      case 'quit':
        shutdown();
        return true;
      default:
        return false;
    }
  }

  // ── Prompt loop ──

  function prompt(): void {
    rl.question(purple('  ▸ '), async (input) => {
      const message = input.trim();
      if (!message) {
        prompt();
        return;
      }

      if (message.startsWith('/')) {
        const cmd = message.slice(1).toLowerCase();
        if (handleSlashCommand(cmd)) {
          prompt();
          return;
        }
      }

      // User message
      console.log(coral('  ▸ you'));
      console.log(`  ${message}`);
      console.log('');

      isBusy = true;
      await agent.processMessage(message);
      isBusy = false;

      console.log('');
      prompt();
    });
  }

  // ── Shutdown ──

  function shutdown(): void {
    agent.destroy();
    session.close();
    rl.close();
    console.log('');
    console.log(dim('  goodbye.'));
    console.log('');
    process.exit(0);
  }

  // Ctrl+C handling
  rl.on('SIGINT', () => {
    if (isBusy) {
      agent.cancel();
      isBusy = false;
      streamingText = '';
      process.stdout.write('\n');
      console.log(dim('  cancelled.'));
      console.log('');
      prompt();
    } else {
      shutdown();
    }
  });

  rl.on('close', () => {
    if (isBusy) agent.cancel();
    shutdown();
  });

  // Start
  prompt();
}

function summarizeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'read_file': return String(input.path || '');
    case 'write_file': return String(input.path || '');
    case 'edit_file': return String(input.path || '');
    case 'bash': return String(input.command || '').slice(0, 80);
    case 'grep_search': return `"${input.pattern || ''}" ${input.path || '.'}`;
    case 'glob_search': return `${input.pattern || ''}`;
    case 'list_directory': return String(input.path || '.');
    default: return '';
  }
}
