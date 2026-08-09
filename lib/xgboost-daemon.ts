import { spawn, ChildProcess } from 'child_process';
import { getMlRuntimeSchemaContract } from './ml-runtime-schema';

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: any) => void;
  timer: NodeJS.Timeout;
}

type DaemonAction = 'predict' | 'predict_ensemble' | 'train' | 'list_models' | 'ping' | 'backtest';

const CANONICAL_RUNTIME_ENTRYPOINT = 'ml_runtime_entry.py';

class XGBoostDaemonManager {
  private child: ChildProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private reqIdCounter = 0;
  private isReady = false;
  private buffer = '';
  private restartTimer: NodeJS.Timeout | null = null;
  private restartDelay = 1000;

  constructor() {
    this.ensureDaemonRunning();
  }

  private getRuntimeScript(): string {
    const configuredScript = process.env.PYTHON_ML_SCRIPT_PATH?.trim();
    const pythonScript = configuredScript || `scripts/${CANONICAL_RUNTIME_ENTRYPOINT}`;
    const scriptName = pythonScript.split(/[\\/]/).pop() || '';

    if (scriptName !== CANONICAL_RUNTIME_ENTRYPOINT) {
      throw new Error(`PYTHON_ML_SCRIPT_PATH must target the canonical ${CANONICAL_RUNTIME_ENTRYPOINT} entrypoint`);
    }

    return pythonScript;
  }

  private ensureDaemonRunning() {
    if (this.child) return;

    try {
      const pythonScript = this.getRuntimeScript();
      this.child = spawn(process.env.PYTHON_BIN || 'python3', [pythonScript], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      this.child.stdout?.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('utf8');
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed);
            if (data.type === 'ready') {
              this.isReady = true;
              this.restartDelay = 1000;
              continue;
            }

            if (data.id && this.pending.has(data.id)) {
              const req = this.pending.get(data.id)!;
              clearTimeout(req.timer);
              this.pending.delete(data.id);
              req.resolve(data);
            }
          } catch {
            // stdout remains JSON-line tolerant
          }
        }
      });

      const onExit = () => {
        this.child = null;
        this.isReady = false;
        for (const req of this.pending.values()) {
          clearTimeout(req.timer);
          req.reject(new Error('Python ML daemon exited unexpectedly'));
        }
        this.pending.clear();
        this.scheduleRestart();
      };

      this.child.on('exit', onExit);
      this.child.on('error', onExit);
    } catch {
      this.child = null;
      this.isReady = false;
      this.scheduleRestart();
    }
  }

  private scheduleRestart() {
    if (this.restartTimer) return;
    const delay = this.restartDelay;
    this.restartDelay = Math.min(30000, this.restartDelay * 2);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.ensureDaemonRunning();
    }, delay);
  }

  private static readonly ALLOWED_ACTIONS = new Set<DaemonAction>([
    'predict',
    'predict_ensemble',
    'train',
    'list_models',
    'ping',
    'backtest',
  ]);

  public async sendCommand(action: DaemonAction, payload: Record<string, any> = {}): Promise<any> {
    if (!XGBoostDaemonManager.ALLOWED_ACTIONS.has(action)) {
      throw new Error(`Unauthorized daemon action: ${action}`);
    }
    this.ensureDaemonRunning();
    if (!this.child?.stdin?.writable) throw new Error('Python ML daemon unavailable');

    const schemaContract = await getMlRuntimeSchemaContract();
    const sanitized: Record<string, unknown> = { ...payload, schemaContract };

    const symbol = sanitized.symbol;
    if (typeof symbol === 'string') {
      sanitized.symbol = symbol.replace(/[^A-Za-z0-9_]/g, '');
    }

    const ticks = sanitized.ticks;
    if (ticks !== undefined && !Array.isArray(ticks)) {
      throw new Error('ticks must be an array');
    }

    const id = `req_${Date.now()}_${++this.reqIdCounter}`;
    const packet = JSON.stringify({ action, id, ...sanitized }) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Daemon request ${action} timed out`));
        }
      }, action === 'train' ? 30000 : action === 'backtest' ? 60000 : 5000);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child!.stdin!.write(packet);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  public isAvailable() {
    return this.child !== null && this.isReady;
  }
}

export const xgboostDaemon = new XGBoostDaemonManager();
