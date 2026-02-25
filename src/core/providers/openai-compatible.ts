/**
 * OpenAI-compatible provider adapter.
 * Covers: xAI (Grok), OpenAI (GPT), OpenRouter, Google (via OpenRouter), custom endpoints.
 *
 * Uses the standard OpenAI chat completions API format which most providers support.
 * No SDK dependency — raw fetch for maximum compatibility and zero version coupling.
 */

import type {
  ModelProvider,
  ChatMessage,
  ToolDefinition,
  ProviderEvent,
  ContentBlock,
  ProviderID,
} from './types.js';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly displayName: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private extraHeaders: Record<string, string>;

  constructor(config: {
    providerId: ProviderID;
    displayName: string;
    apiKey: string;
    baseUrl: string;
    model: string;
    extraHeaders?: Record<string, string>;
  }) {
    this.id = config.providerId;
    this.displayName = config.displayName;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, ''); // strip trailing slashes
    this.model = config.model;
    this.extraHeaders = config.extraHeaders || {};
  }

  async *streamChat(params: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    systemPrompt?: string;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<ProviderEvent> {
    const messages = this.convertMessages(params.messages, params.systemPrompt);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      max_tokens: params.maxTokens || 8192,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      yield {
        type: 'error',
        error: new Error(`${this.displayName} API error ${response.status}: ${errorText}`),
      };
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: new Error('No response body') };
      return;
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    // Track tool calls being assembled
    const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6);
          let parsed: any;
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            continue; // malformed SSE line, skip
          }

          // Extract usage if present (some providers include it in the stream)
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens || parsed.usage.input_tokens || 0;
            outputTokens = parsed.usage.completion_tokens || parsed.usage.output_tokens || 0;
          }

          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            yield { type: 'text_delta', text: delta.content };
          }

          // Tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;

              if (tc.id) {
                // New tool call starting
                pendingToolCalls.set(index, {
                  id: tc.id,
                  name: tc.function?.name || '',
                  args: tc.function?.arguments || '',
                });
                if (tc.function?.name) {
                  yield { type: 'tool_call_start', id: tc.id, name: tc.function.name };
                }
              } else if (pendingToolCalls.has(index)) {
                // Continuing an existing tool call
                const pending = pendingToolCalls.get(index)!;
                if (tc.function?.name) {
                  pending.name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  pending.args += tc.function.arguments;
                  yield { type: 'tool_call_delta', id: pending.id, args: tc.function.arguments };
                }
              }
            }
          }

          // Check for finish
          if (choice.finish_reason) {
            // Emit completed tool calls
            for (const [, tc] of pendingToolCalls) {
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(tc.args);
              } catch {
                // Malformed tool args
              }
              yield { type: 'tool_call_end', id: tc.id, name: tc.name, input };
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: 'done',
      usage: { inputTokens, outputTokens },
    };
  }

  private convertMessages(messages: ChatMessage[], systemPrompt?: string): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        if (msg.role === 'tool' && msg.toolCallId) {
          result.push({
            role: 'tool',
            content: msg.content,
            tool_call_id: msg.toolCallId,
          });
        } else {
          result.push({
            role: msg.role === 'tool' ? 'user' : msg.role as 'user' | 'assistant',
            content: msg.content,
          });
        }
      } else {
        // Content block array — convert to OpenAI format
        const textParts: string[] = [];
        const toolCalls: OpenAIMessage['tool_calls'] = [];
        const toolResults: OpenAIMessage[] = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          } else if (block.type === 'tool_result') {
            toolResults.push({
              role: 'tool',
              content: block.content,
              tool_call_id: block.toolCallId,
            });
          }
        }

        if (msg.role === 'assistant') {
          const assistantMsg: OpenAIMessage = {
            role: 'assistant',
            content: textParts.join('\n') || null,
          };
          if (toolCalls.length > 0) {
            assistantMsg.tool_calls = toolCalls;
          }
          result.push(assistantMsg);
        } else if (msg.role === 'user' && toolResults.length > 0) {
          // Tool results go as separate tool messages
          for (const tr of toolResults) {
            result.push(tr);
          }
        } else {
          result.push({
            role: msg.role as 'user' | 'assistant',
            content: textParts.join('\n'),
          });
        }
      }
    }

    return result;
  }

  private convertTools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }
}
