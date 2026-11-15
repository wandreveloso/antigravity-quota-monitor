import * as http from 'http';
import * as https from 'https';
import { EventEmitter } from 'events';
import { ProcessDetector } from './process-detector';
import { ContextReader } from './context-reader';
import { MetricsNormalizer } from './metrics-normalizer';
import {
  QuotaSnapshot,
  RawQuotaSummaryResponse,
  RawUserStatusResponse,
  ContextMetrics,
  ProcessInfo,
} from './types';

export interface MetricsClientOptions {
  pollingIntervalMs?: number;
  workspaceUri?: string;
}

export class MetricsClient extends EventEmitter {
  private detector: ProcessDetector;
  private contextReader: ContextReader;
  private pollingIntervalMs: number;
  private workspaceUri?: string;

  private pollTimer?: NodeJS.Timeout;
  private backoffTimer?: NodeJS.Timeout;
  private isPolling = false;
  private isFetching = false;
  private consecutiveErrors = 0;
  private currentBackoffMs = 2000;
  private readonly maxBackoffMs = 32000;

  private lastSnapshot?: QuotaSnapshot;

  constructor(options: MetricsClientOptions = {}) {
    super();
    this.detector = new ProcessDetector();
    this.contextReader = new ContextReader();
    this.pollingIntervalMs = options.pollingIntervalMs ?? 30000;
    this.workspaceUri = options.workspaceUri;
  }

  public getLastSnapshot(): QuotaSnapshot | undefined {
    return this.lastSnapshot;
  }

  public setWorkspaceUri(uri?: string): void {
    this.workspaceUri = uri;
  }

  public setPollingInterval(intervalMs: number): void {
    this.pollingIntervalMs = Math.max(5000, intervalMs);
    if (this.isPolling) {
      this.startPolling();
    }
  }

  public startPolling(): void {
    this.stopPolling();
    this.isPolling = true;
    this.consecutiveErrors = 0;
    this.currentBackoffMs = 2000;

    // Immediate first fetch
    void this.fetchMetrics();

    this.pollTimer = setInterval(() => {
      void this.fetchMetrics();
    }, this.pollingIntervalMs);
  }

  public stopPolling(): void {
    this.isPolling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = undefined;
    }
  }

  public async refreshNow(): Promise<QuotaSnapshot> {
    return await this.fetchMetrics(true);
  }

  public dispose(): void {
    this.stopPolling();
    this.removeAllListeners();
    this.detector.clearCache();
  }

  private async fetchMetrics(forceRediscover = false): Promise<QuotaSnapshot> {
    if (this.isFetching) {
      if (this.lastSnapshot) {
        return this.lastSnapshot;
      }
    }

    this.isFetching = true;

    try {
      let proc = forceRediscover ? null : this.detector.getCached();
      if (!proc) {
        proc = await this.detector.detect(forceRediscover);
      }

      if (!proc) {
        throw new Error('Antigravity daemon not found or unreachable.');
      }

      const [quotaSummary, userStatus, contextMetrics] = await Promise.all([
        this.queryRpc<RawQuotaSummaryResponse>(
          proc,
          '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary'
        ),
        this.queryRpc<RawUserStatusResponse>(
          proc,
          '/exa.language_server_pb.LanguageServerService/GetUserStatus'
        ).catch(() => null),
        this.contextReader.getContextMetrics(this.workspaceUri),
      ]);

      const snapshot = MetricsNormalizer.normalize(quotaSummary, userStatus, contextMetrics);
      this.lastSnapshot = snapshot;
      this.consecutiveErrors = 0;
      this.currentBackoffMs = 2000;

      this.emit('update', snapshot);
      return snapshot;
    } catch (err) {
      this.consecutiveErrors++;
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);

      if (this.consecutiveErrors >= 3) {
        this.detector.clearCache();
      }

      // Schedule exponential backoff retry if in polling mode
      if (this.isPolling && !this.backoffTimer) {
        const delay = Math.min(this.maxBackoffMs, this.currentBackoffMs);
        this.currentBackoffMs *= 2;
        this.backoffTimer = setTimeout(() => {
          this.backoffTimer = undefined;
          void this.fetchMetrics(true);
        }, delay);
      }

      if (this.lastSnapshot) {
        return this.lastSnapshot;
      }

      const fallbackContext: ContextMetrics = {
        totalTokens: 0,
        cachedTokens: 0,
        newTokens: 0,
        usedPct: 0,
      };

      return MetricsNormalizer.normalize(null, null, fallbackContext);
    } finally {
      this.isFetching = false;
    }
  }

  private queryRpc<T>(proc: ProcessInfo, rpcPath: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        metadata: {
          ideName: 'antigravity',
          extensionName: 'antigravity',
          locale: 'en',
        },
      });

      const options = {
        hostname: '127.0.0.1',
        port: proc.port,
        path: rpcPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': proc.csrfToken,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 4000,
        rejectUnauthorized: false,
      };

      const requester = proc.protocol === 'https' ? https.request : http.request;
      const req = requester(options, res => {
        let body = '';
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed: unknown = JSON.parse(body);
              resolve(parsed as T);
            } catch (e) {
              reject(new Error(`Failed to parse response: ${e instanceof Error ? e.message : String(e)}`));
            }
          } else {
            reject(new Error(`RPC responded with HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', err => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('RPC request timed out'));
      });

      req.write(payload);
      req.end();
    });
  }
}

