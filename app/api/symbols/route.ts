import { NextResponse } from 'next/server';
import WebSocket from 'ws';
import { logger } from '@/lib/logger';
import { openDerivPublicWebSocket } from '@/lib/deriv-public-websocket';

export interface ActiveSymbolItem {
  symbol: string;
  displayName: string;
  market: string;
  submarket: string;
  isOpen: boolean;
  isAvailable: boolean;
}

type DerivActiveSymbol = {
  underlying_symbol?: string;
  underlying_symbol_name?: string;
  market?: string;
  submarket?: string;
  exchange_is_open?: number | string | boolean;
  is_trading_suspended?: number | string | boolean;
};

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

async function fetchLiveSymbols(): Promise<ActiveSymbolItem[]> {
  const ws = await openDerivPublicWebSocket(10_000);

  return new Promise<ActiveSymbolItem[]>((resolve, reject) => {
    let handled = false;
    const timeout = setTimeout(() => {
      if (!handled) {
        handled = true;
        try { ws.close(); } catch {}
        reject(new Error('Deriv symbol discovery timed out.'));
      }
    }, 10_000);

    const fail = (error: Error) => {
      if (handled) return;
      handled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      reject(error);
    };

    ws.send(JSON.stringify({ active_symbols: 'brief', req_id: 1 }));

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const response = JSON.parse(data.toString());

        if (response.error) {
          const code = response.error.code ? ` (${response.error.code})` : '';
          fail(new Error(`Deriv symbol discovery failed${code}: ${String(response.error.message || 'Unknown Deriv error')}`));
          return;
        }

        if (response.msg_type !== 'active_symbols') return;
        if (!Array.isArray(response.active_symbols)) {
          fail(new Error('Deriv returned an invalid active_symbols response.'));
          return;
        }

        const formatted = (response.active_symbols as DerivActiveSymbol[])
          .map((item): ActiveSymbolItem | null => {
            const symbol = String(item.underlying_symbol || '').trim();
            if (!symbol) return null;

            const exchangeIsOpen = asBoolean(item.exchange_is_open);
            const tradingSuspended = asBoolean(item.is_trading_suspended);

            return {
              symbol,
              displayName: String(item.underlying_symbol_name || symbol),
              market: String(item.market || ''),
              submarket: String(item.submarket || ''),
              isOpen: exchangeIsOpen && !tradingSuspended,
              isAvailable: !tradingSuspended,
            };
          })
          .filter((item): item is ActiveSymbolItem => item !== null);

        if (!formatted.length) {
          fail(new Error('Deriv returned no usable active symbols.'));
          return;
        }

        handled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch {}
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

/**
 * Symbol discovery is a short-lived public market-data request. A process-wide
 * circuit breaker is not used here because it can hide a recovered connection
 * behind a stale "Breaker is open" state. Each request gets bounded fresh
 * connection retries and preserves the real upstream error when unavailable.
 */
async function fetchLiveSymbolsWithRetry(): Promise<ActiveSymbolItem[]> {
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchLiveSymbols();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  throw lastError || new Error('Unable to load live Deriv symbols.');
}

export async function GET() {
  try {
    const symbols = await fetchLiveSymbolsWithRetry();

    return NextResponse.json({
      success: true,
      dataSource: 'deriv-live',
      symbolCount: symbols.length,
      availableCount: symbols.filter((symbol) => symbol.isAvailable).length,
      openCount: symbols.filter((symbol) => symbol.isOpen).length,
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
