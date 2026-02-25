import fs from 'node:fs/promises';
import path from 'node:path';
import type { Tool, ToolResult } from './types.js';
import { resolveSafePath, getProjectRoot } from './sandbox.js';

export const listDirTool: Tool = {
  name: 'list_directory',
  description:
    'List files and directories at a given path. Shows file types, sizes, and modification times. Useful for understanding project structure.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list. Defaults to project root.',
      },
      recursive: {
        type: 'boolean',
        description: 'List recursively (max 3 levels deep). Default: false',
      },
    },
    required: [],
  },
  requiresConfirmation: false,

  async execute(input): Promise<ToolResult> {
    const inputPath = (input.path as string) || '.';
    const recursive = (input.recursive as boolean) || false;

    let safePath: string;
    try {
      safePath = resolveSafePath(inputPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: msg, isError: true };
    }

    try {
      const stat = await fs.stat(safePath);
      if (!stat.isDirectory()) {
        return { content: `Not a directory: ${inputPath}`, isError: true };
      }

      const lines: string[] = [];
      await listDir(safePath, '', lines, recursive ? 3 : 1, 0);

      if (lines.length === 0) return { content: '(empty directory)' };
      return { content: lines.join('\n') };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error listing directory: ${msg}`, isError: true };
    }
  },
};

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'venv']);

async function listDir(
  dirPath: string,
  prefix: string,
  lines: string[],
  maxDepth: number,
  currentDepth: number,
): Promise<void> {
  if (currentDepth >= maxDepth) return;
  if (lines.length > 500) {
    lines.push('... (truncated at 500 entries)');
    return;
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  // Sort: directories first, then files, alphabetical within each group
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        lines.push(`${prefix}${entry.name}/  (skipped)`);
        continue;
      }
      lines.push(`${prefix}${entry.name}/`);
      await listDir(fullPath, prefix + '  ', lines, maxDepth, currentDepth + 1);
    } else {
      try {
        const stat = await fs.stat(fullPath);
        const size = formatSize(stat.size);
        lines.push(`${prefix}${entry.name}  ${size}`);
      } catch {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
