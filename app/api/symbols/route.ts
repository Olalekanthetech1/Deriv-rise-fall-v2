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

const DEFAULT_SYMBOLS: ActiveSymbolItem[] = [
  { symbol: 'R_100', displayName: 'Volatility 100 Index', market: 'synthetic_index', submarket: 'random_index', isOpen: true },
  { symbol: '1HZ100V', displayName: 'Volatility 100 (1s) Index', market: 'synthetic_index', submarket: 'random_index', isOpen: true },
  { symbol: 'R_75', displayName: 'Volatility 75 Index', market: 'synthetic_index', submarket: 'random_index', isOpen: true },
  { symbol: '1HZ75V', displayName: 'Volatility 75 (1s) Index', market: 'synthetic_index', submarket: 'random_index', isOpen: true },
  { symbol: 'R_50', displayName: 'Volatility 50 Index', market: 'synthetic_index', submarket: 'random_index', isOpen: true },
  { symbol: '1HZ50V', displayName: 'Volatility 50 (1s) Index', market: 'synthetic_index', submarket: 'random_index', isOpen: true },
  { symbol: 'R_25', displayName: 'Volatility 25 Index', market: 'synthetic_index', submarket: 'random_index', isOpen: true },
  { symbol: '1HZ25V', displayName: 'Volatility 25 (1s) Index', market: 'synthetic_index', submarket: 'random_index', isOpen: true },
  { symbol: 'R_10', displayName: 'Volatility 10 Index', market: 'synthetic_index', submarket: 'random_index', isOpen: true },
  { symbol: '1HZ10V', displayName: 'Volatility 10 (1s) Index', market: 'synthetic_index', submarket: 'random_index', isOpen: true },
  { symbol: 'JD10', displayName: 'Jump 10 Index', market: 'synthetic_index', submarket: 'jump_index', isOpen: true },
  { symbol: 'JD25', displayName: 'Jump 25 Index', market: 'synthetic_index', submarket: 'jump_index', isOpen: true },
  { symbol: 'JD50', displayName: 'Jump 50 Index', market: 'synthetic_index', submarket: 'jump_index', isOpen: true },
  { symbol: 'JD75', displayName: 'Jump 75 Index', market: 'synthetic_index', submarket: 'jump_index', isOpen: true },
  { symbol: 'JD100', displayName: 'Jump 100 Index', market: 'synthetic_index', submarket: 'jump_index', isOpen: true },
  { symbol: 'FRXEURUSD', displayName: 'EUR/USD', market: 'forex', submarket: 'major_pairs', isOpen: true },
  { symbol: 'FRXGBPUSD', displayName: 'GBP/USD', market: 'forex', submarket: 'major_pairs', isOpen: true },
  { symbol: 'FRXUSDJPY', displayName: 'USD/JPY', market: 'forex', submarket: 'major_pairs', isOpen: true },
  { symbol: 'FRXAUDUSD', displayName: 'AUD/USD', market: 'forex', submarket: 'major_pairs', isOpen: true },
  { symbol: 'FRXUSDCAD', displayName: 'USD/CAD', market: 'forex', submarket: 'major_pairs', isOpen: true },
  { symbol: 'CWMXAUUSD', displayName: 'Gold/USD', market: 'commodities', submarket: 'metals', isOpen: true },
];

async function fetchLiveSymbols(): Promise<ActiveSymbolItem[]> {
  const appId = process.env.NEXT_PUBLIC_DERIV_APP_ID || '1089';
  const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;

  return new Promise<ActiveSymbolItem[]>((resolve, reject) => {
    let handled = false;
    
    // Hard timeout if Deriv hangs
    const timeout = setTimeout(() => {
      if (!handled) {
        handled = true;
        reject(new Error('Deriv WS Timeout'));
      }
    }, 4000);

    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      ws.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic' }));
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const res = JSON.parse(data.toString());
        if (res.active_symbols && Array.isArray(res.active_symbols) && res.active_symbols.length > 0) {
          if (!handled) {
            handled = true;
            clearTimeout(timeout);
            ws.close();
            const formatted: ActiveSymbolItem[] = res.active_symbols.map((s: any) => ({
              symbol: s.symbol || s.underlying_symbol,
              displayName: s.display_name || s.symbol,
              market: s.market || 'synthetic_index',
              submarket: s.submarket_display_name || s.submarket || '',
              isOpen: s.exchange_is_open === 1 || s.is_trading_suspended === 0,
            }));
            resolve(formatted);
          }
        }
      } catch {
        // Keep waiting
      }
    });

    ws.on('error', (err) => {
      if (!handled) {
        handled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

// Implement opossum circuit breaker
const derivCircuitBreaker = new CircuitBreaker(fetchLiveSymbols, {
  timeout: 5000, 
  errorThresholdPercentage: 50, // Open breaker if 50% of requests fail
  resetTimeout: 10000 // Try again after 10s
});

derivCircuitBreaker.fallback(() => DEFAULT_SYMBOLS);

derivCircuitBreaker.on('open', () => {
  logger.warn('Deriv WS Circuit Breaker OPENED (API Degraded)');
});

derivCircuitBreaker.on('halfOpen', () => {
  logger.info('Deriv WS Circuit Breaker HALF-OPEN (Testing recovery)');
});

derivCircuitBreaker.on('close', () => {
  logger.info('Deriv WS Circuit Breaker CLOSED (Recovered)');
});

export async function GET() {
  try {
    const symbols = await derivCircuitBreaker.fire();
    return NextResponse.json({ success: true, symbols });
  } catch (err: any) {
    logger.error(`Error in /api/symbols: ${err.message}`);
    return NextResponse.json({ success: true, symbols: DEFAULT_SYMBOLS });
  }
}

