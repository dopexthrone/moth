import chalk from 'chalk';
import { theme } from './theme.js';

// Brand-colored chalk instances
export const brand = chalk.hex(theme.purple);
export const brandLight = chalk.hex(theme.purpleLight);
export const accent = chalk.hex(theme.coral);
export const textColor = chalk.hex(theme.text);
export const mutedColor = chalk.hex(theme.textMuted);
export const dimColor = chalk.hex(theme.textDim);
export const successColor = chalk.hex(theme.success);
export const errorColor = chalk.hex(theme.error);
export const warningColor = chalk.hex(theme.warning);

// Styled elements
export const prompt = brand.bold('moth ▸');
export const arrow = brand('▸');
export const dot = brandLight('●');
export const check = successColor('✓');
export const cross = errorColor('✗');
export const warn = warningColor('⚠');

export function boxLine(text: string, width = 60): string {
  const line = chalk.hex(theme.border)('─'.repeat(width));
  return `${line}\n${text}\n${line}`;
}

export function statusLine(label: string, value: string): string {
  return `${mutedColor(label)} ${textColor(value)}`;
}

export function tokenCount(count: number): string {
  if (count < 1000) return `${count}`;
  return `${(count / 1000).toFixed(1)}k`;
}

export function elapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format markdown-like text for terminal display.
 * Handles basic formatting: **bold**, `code`, headers.
 */
export function formatMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, (_, content) => chalk.bold(content))
    .replace(/`([^`]+)`/g, (_, content) => brand(content))
    .replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes, content) => {
      const level = hashes.length;
      if (level === 1) return brand.bold.underline(content);
      if (level === 2) return brand.bold(content);
      return brand(content);
    });
}
