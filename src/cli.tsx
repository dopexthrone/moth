import meow from 'meow';
import type { ProviderID } from './core/providers/types.js';
import type { RosieConfig } from './utils/config.js';

const cli = meow(
  `
  Usage
    $ rosie [options]

  Options
    --provider, -p  AI provider: xai, anthropic, openai, google, openrouter, custom
    --model, -m     Model ID (e.g., grok-3-beta, claude-sonnet-4-6, gpt-4.1-mini)
    --base-url      Custom API base URL (for self-hosted or proxied endpoints)
    --no-confirm    Skip tool confirmation prompts
    --ui            Use rich Ink/React UI (requires interactive TTY)
    --version, -v   Show version
    --help, -h      Show this help

  Providers & Models
    xai         grok-4, grok-3-beta, grok-3-mini-beta
    anthropic   claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
    openai      gpt-4.5-preview, gpt-4.1, gpt-4.1-mini, o3, o3-mini, o4-mini
    google      gemini-3.1-pro-preview, gemini-3-flash, gemini-2.5-pro
    openrouter  any model via OpenRouter (e.g., anthropic/claude-sonnet-4-6)

  Examples
    $ rosie                                    # uses configured provider
    $ rosie -p xai -m grok-3-beta              # xAI Grok 3
    $ rosie -p anthropic -m claude-sonnet-4-6  # Anthropic Claude
    $ rosie -p openai -m gpt-4.1              # OpenAI GPT-4.1
    $ rosie -p openrouter                      # OpenRouter
    $ rosie --ui                               # rich terminal UI (Ink)

  Environment Variables
    XAI_API_KEY         xAI API key
    ANTHROPIC_API_KEY   Anthropic API key
    OPENAI_API_KEY      OpenAI API key
    GOOGLE_API_KEY      Google API key
    OPENROUTER_API_KEY  OpenRouter API key
    ROSIE_API_KEY       Generic fallback (any provider)

  Setup
    Run rosie and follow the interactive setup, or set the
    appropriate environment variable for your provider.
`,
  {
    importMeta: import.meta,
    flags: {
      provider: {
        type: 'string',
        shortFlag: 'p',
      },
      model: {
        type: 'string',
        shortFlag: 'm',
      },
      baseUrl: {
        type: 'string',
      },
      confirm: {
        type: 'boolean',
        default: true,
      },
      ui: {
        type: 'boolean',
        default: false,
      },
    },
  },
);

// CLI flag overrides (session-only, never persisted)
const cliOverrides: Partial<RosieConfig> = {};
if (cli.flags.provider) cliOverrides.provider = cli.flags.provider as ProviderID;
if (cli.flags.model) cliOverrides.model = cli.flags.model as string;
if (cli.flags.baseUrl) cliOverrides.baseUrl = cli.flags.baseUrl;
if (!cli.flags.confirm) cliOverrides.confirmTools = false;

// Node version gate
const nodeVersion = parseInt(process.versions.node.split('.')[0]!, 10);
if (nodeVersion < 18) {
  console.error(`\x1b[31mrosie requires Node.js 18 or later. You have ${process.versions.node}.\x1b[0m`);
  process.exit(1);
}

process.on('uncaughtException', (err) => {
  console.error(`\x1b[31mFatal error: ${err.message}\x1b[0m`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`\x1b[31mUnhandled rejection: ${reason}\x1b[0m`);
  if (process.env.DEBUG) console.error(reason);
});

// ── Launch ──

if (cli.flags.ui && process.stdin.isTTY) {
  // Rich Ink UI — requires TTY
  const React = await import('react');
  const { render } = await import('ink');
  const { App } = await import('./components/App.js');
  const { Setup } = await import('./components/Setup.js');
  const { getApiKey: getKey } = await import('./utils/config.js');
  const { setProjectRoot } = await import('./tools/sandbox.js');
  const { SessionManager } = await import('./core/session.js');

  setProjectRoot(process.cwd());

  function Root(): React.ReactElement {
    const [apiKey, setApiKey] = React.useState<string | null>(getKey());
    const [session] = React.useState(() => new SessionManager());

    React.useEffect(() => {
      session.start();
      return () => session.close();
    }, [session]);

    if (!apiKey) {
      return React.createElement(Setup, { onComplete: (key: string) => setApiKey(key) });
    }

    return React.createElement(App, { apiKey, configOverrides: cliOverrides });
  }

  render(React.createElement(Root));
} else {
  // Default: readline terminal — works everywhere
  const { startTerminal } = await import('./terminal.js');
  startTerminal(cliOverrides);
}
