import { Client, neon, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

type WakeupChannel = 'dataset_jobs' | 'ml_training_jobs';

const CHANNEL_CONFIG: Record<WakeupChannel, { table: string; idExpression: string; queuedPredicate?: string }> = {
  dataset_jobs: {
    table: 'ops_ml_dataset_build_jobs',
    idExpression: 'NEW.id',
  },
  ml_training_jobs: {
    table: 'ml_training_job_queue',
    idExpression: 'NEW.job_id',
    queuedPredicate: "NEW.status = 'queued'",
  },
};

function connectionString(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error('[Background Wakeup] DATABASE_URL is required.');
  return value;
}

/**
 * Installs idempotent PostgreSQL triggers that turn durable queue writes into
 * best-effort wake-up notifications. The notification is never the source of
 * truth; workers always reconcile the durable queue after reconnects.
 *
 * PostgreSQL DDL does not accept bind parameters for identifiers or trigger
 * function arguments. The previous tagged-template construction allowed
 * Neon to encode those interpolations as $1-style parameters, which PostgreSQL
 * rejects while parsing CREATE TRIGGER. All interpolated values here come only
 * from the closed CHANNEL_CONFIG enum, so the complete DDL is intentionally
 * sent as raw SQL rather than parameterized SQL.
 */
export async function ensureBackgroundJobWakeupTriggers(): Promise<void> {
  const sql = neon(connectionString());
  await sql`
    CREATE OR REPLACE FUNCTION ops_notify_background_job()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM pg_notify(TG_ARGV[0], row_to_json(NEW)::text);
      RETURN NEW;
    END;
    $$
  `;

  for (const [channel, config] of Object.entries(CHANNEL_CONFIG) as Array<[WakeupChannel, typeof CHANNEL_CONFIG[WakeupChannel]]>) {
    const triggerName = channel === 'dataset_jobs'
      ? 'trg_ops_ml_dataset_jobs_wakeup'
      : 'trg_ml_training_job_queue_wakeup';

    await sql.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON ${config.table}`);

    if (config.queuedPredicate) {
      await sql.unsafe(`
        CREATE TRIGGER ${triggerName}
        AFTER INSERT OR UPDATE OF status ON ${config.table}
        FOR EACH ROW
        WHEN (${config.queuedPredicate})
        EXECUTE FUNCTION ops_notify_background_job('${channel}')
      `);
    } else {
      await sql.unsafe(`
        CREATE TRIGGER ${triggerName}
        AFTER INSERT ON ${config.table}
        FOR EACH ROW
        EXECUTE FUNCTION ops_notify_background_job('${channel}')
      `);
    }
  }
}

/**
 * Maintains a persistent PostgreSQL LISTEN connection for a background worker.
 * Notifications only wake the worker; the worker must still claim work from
 * the durable database queue. If the connection drops, it reconnects and the
 * caller's reconciliation loop remains the correctness fallback.
 */
export async function startBackgroundJobWakeupListener(
  channel: WakeupChannel,
  onWake: () => void,
): Promise<() => Promise<void>> {
  const databaseUrl = connectionString();
  let stopped = false;
  let client: Client | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelayMs = 1000;

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(30000, reconnectDelayMs * 2);
  };

  const connect = async () => {
    if (stopped || client) return;
    const nextClient = new Client(databaseUrl);
    client = nextClient;
    try {
      nextClient.on('notification', (message: { channel?: string }) => {
        if (message.channel === channel && !stopped) onWake();
      });
      nextClient.on('error', (error: unknown) => {
        console.error(`[Background Wakeup] ${channel} listener error:`, error);
        if (client === nextClient) client = null;
        scheduleReconnect();
      });
      await nextClient.connect();
      await nextClient.query(`LISTEN ${channel}`);
      reconnectDelayMs = 1000;
      console.log(`[Background Wakeup] listening on ${channel}`);
    } catch (error) {
      console.error(`[Background Wakeup] ${channel} connection failed:`, error);
      if (client === nextClient) client = null;
      try { await nextClient.end(); } catch { /* best effort */ }
      scheduleReconnect();
    }
  };

  await connect();

  return async () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const current = client;
    client = null;
    if (current) {
      try { await current.query(`UNLISTEN ${channel}`); } catch { /* best effort */ }
      try { await current.end(); } catch { /* best effort */ }
    }
  };
}
