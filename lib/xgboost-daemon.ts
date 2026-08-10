import { spawn, ChildProcess } from 'child_process';
import { getMlRuntimeSchemaContract, type MlRuntimeSchemaContract } from './ml-runtime-schema';

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: any) => void;
  timer: NodeJS.Timeout;
}

type DaemonAction = 'predict' | 'predict_ensemble' | 'train' | 'train_partitioned' | 'list_models' | 'ping' | 'backtest';
const CANONICAL_RUNTIME_ENTRYPOINT = 'ml_runtime_entry.py';
const DEFAULT_TRAINING_TIMEOUT_MS = 15 * 60 * 1000;

function trainingTimeoutMs(): number {
  const raw = process.env.ML_TRAINING_TIMEOUT_MS?.trim();
  const value = raw ? Number(raw) : DEFAULT_TRAINING_TIMEOUT_MS;
  if (!Number.isFinite(value)) return DEFAULT_TRAINING_TIMEOUT_MS;
  return Math.min(2 * 60 * 60 * 1000, Math.max(60_000, Math.trunc(value)));
}

function attachClientRoundTripTiming(data: any, roundTripMs: number): any {
  if (!data || typeof data !== 'object') return data;
  const next: Record<string, any> = { ...data };
  const metrics = next.metrics && typeof next.metrics === 'object' ? { ...next.metrics } : null;
  if (metrics) {
    const timings = metrics.timings && typeof metrics.timings === 'object' ? { ...metrics.timings } : {};
    timings.clientRoundTripMs = roundTripMs;
    metrics.timings = timings;
    next.metrics = metrics;
  } else {
    const timings = next.timings && typeof next.timings === 'object' ? { ...next.timings } : {};
    timings.clientRoundTripMs = roundTripMs;
    next.timings = timings;
  }
  return next;
}

class XGBoostDaemonManager {
  private child: ChildProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private reqIdCounter = 0;
  private isReady = false;
  private buffer = '';
  private restartTimer: NodeJS.Timeout | null = null;
  private restartDelay = 1000;

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
      this.child = spawn(/*turbopackIgnore: true*/ process.env.PYTHON_BIN || 'python3', [pythonScript], {
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
            /* ignore non-JSON stdout */
          }
        }
      });
      const onExit = () => {
        this.child = null;
        this.isReady = false;
        this.buffer = '';
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

  private terminateTrainingDaemon() {
    const child = this.child;
    this.child = null;
    this.isReady = false;
    this.buffer = '';
    if (!child) return;
    try {
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => {
        try {
          if (!child.killed) child.kill('SIGKILL');
        } catch {
          // Process already exited.
        }
      }, 2000);
      child.once('exit', () => clearTimeout(killTimer));
    } catch {
      // The child may have already exited; restart scheduling remains safe.
    }
    this.scheduleRestart();
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
    'train_partitioned',
    'list_models',
    'ping',
    'backtest',
  ]);

  public async sendCommand(action: DaemonAction, payload: Record<string, any> = {}): Promise<any> {
    if (!XGBoostDaemonManager.ALLOWED_ACTIONS.has(action)) throw new Error(`Unauthorized daemon action: ${action}`);
    this.ensureDaemonRunning();
    if (!this.child?.stdin?.writable) throw new Error('Python ML daemon unavailable');

    const requestedSchema = payload.schemaContract as MlRuntimeSchemaContract | undefined;
    const schemaContract = requestedSchema ?? await getMlRuntimeSchemaContract();
    if (!schemaContract || typeof schemaContract !== 'object' || typeof schemaContract.schemaFingerprint !== 'string') {
      throw new Error('Invalid ML schema contract.');
    }
    const sanitized: Record<string, unknown> = { ...payload, schemaContract };
    if (typeof sanitized.symbol === 'string') sanitized.symbol = sanitized.symbol.replace(/[^A-Za-z0-9_]/g, '');
    if (sanitized.ticks !== undefined && !Array.isArray(sanitized.ticks)) throw new Error('ticks must be an array');

    const id = `req_${Date.now()}_${++this.reqIdCounter}`;
    const packet = JSON.stringify({ action, id, ...sanitized }) + '\n';
    const roundTripStartedAt = Date.now();

    return new Promise((resolve, reject) => {
      const defaultTimeoutMs = action === 'train' || action === 'train_partitioned'
        ? trainingTimeoutMs()
        : action === 'backtest'
          ? 60000
          : action === 'predict_ensemble'
            ? 15000
            : 5000;
      const configuredTimeout = Number(process.env.ML_PREDICT_ENSEMBLE_TIMEOUT_MS);
      const timeoutMs = action === 'predict_ensemble' && Number.isFinite(configuredTimeout) && configuredTimeout >= 5000 && configuredTimeout <= 60000
        ? configuredTimeout
        : defaultTimeoutMs;
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        if (action === 'train' || action === 'train_partitioned') {
          this.terminateTrainingDaemon();
          reject(new Error(`DAEMON_TRAINING_TIMEOUT: ${action} exceeded ${timeoutMs}ms; native worker was terminated and will restart cleanly.`));
        } else {
          reject(new Error(`Daemon request ${action} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (data: any) => resolve(attachClientRoundTripTiming(data, Date.now() - roundTripStartedAt)),
        reject,
        timer,
      });

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
    this.ensureDaemonRunning();
    return this.child !== null && this.isReady;
  }
}

export const xgboostDaemon = new XGBoostDaemonManager();
