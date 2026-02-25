import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Tool, ToolResult } from './types.js';
import { resolveSafePath } from './sandbox.js';

export const writeFileTool: Tool = {
  name: 'write_file',
  description:
    'Write content to a file. Creates the file if it does not exist. Overwrites if it does. Creates parent directories as needed. Writes atomically via temp file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to write (relative to project root)',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
  requiresConfirmation: true,

  async execute(input): Promise<ToolResult> {
    const inputPath = input.path as string;
    const content = input.content as string;

    let safePath: string;
    try {
      safePath = resolveSafePath(inputPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: msg, isError: true };
    }

    try {
      const dir = path.dirname(safePath);
      await fs.mkdir(dir, { recursive: true, mode: 0o755 });

      // Atomic write: write to temp file, then rename
      const tmpPath = path.join(os.tmpdir(), `rosie-write-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await fs.writeFile(tmpPath, content, 'utf-8');

      try {
        await fs.rename(tmpPath, safePath);
      } catch {
        // Cross-device rename fails — fall back to copy + delete
        await fs.copyFile(tmpPath, safePath);
        await fs.unlink(tmpPath).catch(() => {});
      }

      const lineCount = content.split('\n').length;
      return {
        content: `Written: ${safePath} (${content.length} bytes, ${lineCount} lines)`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error writing file: ${msg}`, isError: true };
    }
  },
};
