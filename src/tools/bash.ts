import { spawn } from 'node:child_process';
import type { Tool, ToolResult } from './types.js';
import { getProjectRoot } from './sandbox.js';

const DEFAULT_TIMEOUT = 120_000;
const MAX_OUTPUT = 200_000; // 200KB

export const bashTool: Tool = {
  name: 'bash',
  description:
    'Execute a bash command and return stdout + stderr. Commands run in the project root directory. Dangerous commands are blocked.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds. Default: 120000 (2 minutes)',
      },
    },
    required: ['command'],
  },
  requiresConfirmation: true,

  async execute(input): Promise<ToolResult> {
    const command = input.command as string;
    const timeout = (input.timeout as number) || DEFAULT_TIMEOUT;

    // Block commands that could damage the system
    const blocked = isBlockedCommand(command);
    if (blocked) {
      return {
        content: `Blocked: ${blocked}`,
        isError: true,
      };
    }

    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      let killed = false;

      // Use spawn with shell for consistent behavior, but with safety checks done above
      // Don't use spawn's built-in timeout — manage it ourselves for proper SIGKILL escalation
      const proc = spawn('bash', ['-c', command], {
        cwd: getProjectRoot(),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const collectOutput = (data: Buffer): void => {
        if (totalSize >= MAX_OUTPUT) return;
        const remaining = MAX_OUTPUT - totalSize;
        const chunk = data.length > remaining ? data.subarray(0, remaining) : data;
        chunks.push(chunk);
        totalSize += chunk.length;
      };

      proc.stdout?.on('data', collectOutput);
      proc.stderr?.on('data', collectOutput);

      // Enforce timeout via kill
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

      killTimer = setTimeout(() => {
        if (!proc.killed) {
          killed = true;
          proc.kill('SIGTERM');
          // Force kill after grace period
          forceKillTimer = setTimeout(() => {
            if (!proc.killed) proc.kill('SIGKILL');
          }, 5000);
        }
      }, timeout);

      proc.on('error', (err) => {
        clearTimeout(killTimer);
        clearTimeout(forceKillTimer);
        resolve({
          content: `Failed to execute: ${err.message}`,
          isError: true,
        });
      });

      proc.on('close', (code, signal) => {
        clearTimeout(killTimer);
        clearTimeout(forceKillTimer);

        let output = Buffer.concat(chunks).toString('utf-8');

        if (totalSize >= MAX_OUTPUT) {
          output += '\n... (output truncated at 200KB)';
        }

        if (signal === 'SIGTERM' || killed) {
          output += `\n(killed: timeout after ${timeout}ms)`;
        }

        resolve({
          content: output || `(no output, exit code: ${code})`,
          isError: code !== 0,
        });
      });
    });
  },
};

/**
 * Check if a command should be blocked.
 * Returns a reason string if blocked, null if allowed.
 *
 * Strategy: block known-destructive patterns rather than allowlisting.
 * This is imperfect (shell is Turing-complete) but catches common cases.
 * The confirmation prompt is the real safety gate.
 */
function isBlockedCommand(command: string): string | null {
  const normalized = command.toLowerCase().trim();

  // System-destroying commands
  const destructive = [
    { pattern: /\brm\s+(-[a-z]*f[a-z]*\s+)?\/($|\s)/, reason: 'rm at filesystem root' },
    { pattern: /\bmkfs\b/, reason: 'filesystem formatting' },
    { pattern: /\bdd\s+.*\bof=\/dev\//, reason: 'raw device write' },
    { pattern: /:\(\)\{.*\|.*&.*\};:/, reason: 'fork bomb' },
    { pattern: /\b(shutdown|reboot|halt|poweroff)\b/, reason: 'system power control' },
    { pattern: />\s*\/dev\/sd[a-z]/, reason: 'raw device write' },
    { pattern: />\s*\/dev\/nvme/, reason: 'raw device write' },
    { pattern: /\bchmod\s+(-R\s+)?[0-7]*\s+\/($|\s)/, reason: 'recursive permission change at root' },
    { pattern: /\bchown\s+(-R\s+)?.*\s+\/($|\s)/, reason: 'recursive ownership change at root' },
    { pattern: /\bcurl\s.*\|\s*(bash|sh|zsh)/, reason: 'pipe remote script to shell' },
    { pattern: /\bwget\s.*\|\s*(bash|sh|zsh)/, reason: 'pipe remote script to shell' },
  ];

  for (const { pattern, reason } of destructive) {
    if (pattern.test(normalized)) {
      return `Command blocked: ${reason}. If this is intentional, run it directly in your terminal.`;
    }
  }

  return null;
}
