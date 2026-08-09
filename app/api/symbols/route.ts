import { NextResponse } from 'next/server';
import WebSocket from 'ws';
import CircuitBreaker from 'opossum';
import { logger } from '@/lib/logger';

export interface ActiveSymbolItem {
  symbol: string;
  displayName: string;
  market: string;
  submarket: string;
  isOpen: boolean;
}

type DerivActiveSymbol = {
  symbol?: string;
  underlying_symbol?: string;
  display_name?: string;
  underlying_symbol_name?: string;
  market?: string;
  submarket?: string;
  submarket_display_name?: string;
  exchange_is_open?: number | string | boolean;
  is_trading_suspended?: number | string | boolean;
};

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

async function fetchLiveSymbols(): Promise<ActiveSymbolItem[]> {
  const appId = process.env.NEXT_PUBLIC_DERIV_APP_ID?.trim();
  if (!appId) throw new Error('NEXT_PUBLIC_DERIV_APP_ID is not configured.');

  const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;

  return new Promise<ActiveSymbolItem[]>((resolve, reject) => {
    let handled = false;
    const timeout = setTimeout(() => {
      if (!handled) {
        handled = true;
        reject(new Error('Deriv symbol discovery timed out.'));
      }
    }, 4000);

    const ws = new WebSocket(wsUrl);

    const fail = (error: Error) => {
      if (handled) return;
      handled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      reject(error);
    };

    ws.on('open', () => {
      // Keep this request compatible with the current Deriv active_symbols API.
      // Filtering is performed locally because product_type was removed from
      // the current endpoint contract.
      ws.send(JSON.stringify({ active_symbols: 'brief' }));
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.error) {
          fail(new Error(String(response.error.message || 'Deriv symbol discovery failed.')));
          return;
        }

        if (!Array.isArray(response.active_symbols) || response.active_symbols.length === 0) return;

        const formatted = (response.active_symbols as DerivActiveSymbol[])
          .map((item): ActiveSymbolItem | null => {
            // Support both the current API field names and the legacy names so
            // the application remains resilient during Deriv API transitions.
            const symbol = String(item.underlying_symbol || item.symbol || '').trim();
            if (!symbol) return null;

            const exchangeOpen = asBoolean(item.exchange_is_open);
            const tradingSuspended = asBoolean(item.is_trading_suspended);

            return {
              symbol,
              displayName: String(item.underlying_symbol_name || item.display_name || symbol),
              market: String(item.market || ''),
              submarket: String(item.submarket || item.submarket_display_name || ''),
              isOpen: exchangeOpen && !tradingSuspended,
            };
          })
          .filter((item): item is ActiveSymbolItem => item !== null);

        if (!formatted.length) {
          fail(new Error('Deriv returned no usable active symbols.'));
          return;
        }

        handled = true;
        clearTimeout(timeout);
        ws.close();
        resolve(formatted);
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Invalid Deriv symbol response.'));
      }
    });

    ws.on('error', (error) => fail(error instanceof Error ? error : new Error('Deriv WebSocket error.')));
    ws.on('close', () => {
      if (!handled) fail(new Error('Deriv symbol discovery connection closed before data was received.'));
    });
  });
}

const derivCircuitBreaker = new CircuitBreaker(fetchLiveSymbols, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000,
});

derivCircuitBreaker.on('open', () => logger.warn('Deriv WS Circuit Breaker OPENED (API Degraded)'));
derivCircuitBreaker.on('halfOpen', () => logger.info('Deriv WS Circuit Breaker HALF-OPEN (Testing recovery)'));
derivCircuitBreaker.on('close', () => logger.info('Deriv WS Circuit Breaker CLOSED (Recovered)'));

export async function GET() {
  try {
    const symbols = await derivCircuitBreaker.fire();
    return NextResponse.json({
      success: true,
      dataSource: 'deriv-live',
      symbols,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    logger.error(`Error in /api/symbols: ${err?.message || err}`);
    return NextResponse.json({
      success: false,
      dataSource: 'deriv-unavailable',
      symbols: [],
      error: err?.message || 'Unable to load live Deriv symbols.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
