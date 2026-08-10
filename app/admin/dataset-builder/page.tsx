'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Beaker, CheckCircle2, Database, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';

type SymbolItem = { symbol: string; displayName: string; market: string; submarket: string; isOpen: boolean; isAvailable: boolean };
type DurationUnit = 't' | 's' | 'm' | 'h' | 'd';
type DurationRange = { id: string; unit: DurationUnit; min: number; max: number; tradeTypes: string[]; source: string };
type TrainingHorizon = { value: number; unit: DurationUnit; rangeId: string };
type DurationDiscovery = { symbol: string; ranges: DurationRange[]; fetchedAt: string; source: string };
type Dataset = { id: string; name: string; version: string; asset_symbol: string; horizon_ticks: number; duration_value: number | null; duration_unit: DurationUnit | null; duration_seconds: number | null; horizon_type: 'tick' | 'time' | null; contract_type: string | null; feature_schema_version: string; label_schema_version: string; sample_count: number; train_count: number; validation_count: number; test_count: number; status: string; leakage_check_passed: boolean; checksum: string | null; created_at: string; metadata?: { assetDisplayName?: string; qualityReport?: { status?: string } } | null };
type ApiState = { datasets: Dataset[]; discovery: DurationDiscovery | null; horizons: TrainingHorizon[] };
type AutoJob = { id: string; symbol: string; status: 'running' | 'completed' | 'failed'; requestedCount: number; completedCount: number; failedCount: number; failures?: Array<{ value: number; unit: DurationUnit; error: string }> };

const unitLabel: Record<DurationUnit, string> = { t: 'ticks', s: 'seconds', m: 'minutes', h: 'hours', d: 'days' };
const units: Array<{ unit: DurationUnit; label: string }> = [{ unit: 't', label: 'TICKS' }, { unit: 's', label: 'SEC' }, { unit: 'm', label: 'MIN' }, { unit: 'h', label: 'HOUR' }, { unit: 'd', label: 'DAY' }];
const formatDuration = (value: number, unit: DurationUnit) => `${value} ${unitLabel[unit]}`;

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text.trim()) throw new Error(`Request failed with HTTP ${response.status}.`);
  try { return JSON.parse(text); } catch { throw new Error(`Request returned a non-JSON response (HTTP ${response.status}).`); }
}

export default function TrainingDatasetBuilderPage() {
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [state, setState] = useState<ApiState>({ datasets: [], discovery: null, horizons: [] });
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [buildingAll, setBuildingAll] = useState(false);
  const [autoJobId, setAutoJobId] = useState<string | null>(null);
  const [autoJob, setAutoJob] = useState<AutoJob | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<DurationUnit>('t');
  const [autoMode, setAutoMode] = useState(false);
  const [selectedHorizon, setSelectedHorizon] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const availableSymbols = useMemo(() => symbols.filter((item) => item.isAvailable), [symbols]);
  const selectedAsset = availableSymbols.find((item) => item.symbol === selectedSymbol);
  const horizonsForSelectedUnit = useMemo(() => state.horizons.filter((h) => h.unit === selectedUnit), [state.horizons, selectedUnit]);
  const selectedUnitRange = useMemo(() => state.discovery?.ranges.filter((r) => r.unit === selectedUnit) ?? [], [state.discovery, selectedUnit]);

  async function loadSymbols() {
    const response = await fetch('/api/symbols', { cache: 'no-store' });
    const data = await readJson(response);
    const live = Array.isArray(data?.symbols) ? data.symbols : [];
    setSymbols(live);
    setSelectedSymbol((current) => current || live.find((item: SymbolItem) => item.isAvailable)?.symbol || '');
    if (!response.ok) throw new Error(data?.error || 'Live Deriv symbols are unavailable.');
  }

  async function loadDatasetState(symbol: string) {
    if (!symbol) return;
    const response = await fetch(`/api/admin/datasets?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
    const data = await readJson(response);
    if (!response.ok) throw new Error(data?.error || 'Unable to load Deriv duration capabilities.');
    const horizons: TrainingHorizon[] = Array.isArray(data?.trainingHorizons) ? data.trainingHorizons : [];
    const available = units.map((u) => u.unit).filter((u) => horizons.some((h) => h.unit === u));
    const preferred = available.includes(selectedUnit) ? selectedUnit : (available[0] ?? 't');
    setState({ datasets: Array.isArray(data?.datasets) ? data.datasets : [], discovery: data?.durationDiscovery ?? null, horizons });
    setSelectedUnit(preferred);
    if (!autoJobId) {
      setAutoMode(false);
      const first = horizons.find((h) => h.unit === preferred);
      setSelectedHorizon(first ? `${first.value}:${first.unit}` : '');
    }
  }

  async function load() {
    setLoading(true); setError(null);
    try { await loadSymbols(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load dataset builder.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selectedSymbol) return;
    setError(null);
    void loadDatasetState(selectedSymbol).catch((err) => setError(err instanceof Error ? err.message : 'Unable to load duration capabilities.'));
  }, [selectedSymbol]);

  useEffect(() => {
    if (!autoJobId || !buildingAll) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/admin/datasets?autoJobId=${encodeURIComponent(autoJobId)}`, { cache: 'no-store' });
        const data = await readJson(response);
        if (!response.ok || !data?.success || !data?.job) throw new Error(data?.error || 'Unable to read AUTO build progress.');
        if (cancelled) return;
        const job = data.job as AutoJob;
        setAutoJob(job);
        if (job.status === 'running') return;
        setBuildingAll(false);
        setAutoJobId(null);
        await loadDatasetState(job.symbol);
        if (job.status === 'completed' && job.failedCount === 0) setSuccess(`AUTO completed ${job.completedCount} of ${job.requestedCount} discovered duration datasets for ${job.symbol}.`);
        else if (job.status === 'completed') setSuccess(`AUTO finished ${job.completedCount} of ${job.requestedCount} datasets for ${job.symbol}; ${job.failedCount} failed. Review the failed horizons before training.`);
        else setError(`AUTO build failed after ${job.completedCount} of ${job.requestedCount} datasets. ${job.failures?.[0]?.error || ''}`.trim());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to read AUTO build progress.');
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [autoJobId, buildingAll]);

  async function buildDataset() {
    if (!selectedSymbol || !selectedHorizon || autoMode) return;
    const [valueText, unit] = selectedHorizon.split(':');
    const durationValue = Number(valueText);
    if (!Number.isSafeInteger(durationValue)) return;
    setBuilding(true); setError(null); setSuccess(null);
    try {
      const response = await fetch('/api/admin/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: selectedSymbol, durationValue, durationUnit: unit }) });
      const data = await readJson(response);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Dataset construction failed.');
      setSuccess(`Built ${formatDuration(durationValue, unit as DurationUnit)} dataset from persisted real Deriv ticks.`);
      await loadDatasetState(selectedSymbol);
    } catch (err) { setError(err instanceof Error ? err.message : 'Dataset construction failed.'); }
    finally { setBuilding(false); }
  }

  async function buildAllSupported() {
    if (!selectedSymbol || !state.horizons.length || buildingAll) return;
    setBuildingAll(true); setAutoJob(null); setError(null); setSuccess(null);
    try {
      const response = await fetch('/api/admin/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: selectedSymbol, buildAllSupportedHorizons: true }) });
      const data = await readJson(response);
      if (!response.ok || !data?.success || !data?.jobId) throw new Error(data?.error || 'Unable to start AUTO dataset build.');
      setAutoJobId(data.jobId);
      setAutoJob(data.job ?? null);
      setSuccess(`AUTO started for ${selectedSymbol}: ${data.requestedCount ?? data.result?.requestedCount ?? 0} dynamically discovered horizons.`);
    } catch (err) { setBuildingAll(false); setError(err instanceof Error ? err.message : 'Unable to start AUTO dataset build.'); }
  }

  const progress = autoJob ? Math.min(100, Math.round(((autoJob.completedCount + autoJob.failedCount) / Math.max(1, autoJob.requestedCount)) * 100)) : 0;

  return <main className="min-h-screen bg-[#05070b] px-4 py-5 text-slate-100 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1400px]">
    <header className="mb-5 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between"><div><Link href="/admin" className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-300"><ArrowLeft className="h-3.5 w-3.5" />Back to Admin Operations</Link><div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><Beaker className="h-6 w-6 text-cyan-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Agenda 5</p><h1 className="text-2xl font-black sm:text-3xl">Training Dataset Builder</h1><p className="mt-1 text-sm text-slate-500">Leakage-safe datasets built from persisted real Deriv ticks with broker-driven durations.</p></div></div></div><button onClick={() => void load()} disabled={loading || building || buildingAll} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button></header>
    {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
    {success && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-300"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{success}</span></div>}
    <section className="mb-5 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
      <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-5 flex items-center gap-2 text-sm font-bold text-cyan-300"><Sparkles className="h-4 w-4" />Build dataset</div>
        <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Deriv asset</span><select value={selectedSymbol} onChange={(e) => { setAutoJobId(null); setAutoJob(null); setBuildingAll(false); setSelectedSymbol(e.target.value); setSelectedHorizon(''); setAutoMode(false); }} disabled={loading || building || buildingAll} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none"><option value="">Select a live Deriv asset</option>{availableSymbols.map((item) => <option key={item.symbol} value={item.symbol}>{item.displayName} — {item.symbol}</option>)}</select>{selectedAsset && <span className="mt-2 block text-xs text-slate-500">{selectedAsset.market} / {selectedAsset.submarket} · {selectedAsset.isOpen ? 'Open' : 'Available but closed'}</span>}</label>
        <div className="mt-4"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Prediction horizon mode</span><div className="grid grid-cols-6 overflow-hidden rounded-xl border border-white/10 bg-black/30"><button type="button" onClick={() => { setAutoMode(true); setSelectedHorizon(''); }} disabled={!state.horizons.length || building || buildingAll} className={`px-1.5 py-3 text-xs font-bold ${autoMode ? 'bg-cyan-400 text-slate-950' : 'text-slate-300'} ${!state.horizons.length ? 'opacity-30' : ''}`}>AUTO</button>{units.map((option) => { const available = state.horizons.some((h) => h.unit === option.unit); const active = !autoMode && selectedUnit === option.unit; return <button key={option.unit} type="button" onClick={() => { setAutoMode(false); setSelectedUnit(option.unit); const first = state.horizons.find((h) => h.unit === option.unit); setSelectedHorizon(first ? `${first.value}:${first.unit}` : ''); }} disabled={!available || building || buildingAll} className={`px-1.5 py-3 text-xs font-bold sm:text-sm ${active ? 'bg-cyan-400 text-slate-950' : 'text-slate-300'} ${!available ? 'opacity-30' : ''}`}>{option.label}</button>; })}</div>{autoMode ? <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-3 text-xs leading-5 text-slate-400"><strong className="text-cyan-300">AUTO mode:</strong> build the complete dynamically derived set of Deriv-supported horizons for this asset.</div> : <select value={selectedHorizon} onChange={(e) => setSelectedHorizon(e.target.value)} disabled={!horizonsForSelectedUnit.length || building || buildingAll} className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm"><option value="">Select a Deriv-supported {unitLabel[selectedUnit]} horizon</option>{horizonsForSelectedUnit.map((item) => <option key={`${item.value}:${item.unit}`} value={`${item.value}:${item.unit}`}>{formatDuration(item.value, item.unit)}</option>)}</select>}</div>
        <div className="mt-5 rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.03] p-4 text-xs leading-5 text-slate-400"><strong className="text-slate-200">Pipeline contract:</strong> real Deriv ticks → registry-driven features → broker duration target → leakage checks → train-only normalization → chronological split with embargo.</div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2"><button onClick={() => void buildDataset()} disabled={autoMode || !selectedSymbol || !selectedHorizon || building || buildingAll || loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50">{building ? 'Building…' : 'Build selected horizon'}</button><button onClick={() => void buildAllSupported()} disabled={!selectedSymbol || !state.horizons.length || building || buildingAll || loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-300 disabled:opacity-50">{buildingAll ? <><RefreshCw className="h-4 w-4 animate-spin" />{autoJob ? `AUTO ${autoJob.completedCount + autoJob.failedCount}/${autoJob.requestedCount}` : 'Starting AUTO…'}</> : <><Database className="h-4 w-4" />{autoMode ? 'Build AUTO horizons' : 'Build all supported horizons'}</>}</button></div>
        {buildingAll && autoJob && <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4"><div className="flex items-center justify-between text-xs"><span className="font-semibold text-cyan-200">{autoJob.symbol} AUTO build</span><span className="text-slate-400">{autoJob.completedCount} completed · {autoJob.failedCount} failed · {autoJob.requestedCount} total</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-[11px] text-slate-500">Each horizon is built from persisted real Deriv ticks with bounded server concurrency. The progress is polled from the server job, not inferred from the button click.</p></div>}
      </article>
      <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-5 flex items-center gap-2 text-sm font-bold text-emerald-300"><ShieldCheck className="h-4 w-4" />Dynamic duration contract</div>{!state.discovery ? <p className="text-sm text-slate-500">Select an asset to query Deriv duration metadata.</p> : autoMode ? <div className="space-y-3">{state.discovery.ranges.map((range) => <div key={range.id} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between"><span className="font-semibold text-slate-200">{formatDuration(range.min, range.unit)}{range.min !== range.max ? ` – ${formatDuration(range.max, range.unit)}` : ''}</span><span className="text-[10px] uppercase text-emerald-300">Deriv</span></div>{range.tradeTypes.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Trade type: {range.tradeTypes.join(', ')}</p>}</div>)}</div> : selectedUnitRange.length === 0 ? <p className="text-sm text-slate-500">Deriv did not advertise a {unitLabel[selectedUnit]} duration for this asset.</p> : <div className="space-y-3">{selectedUnitRange.map((range) => <div key={range.id} className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="font-semibold text-slate-200">{formatDuration(range.min, range.unit)}{range.min !== range.max ? ` – ${formatDuration(range.max, range.unit)}` : ''}</span><span className="ml-2 text-[10px] uppercase text-emerald-300">Deriv</span></div>)}</div>}<p className="mt-4 text-[11px] text-slate-500">Source: {state.discovery?.source || 'waiting for Deriv'}.</p></article>
    </section>
    <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-4 flex items-end justify-between"><div><h2 className="text-lg font-bold">Built datasets</h2><p className="mt-1 text-xs text-slate-500">Each dataset records asset, duration value/unit, effective tick horizon and lineage.</p></div><span className="text-xs text-slate-500">{state.datasets.length} shown</span></div>{state.datasets.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">No duration-aware training datasets have been built for this asset.</div> : <div className="grid gap-3 lg:grid-cols-2">{state.datasets.map((dataset) => <article key={dataset.id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-100">{dataset.name}</h3><p className="mt-1 text-xs text-slate-500">{dataset.metadata?.assetDisplayName || dataset.asset_symbol} · {dataset.duration_value && dataset.duration_unit ? formatDuration(Number(dataset.duration_value), dataset.duration_unit) : `${dataset.horizon_ticks} ticks`}</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">{dataset.status.toUpperCase()}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-400 sm:grid-cols-4"><div><span className="block text-slate-600">Samples</span>{Number(dataset.sample_count).toLocaleString()}</div><div><span className="block text-slate-600">Train</span>{Number(dataset.train_count).toLocaleString()}</div><div><span className="block text-slate-600">Validation</span>{Number(dataset.validation_count).toLocaleString()}</div><div><span className="block text-slate-600">Test</span>{Number(dataset.test_count).toLocaleString()}</div></div></article>)}</div>}</section>
  </div></main>;
}