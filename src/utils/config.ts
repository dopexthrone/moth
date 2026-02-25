import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ProviderID } from '../core/providers/types.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'rosie');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const KEY_FILE = path.join(CONFIG_DIR, '.api-key');

export interface RosieConfig {
  provider: ProviderID;
  model: string;
  maxTokens: number;
  confirmTools: boolean;
  streamOutput: boolean;
  baseUrl?: string;
}

const DEFAULT_CONFIG: RosieConfig = {
  provider: 'xai',
  model: 'grok-3-beta',
  maxTokens: 8192,
  confirmTools: true,
  streamOutput: true,
};

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): RosieConfig {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // Corrupt config — use defaults
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: Partial<RosieConfig>): void {
  ensureConfigDir();
  const current = loadConfig();
  const merged = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

export function getApiKey(): string | null {
  // 1. Provider-specific env vars take priority
  const envKeys: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    xai: process.env.XAI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  };

  const config = loadConfig();
  const providerKey = envKeys[config.provider];
  if (providerKey) return providerKey;

  // 2. Generic env var
  const genericKey = process.env.ROSIE_API_KEY;
  if (genericKey) return genericKey;

  // 3. Config file
  ensureConfigDir();
  try {
    if (fs.existsSync(KEY_FILE)) {
      return fs.readFileSync(KEY_FILE, 'utf-8').trim();
    }
  } catch {
    // Can't read key file
  }
  return null;
}

export function saveApiKey(key: string): void {
  ensureConfigDir();
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
