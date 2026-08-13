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
    // PostgreSQL trigger-function arguments are part of DDL grammar and cannot
    // be sent as bind parameters. Both values come from the closed WakeupChannel
    // union, so emitting the quoted literal is safe and avoids the "$1" syntax
    // error produced by parameterized EXECUTE FUNCTION arguments.
    const channelLiteral = sql.unsafe(`'${channel}'`);

    await sql`DROP TRIGGER IF EXISTS ${sql.unsafe(triggerName)} ON ${sql.unsafe(config.table)}`;

    if (config.queuedPredicate) {
      await sql`
        CREATE TRIGGER ${sql.unsafe(triggerName)}
        AFTER INSERT OR UPDATE OF status ON ${sql.unsafe(config.table)}
        FOR EACH ROW
        WHEN (${sql.unsafe(config.queuedPredicate)})
        EXECUTE FUNCTION ops_notify_background_job(${channelLiteral})
      `;
    } else {
      await sql`
        CREATE TRIGGER ${sql.unsafe(triggerName)}
        AFTER INSERT ON ${sql.unsafe(config.table)}
        FOR EACH ROW
        EXECUTE FUNCTION ops_notify_background_job(${channelLiteral})
      `;
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
