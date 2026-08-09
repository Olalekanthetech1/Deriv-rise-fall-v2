'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, Radio, Server, ShieldAlert, ShieldCheck, DatabaseZap } from 'lucide-react';

type LiveSymbol = {
  symbol: string;
  displayName: string;
  market: string;
  submarket: string;
  isOpen: boolean;
};

type IngestionRun = {
  runId: string;
  symbol: string;
  requestedCount: number;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'partial' | 'failed';
  recordsReceived: number;
  recordsInserted: number;
  recordsRejected: number;
  firstTickTime: string | null;
  lastTickTime: string | null;
  errorMessage: string | null;
};

type Checkpoint = {
  source: string;
  symbol: string;
  lastTickEpoch: number | null;
  lastTickTime: string | null;
  updatedAt: string;
} | null;

export default function MarketDataIngestionPage() {
  const [symbols, setSymbols] = useState<LiveSymbol[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [count, setCount] = useState('5000');
  const [resumeFromCheckpoint, setResumeFromCheckpoint] = useState(true);
  const [recentRuns, setRecentRuns] = useState<IngestionRun[]>([]);
  const [checkpoint, setCheckpoint] = useState<Checkpoint>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openSymbols = useMemo(() => symbols.filter((symbol) => symbol.isOpen), [symbols]);

  async function loadSymbols() {
    try {
      const response = await fetch('/api/symbols', { cache: 'no-store' });
      const data = await response.json();
      if (response.ok && Array.isArray(data?.symbols)) {
        setSymbols(data.symbols.filter((item: LiveSymbol) => item?.symbol));
        const firstOpen = data.symbols.find((item: LiveSymbol) => item?.isOpen && item?.symbol);
        if (firstOpen && !selectedSymbol) setSelectedSymbol(firstOpen.symbol);
      }
    } catch {
      // Leave the selector empty; the ingestion API still accepts a manual symbol.
    }
  }

  async function loadState(symbol?: string) {
    const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
    const response = await fetch(`/api/admin/market-data${qs}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Unable to load historical ingestion state.');
    setRecentRuns(Array.isArray(data?.recentRuns) ? data.recentRuns : []);
    setCheckpoint(data?.checkpoint ?? null);
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadSymbols(), loadState(selectedSymbol || undefined)]);
    } catch (err: any) {
      setError(err?.message || 'Unable to load the historical ingestion page.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleIngest() {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/market-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedSymbol,
          count: Number(count),
          resumeFromCheckpoint,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Historical ingestion failed.');
      setMessage(`Ingestion ${data.status}: ${data.recordsInserted?.toLocaleString?.() ?? data.recordsInserted} real ticks inserted for ${data.symbol}.`);
      await loadState(selectedSymbol || undefined);
    } catch (err: any) {
      setError(err?.message || 'Historical ingestion failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="min-h-screen bg-[#05070b] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/admin" className="inline-flex items-center gap-2 text-xs text-cyan-300 hover:text-cyan-200"><ArrowLeft className="h-4 w-4" />Back to Admin Operations</Link>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Market Data Ingestion</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Real Deriv historical ticks only. The pipeline stores raw tick lineage in Neon and refuses synthetic fallback data.</p>
        </div>
        <button onClick={refresh} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold hover:bg-white/10">
          <RefreshCw className="h-4 w-4" />Refresh
        </button>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-cyan-300"><Radio className="h-4 w-4" />Historical backfill</div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Deriv symbol</span>
              <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-400/50">
                {openSymbols.length > 0 ? null : <option value="">No open symbols loaded</option>}
                {openSymbols.map((symbol) => <option key={symbol.symbol} value={symbol.symbol}>{symbol.symbol} — {symbol.displayName}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Tick count</span>
              <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-400/50" />
            </label>
          </div>
          <label className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
            <input type="checkbox" checked={resumeFromCheckpoint} onChange={(e) => setResumeFromCheckpoint(e.target.checked)} className="h-4 w-4 accent-cyan-400" />
            Resume from the last saved checkpoint for this symbol
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={handleIngest} disabled={submitting || !selectedSymbol} className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
              {submitting ? 'Ingesting…' : 'Start historical ingestion'}
            </button>
            <span className="text-xs text-slate-500">Only real Deriv history is accepted. No mock data is generated anywhere in this flow.</span>
          </div>
          {message && <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-200"><CheckCircle2 className="mr-2 inline-block h-4 w-4" />{message}</div>}
          {error && <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200"><ShieldAlert className="mr-2 inline-block h-4 w-4" />{error}</div>}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-300"><Server className="h-4 w-4" />Checkpoint</div>
          <div className="space-y-3 text-sm text-slate-400">
            <div><span className="block text-xs uppercase tracking-wider text-slate-500">Source</span><span className="mt-1 block text-slate-200">{checkpoint?.source ?? 'Unavailable'}</span></div>
            <div><span className="block text-xs uppercase tracking-wider text-slate-500">Symbol</span><span className="mt-1 block text-slate-200">{checkpoint?.symbol ?? 'Unavailable'}</span></div>
            <div><span className="block text-xs uppercase tracking-wider text-slate-500">Last tick</span><span className="mt-1 block text-slate-200">{checkpoint?.lastTickTime ?? 'Unavailable'}</span></div>
            <div><span className="block text-xs uppercase tracking-wider text-slate-500">Updated</span><span className="mt-1 block text-slate-200">{checkpoint?.updatedAt ?? 'Unavailable'}</span></div>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-300"><ShieldCheck className="h-4 w-4" />Recent ingestion runs</div>
        {loading ? <div className="text-sm text-slate-500">Loading ingestion state…</div> : recentRuns.length === 0 ? <div className="text-sm text-slate-500">No historical ingestion runs recorded yet.</div> : <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{recentRuns.map((run) => <article key={run.runId} className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
          <div className="flex items-start justify-between gap-3"><div><div className="font-bold text-slate-100">{run.symbol}</div><div className="mt-1 text-xs text-slate-500">{run.startedAt}</div></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wider ${run.status === 'completed' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : run.status === 'partial' ? 'border-amber-400/20 bg-amber-400/10 text-amber-200' : run.status === 'failed' ? 'border-red-400/20 bg-red-400/10 text-red-200' : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200'}`}>{run.status.toUpperCase()}</span></div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-400"><div><span className="block text-slate-500">Requested</span>{run.requestedCount.toLocaleString()}</div><div><span className="block text-slate-500">Inserted</span>{run.recordsInserted.toLocaleString()}</div><div><span className="block text-slate-500">Received</span>{run.recordsReceived.toLocaleString()}</div><div><span className="block text-slate-500">Rejected</span>{run.recordsRejected.toLocaleString()}</div></div>
          <div className="mt-3 text-xs text-slate-500">{run.firstTickTime ? `From ${run.firstTickTime}` : 'No start time'}{run.lastTickTime ? ` • to ${run.lastTickTime}` : ''}</div>
          {run.errorMessage ? <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-200">{run.errorMessage}</div> : null}
        </article>)}</div>}
      </section>
    </div>
  </main>;
}
