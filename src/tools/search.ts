import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolResult } from './types.js';
import { resolveSafePath, getProjectRoot } from './sandbox.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export const grepTool: Tool = {
  name: 'grep_search',
  description:
    'Search file contents using ripgrep (rg) or grep. Returns matching lines with file paths and line numbers. Supports regex.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'Directory or file to search in. Defaults to project root.',
      },
      glob: {
        type: 'string',
        description: 'File glob pattern to filter (e.g., "*.ts", "*.py")',
      },
      case_insensitive: {
        type: 'boolean',
        description: 'Case insensitive search. Default: false',
      },
    },
    required: ['pattern'],
  },
  requiresConfirmation: false,

  async execute(input): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchDir = input.path as string | undefined;
    const glob = input.glob as string | undefined;
    const caseInsensitive = input.case_insensitive as boolean;

    // Validate search path
    let safePath: string;
    try {
      safePath = searchDir ? resolveSafePath(searchDir) : getProjectRoot();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: msg, isError: true };
    }

    // Build args array (no shell interpolation — safe from injection)
    const useRg = await commandExists('rg');

    try {
      let stdout: string;

      if (useRg) {
        const args = ['--line-number', '--no-heading', '--color=never', '--max-count=200'];
        if (caseInsensitive) args.push('-i');
        if (glob) args.push('--glob', glob);
        args.push('--', pattern, safePath);

        const result = await execFileAsync('rg', args, {
          maxBuffer: 500_000,
          timeout: 30_000,
        });
        stdout = result.stdout;
      } else {
        const args = ['-rn', '--max-count=200'];
        if (caseInsensitive) args.push('-i');
        if (glob) args.push(`--include=${glob}`);
        args.push('--', pattern, safePath);

        const result = await execFileAsync('grep', args, {
          maxBuffer: 500_000,
          timeout: 30_000,
        });
        stdout = result.stdout;
      }

      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return { content: 'No matches found.' };

      if (lines.length > 100) {
        return {
          content: lines.slice(0, 100).join('\n') + `\n\n(showing 100 of ${lines.length} matches)`,
        };
      }

      return { content: lines.join('\n') };
    } catch (err: unknown) {
      // Exit code 1 = no matches (grep/rg convention)
      if (isExitCode(err, 1)) {
        return { content: 'No matches found.' };
      }
      // Exit code 2 = pattern error
      if (isExitCode(err, 2)) {
        return { content: `Invalid search pattern: "${pattern}". Check regex syntax.`, isError: true };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Search error: ${msg}`, isError: true };
    }
  },
};

export const globTool: Tool = {
  name: 'glob_search',
  description:
    'Find files matching a glob pattern. Uses find command. Returns file paths.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob-style pattern (e.g., "*.ts", "*.test.js"). Matches file names, not full paths.',
      },
      path: {
        type: 'string',
        description: 'Base directory to search from. Defaults to project root.',
      },
    },
    required: ['pattern'],
  },
  requiresConfirmation: false,

  async execute(input): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchDir = input.path as string | undefined;

    let safePath: string;
    try {
      safePath = searchDir ? resolveSafePath(searchDir) : getProjectRoot();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: msg, isError: true };
    }

    try {
      // Use find with -name (safe: pattern is passed as argument, not interpolated)
      const args = [
        safePath,
        '-not', '-path', '*/node_modules/*',
        '-not', '-path', '*/.git/*',
        '-not', '-path', '*/dist/*',
        '-type', 'f',
        '-name', pattern,
      ];

      const { stdout } = await execFileAsync('find', args, {
        maxBuffer: 200_000,
        timeout: 15_000,
      });

      const files = stdout.trim().split('\n').filter(Boolean);
      if (files.length === 0) return { content: 'No files found.' };

      // Show relative paths for readability
      const relative = files.map((f) => f.replace(getProjectRoot() + '/', ''));

      if (relative.length > 100) {
        return {
          content: relative.slice(0, 100).join('\n') + `\n\n(showing 100 of ${relative.length} files)`,
        };
      }

      return { content: relative.join('\n') };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Search error: ${msg}`, isError: true };
    }
  },
};

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

function isExitCode(err: unknown, code: number): boolean {
  return !!(err && typeof err === 'object' && 'code' in err && (err as { code: unknown }).code === code);
}
