import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

export interface CacheStats {
  brainSizeMB: number;
  conversationsSizeMB: number;
  totalSizeMB: number;
  totalConversations: number;
}

export interface CleanPlan {
  keepCount: number;
  toDeleteFiles: { path: string; size: number }[];
  totalFreedBytes: number;
}

export interface CleanResult {
  freedBytes: number;
  deletedFilesCount: number;
  vacuumedDb: boolean;
}

export class CacheManager {
  private baseDir = path.join(os.homedir(), '.gemini', 'antigravity');
  private convsDir = path.join(this.baseDir, 'conversations');
  private brainDir = path.join(this.baseDir, 'brain');
  private summariesDb = path.join(this.baseDir, 'conversation_summaries.db');

  /**
   * Retrieves overall cache and storage statistics for Antigravity
   */
  public async getCacheStats(): Promise<CacheStats> {
    const convStats = await this.getDirFileStats(this.convsDir);
    const brainStats = await this.getDirFileStats(this.brainDir);

    const convBytes = convStats.reduce((sum, f) => sum + f.size, 0);
    const brainBytes = brainStats.reduce((sum, f) => sum + f.size, 0);
    const totalBytes = convBytes + brainBytes;

    const dbFiles = convStats.filter(f => f.name.endsWith('.db'));

    return {
      conversationsSizeMB: Math.round((convBytes / (1024 * 1024)) * 10) / 10,
      brainSizeMB: Math.round((brainBytes / (1024 * 1024)) * 10) / 10,
      totalSizeMB: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
      totalConversations: dbFiles.length,
    };
  }

  /**
   * Cleans stale conversation files and brain artifacts, keeping the most recent active conversations.
   * Also compacts SQLite database with VACUUM.
   */
  public async cleanCache(keepCount = 5): Promise<CleanResult> {
    let freedBytes = 0;
    let deletedFilesCount = 0;

    try {
      const convEntries = await this.getDirFileStats(this.convsDir);
      const dbEntries = convEntries
        .filter(f => f.name.endsWith('.db'))
        .sort((a, b) => b.mtime - a.mtime);

      const keptIds = new Set(
        dbEntries.slice(0, keepCount).map(f => f.name.replace(/\.db$/, ''))
      );

      // Delete older conversation databases and wal/shm companions
      for (const entry of convEntries) {
        const id = entry.name.replace(/\.(db|db-shm|db-wal)$/, '');
        if (!keptIds.has(id)) {
          try {
            await fs.unlink(entry.fullPath);
            freedBytes += entry.size;
            deletedFilesCount++;
          } catch {
            // Ignore removal errors
          }
        }
      }

      // Clean corresponding old brain directories
      try {
        const brainEntries = await fs.readdir(this.brainDir, { withFileTypes: true });
        for (const entry of brainEntries) {
          if (entry.isDirectory() && !entry.name.startsWith('.') && !keptIds.has(entry.name)) {
            const dirPath = path.join(this.brainDir, entry.name);
            try {
              const files = await this.getDirFileStats(dirPath);
              for (const f of files) {
                freedBytes += f.size;
                deletedFilesCount++;
              }
              await fs.rm(dirPath, { recursive: true, force: true });
            } catch {
              // Ignore
            }
          }
        }
      } catch {
        // Brain dir readdir failed
      }
    } catch {
      // Main clean failed
    }

    // Vacuum summaries SQLite database to reclaim fragmented pages
    let vacuumedDb = false;
    try {
      await execAsync(`sqlite3 "${this.summariesDb}" "VACUUM;"`, { timeout: 5000 });
      vacuumedDb = true;
    } catch {
      vacuumedDb = false;
    }

    return {
      freedBytes,
      deletedFilesCount,
      vacuumedDb,
    };
  }

  /**
   * Helps user trigger context compaction in the active agent session
   */
  public async triggerContextCompaction(): Promise<void> {
    try {
      await vscode.env.clipboard.writeText('/compact');
      await vscode.commands.executeCommand('antigravity.openChatView');
    } catch {
      // Fallback
    }

    const action = await vscode.window.showInformationMessage(
      'Comando "/compact" copiado para a área de transferência! Cole no chat do agente e pressione Enter para compactar e otimizar o contexto da sessão.',
      'Abrir Chat'
    );

    if (action === 'Abrir Chat') {
      await vscode.commands.executeCommand('antigravity.openChatView');
    }
  }

  /**
   * Restarts the Antigravity language server and status updater services
   */
  public async restartAgentServices(): Promise<boolean> {
    try {
      await vscode.commands.executeCommand('antigravity.restartLanguageServer');
      await vscode.commands.executeCommand('antigravity.restartUserStatusUpdater');
      return true;
    } catch {
      return false;
    }
  }

  private async getDirFileStats(dir: string): Promise<{ name: string; fullPath: string; size: number; mtime: number }[]> {
    const results: { name: string; fullPath: string; size: number; mtime: number }[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile()) {
          try {
            const stat = await fs.stat(fullPath);
            results.push({
              name: entry.name,
              fullPath,
              size: stat.size,
              mtime: stat.mtimeMs,
            });
          } catch {
            // Ignore stat error
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const sub = await this.getDirFileStats(fullPath);
          results.push(...sub);
        }
      }
    } catch {
      // Ignore dir read error
    }
    return results;
  }
}

