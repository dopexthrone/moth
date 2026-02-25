import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../utils/theme.js';
import { loadConfig } from '../utils/config.js';

export function Banner(): React.ReactElement {
  const config = loadConfig();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={theme.purple} bold>
          {'  ◈ moth '}
        </Text>
        <Text color={theme.textMuted}>v0.1.0</Text>
        <Text color={theme.textDim}> — </Text>
        <Text color={theme.coral}>{config.provider}</Text>
        <Text color={theme.textDim}>/{config.model}</Text>
      </Box>
      <Box>
        <Text color={theme.border}>
          {'  ─────────────────────────────────────────'}
        </Text>
      </Box>
      <Box>
        <Text color={theme.textDim}>
          {'  Type a message to start. /help for commands. Ctrl+C to exit.'}
        </Text>
      </Box>
    </Box>
  );
}
