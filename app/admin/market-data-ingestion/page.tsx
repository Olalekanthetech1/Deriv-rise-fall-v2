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
  isAvailable: boolean;
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
  metadata?: Record<string, unknown>;
};

type Checkpoint = {
  source: string;
  symbol: string;
  lastTickEpoch: number | null;
  lastTickTime: string | null;
  updatedAt: string;
} | null;

function aggregatePartialRuns(runs: IngestionRun[]): IngestionRun[] {
  const groups = new Map<string, IngestionRun>();

  for (const run of runs) {
    const sessionId = typeof run.metadata?.backfillSessionId === 'string' ? run.metadata.backfillSessionId : null;
    const key = run.status === 'partial'
      ? sessionId
        ? `session:${sessionId}`
        : `legacy:${run.symbol}:${run.requestedCount}`
      : `run:${run.runId}`;

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...run });
      continue;
    }

    existing.recordsReceived += run.recordsReceived;
    existing.recordsInserted += run.recordsInserted;
    existing.recordsRejected += run.recordsRejected;
    existing.startedAt = new Date(Math.min(new Date(existing.startedAt).getTime(), new Date(run.startedAt).getTime())).toISOString();
    existing.completedAt = existing.completedAt && run.completedAt
      ? new Date(Math.max(new Date(existing.completedAt).getTime(), new Date(run.completedAt).getTime())).toISOString()
      : existing.completedAt || run.completedAt;
    if (run.firstTickTime && (!existing.firstTickTime || new Date(run.firstTickTime) < new Date(existing.firstTickTime))) existing.firstTickTime = run.firstTickTime;
    if (run.lastTickTime && (!existing.lastTickTime || new Date(run.lastTickTime) > new Date(existing.lastTickTime))) existing.lastTickTime = run.lastTickTime;
    existing.errorMessage = run.errorMessage || existing.errorMessage;
    existing.metadata = { ...existing.metadata, aggregatedBatches: Number(existing.metadata?.aggregatedBatches || 1) + 1 };
  }

  return [...groups.values()].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

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

  const availableSymbols = useMemo(() => symbols.filter((symbol) => symbol.isAvailable), [symbols]);
  const displayRuns = useMemo(() => aggregatePartialRuns(recentRuns), [recentRuns]);

  async function loadSymbols() {
    const response = await fetch('/api/symbols', { cache: 'no-store' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || `Unable to load live Deriv symbols (${response.status}).`);
    }

    if (!Array.isArray(data?.symbols)) {
      throw new Error('Deriv symbol endpoint returned an invalid symbol list.');
    }

    setSymbols(data.symbols.filter((item: LiveSymbol) => item?.symbol && item?.isAvailable));
    const firstAvailable = data.symbols.find((item: LiveSymbol) => item?.isAvailable && item?.symbol);
    if (firstAvailable && !selectedSymbol) setSelectedSymbol(firstAvailable.symbol);
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

      const inserted = Number(data.progress?.inserted ?? data.recordsInserted ?? 0);
      const requested = Number(data.progress?.requested ?? data.requestedCount ?? Number(count));
      const percent = Number(data.progress?.percent ?? ((inserted / Math.max(1, requested)) * 100));
      const statusLabel = data.status === 'completed' ? 'completed' : 'in progress';
      setMessage(`Backfill ${statusLabel}: ${inserted.toLocaleString()} / ${requested.toLocaleString()} real ticks stored (${Math.min(100, percent).toFixed(0)}%).`);
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
                {availableSymbols.length === 0 ? <option value="">No available symbols loaded</option> : null}
                {availableSymbols.map((symbol) => <option key={symbol.symbol} value={symbol.symbol}>{symbol.symbol} — {symbol.displayName}</option>)}
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
        {loading ? <div className="text-sm text-slate-500">Loading ingestion state…</div> : displayRuns.length === 0 ? <div className="text-sm text-slate-500">No historical ingestion runs recorded yet.</div> : <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{displayRuns.map((run) => {
          const progress = Math.min(100, (run.recordsInserted / Math.max(1, run.requestedCount)) * 100);
          const batchCount = Number(run.metadata?.aggregatedBatches || (Array.isArray(run.metadata?.batches) ? run.metadata?.batches.length : 0));
          return <article key={run.runId} className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
            <div className="flex items-start justify-between gap-3"><div><div className="font-bold text-slate-100">{run.symbol}</div><div className="mt-1 text-xs text-slate-500">{run.startedAt}</div></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wider ${run.status === 'completed' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : run.status === 'partial' ? 'border-amber-400/20 bg-amber-400/10 text-amber-200' : run.status === 'failed' ? 'border-red-400/20 bg-red-400/5 text-red-200' : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200'}`}>{run.status === 'partial' ? 'IN PROGRESS' : run.status.toUpperCase()}</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${progress}%` }} /></div>
            <div className="mt-2 flex items-center justify-between text-xs"><span className="font-semibold text-slate-200">{run.recordsInserted.toLocaleString()} / {run.requestedCount.toLocaleString()}</span><span className="text-slate-500">{progress.toFixed(0)}%</span></div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-400"><div><span className="block text-slate-500">Requested</span>{run.requestedCount.toLocaleString()}</div><div><span className="block text-slate-500">Stored</span>{run.recordsInserted.toLocaleString()}</div><div><span className="block text-slate-500">Received</span>{run.recordsReceived.toLocaleString()}</div><div><span className="block text-slate-500">Rejected</span>{run.recordsRejected.toLocaleString()}</div></div>
            {batchCount > 1 ? <div className="mt-3 text-xs text-cyan-300">{batchCount} ingestion batches aggregated into this backfill.</div> : null}
            <div className="mt-3 text-xs text-slate-500">{run.firstTickTime ? `From ${run.firstTickTime}` : 'No start time'}{run.lastTickTime ? ` • to ${run.lastTickTime}` : ''}</div>
            {run.errorMessage ? <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-200">{run.errorMessage}</div> : null}
          </article>;
        })}</div>}
      </section>
    </div>
  </main>;
}
