import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Tool, ToolResult } from './types.js';
import { resolveSafePath } from './sandbox.js';

export const editFileTool: Tool = {
  name: 'edit_file',
  description:
    'Edit a file by replacing an exact string match with new content. The old_string must appear exactly once in the file. Write atomically via temp file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to edit',
      },
      old_string: {
        type: 'string',
        description: 'The exact string to find and replace. Must be unique in the file.',
      },
      new_string: {
        type: 'string',
        description: 'The replacement string',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  requiresConfirmation: true,

  async execute(input): Promise<ToolResult> {
    const inputPath = input.path as string;
    const oldStr = input.old_string as string;
    const newStr = input.new_string as string;

    if (oldStr === newStr) {
      return { content: 'old_string and new_string are identical. No change needed.', isError: true };
    }

    let safePath: string;
    try {
      safePath = resolveSafePath(inputPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: msg, isError: true };
    }

    try {
      const content = await fs.readFile(safePath, 'utf-8');

      // Count occurrences
      let count = 0;
      let searchFrom = 0;
      while (true) {
        const idx = content.indexOf(oldStr, searchFrom);
        if (idx === -1) break;
        count++;
        searchFrom = idx + oldStr.length;
      }

      if (count === 0) {
        return {
          content: `String not found in ${inputPath}. Verify the exact content including whitespace and newlines.`,
          isError: true,
        };
      }

      if (count > 1) {
        return {
          content: `Found ${count} occurrences of old_string in ${inputPath}. Must be unique — provide more surrounding context to disambiguate.`,
          isError: true,
        };
      }

      const newContent = content.replace(oldStr, newStr);

      // Atomic write
      const tmpPath = path.join(os.tmpdir(), `moth-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await fs.writeFile(tmpPath, newContent, 'utf-8');

      try {
        await fs.rename(tmpPath, safePath);
      } catch {
        await fs.copyFile(tmpPath, safePath);
        await fs.unlink(tmpPath).catch(() => {});
      }

      const oldLines = oldStr.split('\n').length;
      const newLines = newStr.split('\n').length;
      const delta = newLines - oldLines;
      const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '±0';

      return {
        content: `Edited: ${safePath} (replaced ${oldStr.length} → ${newStr.length} chars, ${deltaStr} lines)`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT')) {
        return { content: `File not found: ${inputPath}`, isError: true };
      }
      return { content: `Error editing file: ${msg}`, isError: true };
    }
  },
};
