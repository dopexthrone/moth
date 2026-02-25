import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import meow from 'meow';
import { App } from './components/App.js';
import { Setup } from './components/Setup.js';
import { getApiKey, loadConfig, saveConfig } from './utils/config.js';
import { setProjectRoot } from './tools/sandbox.js';
import { SessionManager } from './core/session.js';
import { theme } from './utils/theme.js';

const cli = meow(
  `
  Usage
    $ moth [options]

  Options
    --model, -m     Claude model to use (default: claude-sonnet-4-6)
    --no-confirm    Skip tool confirmation prompts
    --version, -v   Show version
    --help, -h      Show this help

  Examples
    $ moth
    $ moth --model claude-opus-4-6
    $ moth --no-confirm

  Setup
    Set ANTHROPIC_API_KEY environment variable, or run moth
    and follow the interactive setup.
`,
  {
    importMeta: import.meta,
    flags: {
      model: {
        type: 'string',
        shortFlag: 'm',
      },
      confirm: {
        type: 'boolean',
        default: true,
      },
    },
  },
);

// Apply CLI flag overrides to config
if (cli.flags.model) {
  saveConfig({ model: cli.flags.model });
}
if (!cli.flags.confirm) {
  saveConfig({ confirmTools: false });
}

// Set project root to current working directory
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

  return <App apiKey={apiKey} />;
}

// Check Node version
const nodeVersion = parseInt(process.versions.node.split('.')[0]!, 10);
if (nodeVersion < 18) {
  console.error(
    `\x1b[31mmoth requires Node.js 18 or later. You have ${process.versions.node}.\x1b[0m`,
  );
  process.exit(1);
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  console.error(`\x1b[31mFatal error: ${err.message}\x1b[0m`);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`\x1b[31mUnhandled rejection: ${reason}\x1b[0m`);
  if (process.env.DEBUG) {
    console.error(reason);
  }
});

render(<Root />);
