import fs from 'node:fs/promises';
import type { Tool, ToolResult } from './types.js';
import { resolveSafePath, isBinaryFile, MAX_READ_SIZE } from './sandbox.js';

export const readFileTool: Tool = {
  name: 'read_file',
  description:
    'Read the contents of a file at the given path. Returns the file content with line numbers. Paths are relative to the project root.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read (relative to project root or absolute within project)',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (1-indexed). Optional.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read. Optional, defaults to 2000.',
      },
    },
    required: ['path'],
  },
  requiresConfirmation: false,

  async execute(input): Promise<ToolResult> {
    const inputPath = input.path as string;
    const offset = (input.offset as number) || 1;
    const limit = (input.limit as number) || 2000;

    let safePath: string;
    try {
      safePath = resolveSafePath(inputPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: msg, isError: true };
    }

    try {
      // Check file size before reading
      const stat = await fs.stat(safePath);
      if (stat.size > MAX_READ_SIZE) {
        return {
          content: `File is too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Maximum: ${MAX_READ_SIZE / 1024 / 1024}MB. Use offset/limit to read portions.`,
          isError: true,
        };
      }

      // Check for binary
      if (await isBinaryFile(safePath)) {
        return {
          content: `File appears to be binary (${stat.size} bytes). Cannot display binary content.`,
          isError: true,
        };
      }

      const content = await fs.readFile(safePath, 'utf-8');
      const lines = content.split('\n');
      const startIdx = Math.max(0, offset - 1);
      const endIdx = Math.min(lines.length, startIdx + limit);
      const sliced = lines.slice(startIdx, endIdx);

      const maxLineNumWidth = String(endIdx).length;
      const numbered = sliced
        .map((line, i) => {
          const lineNum = String(startIdx + i + 1).padStart(maxLineNumWidth, ' ');
          // Truncate very long lines
          const truncated = line.length > 2000 ? line.slice(0, 2000) + '...' : line;
          return `${lineNum}\t${truncated}`;
        })
        .join('\n');

      const meta =
        endIdx < lines.length
          ? `\n(showing lines ${startIdx + 1}-${endIdx} of ${lines.length})`
          : '';

      return { content: (numbered || '(empty file)') + meta };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT')) {
        return { content: `File not found: ${inputPath}`, isError: true };
      }
      if (msg.includes('EACCES')) {
        return { content: `Permission denied: ${inputPath}`, isError: true };
      }
      return { content: `Error reading file: ${msg}`, isError: true };
    }
  },
};
