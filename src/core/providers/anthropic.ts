/**
 * Anthropic (Claude) native provider adapter.
 * Uses the Anthropic SDK directly for best compatibility with Claude-specific features.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ModelProvider,
  ChatMessage,
  ToolDefinition,
  ProviderEvent,
  ContentBlock,
} from './types.js';

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic' as const;
  readonly displayName = 'Anthropic (Claude)';
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async *streamChat(params: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    systemPrompt?: string;
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<ProviderEvent> {
    const messages = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: params.maxTokens || 8192,
          system: params.systemPrompt || undefined,
          messages,
          tools: tools && tools.length > 0 ? tools : undefined,
        },
        { signal: params.signal },
      );

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text_delta', text: event.delta.text };
          }
        } else if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            yield {
              type: 'tool_call_start',
              id: event.content_block.id,
              name: event.content_block.name,
            };
          }
        }
      }

      const final = await stream.finalMessage();

      // Emit completed tool calls from final message
      for (const block of final.content) {
        if (block.type === 'tool_use') {
          yield {
            type: 'tool_call_end',
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          };
        }
      }

      yield {
        type: 'done',
        usage: {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        yield { type: 'error', error: new Error('Request cancelled.') };
        return;
      }
      yield {
        type: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  private convertMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue; // system prompt handled separately

      if (typeof msg.content === 'string') {
        result.push({
          role: msg.role === 'tool' ? 'user' : msg.role,
          content: msg.content,
        });
      } else {
        // Convert content blocks to Anthropic format
        const blocks: Anthropic.ContentBlockParam[] = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            blocks.push({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            blocks.push({
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: block.input,
            });
          } else if (block.type === 'tool_result') {
            blocks.push({
              type: 'tool_result',
              tool_use_id: block.toolCallId,
              content: block.content,
              is_error: block.isError,
            } as unknown as Anthropic.ContentBlockParam);
          }
        }

        result.push({
          role: msg.role === 'tool' ? 'user' : msg.role,
          content: blocks,
        });
      }
    }

    return result;
  }

  private convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));
  }
}
