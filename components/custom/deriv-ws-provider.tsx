'use client';

import { createContext, useContext, useEffect, useRef } from 'react';
import { useDerivWS } from '@deriv/core';
import { useAuth } from '@/hooks/use-auth';
import { ClientWSRateLimiter } from '@/lib/websocket-rate-limiter';
import type { DerivWS } from '@deriv/core';
import type { UseAuthReturn } from '@/hooks/use-auth';

interface DerivWSContextValue {
  ws: DerivWS | null;
  isConnected: boolean;
  isExhausted: boolean;
  auth: UseAuthReturn;
  isRateLimited: boolean;
}

const DerivWSContext = createContext<DerivWSContextValue | null>(null);

/**
 * Maintains a single WebSocket connection and auth state above all page components
 * so navigation between pages (e.g. main → reports → back) does not tear down
 * and recreate the connection.
 */
export function DerivWSProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const rateLimiterRef = useRef(new ClientWSRateLimiter(3000, 60)); // 3000 msg / 60 sec (high-frequency ticks & trades)
  const { ws, isConnected, isExhausted } = useDerivWS({
    url: auth.wsUrl,
    accountId: auth.activeAccountId ?? undefined,
  });

  useEffect(() => {
    const accountId = auth.activeAccount?.account_id;
    if (!ws || !isConnected || !accountId) return;

    // Listen globally for buy/sell/balance WS frames with rate check
    const unsub = ws.onMessage((data) => {
      const allowed = rateLimiterRef.current.tryConsume(1);
      if (!allowed) {
        console.warn('[WS Rate Limiter] High frequency WebSocket traffic detected and throttled.');
        return;
      }

      if (data.buy && typeof data.buy === 'object') {
        const buyObj = data.buy as { balance_after?: number };
        if (buyObj.balance_after !== undefined) {
          auth.updateAccountBalance(accountId, buyObj.balance_after);
        }
      }
      if (data.sell && typeof data.sell === 'object') {
        const sellObj = data.sell as { balance_after?: number };
        if (sellObj.balance_after !== undefined) {
          auth.updateAccountBalance(accountId, sellObj.balance_after);
        }
      }
      if (data.balance && typeof data.balance === 'object') {
        const balObj = data.balance as { balance?: number | string; loginid?: string };
        if (balObj.balance !== undefined) {
          auth.updateAccountBalance(balObj.loginid || accountId, balObj.balance);
        }
      }
    });

    return () => {
      unsub();
    };
  }, [ws, isConnected, auth]);

  const isRateLimited = rateLimiterRef.current.getRemainingTokens() === 0;

  return (
    <DerivWSContext.Provider value={{ ws, isConnected, isExhausted, auth, isRateLimited }}>
      {children}
    </DerivWSContext.Provider>
  );
}

export function useDerivWSContext(): DerivWSContextValue {
  const ctx = useContext(DerivWSContext);
  if (!ctx) {
    throw new Error('useDerivWSContext must be used within a DerivWSProvider');
  }
  return ctx;
}
