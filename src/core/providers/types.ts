/**
 * Provider-agnostic types for model interaction.
 * Every provider adapter must conform to this interface.
 * The agent loop operates exclusively through these types —
 * it never touches provider-specific SDKs directly.
 */

/** A message in the conversation history */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCallId?: string;   // for role=tool: which tool call this responds to
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolCallId: string; content: string; isError: boolean };

/** Tool definition sent to the model */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Streaming events emitted by providers */
export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; args: string }
  | { type: 'tool_call_end'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done'; usage: TokenUsage }
  | { type: 'error'; error: Error };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** The response after a full model turn completes */
export interface ModelResponse {
  content: ContentBlock[];
  usage: TokenUsage;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop';
}

/**
 * The provider interface. Every model provider implements this.
 * The agent loop calls streamChat() and iterates the async generator.
 */
export interface ModelProvider {
  readonly id: string;
  readonly displayName: string;

  /**
   * Stream a chat completion. Yields events as tokens arrive.
   * Must handle tool definitions and multi-turn conversation.
   */
  streamChat(params: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    systemPrompt?: string;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<ProviderEvent>;
}

/**
 * Provider configuration — what the user provides to connect.
 */
export interface ProviderConfig {
  provider: ProviderID;
  apiKey: string;
  model: string;
  baseUrl?: string;  // for custom endpoints (local models, proxies)
}

export type ProviderID = 'anthropic' | 'xai' | 'openai' | 'google' | 'openrouter' | 'custom';

/**
 * Model catalog entry — what models are available per provider.
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderID;
  contextWindow: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  costPer1kInput?: number;   // USD
  costPer1kOutput?: number;  // USD
}
