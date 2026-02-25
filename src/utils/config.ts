import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'moth');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const KEY_FILE = path.join(CONFIG_DIR, '.api-key');

export interface MothConfig {
  model: string;
  maxTokens: number;
  theme: 'auto' | 'light' | 'dark';
  confirmTools: boolean;
  streamOutput: boolean;
}

const DEFAULT_CONFIG: MothConfig = {
  model: 'claude-sonnet-4-6',
  maxTokens: 8192,
  theme: 'auto',
  confirmTools: true,
  streamOutput: true,
};

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): MothConfig {
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

export function saveConfig(config: Partial<MothConfig>): void {
  ensureConfigDir();
  const current = loadConfig();
  const merged = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

export function getApiKey(): string | null {
  // 1. Environment variable takes priority
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;

  // 2. Config file
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
