import { saveTicksBatch, getTicksHistory, initDbSchema } from '@/lib/db';
import WebSocket from 'ws';
import { openDerivPublicWebSocket } from '@/lib/deriv-public-websocket';

export type TickPoint = { price: number; timestamp: number };

export async function fetchDerivTickHistory(
  symbol: string,
  count: number = 1000,
  end: number | 'latest' = 'latest',
): Promise<TickPoint[]> {
  const ws = await openDerivPublicWebSocket(10_000);

  return new Promise((resolve, reject) => {
    let handled = false;
    const reqCount = Math.min(5000, Math.max(50, count));
    const timeout = setTimeout(() => {
      if (handled) return;
      handled = true;
      try { ws.close(); } catch {}
      reject(new Error(`Deriv tick history request timed out for ${symbol}.`));
    }, 10_000);

    const fail = (error: Error) => {
      if (handled) return;
      handled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      reject(error);
    };

    ws.send(JSON.stringify({
      ticks_history: symbol,
      adjust_start_time: 1,
      count: reqCount,
      end,
      style: 'ticks',
      req_id: 1,
    }));

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const res = JSON.parse(data.toString());
        if (res?.error) {
          const code = res.error.code ? ` (${res.error.code})` : '';
          fail(new Error(`Deriv tick history failed for ${symbol}${code}: ${String(res.error.message || 'Unknown Deriv error')}`));
          return;
        }

        if (res?.msg_type !== 'history' && !res?.history) return;

        if (res?.history && Array.isArray(res.history.prices) && Array.isArray(res.history.times)) {
          const prices: number[] = res.history.prices;
          const times: number[] = res.history.times;
          const ticks = prices
            .map((price, idx) => ({
              price: Number(price),
              timestamp: Number(times[idx] ?? 0) * 1000,
            }))
            .filter((tick) => Number.isFinite(tick.price) && tick.price > 0 && Number.isFinite(tick.timestamp) && tick.timestamp > 0);

          if (!ticks.length) {
            fail(new Error(`Deriv returned no valid historical ticks for ${symbol}.`));
            return;
          }

          handled = true;
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          resolve(ticks);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(`Invalid Deriv tick history response for ${symbol}.`));
      }
    });

    ws.on('error', (error) => fail(error instanceof Error ? error : new Error(`Deriv WebSocket error while loading ${symbol}.`)));
    ws.on('close', () => {
      if (!handled) fail(new Error(`Deriv WebSocket closed before historical data was received for ${symbol}.`));
    });
  });
}

export async function ensureMinTicks(symbol: string, minRequired: number = 100, forceDerivFetch: boolean = false) {
  await initDbSchema();
  let dbTicks = forceDerivFetch ? [] : await getTicksHistory(symbol, Math.max(1000, minRequired));

  if (!dbTicks || dbTicks.length < minRequired) {
    const realDerivTicks = await fetchDerivTickHistory(symbol, Math.max(1000, minRequired), 'latest');
    await saveTicksBatch(symbol, realDerivTicks).catch(() => {});
    dbTicks = await getTicksHistory(symbol, Math.max(1000, minRequired));
    if (!dbTicks || dbTicks.length < minRequired) {
      dbTicks = realDerivTicks;
    }
  }

  return dbTicks;
}
