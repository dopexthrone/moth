/**
 * Event-driven backbone for the agentic loop.
 * All state transitions flow through typed events.
 * Components subscribe to what they need — no prop drilling, no callback hell.
 */

export type MothEvent =
  | { type: 'user:input'; message: string; timestamp: number }
  | { type: 'agent:thinking'; timestamp: number }
  | { type: 'agent:text'; delta: string; timestamp: number }
  | { type: 'agent:text:done'; fullText: string; timestamp: number }
  | { type: 'agent:tool_request'; toolId: string; toolName: string; input: Record<string, unknown>; timestamp: number }
  | { type: 'agent:tool_result'; toolId: string; content: string; isError: boolean; timestamp: number }
  | { type: 'agent:turn_complete'; usage: { inputTokens: number; outputTokens: number }; timestamp: number }
  | { type: 'agent:error'; error: Error; recoverable: boolean; timestamp: number }
  | { type: 'tool:approval_required'; toolId: string; toolName: string; input: Record<string, unknown>; timestamp: number }
  | { type: 'tool:approved'; toolId: string; timestamp: number }
  | { type: 'tool:denied'; toolId: string; timestamp: number }
  | { type: 'tool:executing'; toolId: string; toolName: string; timestamp: number }
  | { type: 'tool:complete'; toolId: string; content: string; isError: boolean; durationMs: number; timestamp: number }
  | { type: 'session:started'; sessionId: string; timestamp: number }
  | { type: 'session:cleared'; timestamp: number }
  | { type: 'session:context_trimmed'; removedMessages: number; timestamp: number }
  | { type: 'system:error'; error: Error; fatal: boolean; timestamp: number }
  | { type: 'system:shutdown'; reason: string; timestamp: number };

export type MothEventType = MothEvent['type'];

type EventHandler<T extends MothEventType> = (
  event: Extract<MothEvent, { type: T }>,
) => void | Promise<void>;

/**
 * Typed event bus. Synchronous dispatch, async handlers tolerated.
 * Single source of truth for all state transitions in the system.
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler<any>>>();
  private history: MothEvent[] = [];
  private maxHistory = 1000;

  on<T extends MothEventType>(type: T, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  emit(event: MothEvent): void {
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          const result = handler(event as any);
          // If handler returns a promise, catch unhandled rejections
          if (result && typeof result === 'object' && 'catch' in result) {
            (result as Promise<void>).catch((err) => {
              this.emit({
                type: 'system:error',
                error: err instanceof Error ? err : new Error(String(err)),
                fatal: false,
                timestamp: Date.now(),
              });
            });
          }
        } catch (err) {
          this.emit({
            type: 'system:error',
            error: err instanceof Error ? err : new Error(String(err)),
            fatal: false,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  getHistory(type?: MothEventType): MothEvent[] {
    if (type) return this.history.filter((e) => e.type === type);
    return [...this.history];
  }

  clear(): void {
    this.handlers.clear();
    this.history = [];
  }
}

/** Singleton bus for the application */
export const bus = new EventBus();
