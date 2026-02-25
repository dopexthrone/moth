import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme } from '../utils/theme.js';
import { saveApiKey } from '../utils/config.js';

interface SetupProps {
  onComplete: (apiKey: string) => void;
}

export function Setup({ onComplete }: SetupProps): React.ReactElement {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (key.return) {
      const trimmed = apiKey.trim();
      if (!trimmed.startsWith('sk-ant-')) {
        setError('API key should start with "sk-ant-". Please try again.');
        return;
      }
      if (trimmed.length < 20) {
        setError('API key seems too short. Please check and try again.');
        return;
      }
      saveApiKey(trimmed);
      onComplete(trimmed);
      return;
    }

    if (key.backspace || key.delete) {
      setApiKey((prev) => prev.slice(0, -1));
      setError('');
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setApiKey((prev) => prev + input);
      setError('');
    }
  });

  const maskedKey = apiKey ? apiKey.slice(0, 7) + '•'.repeat(Math.max(0, apiKey.length - 7)) : '';

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color={theme.purple} bold>
          {'◈ moth setup'}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={theme.text}>
          Welcome! Moth needs your Anthropic API key to get started.
        </Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text color={theme.textDim}>
          Get your key at: console.anthropic.com/settings/keys
        </Text>
        <Text color={theme.textDim}>
          Or set ANTHROPIC_API_KEY environment variable.
        </Text>
      </Box>

      <Box>
        <Text color={theme.purple}>API Key: </Text>
        <Text color={theme.userInput}>
          {maskedKey || <Text color={theme.textDim}>sk-ant-...</Text>}
          <Text color={theme.purple}>▌</Text>
        </Text>
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color={theme.error}>✗ {error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.textDim}>
          Press Enter to save. Your key is stored locally at ~/.config/moth/.api-key
        </Text>
      </Box>
    </Box>
  );
}
