export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
  requiresConfirmation?: boolean;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}
