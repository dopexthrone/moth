/**
 * The agentic loop — the brain of moth.
 *
 * This is a proper state machine that drives the conversation cycle:
 *   user input → model call → tool execution → model call → ... → idle
 *
 * Key design decisions:
 * - The loop owns the conversation lifecycle, not the UI
 * - Tool execution is async with timeout + cancellation
 * - Context window is managed with automatic sliding window
 * - All state transitions emit events to the bus
 * - The loop is re-entrant safe (one turn at a time)
 */

import Anthropic from '@anthropic-ai/sdk';
import { bus, type MothEvent } from './event-bus.js';
import { type Tool, type ToolResult } from '../tools/types.js';
import { validateToolInput } from '../tools/validator.js';

export interface AgentConfig {
  model: string;
  maxTokens: number;
  maxTurns: number;          // hard ceiling on tool-use loops per user message
  toolTimeoutMs: number;     // per-tool execution timeout
  confirmDestructive: boolean;
  contextWindowTokens: number; // rough budget for conversation history
}

const DEFAULT_CONFIG: AgentConfig = {
  model: 'claude-sonnet-4-6',
  maxTokens: 8192,
  maxTurns: 25,
  toolTimeoutMs: 120_000,
  confirmDestructive: true,
  contextWindowTokens: 180_000,  // keep ~20k buffer from 200k context
};

const SYSTEM_PROMPT = `You are Moth, an AI coding assistant built by Motherlabs, powered by Claude.

You work in the user's terminal to help with software engineering: writing code, debugging, refactoring, explaining systems, running tests, managing git.

PROACTIVE BEHAVIOR:
- When you read files and notice bugs, mention them without being asked
- After completing a task, suggest logical next steps
- If tests are failing, offer to investigate the failures
- When you see code quality issues, flag them concisely
- If you notice missing error handling or edge cases, surface them

TOOL USAGE:
- Read files before modifying them — understand first
- Verify changes work by running relevant commands after edits
- Use search tools to find code rather than guessing file paths
- Make targeted edits, not full file rewrites
- Always explain what you're about to do before running destructive commands

COMMUNICATION:
- Be concise. Terminal space is limited.
- Use markdown for code blocks and formatting
- Reference specific file paths and line numbers
- State confidence levels when uncertain
- One sentence is better than one paragraph when both convey the same information`;

type LoopState =
  | 'idle'
  | 'calling_model'
  | 'processing_tools'
  | 'waiting_approval'
  | 'error';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | Anthropic.ContentBlockParam[];
}

export class AgentLoop {
  private client: Anthropic;
  private config: AgentConfig;
  private history: ConversationMessage[] = [];
  private state: LoopState = 'idle';
  private tools: Tool[] = [];
  private toolMap: Map<string, Tool> = new Map();
  private abortController: AbortController | null = null;
  private totalTokensIn = 0;
  private totalTokensOut = 0;
  private pendingApproval: {
    toolId: string;
    toolName: string;
    input: Record<string, unknown>;
    resolve: (approved: boolean) => void;
  } | null = null;

  constructor(apiKey: string, tools: Tool[], config?: Partial<AgentConfig>) {
    this.client = new Anthropic({ apiKey });
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tools = tools;
    for (const tool of tools) {
      this.toolMap.set(tool.name, tool);
    }

    // Listen for approval/denial events
    bus.on('tool:approved', (event) => {
      if (this.pendingApproval && this.pendingApproval.toolId === event.toolId) {
        this.pendingApproval.resolve(true);
      }
    });

    bus.on('tool:denied', (event) => {
      if (this.pendingApproval && this.pendingApproval.toolId === event.toolId) {
        this.pendingApproval.resolve(false);
      }
    });
  }

  get currentState(): LoopState {
    return this.state;
  }

  get usage(): { inputTokens: number; outputTokens: number } {
    return { inputTokens: this.totalTokensIn, outputTokens: this.totalTokensOut };
  }

  get historyLength(): number {
    return this.history.length;
  }

  /**
   * Process a user message through the full agentic cycle.
   * This is the main entry point — call once per user input.
   * Returns when the agent is done (no more tool calls to make).
   */
  async processMessage(userMessage: string): Promise<void> {
    if (this.state !== 'idle') {
      bus.emit({
        type: 'agent:error',
        error: new Error('Agent is busy. Wait for current turn to complete.'),
        recoverable: true,
        timestamp: Date.now(),
      });
      return;
    }

    this.history.push({ role: 'user', content: userMessage });
    this.trimContextIfNeeded();

    let turnsRemaining = this.config.maxTurns;

    // The agentic loop: model → tools → model → tools → ... → done
    while (turnsRemaining > 0) {
      turnsRemaining--;

      const assistantContent = await this.callModel();
      if (!assistantContent) break; // error occurred, already emitted

      // Extract tool uses from the response
      const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          toolUses.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      // No tool uses → agent is done with this turn
      if (toolUses.length === 0) {
        this.state = 'idle';
        break;
      }

      // Execute tools and collect results
      this.state = 'processing_tools';
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        const result = await this.executeTool(toolUse.id, toolUse.name, toolUse.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.content,
          is_error: result.isError ?? false,
        });
      }

      // Add tool results to history as a user message (per API spec)
      this.history.push({
        role: 'user',
        content: toolResults as unknown as Anthropic.ContentBlockParam[],
      });

      // Loop continues — model will see tool results and decide next action
    }

    if (turnsRemaining === 0) {
      bus.emit({
        type: 'agent:error',
        error: new Error(`Hit maximum turns (${this.config.maxTurns}). Stopping to prevent infinite loop.`),
        recoverable: true,
        timestamp: Date.now(),
      });
    }

    this.state = 'idle';
  }

  /**
   * Call the Claude API with streaming. Emits events as tokens arrive.
   * Returns the full content blocks array, or null on error.
   */
  private async callModel(): Promise<Anthropic.ContentBlock[] | null> {
    this.state = 'calling_model';
    this.abortController = new AbortController();

    bus.emit({ type: 'agent:thinking', timestamp: Date.now() });

    const anthropicTools: Anthropic.Tool[] = this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    try {
      const stream = this.client.messages.stream(
        {
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system: SYSTEM_PROMPT,
          messages: this.history as Anthropic.MessageParam[],
          tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        },
        { signal: this.abortController.signal },
      );

      let textAccumulator = '';

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            textAccumulator += event.delta.text;
            bus.emit({
              type: 'agent:text',
              delta: event.delta.text,
              timestamp: Date.now(),
            });
          }
        }
      }

      const finalMessage = await stream.finalMessage();

      // Emit text completion if there was text content
      if (textAccumulator) {
        bus.emit({
          type: 'agent:text:done',
          fullText: textAccumulator,
          timestamp: Date.now(),
        });
      }

      // Emit tool request events for the UI
      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          bus.emit({
            type: 'agent:tool_request',
            toolId: block.id,
            toolName: block.name,
            input: block.input as Record<string, unknown>,
            timestamp: Date.now(),
          });
        }
      }

      // Track usage
      this.totalTokensIn += finalMessage.usage.input_tokens;
      this.totalTokensOut += finalMessage.usage.output_tokens;

      bus.emit({
        type: 'agent:turn_complete',
        usage: {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
        },
        timestamp: Date.now(),
      });

      // Add assistant response to history
      this.history.push({
        role: 'assistant',
        content: finalMessage.content as unknown as Anthropic.ContentBlockParam[],
      });

      return finalMessage.content;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        bus.emit({
          type: 'agent:error',
          error: new Error('Request cancelled.'),
          recoverable: true,
          timestamp: Date.now(),
        });
        this.state = 'idle';
        return null;
      }

      const error = err instanceof Error ? err : new Error(String(err));

      // Classify the error for actionable handling
      const isRateLimit = error.message.includes('rate_limit') || error.message.includes('429');
      const isOverloaded = error.message.includes('overloaded') || error.message.includes('529');
      const isAuthError = error.message.includes('authentication') || error.message.includes('401');

      bus.emit({
        type: 'agent:error',
        error: isRateLimit
          ? new Error('Rate limited by Anthropic API. Wait a moment and try again.')
          : isOverloaded
            ? new Error('Anthropic API is overloaded. Try again in a few seconds.')
            : isAuthError
              ? new Error('API key is invalid or expired. Run moth with a new key.')
              : error,
        recoverable: !isAuthError,
        timestamp: Date.now(),
      });

      this.state = 'error';
      return null;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Execute a single tool with validation, confirmation, and timeout.
   */
  private async executeTool(
    toolId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tool = this.toolMap.get(toolName);
    if (!tool) {
      const result = { content: `Unknown tool: ${toolName}`, isError: true };
      bus.emit({
        type: 'tool:complete',
        toolId,
        content: result.content,
        isError: true,
        durationMs: 0,
        timestamp: Date.now(),
      });
      return result;
    }

    // Validate input against schema
    const validation = validateToolInput(tool, input);
    if (!validation.valid) {
      const result = {
        content: `Invalid input for ${toolName}: ${validation.errors.join(', ')}`,
        isError: true,
      };
      bus.emit({
        type: 'tool:complete',
        toolId,
        content: result.content,
        isError: true,
        durationMs: 0,
        timestamp: Date.now(),
      });
      return result;
    }

    // Check if tool needs user approval
    if (tool.requiresConfirmation && this.config.confirmDestructive) {
      const approved = await this.requestApproval(toolId, toolName, input);
      if (!approved) {
        const result = { content: 'Tool execution denied by user.', isError: true };
        bus.emit({
          type: 'tool:complete',
          toolId,
          content: result.content,
          isError: true,
          durationMs: 0,
          timestamp: Date.now(),
        });
        return result;
      }
    }

    // Execute with timeout
    bus.emit({
      type: 'tool:executing',
      toolId,
      toolName,
      timestamp: Date.now(),
    });

    const startTime = Date.now();

    try {
      const result = await Promise.race([
        tool.execute(input),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool ${toolName} timed out after ${this.config.toolTimeoutMs}ms`)),
            this.config.toolTimeoutMs,
          ),
        ),
      ]);

      const durationMs = Date.now() - startTime;

      bus.emit({
        type: 'tool:complete',
        toolId,
        content: result.content,
        isError: result.isError ?? false,
        durationMs,
        timestamp: Date.now(),
      });

      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);
      const result = { content: `Tool error: ${msg}`, isError: true };

      bus.emit({
        type: 'tool:complete',
        toolId,
        content: result.content,
        isError: true,
        durationMs,
        timestamp: Date.now(),
      });

      return result;
    }
  }

  /**
   * Request user approval for a tool execution.
   * Emits an event and waits for approval/denial via event bus.
   */
  private requestApproval(
    toolId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<boolean> {
    this.state = 'waiting_approval';

    bus.emit({
      type: 'tool:approval_required',
      toolId,
      toolName,
      input,
      timestamp: Date.now(),
    });

    return new Promise<boolean>((resolve) => {
      this.pendingApproval = { toolId, toolName, input, resolve };
    });
  }

  /**
   * Cancel the current operation (streaming or tool execution).
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.pendingApproval) {
      this.pendingApproval.resolve(false);
      this.pendingApproval = null;
    }
    this.state = 'idle';
  }

  /**
   * Trim conversation history when approaching context window limit.
   * Keeps system message + first user message + last N messages.
   * Rough estimation: 4 chars ≈ 1 token.
   */
  private trimContextIfNeeded(): void {
    const estimateTokens = (msg: ConversationMessage): number => {
      if (typeof msg.content === 'string') {
        return Math.ceil(msg.content.length / 4);
      }
      // Array content — estimate from stringified
      return Math.ceil(JSON.stringify(msg.content).length / 4);
    };

    let totalTokens = this.history.reduce((sum, msg) => sum + estimateTokens(msg), 0);

    if (totalTokens <= this.config.contextWindowTokens) return;

    // Keep first message (initial context) and trim from the front
    const first = this.history[0];
    let removed = 0;

    while (
      this.history.length > 2 &&
      totalTokens > this.config.contextWindowTokens * 0.8
    ) {
      const removed_msg = this.history.splice(1, 1)[0]!;
      totalTokens -= estimateTokens(removed_msg);
      removed++;
    }

    // Re-insert first if we accidentally removed it
    if (this.history[0] !== first && first) {
      this.history.unshift(first);
    }

    if (removed > 0) {
      bus.emit({
        type: 'session:context_trimmed',
        removedMessages: removed,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Clear conversation history and reset state.
   */
  clearHistory(): void {
    this.history = [];
    this.state = 'idle';
    this.totalTokensIn = 0;
    this.totalTokensOut = 0;
    bus.emit({ type: 'session:cleared', timestamp: Date.now() });
  }
}
