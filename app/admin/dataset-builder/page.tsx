'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Beaker, CheckCircle2, Database, RefreshCw, ShieldCheck, Sparkles, Trash2, XCircle } from 'lucide-react';
import { formatReadableAsset, formatReadableDatasetName, formatReadableDuration } from '@/lib/ml-display-formatters';

type DurationUnit = 't' | 's' | 'm' | 'h' | 'd';
type SymbolItem = { symbol: string; displayName: string; market: string; submarket: string; isOpen: boolean; isAvailable: boolean };
type DurationRange = { id: string; unit: DurationUnit; min: number; max: number; tradeTypes: string[]; source: string };
type TrainingHorizon = { value: number; unit: DurationUnit; rangeId: string };
type Dataset = { id: string; name: string; raw_name?: string; asset_symbol: string; horizon_ticks: number; duration_value: number | null; duration_unit: DurationUnit | null; duration_seconds: number | null; sample_count: number; train_count: number; validation_count: number; test_count: number; status: string; leakage_check_passed: boolean; metadata?: { assetDisplayName?: string } | null };
type AutoSkip = { value: number; unit: DurationUnit; reason: string };
type AutoFailure = { value: number; unit: DurationUnit; error: string };
type AutoJob = { id: string; symbol: string; status: 'running' | 'completed' | 'failed'; requestedCount: number; completedCount: number; skippedCount: number; failedCount: number; cancelledCount?: number; skips: AutoSkip[]; failures: AutoFailure[] };

const units: Array<{ unit: DurationUnit; label: string }> = [
  { unit: 't', label: 'TICKS' }, { unit: 's', label: 'SEC' }, { unit: 'm', label: 'MIN' }, { unit: 'h', label: 'HOUR' }, { unit: 'd', label: 'DAY' },
];
const unitLabel: Record<DurationUnit, string> = { t: 'ticks', s: 'seconds', m: 'minutes', h: 'hours', d: 'days' };

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text.trim()) throw new Error(`Request failed with HTTP ${response.status}.`);
  try { return JSON.parse(text); } catch { throw new Error(`Request returned a non-JSON response (HTTP ${response.status}).`); }
}

export default function TrainingDatasetBuilderPage() {
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [horizons, setHorizons] = useState<TrainingHorizon[]>([]);
  const [ranges, setRanges] = useState<DurationRange[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<DurationUnit>('t');
  const [selectedHorizon, setSelectedHorizon] = useState('');
  const [autoMode, setAutoMode] = useState(false);
  const [autoJobId, setAutoJobId] = useState<string | null>(null);
  const [autoJob, setAutoJob] = useState<AutoJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const selectedAsset = symbols.find((item) => item.symbol === selectedSymbol);
  const visibleHorizons = useMemo(() => horizons.filter((item) => item.unit === selectedUnit), [horizons, selectedUnit]);
  const visibleRanges = useMemo(() => ranges.filter((item) => item.unit === selectedUnit), [ranges, selectedUnit]);
  const progressTerminal = autoJob ? autoJob.completedCount + autoJob.skippedCount + autoJob.failedCount + (autoJob.cancelledCount ?? 0) : 0;
  const progress = autoJob ? Math.min(100, Math.round((progressTerminal / Math.max(1, autoJob.requestedCount)) * 100)) : 0;
  const assetLabel = selectedSymbol ? formatReadableAsset(selectedSymbol) : 'Select a live Deriv asset';

  async function loadSymbols() {
    const response = await fetch('/api/symbols', { cache: 'no-store' });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data?.error || 'Live Deriv symbols are unavailable.');
    const live = Array.isArray(data?.symbols) ? data.symbols as SymbolItem[] : [];
    setSymbols(live);
    setSelectedSymbol((current) => current || live.find((item) => item.isAvailable)?.symbol || '');
  }

  async function loadDatasetState(symbol: string) {
    if (!symbol) return;
    const response = await fetch(`/api/admin/datasets?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data?.error || 'Unable to load Dataset Builder state.');
    const nextHorizons = Array.isArray(data?.trainingHorizons) ? data.trainingHorizons as TrainingHorizon[] : [];
    setDatasets(Array.isArray(data?.datasets) ? data.datasets as Dataset[] : []);
    setHorizons(nextHorizons);
    setRanges(Array.isArray(data?.durationDiscovery?.ranges) ? data.durationDiscovery.ranges as DurationRange[] : []);
    const availableUnits = units.map((item) => item.unit).filter((unit) => nextHorizons.some((h) => h.unit === unit));
    const nextUnit = availableUnits.includes(selectedUnit) ? selectedUnit : (availableUnits[0] ?? 't');
    setSelectedUnit(nextUnit);
    const first = nextHorizons.find((item) => item.unit === nextUnit);
    setSelectedHorizon(first ? `${first.value}:${first.unit}` : '');
  }

  async function refresh() {
    setLoading(true); setError(null);
    try {
      await loadSymbols();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Dataset Builder.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!selectedSymbol) return;
    void loadDatasetState(selectedSymbol).catch((err) => setError(err instanceof Error ? err.message : 'Unable to load Dataset Builder state.'));
  }, [selectedSymbol]);

  useEffect(() => {
    if (!autoJobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/admin/datasets?autoJobId=${encodeURIComponent(autoJobId)}`, { cache: 'no-store' });
        const data = await readJson(response);
        if (!response.ok || !data?.success || !data?.job) throw new Error(data?.error || 'Unable to read AUTO progress.');
        if (cancelled) return;
        const job = data.job as AutoJob;
        setAutoJob(job);
        if (job.status === 'running') return;
        setAutoJobId(null);
        await loadDatasetState(job.symbol);
        if (job.status === 'completed') {
          setMessage(`AUTO build finished: ${job.completedCount} dataset${job.completedCount === 1 ? '' : 's'} created, ${job.skippedCount} skipped, ${job.failedCount} failed.`);
        } else {
          setError(`AUTO build stopped with ${job.failedCount} unexpected failure${job.failedCount === 1 ? '' : 's'}. ${job.failures?.[0]?.error || ''}`.trim());
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to read AUTO progress.');
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [autoJobId]);

  async function buildSelected() {
    if (!selectedSymbol || !selectedHorizon || building) return;
    const [valueText, unit] = selectedHorizon.split(':');
    const value = Number(valueText);
    if (!Number.isSafeInteger(value) || !['t', 's', 'm', 'h', 'd'].includes(unit)) return;
    setBuilding(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/admin/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: selectedSymbol, durationValue: value, durationUnit: unit }) });
      const data = await readJson(response);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Dataset construction failed.');
      setMessage(`Built ${formatReadableDuration(value, unit)} dataset for ${assetLabel}.`);
      await loadDatasetState(selectedSymbol);
    } catch (err) { setError(err instanceof Error ? err.message : 'Dataset construction failed.'); }
    finally { setBuilding(false); }
  }

  async function buildAll() {
    if (!selectedSymbol || !horizons.length || building || autoJobId) return;
    setBuilding(true); setError(null); setMessage(null); setAutoJob(null);
    try {
      const response = await fetch('/api/admin/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: selectedSymbol, buildAllSupportedHorizons: true, ...(autoMode ? {} : { durationUnit: selectedUnit }) }) });
      const data = await readJson(response);
      if (!response.ok || !data?.success || !data?.jobId) throw new Error(data?.error || 'Unable to start AUTO dataset build.');
      setAutoJobId(data.jobId);
      setAutoJob(data.job as AutoJob);
      setMessage(`AUTO started for ${assetLabel}. Feasibility-ineligible horizons will be skipped, not reported as build failures.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to start AUTO dataset build.'); }
    finally { setBuilding(false); }
  }

  async function archiveAutoReport() {
    if (!autoJob || autoJob.status === 'running' || autoJobId) return;
    setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/admin/datasets?autoJobId=${encodeURIComponent(autoJob.id)}`, { method: 'DELETE', cache: 'no-store' });
      const data = await readJson(response);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Unable to archive AUTO report.');
      setAutoJob(null);
      setMessage('AUTO report archived. Built datasets, training runs and registered models were preserved.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to archive AUTO report.'); }
  }

  async function deleteDataset(dataset: Dataset) {
    if (deletingId) return;
    if (!window.confirm(`Delete dataset “${dataset.name}”? The server will protect datasets with training/model lineage.`)) return;
    setDeletingId(dataset.id); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/admin/datasets/${encodeURIComponent(dataset.id)}`, { method: 'DELETE', cache: 'no-store' });
      const data = await readJson(response);
      if (!response.ok || !data?.success) throw new Error(data?.message || data?.error || 'Unable to delete dataset.');
      setDatasets((current) => current.filter((item) => item.id !== dataset.id));
      setMessage(`Deleted ${dataset.name}.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to delete dataset.'); }
    finally { setDeletingId(null); }
  }

  return <main className="min-h-screen bg-[#05070b] px-4 py-5 text-slate-100 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1400px]">
      <header className="mb-5 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div><Link href="/admin" className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-500"><ArrowLeft className="h-3.5 w-3.5" />Back to Admin Operations</Link><div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><Beaker className="h-6 w-6 text-cyan-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Agenda 5</p><h1 className="text-2xl font-black sm:text-3xl">Training Dataset Builder</h1><p className="mt-1 text-sm text-slate-500">Leakage-safe datasets built from persisted real Deriv ticks with broker-driven durations.</p></div></div></div>
        <button onClick={() => void refresh()} disabled={loading || building || Boolean(autoJobId)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </header>

      {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
      {message && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-300"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>}

      <section className="mb-5 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-bold text-cyan-300"><Sparkles className="h-4 w-4" />Build dataset</div>
          <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Deriv asset</span><select value={selectedSymbol} onChange={(event) => { setAutoJob(null); setAutoJobId(null); setSelectedSymbol(event.target.value); }} disabled={loading || building || Boolean(autoJobId)} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm"><option value="">Select a live Deriv asset</option>{symbols.filter((item) => item.isAvailable).map((item) => <option key={item.symbol} value={item.symbol}>{item.displayName} — {item.symbol}</option>)}</select>{selectedAsset && <span className="mt-2 block text-xs text-slate-500">{selectedAsset.market} / {selectedAsset.submarket} · {selectedAsset.isOpen ? 'Open' : 'Available but closed'}</span>}</label>

          <div className="mt-4"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Prediction horizon</span><div className="grid grid-cols-6 overflow-hidden rounded-xl border border-white/10 bg-black/30"><button type="button" onClick={() => { setAutoMode(true); setSelectedHorizon(''); }} disabled={!horizons.length || building || Boolean(autoJobId)} className={`px-1.5 py-3 text-xs font-bold ${autoMode ? 'bg-cyan-400 text-slate-950' : 'text-slate-300'}`}>AUTO</button>{units.map((option) => { const available = horizons.some((item) => item.unit === option.unit); return <button key={option.unit} type="button" onClick={() => { setAutoMode(false); setSelectedUnit(option.unit); const first = horizons.find((item) => item.unit === option.unit); setSelectedHorizon(first ? `${first.value}:${first.unit}` : ''); }} disabled={!available || building || Boolean(autoJobId)} className={`px-1.5 py-3 text-xs font-bold sm:text-sm ${!autoMode && selectedUnit === option.unit ? 'bg-cyan-400 text-slate-950' : 'text-slate-300'} ${!available ? 'opacity-30' : ''}`}>{option.label}</button>; })}</div>{autoMode ? <p className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-3 text-xs leading-5 text-slate-400"><strong className="text-cyan-300">AUTO:</strong> evaluate every dynamically discovered Deriv-supported horizon. Horizons that cannot safely produce train/validation/test data are recorded as <strong className="text-amber-300">SKIPPED</strong>, not as failures.</p> : <select value={selectedHorizon} onChange={(event) => setSelectedHorizon(event.target.value)} disabled={!visibleHorizons.length || building || Boolean(autoJobId)} className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm"><option value="">Select a {unitLabel[selectedUnit]} horizon</option>{visibleHorizons.map((item) => <option key={`${item.value}:${item.unit}`} value={`${item.value}:${item.unit}`}>{formatReadableDuration(item.value, item.unit)}</option>)}</select>}</div>
          <div className="mt-5 rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.03] p-4 text-xs leading-5 text-slate-400"><strong className="text-slate-200">Safety contract:</strong> real Deriv ticks → duration-aware features → non-flat directional labels → chronological split with embargo → train-only normalization → leakage validation.</div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2"><button onClick={() => void buildSelected()} disabled={autoMode || !selectedSymbol || !selectedHorizon || building || Boolean(autoJobId)} className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50">{building ? 'Building…' : 'Build selected horizon'}</button><button onClick={() => void buildAll()} disabled={!selectedSymbol || !horizons.length || building || Boolean(autoJobId)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-300 disabled:opacity-50"><Database className="h-4 w-4" />{autoMode ? 'Build AUTO horizons' : `Build all ${unitLabel[selectedUnit]} horizons`}</button></div>

          {autoJob && <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold text-cyan-200">{formatReadableAsset(autoJob.symbol)} · AUTO report</span><span className="text-slate-400">{autoJob.completedCount} created · {autoJob.skippedCount} skipped · {autoJob.failedCount} failed · {autoJob.requestedCount} evaluated</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${progress}%` }} /></div><div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px]"><div className="rounded-xl border border-emerald-400/10 bg-emerald-400/5 p-2"><strong className="block text-emerald-300">{autoJob.completedCount}</strong>Created</div><div className="rounded-xl border border-amber-400/10 bg-amber-400/5 p-2"><strong className="block text-amber-300">{autoJob.skippedCount}</strong>Skipped</div><div className="rounded-xl border border-red-400/10 bg-red-400/5 p-2"><strong className="block text-red-300">{autoJob.failedCount}</strong>Failed</div></div>{autoJob.skips.length > 0 && <div className="mt-4 space-y-2"><p className="text-xs font-bold text-amber-300">Skipped horizons — safety/feasibility reasons</p>{autoJob.skips.map((item, index) => <div key={`${item.value}:${item.unit}:${index}`} className="rounded-xl border border-amber-400/10 bg-amber-400/[0.04] p-3 text-xs"><div className="font-semibold text-slate-200">{formatReadableDuration(item.value, item.unit)}</div><p className="mt-1 text-slate-400">{item.reason}</p></div>)}</div>}{autoJob.failures.length > 0 && <div className="mt-4 space-y-2"><p className="text-xs font-bold text-red-300">Unexpected failures</p>{autoJob.failures.map((item, index) => <div key={`${item.value}:${item.unit}:${index}`} className="rounded-xl border border-red-400/10 bg-red-400/[0.04] p-3 text-xs"><div className="font-semibold text-slate-200">{formatReadableDuration(item.value, item.unit)}</div><p className="mt-1 text-red-200">{item.error}</p></div>)}</div>}{autoJob.status !== 'running' && <button type="button" onClick={() => void archiveAutoReport()} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300"><Trash2 className="h-3.5 w-3.5" />Archive AUTO report only</button>}</div>}
        </article>

        <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-5 flex items-center gap-2 text-sm font-bold text-emerald-300"><ShieldCheck className="h-4 w-4" />Dynamic duration contract</div>{ranges.length === 0 ? <p className="text-sm text-slate-500">Select an asset to query Deriv duration metadata.</p> : <div className="space-y-3">{(autoMode ? ranges : visibleRanges).map((range) => <div key={range.id} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between"><span className="font-semibold text-slate-200">{formatReadableDuration(range.min, range.unit)}{range.min !== range.max ? ` – ${formatReadableDuration(range.max, range.unit)}` : ''}</span><span className="text-[10px] uppercase text-emerald-300">Deriv</span></div>{range.tradeTypes.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Trade type: {range.tradeTypes.join(', ')}</p>}</div>)}</div>}<p className="mt-4 text-[11px] text-slate-500">Asset: {assetLabel}. Only broker-discovered durations are selectable.</p></article>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-4 flex items-end justify-between"><div><h2 className="text-lg font-bold">Built datasets</h2><p className="mt-1 text-xs text-slate-500">Canonical symbol IDs remain raw; presentation uses one centralized readable asset formatter.</p></div><span className="text-xs text-slate-500">{datasets.length} shown</span></div>{datasets.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">No duration-aware training datasets have been built for this asset.</div> : <div className="grid gap-3 lg:grid-cols-2">{datasets.map((dataset) => { const readableName = formatReadableDatasetName({ name: dataset.name, assetSymbol: dataset.asset_symbol, assetDisplayName: dataset.metadata?.assetDisplayName, durationValue: dataset.duration_value, durationUnit: dataset.duration_unit }); return <article key={dataset.id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-bold text-slate-100">{readableName}</h3><p className="mt-1 text-xs text-slate-500">Raw symbol: {dataset.asset_symbol} · {dataset.duration_value && dataset.duration_unit ? formatReadableDuration(dataset.duration_value, dataset.duration_unit) : `${dataset.horizon_ticks} ticks`}</p></div><div className="flex items-center gap-2"><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">{dataset.status.toUpperCase()}</span><button type="button" onClick={() => void deleteDataset(dataset)} disabled={Boolean(deletingId) || Boolean(autoJobId)} aria-label={`Delete dataset ${readableName}`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-400/20 bg-red-400/5 text-red-300 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button></div></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-400 sm:grid-cols-4"><div><span className="block text-slate-600">Samples</span>{Number(dataset.sample_count).toLocaleString()}</div><div><span className="block text-slate-600">Train</span>{Number(dataset.train_count).toLocaleString()}</div><div><span className="block text-slate-600">Validation</span>{Number(dataset.validation_count).toLocaleString()}</div><div><span className="block text-slate-600">Test</span>{Number(dataset.test_count).toLocaleString()}</div></div></article>; })}</div>}</section>
    </div>
  </main>;
}