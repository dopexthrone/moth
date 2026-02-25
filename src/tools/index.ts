import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';
import { editFileTool } from './edit-file.js';
import { bashTool } from './bash.js';
import { grepTool, globTool } from './search.js';
import { listDirTool } from './list-dir.js';
import type { Tool } from './types.js';

export const allTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  bashTool,
  grepTool,
  globTool,
  listDirTool,
];

export function getToolByName(name: string): Tool | undefined {
  return allTools.find((t) => t.name === name);
}

export type { Tool, ToolResult } from './types.js';
