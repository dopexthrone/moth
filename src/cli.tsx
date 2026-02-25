import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import meow from 'meow';
import { App } from './components/App.js';
import { Setup } from './components/Setup.js';
import { getApiKey } from './utils/config.js';
import { setProjectRoot } from './tools/sandbox.js';
import { SessionManager } from './core/session.js';
import type { ProviderID } from './core/providers/types.js';

const cli = meow(
  `
  Usage
    $ rosie [options]

  Options
    --provider, -p  AI provider: xai, anthropic, openai, google, openrouter, custom
    --model, -m     Model ID (e.g., grok-3-beta, claude-sonnet-4-6, gpt-4.1-mini)
    --base-url      Custom API base URL (for self-hosted or proxied endpoints)
    --no-confirm    Skip tool confirmation prompts
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
    },
  },
);

// Apply CLI flag overrides as session-only overrides (don't persist to config file)
const cliOverrides: Partial<import('./utils/config.js').RosieConfig> = {};
if (cli.flags.provider) cliOverrides.provider = cli.flags.provider as ProviderID;
if (cli.flags.model) cliOverrides.model = cli.flags.model as string;
if (cli.flags.baseUrl) cliOverrides.baseUrl = cli.flags.baseUrl;
if (!cli.flags.confirm) cliOverrides.confirmTools = false;

setProjectRoot(process.cwd());

function Root(): React.ReactElement {
  const [apiKey, setApiKey] = useState<string | null>(getApiKey());
  const [session] = useState(() => new SessionManager());

  useEffect(() => {
    session.start();
    return () => session.close();
  }, [session]);

  if (!apiKey) {
    return <Setup onComplete={(key) => setApiKey(key)} />;
  }

  return <App apiKey={apiKey} configOverrides={cliOverrides} />;
}

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

render(<Root />);
