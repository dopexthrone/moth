import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../utils/theme.js';
import { tokenCount, elapsed } from '../utils/format.js';

export type AppStatus = 'idle' | 'thinking' | 'streaming' | 'tool_running' | 'error';

interface StatusBarProps {
  status: AppStatus;
  model: string;
  tokensIn: number;
  tokensOut: number;
  elapsedMs: number;
  currentTool?: string;
}

const STATUS_INDICATORS: Record<AppStatus, { symbol: string; color: string; label: string }> = {
  idle: { symbol: '●', color: theme.success, label: 'ready' },
  thinking: { symbol: '◌', color: theme.thinking, label: 'thinking...' },
  streaming: { symbol: '▸', color: theme.streaming, label: 'streaming' },
  tool_running: { symbol: '⚙', color: theme.toolRunning, label: 'running' },
  error: { symbol: '✗', color: theme.error, label: 'error' },
};

export function StatusBar({
  status,
  model,
  tokensIn,
  tokensOut,
  elapsedMs,
  currentTool,
}: StatusBarProps): React.ReactElement {
  const indicator = STATUS_INDICATORS[status];

  return (
    <Box borderStyle="single" borderColor={theme.border} paddingX={1}>
      <Box marginRight={2}>
        <Text color={indicator.color}>{indicator.symbol} </Text>
        <Text color={indicator.color}>{indicator.label}</Text>
        {currentTool && (
          <Text color={theme.toolRunning}> ({currentTool})</Text>
        )}
      </Box>
      <Box marginRight={2}>
        <Text color={theme.textDim}>model: </Text>
        <Text color={theme.textMuted}>{model}</Text>
      </Box>
      {(tokensIn > 0 || tokensOut > 0) && (
        <Box marginRight={2}>
          <Text color={theme.textDim}>tokens: </Text>
          <Text color={theme.textMuted}>
            ↑{tokenCount(tokensIn)} ↓{tokenCount(tokensOut)}
          </Text>
        </Box>
      )}
      {elapsedMs > 0 && (
        <Box>
          <Text color={theme.textDim}>time: </Text>
          <Text color={theme.textMuted}>{elapsed(elapsedMs)}</Text>
        </Box>
      )}
    </Box>
  );
}
