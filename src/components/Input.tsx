import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../utils/theme.js';

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function Input({ onSubmit, disabled = false, placeholder }: InputProps): React.ReactElement {
  const [value, setValue] = useState('');

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.return) {
        if (value.trim()) {
          onSubmit(value.trim());
          setValue('');
        }
        return;
      }

      if (key.backspace || key.delete) {
        setValue((prev) => prev.slice(0, -1));
        return;
      }

      // Ctrl+C is handled at the App level for cancel/exit logic
      if (key.ctrl && input === 'c') return;

      if (key.ctrl && input === 'l') {
        // Clear would need app-level handler
        return;
      }

      // Regular character input
      if (input && !key.ctrl && !key.meta) {
        setValue((prev) => prev + input);
      }
    },
    { isActive: !disabled },
  );

  return (
    <Box marginTop={1}>
      <Box marginRight={1}>
        <Text color={theme.purple} bold>
          {'▸'}
        </Text>
      </Box>
      <Box>
        {value ? (
          <Text color={theme.userInput}>
            {value}
            <Text color={theme.purple}>▌</Text>
          </Text>
        ) : (
          <Text color={theme.textDim}>
            {placeholder || 'Ask anything...'}
            <Text color={theme.purple}>▌</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}

interface ConfirmProps {
  message: string;
  onConfirm: (yes: boolean) => void;
}

export function Confirm({ message, onConfirm }: ConfirmProps): React.ReactElement {
  useInput((input) => {
    if (input === 'y' || input === 'Y') {
      onConfirm(true);
    } else if (input === 'n' || input === 'N') {
      onConfirm(false);
    }
  });

  return (
    <Box marginLeft={4}>
      <Text color={theme.coral}>
        {message}{' '}
      </Text>
      <Text color={theme.textDim}>(y/n) </Text>
    </Box>
  );
}
