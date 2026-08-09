import { saveTicksBatch, getTicksHistory, initDbSchema } from '@/lib/db';
import WebSocket from 'ws';

export type TickPoint = { price: number; timestamp: number };

function getDerivAppId(): string {
  return process.env.NEXT_PUBLIC_DERIV_APP_ID?.trim() || '1089';
}

export async function fetchDerivTickHistory(
  symbol: string,
  count: number = 1000,
  end: number | 'latest' = 'latest',
): Promise<TickPoint[]> {
  const appId = getDerivAppId();
  const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;

  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    const reqCount = Math.min(5000, Math.max(50, count));
    const timeout = setTimeout(() => {
      if (ws) {
        try { ws.close(); } catch {}
      }
      resolve([]);
    }, 7000);

    try {
      ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        ws?.send(JSON.stringify({
          ticks_history: symbol,
          adjust_start_time: 1,
          count: reqCount,
          end,
          style: 'ticks',
        }));
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const res = JSON.parse(data.toString());
          if (res?.error) {
            clearTimeout(timeout);
            try { ws?.close(); } catch {}
            resolve([]);
            return;
          }

          if (res?.history && Array.isArray(res.history.prices) && Array.isArray(res.history.times)) {
            const prices: number[] = res.history.prices;
            const times: number[] = res.history.times;
            const ticks = prices
              .map((price, idx) => ({
                price: Number(price),
                timestamp: Number(times[idx] ?? 0) * 1000,
              }))
              .filter((tick) => Number.isFinite(tick.price) && tick.price > 0 && Number.isFinite(tick.timestamp) && tick.timestamp > 0);

            clearTimeout(timeout);
            try { ws?.close(); } catch {}
            resolve(ticks);
            return;
          }
        } catch {
          // Ignore malformed frames and fall through to a safe empty response.
        }

        clearTimeout(timeout);
        try { ws?.close(); } catch {}
        resolve([]);
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        try { ws?.close(); } catch {}
        resolve([]);
      });
    } catch {
      clearTimeout(timeout);
      resolve([]);
    }
  });
}

export async function ensureMinTicks(symbol: string, minRequired: number = 100, forceDerivFetch: boolean = false) {
  await initDbSchema();
  let dbTicks = forceDerivFetch ? [] : await getTicksHistory(symbol, Math.max(1000, minRequired));

  if (!dbTicks || dbTicks.length < minRequired) {
    const realDerivTicks = await fetchDerivTickHistory(symbol, Math.max(1000, minRequired), 'latest');
    if (realDerivTicks && realDerivTicks.length > 0) {
      await saveTicksBatch(symbol, realDerivTicks).catch(() => {});
      dbTicks = await getTicksHistory(symbol, Math.max(1000, minRequired));
      if (!dbTicks || dbTicks.length < minRequired) {
        dbTicks = realDerivTicks;
      }
    } else {
      dbTicks = [];
    }
  }

  return dbTicks;
}
