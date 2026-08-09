'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Beaker, CheckCircle2, Database, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';

type SymbolItem = { symbol: string; displayName: string; market: string; submarket: string; isOpen: boolean; isAvailable: boolean };
type DurationUnit = 't' | 's' | 'm' | 'h' | 'd';
type DurationRange = { id: string; unit: DurationUnit; min: number; max: number; tradeTypes: string[]; source: string };
type TrainingHorizon = { value: number; unit: DurationUnit; rangeId: string };
type DurationDiscovery = { symbol: string; ranges: DurationRange[]; fetchedAt: string; source: string };
type Dataset = {
  id: string; name: string; version: string; asset_symbol: string; horizon_ticks: number;
  duration_value: number | null; duration_unit: DurationUnit | null; duration_seconds: number | null;
  horizon_type: 'tick' | 'time' | null; contract_type: string | null; feature_schema_version: string;
  label_schema_version: string; sample_count: number; train_count: number; validation_count: number; test_count: number;
  status: string; leakage_check_passed: boolean; checksum: string | null; created_at: string;
  metadata?: { assetDisplayName?: string; duration?: { value?: number; unit?: DurationUnit; seconds?: number | null; effectiveHorizonTicks?: number }; qualityReport?: { status?: string; splitGapTicks?: number; excludedAmbiguousTargets?: number; featureCount?: number } } | null;
};
type ApiState = { datasets: Dataset[]; discovery: DurationDiscovery | null; horizons: TrainingHorizon[] };

const unitLabel: Record<DurationUnit, string> = { t: 'ticks', s: 'seconds', m: 'minutes', h: 'hours', d: 'days' };
function formatDuration(value: number, unit: DurationUnit) { return `${value} ${unitLabel[unit]}`; }

export default function TrainingDatasetBuilderPage() {
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [state, setState] = useState<ApiState>({ datasets: [], discovery: null, horizons: [] });
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [buildingAll, setBuildingAll] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<DurationUnit>('t');
  const [autoMode, setAutoMode] = useState(false);
  const [selectedHorizon, setSelectedHorizon] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const availableSymbols = useMemo(() => symbols.filter((item) => item.isAvailable), [symbols]);
  const selectedAsset = availableSymbols.find((item) => item.symbol === selectedSymbol);
  const unitOptions: Array<{ unit: DurationUnit; label: string }> = [
    { unit: 't', label: 'TICKS' },
    { unit: 's', label: 'SEC' },
    { unit: 'm', label: 'MIN' },
    { unit: 'h', label: 'HOUR' },
    { unit: 'd', label: 'DAY' },
  ];
  const horizonsForSelectedUnit = useMemo(
    () => state.horizons.filter((horizon) => horizon.unit === selectedUnit),
    [state.horizons, selectedUnit],
  );
  const selectedUnitRange = useMemo(
    () => state.discovery?.ranges.filter((range) => range.unit === selectedUnit) ?? [],
    [state.discovery, selectedUnit],
  );

  async function loadSymbols() {
    const response = await fetch('/api/symbols', { cache: 'no-store' });
    const data = await response.json();
    const liveSymbols = Array.isArray(data?.symbols) ? data.symbols : [];
    setSymbols(liveSymbols);
    setSelectedSymbol((current) => current || liveSymbols.find((item: SymbolItem) => item.isAvailable)?.symbol || '');
    if (!response.ok) throw new Error(data?.error || 'Live Deriv symbols are unavailable.');
  }

  async function loadDatasetState(symbol: string) {
    if (!symbol) return;
    const response = await fetch(`/api/admin/datasets?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Unable to load Deriv duration capabilities.');
    const discoveredHorizons: TrainingHorizon[] = Array.isArray(data?.trainingHorizons) ? data.trainingHorizons : [];
    const availableUnits: DurationUnit[] = ['t', 's', 'm', 'h', 'd'].filter((unit) => discoveredHorizons.some((horizon) => horizon.unit === unit)) as DurationUnit[];
    const preferredUnit = availableUnits.includes(selectedUnit) ? selectedUnit : (availableUnits[0] ?? 't');
    setState({ datasets: Array.isArray(data?.datasets) ? data.datasets : [], discovery: data?.durationDiscovery ?? null, horizons: discoveredHorizons });
    setSelectedUnit(preferredUnit);
    setAutoMode(false);
    const first = discoveredHorizons.find((horizon) => horizon.unit === preferredUnit);
    setSelectedHorizon(first ? `${first.value}:${first.unit}` : '');
  }

  async function load() {
    setLoading(true); setError(null);
    try {
      await loadSymbols();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load dataset builder.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!selectedSymbol) return;
    setError(null);
    void loadDatasetState(selectedSymbol).catch((err) => setError(err instanceof Error ? err.message : 'Unable to load duration capabilities.'));
  }, [selectedSymbol]);

  async function buildDataset() {
    if (!selectedSymbol || !selectedHorizon || autoMode) return;
    const [valueText, unit] = selectedHorizon.split(':');
    const durationValue = Number(valueText);
    if (!Number.isSafeInteger(durationValue)) return;
    setBuilding(true); setError(null); setSuccess(null);
    try {
      const response = await fetch('/api/admin/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: selectedSymbol, durationValue, durationUnit: unit }) });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Dataset construction failed.');
      setSuccess(`Built ${formatDuration(durationValue, unit as DurationUnit)} dataset from persisted real Deriv ticks.`);
      await loadDatasetState(selectedSymbol);
    } catch (err) { setError(err instanceof Error ? err.message : 'Dataset construction failed.'); }
    finally { setBuilding(false); }
  }

  async function buildAllSupported() {
    if (!selectedSymbol) return;
    setBuildingAll(true); setError(null); setSuccess(null);
    try {
      const response = await fetch('/api/admin/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: selectedSymbol, buildAllSupportedHorizons: true }) });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Unable to build all supported duration datasets.');
      const result = data.result;
      setSuccess(`Completed ${result.completedCount} of ${result.requestedCount} discovered duration datasets for ${selectedSymbol}.`);
      await loadDatasetState(selectedSymbol);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to build all supported duration datasets.'); }
    finally { setBuildingAll(false); }
  }

  return <main className="min-h-screen bg-[#05070b] px-4 py-5 text-slate-100 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1400px]">
      <header className="mb-5 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/admin" className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-300"><ArrowLeft className="h-3.5 w-3.5" />Back to Admin Operations</Link>
          <div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><Beaker className="h-6 w-6 text-cyan-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Agenda 5</p><h1 className="text-2xl font-black sm:text-3xl">Training Dataset Builder</h1><p className="mt-1 text-sm text-slate-500">Leakage-safe datasets built from persisted real Deriv ticks with broker-driven durations.</p></div></div>
        </div>
        <button onClick={() => void load()} disabled={loading || building || buildingAll} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </header>

      {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
      {success && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-300"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{success}</span></div>}

      <section className="mb-5 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-bold text-cyan-300"><Sparkles className="h-4 w-4" />Build dataset</div>
          <label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Deriv asset</span><select value={selectedSymbol} onChange={(event) => { setSelectedSymbol(event.target.value); setSelectedHorizon(''); setAutoMode(false); }} disabled={loading || building || buildingAll} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-400/50"><option value="">Select a live Deriv asset</option>{availableSymbols.map((item) => <option key={item.symbol} value={item.symbol}>{item.displayName} — {item.symbol}</option>)}</select>{selectedAsset && <span className="mt-2 block text-xs text-slate-500">{selectedAsset.market} / {selectedAsset.submarket} · {selectedAsset.isOpen ? 'Open' : 'Available but closed'}</span>}</label>

          <div className="mt-4">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Prediction horizon mode</span>
            <div className="grid grid-cols-6 overflow-hidden rounded-xl border border-white/10 bg-black/30">
              <button type="button" onClick={() => { setAutoMode(true); setSelectedHorizon(''); }} disabled={!state.horizons.length || building || buildingAll} className={`px-1.5 py-3 text-xs font-bold transition sm:text-sm ${autoMode ? 'bg-cyan-400 text-slate-950' : 'text-slate-300 hover:bg-white/5'} ${!state.horizons.length ? 'cursor-not-allowed opacity-30' : ''}`}>AUTO</button>
              {unitOptions.map((option) => {
                const available = state.horizons.some((horizon) => horizon.unit === option.unit);
                const active = !autoMode && selectedUnit === option.unit;
                return <button key={option.unit} type="button" onClick={() => { setAutoMode(false); setSelectedUnit(option.unit); const first = state.horizons.find((horizon) => horizon.unit === option.unit); setSelectedHorizon(first ? `${first.value}:${first.unit}` : ''); }} disabled={!available || building || buildingAll} className={`px-1.5 py-3 text-xs font-bold transition sm:text-sm ${active ? 'bg-cyan-400 text-slate-950' : 'text-slate-300 hover:bg-white/5'} ${!available ? 'cursor-not-allowed opacity-30' : ''}`}>{option.label}</button>;
              })}
            </div>
            {autoMode ? <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-3 text-xs leading-5 text-slate-400"><strong className="text-cyan-300">AUTO mode:</strong> build the complete set of Deriv-discovered horizons for this asset. The downstream asset-aware strategy can evaluate the resulting duration-specific datasets and select the appropriate horizon; AUTO is not treated as a fake broker duration.</div> : <>
              <select value={selectedHorizon} onChange={(event) => setSelectedHorizon(event.target.value)} disabled={!horizonsForSelectedUnit.length || building || buildingAll} className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-400/50">
                <option value="">Select a Deriv-supported {unitLabel[selectedUnit]} horizon</option>
                {horizonsForSelectedUnit.map((item) => <option key={`${item.value}:${item.unit}`} value={`${item.value}:${item.unit}`}>{formatDuration(item.value, item.unit)}</option>)}
              </select>
              <p className="mt-2 text-xs text-slate-500">Only duration units advertised by Deriv for the selected asset are enabled. Tick targets use future tick positions; time targets use timestamps.</p>
            </>}
          </div>

          <div className="mt-5 rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.03] p-4 text-xs leading-5 text-slate-400"><strong className="text-slate-200">Pipeline contract:</strong> real Deriv ticks → registry-driven features → broker duration target → leakage checks → train-only normalization → chronological split with embargo. Time horizons use timestamp-based future targets; tick horizons use future tick positions.</div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button onClick={() => void buildDataset()} disabled={autoMode || !selectedSymbol || !selectedHorizon || building || buildingAll || loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">{building ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}{building ? 'Building…' : 'Build selected horizon'}</button>
            <button onClick={() => void buildAllSupported()} disabled={!selectedSymbol || !state.horizons.length || building || buildingAll || loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-300 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50">{buildingAll ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}{buildingAll ? 'Building all supported…' : autoMode ? 'Build AUTO horizons' : 'Build all supported horizons'}</button>
          </div>
        </article>

        <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-bold text-emerald-300"><ShieldCheck className="h-4 w-4" />Dynamic duration contract</div>
          {!state.discovery ? <p className="text-sm text-slate-500">Select an asset to query Deriv duration metadata.</p> : selectedUnitRange.length === 0 && !autoMode ? <p className="text-sm text-slate-500">Deriv did not advertise a {unitLabel[selectedUnit]} duration for this asset.</p> : autoMode ? <div className="space-y-3">{state.discovery.ranges.map((range) => <div key={range.id} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-slate-200">{formatDuration(range.min, range.unit)}{range.min !== range.max ? ` – ${formatDuration(range.max, range.unit)}` : ''}</span><span className="text-[10px] uppercase tracking-wider text-emerald-300">Deriv</span></div>{range.tradeTypes.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Trade type: {range.tradeTypes.join(', ')}</p>}</div>)}</div> : <div className="space-y-3">{selectedUnitRange.map((range) => <div key={range.id} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-slate-200">{formatDuration(range.min, range.unit)}{range.min !== range.max ? ` – ${formatDuration(range.max, range.unit)}` : ''}</span><span className="text-[10px] uppercase tracking-wider text-emerald-300">Deriv</span></div>{range.tradeTypes.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Trade type: {range.tradeTypes.join(', ')}</p>}</div>)}</div>}
          <p className="mt-4 text-[11px] leading-5 text-slate-500">Source: {state.discovery?.source || 'waiting for Deriv'}. The registry is refreshed when the selected asset changes.</p>
        </article>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
        <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Built datasets</h2><p className="mt-1 text-xs text-slate-500">Each dataset records asset, duration value/unit, effective tick horizon, feature schema and lineage.</p></div><span className="text-xs text-slate-500">{state.datasets.length} shown</span></div>
        {state.datasets.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">No duration-aware training datasets have been built for this asset.</div> : <div className="grid gap-3 lg:grid-cols-2">{state.datasets.map((dataset) => { const duration = dataset.duration_value && dataset.duration_unit ? formatDuration(Number(dataset.duration_value), dataset.duration_unit) : `${dataset.horizon_ticks} ticks`; const quality = dataset.metadata?.qualityReport; return <article key={dataset.id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-100">{dataset.name}</h3><p className="mt-1 text-xs text-slate-500">{dataset.metadata?.assetDisplayName || dataset.asset_symbol} · {duration}</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-emerald-300">{dataset.status.toUpperCase()}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-400 sm:grid-cols-4"><div><span className="block text-slate-600">Samples</span>{Number(dataset.sample_count).toLocaleString()}</div><div><span className="block text-slate-600">Train</span>{Number(dataset.train_count).toLocaleString()}</div><div><span className="block text-slate-600">Validation</span>{Number(dataset.validation_count).toLocaleString()}</div><div><span className="block text-slate-600">Test</span>{Number(dataset.test_count).toLocaleString()}</div></div><div className="mt-4 flex flex-wrap gap-2 text-[10px]"><span className="rounded-full border border-white/10 px-2 py-1 text-slate-400">{dataset.horizon_type || 'tick'} horizon</span>{dataset.duration_seconds != null && <span className="rounded-full border border-white/10 px-2 py-1 text-slate-400">{Number(dataset.duration_seconds).toLocaleString()}s</span>}<span className="rounded-full border border-emerald-400/20 px-2 py-1 text-emerald-300">Leakage passed</span>{quality?.status && <span className="rounded-full border border-white/10 px-2 py-1 text-slate-400">{quality.status}</span>}</div><p className="mt-3 break-all text-[10px] text-slate-600">{dataset.version} · {dataset.feature_schema_version}</p></article>; })}</div>}
      </section>
    </div>
  </main>;
}
