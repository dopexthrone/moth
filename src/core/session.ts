/**
 * Session persistence — survive crashes, resume conversations.
 * Writes conversation events to a JSONL file that can be replayed.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getConfigDir } from '../utils/config.js';
import { bus, type RosieEvent } from './event-bus.js';

const SESSIONS_DIR = path.join(getConfigDir(), 'sessions');
const MAX_SESSIONS = 20;

export interface SessionMeta {
  id: string;
  startedAt: number;
  lastActivity: number;
  messageCount: number;
  cwd: string;
}

export class SessionManager {
  private sessionId: string;
  private sessionFile: string;
  private writeStream: fs.WriteStream | null = null;
  private messageCount = 0;
  private unsubscribes: Array<() => void> = [];

  constructor() {
    this.sessionId = crypto.randomUUID();
    this.ensureSessionsDir();
    this.sessionFile = path.join(SESSIONS_DIR, `${this.sessionId}.jsonl`);
  }

  /**
   * Start recording events to the session file.
   */
  start(): void {
    this.writeStream = fs.createWriteStream(this.sessionFile, { flags: 'a' });

    // Write session header
    this.writeEntry({
      type: 'session:started',
      sessionId: this.sessionId,
      timestamp: Date.now(),
    });

    bus.emit({
      type: 'session:started',
      sessionId: this.sessionId,
      timestamp: Date.now(),
    });

    // Record relevant events
    const eventTypes: Array<RosieEvent['type']> = [
      'user:input',
      'agent:text:done',
      'agent:tool_request',
      'tool:complete',
      'agent:error',
      'session:context_trimmed',
    ];

    for (const eventType of eventTypes) {
      this.unsubscribes.push(
        bus.on(eventType, (event) => {
          this.writeEntry(event);
          this.messageCount++;
        }),
      );
    }

    // Cleanup old sessions
    this.cleanupOldSessions();
  }

  get id(): string {
    return this.sessionId;
  }

  /**
   * Close the session file.
   */
  close(): void {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }

  /**
   * List recent sessions.
   */
  static listSessions(): SessionMeta[] {
    const dir = SESSIONS_DIR;
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const fullPath = path.join(dir, f);
        const stat = fs.statSync(fullPath);
        return { file: f, mtime: stat.mtimeMs, fullPath };
      })
      .sort((a, b) => b.mtime - a.mtime);

    return files.map(({ file, fullPath, mtime }) => {
      const id = file.replace('.jsonl', '');
      let startedAt = mtime;
      let messageCount = 0;
      let cwd = '';

      // Read first and count lines for metadata
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.trim().split('\n');
        messageCount = lines.length;
        const first = JSON.parse(lines[0]!);
        startedAt = first.timestamp || mtime;
        cwd = first.cwd || '';
      } catch {
        // Corrupt session file
      }

      return {
        id,
        startedAt,
        lastActivity: mtime,
        messageCount,
        cwd,
      };
    });
  }

  private writeEntry(event: RosieEvent): void {
    if (!this.writeStream) return;
    try {
      this.writeStream.write(JSON.stringify(event) + '\n');
    } catch {
      // Silently fail — session logging should never crash the app
    }
  }

  private ensureSessionsDir(): void {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
    }
  }

  private cleanupOldSessions(): void {
    try {
      const sessions = SessionManager.listSessions();
      if (sessions.length > MAX_SESSIONS) {
        const toDelete = sessions.slice(MAX_SESSIONS);
        for (const session of toDelete) {
          const filePath = path.join(SESSIONS_DIR, `${session.id}.jsonl`);
          fs.unlinkSync(filePath);
        }
      }
    } catch {
      // Cleanup is best-effort
    }
  }
}
