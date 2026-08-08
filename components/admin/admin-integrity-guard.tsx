'use client';

import { useEffect, useState, type ReactNode } from 'react';

interface AdminIntegrityGuardProps {
  children: ReactNode;
}

export function AdminIntegrityGuard({ children }: AdminIntegrityGuardProps) {
  const [hasLiveTradeRecords, setHasLiveTradeRecords] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const inspectLiveData = async () => {
      try {
        const response = await fetch('/api/admin/stats', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        const totalTrades = Number(data?.summary?.totalTrades ?? 0);
        if (!cancelled) {
          setHasLiveTradeRecords(Number.isFinite(totalTrades) && totalTrades > 0);
        }
      } catch {
        if (!cancelled) setHasLiveTradeRecords(false);
      }
    };

    void inspectLiveData();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {children}
      {hasLiveTradeRecords === false && (
        <div className="fixed bottom-4 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-950/95 px-4 py-3 text-xs text-slate-300 shadow-2xl backdrop-blur">
          <strong className="block text-sm text-slate-100">No live trade records yet</strong>
          <span className="text-slate-400">
            Admin performance analytics are restricted to persisted database trades. Synthetic/demo trade controls and performance panels are disabled.
          </span>
        </div>
      )}
    </>
  );
}
