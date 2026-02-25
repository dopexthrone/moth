import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { theme } from '../utils/theme.js';
import { Banner } from './Banner.js';
import { StatusBar, type AppStatus } from './StatusBar.js';
import { Input, Confirm } from './Input.js';
import { AgentLoop } from '../core/agent-loop.js';
import { bus } from '../core/event-bus.js';
import { allTools } from '../tools/index.js';
import { loadConfig } from '../utils/config.js';

interface ConversationEntry {
  id: number;
  type: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string;
  toolStatus?: 'running' | 'success' | 'error' | 'denied';
  durationMs?: number;
}

interface PendingApproval {
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
}

interface AppProps {
  apiKey: string;
}

let entryId = 0;

export function App({ apiKey }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const config = loadConfig();
  const agentRef = useRef<AgentLoop | null>(null);

  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [status, setStatus] = useState<AppStatus>('idle');
  const [tokensIn, setTokensIn] = useState(0);
  const [tokensOut, setTokensOut] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [currentTool, setCurrentTool] = useState<string | undefined>();
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const turnStartRef = useRef(0);

  // Initialize agent loop once
  useEffect(() => {
    const agent = new AgentLoop(apiKey, allTools, {
      model: config.model,
      maxTokens: config.maxTokens,
      confirmDestructive: config.confirmTools,
    });
    agentRef.current = agent;

    // Subscribe to events
    const unsubs = [
      bus.on('agent:thinking', () => {
        setStatus('thinking');
      }),

      bus.on('agent:text', (e) => {
        setStatus('streaming');
        setStreamingText((prev) => prev + e.delta);
      }),

      bus.on('agent:text:done', (e) => {
        setStreamingText('');
        setConversation((prev) => [
          ...prev,
          { id: entryId++, type: 'assistant', content: e.fullText },
        ]);
      }),

      bus.on('agent:turn_complete', (e) => {
        setTokensIn((prev) => prev + e.usage.inputTokens);
        setTokensOut((prev) => prev + e.usage.outputTokens);
        setElapsedMs(Date.now() - turnStartRef.current);
      }),

      bus.on('agent:error', (e) => {
        setStatus('error');
        setConversation((prev) => [
          ...prev,
          { id: entryId++, type: 'system', content: `Error: ${e.error.message}` },
        ]);
        if (!e.recoverable) {
          setTimeout(() => setStatus('idle'), 3000);
        } else {
          setStatus('idle');
        }
        setIsBusy(false);
      }),

      bus.on('tool:approval_required', (e) => {
        setStatus('idle');
        setPendingApproval({
          toolId: e.toolId,
          toolName: e.toolName,
          input: e.input,
        });
      }),

      bus.on('tool:executing', (e) => {
        setStatus('tool_running');
        setCurrentTool(e.toolName);
        setConversation((prev) => [
          ...prev,
          {
            id: entryId++,
            type: 'tool',
            content: summarizeTool(e.toolName, {}),
            toolName: e.toolName,
            toolStatus: 'running',
          },
        ]);
      }),

      bus.on('tool:complete', (e) => {
        setCurrentTool(undefined);
        setConversation((prev) => {
          const updated = [...prev];
          // Update the last matching tool entry
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i]!.type === 'tool' && updated[i]!.toolStatus === 'running') {
              updated[i] = {
                ...updated[i]!,
                toolStatus: e.isError ? 'error' : 'success',
                durationMs: e.durationMs,
                content: e.isError ? e.content.slice(0, 300) : summarizeTool(updated[i]!.toolName || '', {}),
              };
              break;
            }
          }
          return updated;
        });
      }),

      bus.on('session:context_trimmed', (e) => {
        setConversation((prev) => [
          ...prev,
          {
            id: entryId++,
            type: 'system',
            content: `Context trimmed: removed ${e.removedMessages} old messages to stay within limits.`,
          },
        ]);
      }),

      bus.on('session:cleared', () => {
        setConversation([]);
        setTokensIn(0);
        setTokensOut(0);
        setStreamingText('');
      }),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [apiKey, config.model, config.maxTokens, config.confirmTools]);

  // Handle Ctrl+C for cancellation during operations
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isBusy) {
        agentRef.current?.cancel();
        setIsBusy(false);
        setStreamingText('');
        setStatus('idle');
      } else {
        exit();
      }
    }
  });

  const handleApproval = useCallback((approved: boolean) => {
    if (!pendingApproval) return;
    const { toolId, toolName } = pendingApproval;

    if (approved) {
      bus.emit({ type: 'tool:approved', toolId, timestamp: Date.now() });
    } else {
      bus.emit({ type: 'tool:denied', toolId, timestamp: Date.now() });
      setConversation((prev) => [
        ...prev,
        { id: entryId++, type: 'tool', content: `${toolName} — denied`, toolName, toolStatus: 'denied' },
      ]);
    }

    setPendingApproval(null);
  }, [pendingApproval]);

  const handleSubmit = useCallback(async (message: string) => {
    if (isBusy) return;

    // Slash commands
    if (message.startsWith('/')) {
      const cmd = message.slice(1).toLowerCase().trim();
      if (cmd === 'help') {
        setConversation((prev) => [...prev, {
          id: entryId++, type: 'system',
          content: '/help — commands\n/clear — reset conversation\n/model — show model\n/tokens — usage stats\n/exit — quit',
        }]);
        return;
      }
      if (cmd === 'clear') {
        agentRef.current?.clearHistory();
        return;
      }
      if (cmd === 'model') {
        setConversation((prev) => [...prev, { id: entryId++, type: 'system', content: `Model: ${config.model}` }]);
        return;
      }
      if (cmd === 'tokens') {
        const usage = agentRef.current?.usage;
        setConversation((prev) => [...prev, {
          id: entryId++, type: 'system',
          content: `Tokens — in: ${usage?.inputTokens || 0}, out: ${usage?.outputTokens || 0}`,
        }]);
        return;
      }
      if (cmd === 'exit' || cmd === 'quit') {
        exit();
        return;
      }
    }

    // Send to agent
    setIsBusy(true);
    turnStartRef.current = Date.now();
    setConversation((prev) => [...prev, { id: entryId++, type: 'user', content: message }]);

    await agentRef.current?.processMessage(message);

    setIsBusy(false);
    setStatus('idle');
  }, [isBusy, config.model, exit]);

  // Only render the last N conversation entries to prevent Ink performance degradation
  const MAX_VISIBLE = 50;
  const visibleConversation = conversation.length > MAX_VISIBLE
    ? conversation.slice(-MAX_VISIBLE)
    : conversation;
  const trimmedCount = conversation.length - visibleConversation.length;

  return (
    <Box flexDirection="column">
      <Banner />

      {trimmedCount > 0 && (
        <Box marginLeft={2}>
          <Text color={theme.textDim}>({trimmedCount} older messages hidden)</Text>
        </Box>
      )}

      {/* Conversation history — windowed for performance */}
      {visibleConversation.map((entry) => (
        <ConversationItem key={entry.id} entry={entry} />
      ))}

      {/* Live streaming text */}
      {streamingText && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={theme.purple} bold>{'◈ moth'}</Text>
          <Box marginLeft={2}>
            <Text color={theme.text} wrap="wrap">
              {streamingText}
              <Text color={theme.streaming}>▌</Text>
            </Text>
          </Box>
        </Box>
      )}

      {/* Approval prompt */}
      {pendingApproval && (
        <Confirm
          message={`Allow ${pendingApproval.toolName}? ${summarizeTool(pendingApproval.toolName, pendingApproval.input)}`}
          onConfirm={handleApproval}
        />
      )}

      {/* Input */}
      {!pendingApproval && (
        <Input
          onSubmit={handleSubmit}
          disabled={isBusy}
          placeholder={
            status === 'thinking' ? 'Thinking...'
              : status === 'streaming' ? 'Streaming... (Ctrl+C to cancel)'
                : status === 'tool_running' ? `Running ${currentTool || 'tool'}...`
                  : 'Ask anything...'
          }
        />
      )}

      <StatusBar
        status={status}
        model={config.model}
        tokensIn={tokensIn}
        tokensOut={tokensOut}
        elapsedMs={elapsedMs}
        currentTool={currentTool}
      />
    </Box>
  );
}

function ConversationItem({ entry }: { entry: ConversationEntry }): React.ReactElement {
  if (entry.type === 'user') {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text color={theme.coral} bold>{'▸ you'}</Text>
        <Box marginLeft={2}>
          <Text color={theme.userInput} wrap="wrap">{entry.content}</Text>
        </Box>
      </Box>
    );
  }

  if (entry.type === 'assistant') {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text color={theme.purple} bold>{'◈ moth'}</Text>
        <Box marginLeft={2}>
          <Text color={theme.text} wrap="wrap">{entry.content}</Text>
        </Box>
      </Box>
    );
  }

  if (entry.type === 'tool') {
    const statusSymbol = entry.toolStatus === 'success' ? '✓'
      : entry.toolStatus === 'error' ? '✗'
        : entry.toolStatus === 'denied' ? '⊘'
          : '⟳';
    const statusColor = entry.toolStatus === 'success' ? theme.success
      : entry.toolStatus === 'error' ? theme.error
        : entry.toolStatus === 'denied' ? theme.coral
          : theme.toolRunning;
    const duration = entry.durationMs ? ` (${entry.durationMs}ms)` : '';

    return (
      <Box marginLeft={4}>
        <Text color={statusColor}>{statusSymbol} </Text>
        <Text color={theme.textMuted}>{entry.toolName}</Text>
        <Text color={theme.textDim}> {entry.content}{duration}</Text>
      </Box>
    );
  }

  // system
  return (
    <Box marginLeft={2}>
      <Text color={theme.textDim}>{entry.content}</Text>
    </Box>
  );
}

function summarizeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'read_file': return String(input.path || '');
    case 'write_file': return String(input.path || '');
    case 'edit_file': return String(input.path || '');
    case 'bash': return String(input.command || '').slice(0, 80);
    case 'grep_search': return `"${input.pattern || ''}" ${input.path || '.'}`;
    case 'glob_search': return `${input.pattern || ''}`;
    case 'list_directory': return String(input.path || '.');
    default: return '';
  }
}
