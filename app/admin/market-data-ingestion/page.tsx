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
};

function aggregatePartialRuns(runs: IngestionRun[]): IngestionRun[] {
  const groups = new Map<string, IngestionRun>();
  for (const run of runs) {
    const sessionId = typeof run.metadata?.backfillSessionId === 'string' ? run.metadata.backfillSessionId : null;
    const key = run.status === 'partial'
      ? sessionId ? `session:${sessionId}` : `legacy:${run.symbol}:${run.requestedCount}`
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
    if (run.firstTickTime && (!existing.firstTickTime || new Date(run.firstTickTime).getTime() < new Date(existing.firstTickTime).getTime())) existing.firstTickTime = run.firstTickTime;
    if (run.lastTickTime && (!existing.lastTickTime || new Date(run.lastTickTime).getTime() > new Date(existing.lastTickTime).getTime())) existing.lastTickTime = run.lastTickTime;
    existing.errorMessage = run.errorMessage || existing.errorMessage;
    existing.metadata = { ...existing.metadata, aggregatedBatches: Number(existing.metadata?.aggregatedBatches || 1) + 1 };
  }
  return [...groups.values()].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export default function MarketDataIngestionPage() {
  const [symbols, setSymbols] = useState<LiveSymbol[]>([]);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [count, setCount] = useState('5000');
  const [resumeFromCheckpoint, setResumeFromCheckpoint] = useState(true);
  const [recentRuns, setRecentRuns] = useState<IngestionRun[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availableSymbols = useMemo(() => symbols.filter((symbol) => symbol.isAvailable), [symbols]);
  const displayRuns = useMemo(() => aggregatePartialRuns(recentRuns), [recentRuns]);

  const getHumanReadableAssetName = (symbolCode: string | null | undefined) => {
    if (!symbolCode) return 'Unavailable';
    return symbols.find((symbol) => symbol.symbol === symbolCode)?.displayName || symbolCode;
  };

  async function loadSymbols(): Promise<LiveSymbol[]> {
    const response = await fetch('/api/symbols', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || `Unable to load live Deriv symbols (${response.status}).`);
    if (!Array.isArray(data?.symbols)) throw new Error('Deriv symbol endpoint returned an invalid symbol list.');
    const loaded = data.symbols.filter((item: LiveSymbol) => item?.symbol && item?.isAvailable);
    setSymbols(loaded);
    return loaded;
  }

  async function loadState(symbolsToLoad: string[] = selectedSymbols) {
    const qs = symbolsToLoad.length ? `?symbols=${encodeURIComponent(symbolsToLoad.join(','))}` : '';
    const response = await fetch(`/api/admin/market-data${qs}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Unable to load historical ingestion state.');
    setRecentRuns(Array.isArray(data?.recentRuns) ? data.recentRuns : []);
    setCheckpoints(Array.isArray(data?.checkpoints) ? data.checkpoints : data?.checkpoint ? [data.checkpoint] : []);
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadSymbols();
      const validSelected = selectedSymbols.filter((symbol) => loaded.some((item) => item.symbol === symbol));
      const nextSelection = validSelected.length ? validSelected : loaded.slice(0, 1).map((item) => item.symbol);
      setSelectedSymbols(nextSelection);
      await loadState(nextSelection);
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

  function toggleSymbol(symbol: string) {
    setError(null);
    setSelectedSymbols((current) => {
      if (current.includes(symbol)) return current.filter((item) => item !== symbol);
      if (current.length >= 25) {
        setError('A maximum of 25 assets can be selected for one ingestion batch.');
        return current;
      }
      return [...current, symbol];
    });
  }

  function selectAll() {
    setError(null);
    setSelectedSymbols(availableSymbols.slice(0, 25).map((symbol) => symbol.symbol));
    if (availableSymbols.length > 25) setMessage('Selected the first 25 available assets. Run another batch for the remaining assets.');
  }

  async function handleIngest() {
    if (!selectedSymbols.length) {
      setError('Select at least one asset.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/market-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: selectedSymbols, count: Number(count), resumeFromCheckpoint }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Historical ingestion failed.');

      if (Array.isArray(data.results)) {
        setMessage(`Ingestion batch finished: ${data.completedAssets ?? 0} completed, ${data.partialAssets ?? 0} partial, ${data.failedAssets ?? 0} failed across ${data.requestedAssets ?? selectedSymbols.length} assets.`);
      } else {
        const inserted = Number(data.progress?.inserted ?? data.recordsInserted ?? 0);
        const requested = Number(data.progress?.requested ?? data.requestedCount ?? Number(count));
        const percent = Number(data.progress?.percent ?? ((inserted / Math.max(1, requested)) * 100));
        setMessage(`Backfill ${data.status === 'completed' ? 'completed' : 'in progress'}: ${inserted.toLocaleString()} / ${requested.toLocaleString()} real ticks stored (${Math.min(100, percent).toFixed(0)}%).`);
      }
      await loadState(selectedSymbols);
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
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Real Deriv historical ticks only. Select multiple assets; each asset keeps its own checkpoint and ingestion result.</p>
        </div>
        <button onClick={refresh} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold hover:bg-white/10"><RefreshCw className="h-4 w-4" />Refresh</button>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold text-cyan-300"><Radio className="h-4 w-4" />Historical backfill</div><span className="text-xs text-slate-500">{selectedSymbols.length} selected</span></div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Deriv assets</div><div className="flex gap-2"><button type="button" onClick={selectAll} disabled={!availableSymbols.length || submitting} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold hover:bg-white/10 disabled:opacity-50">Select all (max 25)</button><button type="button" onClick={() => setSelectedSymbols([])} disabled={submitting} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold hover:bg-white/10 disabled:opacity-50">Clear</button></div></div>
            <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {availableSymbols.length === 0 ? <div className="col-span-full text-sm text-slate-500">No available symbols loaded.</div> : availableSymbols.map((symbol) => <label key={symbol.symbol} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${selectedSymbols.includes(symbol.symbol) ? 'border-cyan-400/30 bg-cyan-400/5' : 'border-white/10 bg-black/10 hover:bg-white/5'}`}><input type="checkbox" checked={selectedSymbols.includes(symbol.symbol)} onChange={() => toggleSymbol(symbol.symbol)} disabled={submitting} className="h-4 w-4 accent-cyan-400" /><span className="min-w-0"><span className="block truncate font-semibold text-slate-200">{symbol.displayName}</span><span className="text-[11px] text-slate-500">{symbol.symbol}</span></span></label>)}
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Ticks per asset</span><input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-400/50" /></label>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-400"><span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Batch execution</span><span className="mt-1 block text-slate-200">Up to 2 assets concurrently; each checkpoint remains independent.</span></div>
          </div>

          <label className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300"><input type="checkbox" checked={resumeFromCheckpoint} onChange={(e) => setResumeFromCheckpoint(e.target.checked)} className="h-4 w-4 accent-cyan-400" />Resume each selected asset from its own saved checkpoint</label>
          <div className="mt-4 flex flex-wrap items-center gap-3"><button onClick={handleIngest} disabled={submitting || !selectedSymbols.length} className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}{submitting ? `Ingesting ${selectedSymbols.length} asset${selectedSymbols.length === 1 ? '' : 's'}…` : `Start ingestion for ${selectedSymbols.length || 0} asset${selectedSymbols.length === 1 ? '' : 's'}`}</button><span className="text-xs text-slate-500">Only real Deriv history is accepted. No mock data is generated anywhere in this flow.</span></div>
          {message && <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-200"><CheckCircle2 className="mr-2 inline-block h-4 w-4" />{message}</div>}
          {error && <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200"><ShieldAlert className="mr-2 inline-block h-4 w-4" />{error}</div>}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-300"><Server className="h-4 w-4" />Asset checkpoints</div>
          {checkpoints.length === 0 ? <div className="text-sm text-slate-500">No saved checkpoints for the selected assets.</div> : <div className="space-y-3">{checkpoints.map((checkpoint) => <div key={checkpoint.symbol} className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="font-semibold text-slate-200">{getHumanReadableAssetName(checkpoint.symbol)}</div><div className="mt-1 text-[11px] text-slate-500">{checkpoint.symbol}</div><div className="mt-2 text-xs text-slate-400">Last tick: <span className="text-slate-200">{checkpoint.lastTickTime ?? 'Unavailable'}</span></div><div className="mt-1 text-[11px] text-slate-500">Updated {checkpoint.updatedAt}</div></div>)}</div>}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-300"><ShieldCheck className="h-4 w-4" />Recent ingestion runs</div>
        {loading ? <div className="text-sm text-slate-500">Loading ingestion state…</div> : displayRuns.length === 0 ? <div className="text-sm text-slate-500">No historical ingestion runs recorded yet.</div> : <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{displayRuns.map((run) => {
          const progress = Math.min(100, (run.recordsInserted / Math.max(1, run.requestedCount)) * 100);
          const rawBatches = run.metadata?.batches;
          const batchCount = Number(run.metadata?.aggregatedBatches || (Array.isArray(rawBatches) ? rawBatches.length : 0));
          const humanReadableAssetName = getHumanReadableAssetName(run.symbol);
          return <article key={run.runId} className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm"><div className="flex items-start justify-between gap-3"><div><div className="font-bold text-slate-100">{humanReadableAssetName}</div><div className="mt-1 text-xs text-slate-500">{run.symbol} • {run.startedAt}</div></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wider ${run.status === 'completed' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : run.status === 'partial' ? 'border-amber-400/20 bg-amber-400/10 text-amber-200' : run.status === 'failed' ? 'border-red-400/20 bg-red-400/5 text-red-200' : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200'}`}>{run.status === 'partial' ? 'IN PROGRESS' : run.status.toUpperCase()}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${progress}%` }} /></div><div className="mt-2 flex items-center justify-between text-xs"><span className="font-semibold text-slate-200">{run.recordsInserted.toLocaleString()} / {run.requestedCount.toLocaleString()}</span><span className="text-slate-500">{progress.toFixed(0)}%</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-400"><div><span className="block text-slate-500">Requested</span>{run.requestedCount.toLocaleString()}</div><div><span className="block text-slate-500">Stored</span>{run.recordsInserted.toLocaleString()}</div><div><span className="block text-slate-500">Received</span>{run.recordsReceived.toLocaleString()}</div><div><span className="block text-slate-500">Rejected</span>{run.recordsRejected.toLocaleString()}</div></div>{batchCount > 1 ? <div className="mt-3 text-xs text-cyan-300">{batchCount} ingestion batches aggregated into this backfill.</div> : null}<div className="mt-3 text-xs text-slate-500">{run.firstTickTime ? `From ${run.firstTickTime}` : 'No start time'}{run.lastTickTime ? ` • to ${run.lastTickTime}` : ''}</div>{run.errorMessage ? <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-200">{run.errorMessage}</div> : null}</article>;
        })}</div>}
      </section>
    </div>
  </main>;
}
