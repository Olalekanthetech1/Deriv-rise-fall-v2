'use client';

import { useEffect, useState, type ReactNode } from 'react';

interface AdminIntegrityGuardProps {
  children: ReactNode;
}

const SYNTHETIC_BUTTON_TEXT = [
  'Seed 20 Test Trades',
  'Seed Execution Trades',
  'Seeding Trades...',
];

const EMPTY_STATE_HEADINGS = [
  'Win/Loss Distribution vs Confidence',
  'Multi-Model Ensemble Performance',
  'Cumulative AI Profit Curve ($)',
];

function removeSyntheticControls(root: ParentNode) {
  const elements = root.querySelectorAll('button');
  elements.forEach((button) => {
    const label = button.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (SYNTHETIC_BUTTON_TEXT.some((text) => label.includes(text))) {
      button.remove();
    }
  });
}

function hideSyntheticPerformancePanels(root: ParentNode) {
  EMPTY_STATE_HEADINGS.forEach((heading) => {
    root.querySelectorAll('h2, h3, span').forEach((node) => {
      if (node.textContent?.replace(/\s+/g, ' ').trim() !== heading) return;
      const panel = node.closest('.bg-slate-900\\/80');
      if (panel instanceof HTMLElement) {
        panel.style.display = 'none';
      }
    });
  });
}

function replaceLegacyLabels(root: ParentNode) {
  root.querySelectorAll('*').forEach((node) => {
    if (node.children.length > 0) return;
    const text = node.textContent?.trim();
    if (text === 'Demo & Live') {
      node.textContent = 'Persisted live trade records';
    } else if (text === 'XGBoost-Default') {
      node.textContent = 'No production model';
    } else if (text === 'WINS' || text === 'LOSSES') {
      const valueNode = node.parentElement?.querySelector('p:first-child');
      if (valueNode && valueNode !== node) {
        const value = Number(valueNode.textContent);
        if (Number.isFinite(value) && (value === 54 || value === 9)) {
          valueNode.textContent = '0';
        }
      }
    }
  });
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
        if (!cancelled) setHasLiveTradeRecords(Number.isFinite(totalTrades) && totalTrades > 0);
      } catch {
        if (!cancelled) setHasLiveTradeRecords(false);
      }
    };

    void inspectLiveData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hasLiveTradeRecords !== false) return;

    const sanitize = () => {
      removeSyntheticControls(document);
      hideSyntheticPerformancePanels(document);
      replaceLegacyLabels(document);
    };

    sanitize();
    const observer = new MutationObserver(sanitize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [hasLiveTradeRecords]);

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
