'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Beaker, CheckCircle2, Database, RefreshCw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';

type SymbolItem = {
  symbol: string;
  displayName: string;
  market: string;
  submarket: string;
  isOpen: boolean;
  isAvailable: boolean;
};

type FeatureDefinition = {
  key: string;
  sourceKey: string;
  name: string;
  pillar: string;
  ordinal: number;
  active: boolean;
  parameters: Record<string, unknown>;
};

type HorizonDefinition = {
  id: string;
  label: string;
  tickCount: number;
  durationSeconds: number | null;
  active: boolean;
  metadata: Record<string, unknown>;
};

type DatasetSchema = {
  featureCount: number;
  featureSchemaVersion: string;
  requiredWindowTicks: number;
  features: FeatureDefinition[];
  horizons: HorizonDefinition[];
  labelPolicy?: {
    schemaVersion: string;
    strategy: string;
    labelValues: string[];
    description: string;
  };
};

type Dataset = {
  id: string;
  name: string;
  version: string;
  asset_symbol: string;
  horizon_ticks: number;
  feature_schema_version: string;
  label_schema_version: string;
  sample_count: number;
  train_count: number;
  validation_count: number;
  test_count: number;
  status: string;
  leakage_check_passed: boolean;
  checksum: string | null;
  source_from: string;
  source_to: string;
  created_at: string;
};

type BuildResult = {
  sampleCount: number;
  trainCount: number;
  validationCount: number;
  testCount: number;
  featureCount: number;
  featureSchemaVersion: string;
  labelSchemaVersion: string;
  labelDeadZone: number;
  ambiguousSamplesExcluded: number;
  horizonTicks: number;
  checksum: string;
  sourceFrom: string;
  sourceTo: string;
};

export default function TrainingDatasetBuilderPage() {
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [horizonTicks, setHorizonTicks] = useState<number | null>(null);
  const [schema, setSchema] = useState<DatasetSchema | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<BuildResult | null>(null);

  const availableSymbols = useMemo(() => symbols.filter((item) => item.isAvailable), [symbols]);
  const selectedAsset = availableSymbols.find((item) => item.symbol === selectedSymbol);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [symbolResponse, datasetResponse] = await Promise.all([
        fetch('/api/symbols', { cache: 'no-store' }),
        fetch('/api/admin/datasets', { cache: 'no-store' }),
      ]);
      const symbolData = await symbolResponse.json();
      const datasetData = await datasetResponse.json();
      if (!datasetResponse.ok) throw new Error(datasetData?.error || 'Unable to load dataset operations.');
      const liveSymbols = Array.isArray(symbolData?.symbols) ? symbolData.symbols : [];
      const loadedSchema = datasetData?.schema as DatasetSchema | undefined;
      setSymbols(liveSymbols);
      setSchema(loadedSchema ?? null);
      setDatasets(Array.isArray(datasetData?.datasets) ? datasetData.datasets : []);
      setSelectedSymbol((current) => current || liveSymbols.find((item: SymbolItem) => item.isAvailable)?.symbol || '');
      setHorizonTicks((current) => current ?? loadedSchema?.horizons?.[0]?.tickCount ?? null);
      if (!symbolResponse.ok) setError(symbolData?.error || 'Live Deriv symbols are currently unavailable.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dataset builder.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function buildDataset() {
    if (!selectedSymbol || horizonTicks == null) return;
    setBuilding(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/admin/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol, horizonTicks }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Dataset construction failed.');
      setSuccess(data.dataset);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dataset construction failed.');
    } finally {
      setBuilding(false);
    }
  }

  return <main className="min-h-screen bg-[#05070b] px-4 py-5 text-slate-100 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1400px]">
      <header className="mb-5 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/admin" className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-300"><ArrowLeft className="h-3.5 w-3.5" />Back to Admin Operations</Link>
          <div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><Beaker className="h-6 w-6 text-cyan-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Agenda 5</p><h1 className="text-2xl font-black sm:text-3xl">Training Dataset Builder</h1><p className="mt-1 text-sm text-slate-500">Registry-driven, leakage-safe datasets built exclusively from persisted real Deriv ticks.</p></div></div>
        </div>
        <button onClick={() => void load()} disabled={loading || building} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </header>

      {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
      {success && <div className="mb-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4"><div className="flex items-center gap-2 text-sm font-bold text-emerald-300"><CheckCircle2 className="h-4 w-4" />Dataset built from real Deriv ticks</div><p className="mt-2 text-xs text-slate-400">{success.sampleCount.toLocaleString()} samples · Train {success.trainCount.toLocaleString()} · Validation {success.validationCount.toLocaleString()} · Test {success.testCount.toLocaleString()}</p><p className="mt-1 text-xs text-slate-400">{success.featureCount} active features · Horizon {success.horizonTicks} ticks</p><p className="mt-1 text-xs text-slate-400">Label policy {success.labelSchemaVersion} · Dead zone {success.labelDeadZone.toExponential(2)} · Ambiguous excluded {success.ambiguousSamplesExcluded.toLocaleString()}</p><p className="mt-1 break-all text-[11px] text-slate-500">Schema: {success.featureSchemaVersion} · SHA-256: {success.checksum}</p></div>}

      <section className="mb-5 grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-bold text-cyan-300"><Sparkles className="h-4 w-4" />Build dataset</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Deriv asset</span><select value={selectedSymbol} onChange={(event) => setSelectedSymbol(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-400/50"><option value="">Select a live Deriv asset</option>{availableSymbols.map((item) => <option key={item.symbol} value={item.symbol}>{item.displayName} — {item.symbol}</option>)}</select>{selectedAsset && <span className="mt-2 block text-xs text-slate-500">{selectedAsset.market} / {selectedAsset.submarket} · {selectedAsset.isOpen ? 'Open' : 'Available but closed'}</span>}</label>
            <label><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Prediction horizon</span><select value={horizonTicks ?? ''} onChange={(event) => setHorizonTicks(Number(event.target.value))} disabled={!schema?.horizons.length} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-400/50"><option value="">Select configured horizon</option>{schema?.horizons.map((item) => <option key={item.id} value={item.tickCount}>{item.label}</option>)}</select></label>
            <div><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Feature schema</span><div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">{schema ? `${schema.featureCount} active features · ${schema.requiredWindowTicks}-tick lookback` : 'Loading registry…'}</div></div>
          </div>
          <div className="mt-5 rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.03] p-4 text-xs leading-5 text-slate-400"><strong className="text-slate-200">Pipeline contract:</strong> real Deriv ticks → active feature registry → configured horizon → future direction label → chronological 70/15/15 split. Flat and near-flat outcomes are excluded by a dynamic dead zone. No synthetic fallback is permitted.</div>
          <button onClick={() => void buildDataset()} disabled={!selectedSymbol || horizonTicks == null || building || loading || !schema} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">{building ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}{building ? 'Building leakage-safe dataset…' : 'Build Training Dataset'}</button>
        </article>

        <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-bold text-emerald-300"><ShieldCheck className="h-4 w-4" />Dataset integrity</div>
          <div className="space-y-4 text-sm"><div><p className="text-xs uppercase tracking-wider text-slate-500">Source policy</p><p className="mt-1 text-slate-200">Deriv real ticks only</p></div><div><p className="text-xs uppercase tracking-wider text-slate-500">Active features</p><p className="mt-1 text-slate-200">{schema ? `${schema.featureCount} · ${schema.featureSchemaVersion}` : 'Loading…'}</p></div><div><p className="text-xs uppercase tracking-wider text-slate-500">Horizon registry</p><p className="mt-1 text-slate-200">{schema ? `${schema.horizons.length} configured horizons` : 'Loading…'}</p></div><div><p className="text-xs uppercase tracking-wider text-slate-500">Label policy</p><p className="mt-1 text-slate-200">{schema?.labelPolicy ? `${schema.labelPolicy.strategy} · ${schema.labelPolicy.schemaVersion}` : 'Loading…'}</p><p className="mt-1 text-xs text-slate-500">{schema?.labelPolicy?.description ?? 'Dynamic dead-zone label hardening'}</p></div><div><p className="text-xs uppercase tracking-wider text-slate-500">Leakage control</p><p className="mt-1 text-emerald-300">Outcome ticks are strictly after the feature anchor</p></div></div>
        </article>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
        <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Built datasets</h2><p className="mt-1 text-xs text-slate-500">Persisted manifests, feature-schema versions, horizon configuration and raw-tick lineage.</p></div><span className="text-xs text-slate-500">{datasets.length} shown</span></div>
        {datasets.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">No training datasets have been built yet.</div> : <div className="grid gap-3 lg:grid-cols-2">{datasets.map((dataset) => <article key={dataset.id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-100">{dataset.name}</h3><p className="mt-1 text-xs text-slate-500">{dataset.asset_symbol} · {dataset.version}</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-emerald-300">{dataset.status.toUpperCase()}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-400 sm:grid-cols-4"><div><span className="block text-slate-600">Samples</span>{Number(dataset.sample_count).toLocaleString()}</div><div><span className="block text-slate-600">Train</span>{Number(dataset.train_count).toLocaleString()}</div><div><span className="block text-slate-600">Validation</span>{Number(dataset.validation_count).toLocaleString()}</div><div><span className="block text-slate-600">Test</span>{Number(dataset.test_count).toLocaleString()}</div></div><div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500"><span>Horizon: {dataset.horizon_ticks} ticks</span><span>•</span><span>{dataset.feature_schema_version}</span><span>•</span><span>{dataset.label_schema_version}</span><span>•</span><span className={dataset.leakage_check_passed ? 'text-emerald-300' : 'text-red-300'}>{dataset.leakage_check_passed ? 'Leakage check passed' : 'Leakage check failed'}</span></div></article>)}</div>}
      </section>
    </div>
  </main>;
}
