import { spawn, ChildProcess } from 'child_process';
import path from 'path';

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: any) => void;
  timer: NodeJS.Timeout;
}

class XGBoostDaemonManager {
  private child: ChildProcess | null = null;
  private pending: Map<string, PendingRequest> = new Map();
  private reqIdCounter = 0;
  private isReady = false;
  private buffer = '';

  constructor() {
    this.ensureDaemonRunning();
  }

  private ensureDaemonRunning() {
    if (this.child) return;

    const pythonScript = path.join(process.cwd(), 'scripts', 'xgboost_engine.py');

    try {
      // Spawn persistent python process
      this.child = spawn('python3', [pythonScript], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      this.child.stdout?.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('utf-8');
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            if (data.type === 'ready') {
              this.isReady = true;
              continue;
            }

            if (data.id && this.pending.has(data.id)) {
              const req = this.pending.get(data.id)!;
              clearTimeout(req.timer);
              this.pending.delete(data.id);
              req.resolve(data);
            }
          } catch {
            // Ignore non-json logs
          }
        }
      });

      this.child.on('exit', () => {
        this.child = null;
        this.isReady = false;
        // Reject all pending requests
        for (const [id, req] of this.pending.entries()) {
          clearTimeout(req.timer);
          req.reject(new Error('Python daemon exited unexpectedly'));
        }
        this.pending.clear();
      });

      this.child.on('error', () => {
        this.child = null;
        this.isReady = false;
      });
    } catch {
      this.child = null;
      this.isReady = false;
    }
  }

  private static readonly ALLOWED_ACTIONS = new Set(['predict', 'train', 'backtest', 'list_models', 'ping']);

  public async sendCommand(
    action: 'predict' | 'train' | 'backtest' | 'list_models' | 'ping',
    payload: Record<string, any> = {}
  ): Promise<any> {
    if (!XGBoostDaemonManager.ALLOWED_ACTIONS.has(action)) {
      throw new Error(`Unauthorized action '${action}' requested for Python daemon`);
    }

    this.ensureDaemonRunning();

    if (!this.child || !this.child.stdin || !this.child.stdin.writable) {
      throw new Error('Python daemon unavailable');
    }

    // Sanitize payload symbol if present
    const sanitizedPayload: Record<string, any> = { ...payload };
    if (sanitizedPayload.symbol && typeof sanitizedPayload.symbol === 'string') {
      sanitizedPayload.symbol = sanitizedPayload.symbol.replace(/[^A-Za-z0-9_]/g, '');
    }

    // Validate ticks payload if present
    if (sanitizedPayload.ticks !== undefined && !Array.isArray(sanitizedPayload.ticks)) {
      throw new Error('Malformed daemon payload: ticks parameter must be an array');
    }

    const reqId = `req_${Date.now()}_${++this.reqIdCounter}`;
    const packet = JSON.stringify({ action, id: reqId, ...sanitizedPayload }) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(reqId)) {
          this.pending.delete(reqId);
          reject(new Error(`Daemon request ${action} timed out`));
        }
      }, 3000);

      this.pending.set(reqId, { resolve, reject, timer });

      try {
        this.child!.stdin!.write(packet);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(err);
      }
    });
  }

  public isAvailable(): boolean {
    return this.child !== null && this.isReady;
  }
}

export const xgboostDaemon = new XGBoostDaemonManager();
