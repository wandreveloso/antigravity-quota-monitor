import { exec } from 'child_process';
import { promisify } from 'util';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import { ProcessInfo } from './types';

const execAsync = promisify(exec);

export class ProcessDetector {
  private cachedInfo: ProcessInfo | null = null;

  public getCached(): ProcessInfo | null {
    return this.cachedInfo;
  }

  public clearCache(): void {
    this.cachedInfo = null;
  }

  public async detect(force = false): Promise<ProcessInfo | null> {
    if (!force && this.cachedInfo) {
      const isAlive = await this.testConnection(
        this.cachedInfo.port,
        this.cachedInfo.csrfToken,
        this.cachedInfo.protocol
      );
      if (isAlive) {
        return this.cachedInfo;
      }
      this.cachedInfo = null;
    }

    const platform = os.platform();
    let candidates: { pid: number; portFromArgs: number; csrfToken: string }[] = [];

    if (platform === 'win32') {
      candidates = await this.detectWindows();
    } else {
      candidates = await this.detectUnix();
    }

    for (const cand of candidates) {
      const candidatePorts: number[] = [];
      if (cand.portFromArgs > 0) {
        candidatePorts.push(cand.portFromArgs);
      }

      const listeningPorts = await this.getListeningPorts(cand.pid);
      for (const p of listeningPorts) {
        if (!candidatePorts.includes(p)) {
          candidatePorts.push(p);
        }
      }

      for (const port of candidatePorts) {
        // Try HTTP first (primary for modern agy daemon)
        if (await this.testConnection(port, cand.csrfToken, 'http')) {
          this.cachedInfo = {
            pid: cand.pid,
            port,
            csrfToken: cand.csrfToken,
            protocol: 'http',
          };
          return this.cachedInfo;
        }

        // Try HTTPS fallback (legacy language_server)
        if (await this.testConnection(port, cand.csrfToken, 'https')) {
          this.cachedInfo = {
            pid: cand.pid,
            port,
            csrfToken: cand.csrfToken,
            protocol: 'https',
          };
          return this.cachedInfo;
        }
      }
    }

    return null;
  }

  private async detectUnix(): Promise<{ pid: number; portFromArgs: number; csrfToken: string }[]> {
    try {
      // Use LC_ALL=C to avoid UTF-8 decode issues on macOS Sequoia+
      const { stdout } = await execAsync('LC_ALL=C ps -eo pid,command', {
        timeout: 4000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return this.parseProcessLines(stdout.split('\n'));
    } catch {
      return [];
    }
  }

  private async detectWindows(): Promise<{ pid: number; portFromArgs: number; csrfToken: string }[]> {
    try {
      const psCmd =
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process | ' +
        'Where-Object { $_.CommandLine -match \'csrf_token\' -and ($_.CommandLine -match \'agy\' -or $_.CommandLine -match \'language_server\') } | ' +
        'Select-Object ProcessId, CommandLine | ConvertTo-Json"';

      const { stdout } = await execAsync(psCmd, { timeout: 5000 });
      if (!stdout || stdout.trim().length === 0) {
        return [];
      }

      const parsed: unknown = JSON.parse(stdout.trim());
      const items: { ProcessId: number; CommandLine: string }[] = Array.isArray(parsed)
        ? (parsed as { ProcessId: number; CommandLine: string }[])
        : typeof parsed === 'object' && parsed !== null
        ? [parsed as { ProcessId: number; CommandLine: string }]
        : [];

      const results: { pid: number; portFromArgs: number; csrfToken: string }[] = [];
      for (const item of items) {
        const cmd = item.CommandLine || '';
        const tokenMatch = cmd.match(/--csrf_token[=\s]+([a-zA-Z0-9-]+)/i);
        if (!tokenMatch) {
          continue;
        }

        const hubPortMatch = cmd.match(/--hub-port[=\s]+(\d+)/i);
        const extPortMatch = cmd.match(/--extension_server_port[=\s]+(\d+)/i);
        const rawPort = hubPortMatch?.[1] || extPortMatch?.[1];
        const portFromArgs = rawPort ? parseInt(rawPort, 10) : 0;

        results.push({
          pid: item.ProcessId,
          portFromArgs,
          csrfToken: tokenMatch[1],
        });
      }

      return results;
    } catch {
      return [];
    }
  }

  private parseProcessLines(lines: string[]): { pid: number; portFromArgs: number; csrfToken: string }[] {
    const results: { pid: number; portFromArgs: number; csrfToken: string }[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.includes('--csrf_token')) {
        continue;
      }

      const isAgy = line.includes('agy') || line.includes('--app_data_dir');
      const isLangServer = line.includes('language_server');
      if (!isAgy && !isLangServer) {
        continue;
      }

      const parts = line.split(/\s+/);
      const pid = parseInt(parts[0], 10);
      if (isNaN(pid) || pid <= 0) {
        continue;
      }

      const tokenMatch = line.match(/--csrf_token[=\s]+([a-zA-Z0-9-]+)/i);
      if (!tokenMatch) {
        continue;
      }

      const hubPortMatch = line.match(/--hub-port[=\s]+(\d+)/i);
      const extPortMatch = line.match(/--extension_server_port[=\s]+(\d+)/i);
      const rawPort = hubPortMatch?.[1] || extPortMatch?.[1];
      const portFromArgs = rawPort ? parseInt(rawPort, 10) : 0;

      results.push({
        pid,
        portFromArgs,
        csrfToken: tokenMatch[1],
      });
    }

    return results;
  }

  private async getListeningPorts(pid: number): Promise<number[]> {
    const ports: number[] = [];
    const platform = os.platform();

    try {
      let stdout = '';
      if (platform === 'darwin') {
        const res = await execAsync(`lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid}`, { timeout: 2500 });
        stdout = res.stdout;
      } else if (platform === 'win32') {
        const res = await execAsync('netstat -ano -p TCP', { timeout: 2500 });
        const lines = res.stdout.split('\n');
        for (const l of lines) {
          if (l.includes(String(pid)) && l.toUpperCase().includes('LISTENING')) {
            const m = l.match(/:(\d+)\s+.*LISTENING/i);
            if (m) {
              const p = parseInt(m[1], 10);
              if (!ports.includes(p)) {
                ports.push(p);
              }
            }
          }
        }
        return ports;
      } else {
        const res = await execAsync(`ss -tlnp 2>/dev/null | grep "pid=${pid}" || lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null`, {
          timeout: 2500,
        });
        stdout = res.stdout;
      }

      const regex = /:(\d+)\s+\(LISTEN\)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(stdout)) !== null) {
        const p = parseInt(match[1], 10);
        if (!ports.includes(p)) {
          ports.push(p);
        }
      }
    } catch {
      // Ignored - fall back to ports from arguments
    }

    return ports;
  }

  private testConnection(port: number, csrfToken: string, protocol: 'http' | 'https'): Promise<boolean> {
    return new Promise(resolve => {
      const payload = JSON.stringify({
        metadata: { ideName: 'antigravity', extensionName: 'antigravity' },
      });

      const options = {
        hostname: '127.0.0.1',
        port,
        path: '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': csrfToken,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 1500,
        rejectUnauthorized: false,
      };

      const requester = protocol === 'https' ? https.request : http.request;
      const req = requester(options, res => {
        let body = '';
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed: unknown = JSON.parse(body);
              resolve(typeof parsed === 'object' && parsed !== null);
            } catch {
              resolve(false);
            }
          } else {
            resolve(false);
          }
        });
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.write(payload);
      req.end();
    });
  }
}

