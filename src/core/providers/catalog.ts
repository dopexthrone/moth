/**
 * Model catalog — latest models per provider as of February 2026.
 * Updated: 2026-02-24
 */

import type { ModelInfo, ProviderID } from './types.js';

export const MODEL_CATALOG: ModelInfo[] = [
  // ── xAI ──
  { id: 'grok-4', name: 'Grok 4', provider: 'xai', contextWindow: 131072, supportsTools: true, supportsStreaming: true },
  { id: 'grok-3-beta', name: 'Grok 3 Beta', provider: 'xai', contextWindow: 131072, supportsTools: true, supportsStreaming: true },
  { id: 'grok-3-mini-beta', name: 'Grok 3 Mini Beta', provider: 'xai', contextWindow: 131072, supportsTools: true, supportsStreaming: true },

  // ── Anthropic ──
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsStreaming: true },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', contextWindow: 1000000, supportsTools: true, supportsStreaming: true },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', contextWindow: 200000, supportsTools: true, supportsStreaming: true },

  // ── OpenAI ──
  { id: 'gpt-4.5-preview', name: 'GPT-4.5 Preview', provider: 'openai', contextWindow: 128000, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', contextWindow: 1047576, supportsTools: true, supportsStreaming: true },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai', contextWindow: 1047576, supportsTools: true, supportsStreaming: true },
  { id: 'o3', name: 'o3', provider: 'openai', contextWindow: 200000, supportsTools: true, supportsStreaming: true },
  { id: 'o3-mini', name: 'o3-mini', provider: 'openai', contextWindow: 200000, supportsTools: true, supportsStreaming: true },
  { id: 'o4-mini', name: 'o4-mini', provider: 'openai', contextWindow: 200000, supportsTools: true, supportsStreaming: true },

  // ── Google ──
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', provider: 'google', contextWindow: 1000000, supportsTools: true, supportsStreaming: true },
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash', provider: 'google', contextWindow: 1000000, supportsTools: true, supportsStreaming: true },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', contextWindow: 1048576, supportsTools: true, supportsStreaming: true },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', contextWindow: 1048576, supportsTools: true, supportsStreaming: true },

  // ── OpenRouter (pass-through) ──
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (via OpenRouter)', provider: 'openrouter', contextWindow: 1000000, supportsTools: true, supportsStreaming: true },
  { id: 'x-ai/grok-4', name: 'Grok 4 (via OpenRouter)', provider: 'openrouter', contextWindow: 131072, supportsTools: true, supportsStreaming: true },
  { id: 'openai/gpt-4.1', name: 'GPT-4.1 (via OpenRouter)', provider: 'openrouter', contextWindow: 1047576, supportsTools: true, supportsStreaming: true },
  { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash (via OpenRouter)', provider: 'openrouter', contextWindow: 1000000, supportsTools: true, supportsStreaming: true },
];

/** Get the default model for a provider */
export function getDefaultModel(provider: ProviderID): string {
  const defaults: Record<ProviderID, string> = {
    xai: 'grok-3-beta',
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4.1-mini',
    google: 'gemini-3-flash',
    openrouter: 'anthropic/claude-sonnet-4-6',
    custom: 'default',
  };
  return defaults[provider];
}

/** Get models for a specific provider */
export function getModelsForProvider(provider: ProviderID): ModelInfo[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}

/** Lookup model info by ID */
export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_CATALOG.find((m) => m.id === modelId);
}

/** Get base URL for a provider */
export function getProviderBaseUrl(provider: ProviderID): string {
  const urls: Record<ProviderID, string> = {
    xai: 'https://api.x.ai/v1',
    anthropic: 'https://api.anthropic.com',
    openai: 'https://api.openai.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
    openrouter: 'https://openrouter.ai/api/v1',
    custom: 'http://localhost:11434/v1',
  };
  return urls[provider];
}

/**
 * Detect provider from API key prefix.
 */
export function detectProviderFromKey(apiKey: string): ProviderID | null {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('xai-')) return 'xai';
  if (apiKey.startsWith('sk-or-')) return 'openrouter';
  if (apiKey.startsWith('sk-')) return 'openai';
  return null;
}
