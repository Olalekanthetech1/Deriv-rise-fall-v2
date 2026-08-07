import { saveTicksBatch, getTicksHistory, initDbSchema } from '@/lib/db';
import WebSocket from 'ws';

export async function fetchDerivTickHistory(symbol: string, count: number = 1000): Promise<Array<{ price: number; timestamp: number }>> {
  const appId = process.env.NEXT_PUBLIC_DERIV_APP_ID || '1089';
  const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;

  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    const reqCount = Math.min(5000, Math.max(50, count));
    const timeout = setTimeout(() => {
      if (ws) {
        try { ws.close(); } catch (e) {}
      }
      resolve([]);
    }, 5000);

    try {
      ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        const req = {
          ticks_history: symbol,
          adjust_start_time: 1,
          count: reqCount,
          end: 'latest',
          start: 1,
          style: 'ticks',
        };
        ws?.send(JSON.stringify(req));
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const res = JSON.parse(data.toString());
          if (res.history && Array.isArray(res.history.prices) && Array.isArray(res.history.times)) {
            const prices: number[] = res.history.prices;
            const times: number[] = res.history.times;
            const ticks = prices.map((price, idx) => ({
              price: Number(price),
              timestamp: times[idx] ? times[idx] * 1000 : Date.now() - (prices.length - idx) * 1000,
            }));
            clearTimeout(timeout);
            try { ws?.close(); } catch (e) {}
            resolve(ticks);
            return;
          }
        } catch (err) {
          // Fall through on parse error
        }
        clearTimeout(timeout);
        try { ws?.close(); } catch (e) {}
        resolve([]);
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        try { ws?.close(); } catch (e) {}
        resolve([]);
      });
    } catch (err) {
      clearTimeout(timeout);
      resolve([]);
    }
  });
}

export function generateSyntheticTicks(symbol: string, count: number = 300) {
  const now = Date.now();
  const ticks: Array<{ price: number; timestamp: number }> = [];
  let price = 6500.0;
  if (symbol.includes('75')) price = 9800.0;
  if (symbol.includes('50')) price = 3400.0;
  if (symbol.includes('25')) price = 1200.0;
  if (symbol.includes('10')) price = 850.0;
  if (symbol.startsWith('FRX')) price = 1.0850;
  if (symbol.startsWith('CWM')) price = 2450.0;

  for (let i = count; i >= 0; i--) {
    const timestamp = now - i * 1000;
    const delta = (Math.random() - 0.495) * (price * 0.0008);
    price = Number((price + delta).toFixed(symbol.startsWith('FRX') ? 5 : 2));
    ticks.push({ price, timestamp });
  }
  return ticks;
}

export async function ensureMinTicks(symbol: string, minRequired: number = 100, forceDerivFetch: boolean = false) {
  await initDbSchema();
  let dbTicks = forceDerivFetch ? [] : await getTicksHistory(symbol, Math.max(1000, minRequired));
  
  if (!dbTicks || dbTicks.length < minRequired) {
    // 1. Attempt fetching real tick history directly from Deriv WebSocket API (cold start 1,000 to 5,000 ticks)
    const realDerivTicks = await fetchDerivTickHistory(symbol, Math.max(1000, minRequired));
    if (realDerivTicks && realDerivTicks.length >= 10) {
      await saveTicksBatch(symbol, realDerivTicks).catch(() => {});
      dbTicks = realDerivTicks;
    } else {
      // 2. Fallback to generated ticks if Deriv WS is unreachable
      const freshTicks = generateSyntheticTicks(symbol, Math.max(300, minRequired));
      await saveTicksBatch(symbol, freshTicks).catch(() => {});
      dbTicks = await getTicksHistory(symbol, Math.max(300, minRequired));
      if (!dbTicks || dbTicks.length < minRequired) {
        dbTicks = freshTicks;
      }
    }
  }
  return dbTicks;
}
