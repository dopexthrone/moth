/**
 * Security sandbox for tool execution.
 * All file paths are resolved and validated against the project root.
 * All shell commands use execFile (no shell interpretation) where possible.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

let projectRoot: string = process.cwd();

/**
 * Set the project root directory. All file operations are sandboxed to this directory.
 */
export function setProjectRoot(root: string): void {
  projectRoot = path.resolve(root);
}

export function getProjectRoot(): string {
  return projectRoot;
}

/**
 * Resolve and validate a file path against the project root.
 * Prevents path traversal attacks (../ etc).
 * Returns the resolved absolute path, or throws if outside sandbox.
 */
export function resolveSafePath(inputPath: string): string {
  const resolved = path.resolve(projectRoot, inputPath);
  const normalized = path.normalize(resolved);

  // Must be within project root
  if (!normalized.startsWith(projectRoot + path.sep) && normalized !== projectRoot) {
    throw new PathTraversalError(inputPath, projectRoot);
  }

  return normalized;
}

/**
 * Check if a path is safe to access (exists and is within sandbox).
 * Does NOT throw — returns null if unsafe.
 */
export async function safeStat(inputPath: string): Promise<{
  path: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
} | null> {
  try {
    const resolved = resolveSafePath(inputPath);
    const lstat = await fs.lstat(resolved);

    // If it's a symlink, check where it points
    if (lstat.isSymbolicLink()) {
      const realPath = await fs.realpath(resolved);
      if (!realPath.startsWith(projectRoot + path.sep) && realPath !== projectRoot) {
        return null; // Symlink points outside sandbox
      }
    }

    return {
      path: resolved,
      isFile: lstat.isFile(),
      isDirectory: lstat.isDirectory(),
      isSymlink: lstat.isSymbolicLink(),
      size: lstat.size,
    };
  } catch {
    return null;
  }
}

export class PathTraversalError extends Error {
  constructor(inputPath: string, root: string) {
    super(`Path "${inputPath}" resolves outside project root "${root}". Access denied.`);
    this.name = 'PathTraversalError';
  }
}

/**
 * Maximum file size for reading (10MB).
 * Binary files and very large files should be handled differently.
 */
export const MAX_READ_SIZE = 10 * 1024 * 1024;

/**
 * Check if a file appears to be binary by reading the first 8KB.
 */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const fd = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fd.read(buf, 0, 8192, 0);
    await fd.close();

    // Check for null bytes — strong indicator of binary
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}
