/**
 * The agentic loop — the brain of Rosie.
 *
 * This is a proper state machine that drives the conversation cycle:
 *   user input → model call → tool execution → model call → ... → idle
 *
 * PROVIDER-AGNOSTIC: Operates through the ModelProvider interface.
 * Supports xAI, Anthropic, OpenAI, Google, OpenRouter, custom endpoints.
 */

import { bus } from './event-bus.js';
import { type Tool, type ToolResult } from '../tools/types.js';
import { validateToolInput } from '../tools/validator.js';
import type { ModelProvider, ChatMessage, ContentBlock, ToolDefinition, ProviderEvent } from './providers/types.js';

export interface AgentConfig {
  maxTokens: number;
  maxTurns: number;          // hard ceiling on tool-use loops per user message
  toolTimeoutMs: number;     // per-tool execution timeout
  confirmDestructive: boolean;
  contextWindowTokens: number; // rough budget for conversation history
}

const DEFAULT_CONFIG: AgentConfig = {
  maxTokens: 8192,
  maxTurns: 25,
  toolTimeoutMs: 120_000,
  confirmDestructive: true,
  contextWindowTokens: 180_000,
};

const SYSTEM_PROMPT = `You are Rosie, an AI coding assistant built by Motherlabs.

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

export class AgentLoop {
  private provider: ModelProvider;
  private config: AgentConfig;
  private history: ChatMessage[] = [];
  private state: LoopState = 'idle';
  private tools: Tool[] = [];
  private toolDefs: ToolDefinition[] = [];
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
  private unsubscribes: Array<() => void> = [];

  constructor(provider: ModelProvider, tools: Tool[], config?: Partial<AgentConfig>) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tools = tools;

    // Pre-compute tool definitions for the provider
    this.toolDefs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    for (const tool of tools) {
      this.toolMap.set(tool.name, tool);
    }

    // Listen for approval/denial events (track for cleanup)
    this.unsubscribes.push(
      bus.on('tool:approved', (event) => {
        if (this.pendingApproval && this.pendingApproval.toolId === event.toolId) {
          this.pendingApproval.resolve(true);
        }
      }),
      bus.on('tool:denied', (event) => {
        if (this.pendingApproval && this.pendingApproval.toolId === event.toolId) {
          this.pendingApproval.resolve(false);
        }
      }),
    );
  }

  /**
   * Clean up event listeners. Must be called when the agent loop is discarded.
   */
  destroy(): void {
    this.cancel();
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
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

  get providerName(): string {
    return this.provider.displayName;
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

      const responseBlocks = await this.callModel();
      if (!responseBlocks) break; // error occurred, already emitted

      // Extract tool uses from the response
      const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      for (const block of responseBlocks) {
        if (block.type === 'tool_use') {
          toolUses.push({ id: block.id, name: block.name, input: block.input });
        }
      }

      // No tool uses → agent is done with this turn
      if (toolUses.length === 0) {
        this.state = 'idle';
        break;
      }

      // Execute tools and collect results
      this.state = 'processing_tools';
      const toolResultBlocks: ContentBlock[] = [];

      for (const toolUse of toolUses) {
        const result = await this.executeTool(toolUse.id, toolUse.name, toolUse.input);
        toolResultBlocks.push({
          type: 'tool_result',
          toolCallId: toolUse.id,
          content: result.content,
          isError: result.isError ?? false,
        });
      }

      // Add tool results to history
      this.history.push({
        role: 'user',
        content: toolResultBlocks,
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
   * Call the model via the provider abstraction.
   * Emits events as tokens arrive.
   * Returns the assembled content blocks, or null on error.
   */
  private async callModel(): Promise<ContentBlock[] | null> {
    this.state = 'calling_model';
    this.abortController = new AbortController();

    bus.emit({ type: 'agent:thinking', timestamp: Date.now() });

    try {
      let textAccumulator = '';
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      let usage = { inputTokens: 0, outputTokens: 0 };

      const stream = this.provider.streamChat({
        messages: this.history,
        tools: this.toolDefs,
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: this.config.maxTokens,
        signal: this.abortController.signal,
      });

      for await (const event of stream) {
        switch (event.type) {
          case 'text_delta':
            textAccumulator += event.text;
            bus.emit({
              type: 'agent:text',
              delta: event.text,
              timestamp: Date.now(),
            });
            break;

          case 'tool_call_end':
            toolCalls.push({ id: event.id, name: event.name, input: event.input });
            bus.emit({
              type: 'agent:tool_request',
              toolId: event.id,
              toolName: event.name,
              input: event.input,
              timestamp: Date.now(),
            });
            break;

          case 'done':
            usage = event.usage;
            break;

          case 'error':
            throw event.error;
        }
      }

      // Emit text completion
      if (textAccumulator) {
        bus.emit({
          type: 'agent:text:done',
          fullText: textAccumulator,
          timestamp: Date.now(),
        });
      }

      // Track usage
      this.totalTokensIn += usage.inputTokens;
      this.totalTokensOut += usage.outputTokens;

      bus.emit({
        type: 'agent:turn_complete',
        usage,
        timestamp: Date.now(),
      });

      // Build content blocks for history
      const contentBlocks: ContentBlock[] = [];
      if (textAccumulator) {
        contentBlocks.push({ type: 'text', text: textAccumulator });
      }
      for (const tc of toolCalls) {
        contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }

      // Add assistant response to history
      this.history.push({
        role: 'assistant',
        content: contentBlocks,
      });

      return contentBlocks;
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

      // Classify common API errors
      const msg = error.message.toLowerCase();
      const isRateLimit = msg.includes('rate') || msg.includes('429') || msg.includes('too many');
      const isAuthError = msg.includes('authentication') || msg.includes('401') || (msg.includes('invalid') && msg.includes('key'));

      bus.emit({
        type: 'agent:error',
        error: isRateLimit
          ? new Error('Rate limited. Wait a moment and try again.')
          : isAuthError
            ? new Error('API key is invalid or expired. Check your key and try again.')
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
      bus.emit({ type: 'tool:complete', toolId, content: result.content, isError: true, durationMs: 0, timestamp: Date.now() });
      return result;
    }

    const validation = validateToolInput(tool, input);
    if (!validation.valid) {
      const result = { content: `Invalid input for ${toolName}: ${validation.errors.join(', ')}`, isError: true };
      bus.emit({ type: 'tool:complete', toolId, content: result.content, isError: true, durationMs: 0, timestamp: Date.now() });
      return result;
    }

    if (tool.requiresConfirmation && this.config.confirmDestructive) {
      const approved = await this.requestApproval(toolId, toolName, input);
      if (!approved) {
        const result = { content: 'Tool execution denied by user.', isError: true };
        bus.emit({ type: 'tool:complete', toolId, content: result.content, isError: true, durationMs: 0, timestamp: Date.now() });
        return result;
      }
    }

    bus.emit({ type: 'tool:executing', toolId, toolName, timestamp: Date.now() });
    const startTime = Date.now();

    try {
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        tool.execute(input),
        new Promise<ToolResult>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`Tool ${toolName} timed out after ${this.config.toolTimeoutMs}ms`)), this.config.toolTimeoutMs);
        }),
      ]);
      clearTimeout(timeoutHandle!);

      const durationMs = Date.now() - startTime;
      bus.emit({ type: 'tool:complete', toolId, content: result.content, isError: result.isError ?? false, durationMs, timestamp: Date.now() });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);
      const result = { content: `Tool error: ${msg}`, isError: true };
      bus.emit({ type: 'tool:complete', toolId, content: result.content, isError: true, durationMs, timestamp: Date.now() });
      return result;
    }
  }

  private requestApproval(toolId: string, toolName: string, input: Record<string, unknown>): Promise<boolean> {
    this.state = 'waiting_approval';
    bus.emit({ type: 'tool:approval_required', toolId, toolName, input, timestamp: Date.now() });
    return new Promise<boolean>((resolve) => {
      this.pendingApproval = { toolId, toolName, input, resolve };
    });
  }

  cancel(): void {
    if (this.abortController) this.abortController.abort();
    if (this.pendingApproval) {
      this.pendingApproval.resolve(false);
      this.pendingApproval = null;
    }
    this.state = 'idle';
  }

  private trimContextIfNeeded(): void {
    const estimateTokens = (msg: ChatMessage): number => {
      if (typeof msg.content === 'string') return Math.ceil(msg.content.length / 4);
      return Math.ceil(JSON.stringify(msg.content).length / 4);
    };

    let totalTokens = this.history.reduce((sum, msg) => sum + estimateTokens(msg), 0);
    if (totalTokens <= this.config.contextWindowTokens) return;

    const first = this.history[0];
    let removed = 0;

    while (this.history.length > 2 && totalTokens > this.config.contextWindowTokens * 0.8) {
      const removedMsg = this.history.splice(1, 1)[0]!;
      totalTokens -= estimateTokens(removedMsg);
      removed++;
    }

    if (this.history[0] !== first && first) {
      this.history.unshift(first);
    }

    if (removed > 0) {
      bus.emit({ type: 'session:context_trimmed', removedMessages: removed, timestamp: Date.now() });
    }
  }

  clearHistory(): void {
    this.history = [];
    this.state = 'idle';
    this.totalTokensIn = 0;
    this.totalTokensOut = 0;
    bus.emit({ type: 'session:cleared', timestamp: Date.now() });
  }
}
