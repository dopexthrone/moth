import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme } from '../utils/theme.js';
import { saveApiKey, saveConfig } from '../utils/config.js';
import { detectProviderFromKey, getDefaultModel } from '../core/providers/catalog.js';
import type { ProviderID } from '../core/providers/types.js';

interface SetupProps {
  onComplete: (apiKey: string) => void;
}

const PROVIDERS: Array<{ id: ProviderID; name: string; keyPrefix: string; envVar: string }> = [
  { id: 'xai', name: 'xAI (Grok)', keyPrefix: 'xai-', envVar: 'XAI_API_KEY' },
  { id: 'anthropic', name: 'Anthropic (Claude)', keyPrefix: 'sk-ant-', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai', name: 'OpenAI (GPT)', keyPrefix: 'sk-', envVar: 'OPENAI_API_KEY' },
  { id: 'openrouter', name: 'OpenRouter (any model)', keyPrefix: 'sk-or-', envVar: 'OPENROUTER_API_KEY' },
  { id: 'google', name: 'Google (Gemini)', keyPrefix: '', envVar: 'GOOGLE_API_KEY' },
];

type SetupStep = 'provider' | 'apikey';

export function Setup({ onComplete }: SetupProps): React.ReactElement {
  const [step, setStep] = useState<SetupStep>('provider');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<ProviderID>('xai');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (step === 'provider') {
      if (key.upArrow) {
        setSelectedIdx((prev) => (prev > 0 ? prev - 1 : PROVIDERS.length - 1));
      } else if (key.downArrow) {
        setSelectedIdx((prev) => (prev < PROVIDERS.length - 1 ? prev + 1 : 0));
      } else if (key.return) {
        const provider = PROVIDERS[selectedIdx]!;
        setSelectedProvider(provider.id);
        setStep('apikey');
      }
      return;
    }

    // Step: apikey
    if (key.return) {
      const trimmed = apiKey.trim();
      if (trimmed.length < 10) {
        setError('API key seems too short. Check and try again.');
        return;
      }

      // Auto-detect provider from key if possible
      const detected = detectProviderFromKey(trimmed);
      const provider = detected || selectedProvider;
      const model = getDefaultModel(provider);

      saveApiKey(trimmed);
      saveConfig({ provider, model });
      onComplete(trimmed);
      return;
    }

    if (key.backspace || key.delete) {
      setApiKey((prev) => prev.slice(0, -1));
      setError('');
      return;
    }

    if (key.escape) {
      setStep('provider');
      setApiKey('');
      setError('');
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setApiKey((prev) => prev + input);
      setError('');
    }
  });

  const maskedKey = apiKey
    ? apiKey.slice(0, Math.min(8, apiKey.length)) + '•'.repeat(Math.max(0, apiKey.length - 8))
    : '';

  if (step === 'provider') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text color={theme.purple} bold>{'◈ rosie setup'}</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color={theme.text}>Select your AI provider:</Text>
        </Box>
        {PROVIDERS.map((p, i) => (
          <Box key={p.id} marginLeft={2}>
            <Text color={i === selectedIdx ? theme.purple : theme.textDim}>
              {i === selectedIdx ? '▸ ' : '  '}
              {p.name}
            </Text>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text color={theme.textDim}>↑↓ to select, Enter to confirm</Text>
        </Box>
      </Box>
    );
  }

  const provider = PROVIDERS.find((p) => p.id === selectedProvider)!;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color={theme.purple} bold>{'◈ rosie setup'}</Text>
        <Text color={theme.textDim}> — {provider.name}</Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text color={theme.textDim}>
          Paste your API key below.
        </Text>
        <Text color={theme.textDim}>
          Or set {provider.envVar} in your shell environment.
        </Text>
      </Box>

      <Box>
        <Text color={theme.purple}>API Key: </Text>
        <Text color={theme.userInput}>
          {maskedKey || <Text color={theme.textDim}>{provider.keyPrefix}...</Text>}
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
          Enter to save · Esc to go back · Key stored at ~/.config/rosie/.api-key
        </Text>
      </Box>
    </Box>
  );
}
