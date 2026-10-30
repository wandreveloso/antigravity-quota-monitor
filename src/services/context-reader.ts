import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ContextMetrics } from './types';

const execAsync = promisify(exec);

export class ContextReader {
  private lastKnownConversationId: string | null = null;
  private readonly defaultContextLimit = 1048576; // 1M tokens standard for Gemini 1.5 / 2.0 / 3.8

  /**
   * Fetches context token metrics asynchronously and non-blockingly.
   */
  public async getContextMetrics(workspaceUri?: string): Promise<ContextMetrics> {
    try {
      const convId = await this.resolveConversationId(workspaceUri);
      if (!convId) {
        return this.fallbackMetrics();
      }

      return await this.readTranscriptMetrics(convId);
    } catch {
      return this.fallbackMetrics();
    }
  }

  private fallbackMetrics(): ContextMetrics {
    return {
      totalTokens: 0,
      cachedTokens: 0,
      newTokens: 0,
      usedPct: 0,
    };
  }

  /**
   * Resolves the active conversation ID using workspaceStorage state.vscdb with SQLITE_BUSY guard.
   */
  private async resolveConversationId(workspaceUri?: string): Promise<string | null> {
    const homeDir = os.homedir();
    const appSupport =
      os.platform() === 'darwin'
        ? path.join(homeDir, 'Library', 'Application Support', 'Antigravity IDE', 'User', 'workspaceStorage')
        : path.join(homeDir, 'AppData', 'Roaming', 'Antigravity IDE', 'User', 'workspaceStorage');

    try {
      // Find workspace directory matching current workspace or use most recently modified workspaceStorage
      const entries = await fs.readdir(appSupport, { withFileTypes: true });
      let targetVscdb: string | null = null;

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const dirPath = path.join(appSupport, entry.name);
        const wsJsonPath = path.join(dirPath, 'workspace.json');

        try {
          const wsJsonContent = await fs.readFile(wsJsonPath, 'utf8');
          if (workspaceUri && wsJsonContent.includes(encodeURIComponent(workspaceUri))) {
            targetVscdb = path.join(dirPath, 'state.vscdb');
            break;
          } else if (workspaceUri && wsJsonContent.includes(workspaceUri)) {
            targetVscdb = path.join(dirPath, 'state.vscdb');
            break;
          }
        } catch {
          // Continue scanning
        }
      }

      // If no exact workspace found, check if we have any recently modified state.vscdb
      if (!targetVscdb) {
        let latestTime = 0;
        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }
          const vscdbPath = path.join(appSupport, entry.name, 'state.vscdb');
          try {
            const stat = await fs.stat(vscdbPath);
            if (stat.mtimeMs > latestTime) {
              latestTime = stat.mtimeMs;
              targetVscdb = vscdbPath;
            }
          } catch {
            // Stat failed
          }
        }
      }

      if (targetVscdb) {
        const convId = await this.queryStateVscdb(targetVscdb);
        if (convId) {
          this.lastKnownConversationId = convId;
          return convId;
        }
      }
    } catch {
      // Ignore directory read failure
    }

    // Fallback: check most recently updated transcript directory in ~/.gemini/antigravity/brain/
    return await this.findLatestBrainConversation();
  }

  /**
   * Executes a safe read-only SQLite query with busy timeout to prevent SQLITE_BUSY deadlocks.
   */
  private async queryStateVscdb(dbPath: string): Promise<string | null> {
    try {
      // Read-only URI mode and busy_timeout=1000
      const cmd = `sqlite3 -cmd ".timeout 1000" "file:${dbPath}?mode=ro" "SELECT value FROM ItemTable WHERE key='google.google-antigravity';"`;
      const { stdout } = await execAsync(cmd, { timeout: 2000 });
      if (!stdout || stdout.trim().length === 0) {
        return null;
      }

      const parsed: unknown = JSON.parse(stdout.trim());
      if (typeof parsed === 'object' && parsed !== null && 'lastConversationId' in parsed) {
        const id = (parsed as { lastConversationId?: unknown }).lastConversationId;
        if (typeof id === 'string' && id.length > 0) {
          return id;
        }
      }
    } catch {
      // Ignore sqlite query error
    }

    return null;
  }

  private async findLatestBrainConversation(): Promise<string | null> {
    const brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
    try {
      const entries = await fs.readdir(brainDir, { withFileTypes: true });
      let latestId: string | null = null;
      let latestTime = 0;

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }

        const transcriptPath = path.join(brainDir, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
        try {
          const stat = await fs.stat(transcriptPath);
          if (stat.mtimeMs > latestTime) {
            latestTime = stat.mtimeMs;
            latestId = entry.name;
          }
        } catch {
          // File does not exist
        }
      }

      return latestId;
    } catch {
      return this.lastKnownConversationId;
    }
  }

  /**
   * Reads only the tail of the transcript file to extract latest token counts efficiently.
   */
  private async readTranscriptMetrics(convId: string): Promise<ContextMetrics> {
    const transcriptPath = path.join(
      os.homedir(),
      '.gemini',
      'antigravity',
      'brain',
      convId,
      '.system_generated',
      'logs',
      'transcript.jsonl'
    );

    let handle: fs.FileHandle | null = null;
    try {
      const stat = await fs.stat(transcriptPath);
      if (stat.size === 0) {
        return this.fallbackMetrics();
      }

      handle = await fs.open(transcriptPath, 'r');
      const bufferSize = Math.min(stat.size, 16384);
      const buffer = Buffer.alloc(bufferSize);
      const position = stat.size - bufferSize;

      await handle.read(buffer, 0, bufferSize, position);
      const text = buffer.toString('utf8');
      const lines = text.split('\n').filter(l => l.trim().length > 0);

      // Iterate backwards to find latest step with token counts
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line.includes('input_tokens') && !line.includes('cache_read_tokens')) {
          continue;
        }

        try {
          const parsed: unknown = JSON.parse(line);
          if (typeof parsed === 'object' && parsed !== null) {
            const stepObj = parsed as {
              input_tokens?: unknown;
              cache_read_tokens?: unknown;
              output_tokens?: unknown;
            };

            const inputTokens = typeof stepObj.input_tokens === 'number' ? stepObj.input_tokens : 0;
            const cachedTokens = typeof stepObj.cache_read_tokens === 'number' ? stepObj.cache_read_tokens : 0;
            const outputTokens = typeof stepObj.output_tokens === 'number' ? stepObj.output_tokens : 0;

            const newTokens = inputTokens + outputTokens;
            const totalTokens = cachedTokens + newTokens;
            const usedPct = Math.min(100, Math.round((totalTokens / this.defaultContextLimit) * 100));

            return {
              totalTokens,
              cachedTokens,
              newTokens,
              usedPct,
            };
          }
        } catch {
          // Continue backwards
        }
      }
    } catch {
      // Fallback
    } finally {
      if (handle) {
        await handle.close().catch(() => {});
      }
    }

    return this.fallbackMetrics();
  }
}

