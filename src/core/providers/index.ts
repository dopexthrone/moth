/**
 * Provider factory — creates the right adapter based on configuration.
 */

export { type ModelProvider, type ProviderConfig, type ProviderID, type ChatMessage, type ContentBlock, type ToolDefinition, type ProviderEvent, type TokenUsage, type ModelResponse, type ModelInfo } from './types.js';
export { MODEL_CATALOG, getDefaultModel, getModelsForProvider, getModelInfo, getProviderBaseUrl, detectProviderFromKey } from './catalog.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAICompatibleProvider } from './openai-compatible.js';

import type { ModelProvider, ProviderConfig } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { getProviderBaseUrl } from './catalog.js';

/**
 * Create a model provider from configuration.
 * This is the single entry point — the rest of the app never imports provider implementations directly.
 */
export function createProvider(config: ProviderConfig): ModelProvider {
  const baseUrl = config.baseUrl || getProviderBaseUrl(config.provider);

  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.apiKey, config.model);

    case 'xai':
      return new OpenAICompatibleProvider({
        providerId: 'xai',
        displayName: 'xAI (Grok)',
        apiKey: config.apiKey,
        baseUrl,
        model: config.model,
      });

    case 'openai':
      return new OpenAICompatibleProvider({
        providerId: 'openai',
        displayName: 'OpenAI',
        apiKey: config.apiKey,
        baseUrl,
        model: config.model,
      });

    case 'google':
      return new OpenAICompatibleProvider({
        providerId: 'google',
        displayName: 'Google (Gemini)',
        apiKey: config.apiKey,
        baseUrl,
        model: config.model,
      });

    case 'openrouter':
      return new OpenAICompatibleProvider({
        providerId: 'openrouter',
        displayName: 'OpenRouter',
        apiKey: config.apiKey,
        baseUrl,
        model: config.model,
        extraHeaders: {
          'HTTP-Referer': 'https://github.com/dopexthrone/moth',
          'X-Title': 'Rosie CLI',
        },
      });

    case 'custom':
      return new OpenAICompatibleProvider({
        providerId: 'custom',
        displayName: config.baseUrl || 'Custom',
        apiKey: config.apiKey,
        baseUrl,
        model: config.model,
      });

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
