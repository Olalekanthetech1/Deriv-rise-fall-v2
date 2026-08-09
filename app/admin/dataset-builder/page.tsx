'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Beaker, CheckCircle2, Database, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';

type SymbolItem = {
  symbol: string;
  displayName: string;
  market: string;
  submarket: string;
  isOpen: boolean;
  isAvailable: boolean;
};

type DatasetQualityReport = {
  status: 'READY' | 'REVIEW';
  totalTicks: number;
  validTicks: number;
  invalidTicks: number;
  duplicateTicks: number;
  candidateSamples: number;
  generatedSamples: number;
  excludedMissingWindows: number;
  excludedAmbiguousTargets: number;
  excludedSplitGap: number;
  featureCount: number;
  trainCount: number;
  validationCount: number;
  testCount: number;
  splitGapTicks: number;
  leakageCheckPassed: boolean;
  temporalSplitValidated: boolean;
  normalizationVersion: string;
  featureSchemaVersion: string;
  labelSchemaVersion: string;
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
  metadata?: {
    qualityReport?: DatasetQualityReport;
    normalization?: { version?: string };
  } | null;
};

type BuildResult = {
  sampleCount: number;
  trainCount: number;
  validationCount: number;
  testCount: number;
  checksum: string;
  sourceFrom: string;
  sourceTo: string;
  qualityReport: DatasetQualityReport;
  normalizationVersion: string;
  datasetFingerprint: string;
};

export default function TrainingDatasetBuilderPage() {
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [horizonTicks, setHorizonTicks] = useState(5);
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
      setSymbols(liveSymbols);
      setDatasets(Array.isArray(datasetData?.datasets) ? datasetData.datasets : []);
      setSelectedSymbol((current) => current || liveSymbols.find((item: SymbolItem) => item.isAvailable)?.symbol || '');
      if (!symbolResponse.ok) setError(symbolData?.error || 'Live Deriv symbols are currently unavailable.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dataset builder.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function buildDataset() {
    if (!selectedSymbol) return;
    setBuilding(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/admin/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol, horizonTicks, windowTicks: 300 }),
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
          <div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><Beaker className="h-6 w-6 text-cyan-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Agenda 5</p><h1 className="text-2xl font-black sm:text-3xl">Training Dataset Builder</h1><p className="mt-1 text-sm text-slate-500">Leakage-safe datasets built exclusively from persisted real Deriv ticks.</p></div></div>
        </div>
        <button onClick={() => void load()} disabled={loading || building} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </header>

      {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
      {success && <div className="mb-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-emerald-300"><CheckCircle2 className="h-4 w-4" />Dataset built from real Deriv ticks</div>
        <p className="mt-2 text-xs text-slate-400">{success.sampleCount.toLocaleString()} samples · Train {success.trainCount.toLocaleString()} · Validation {success.validationCount.toLocaleString()} · Test {success.testCount.toLocaleString()}</p>
        <p className="mt-1 break-all text-[11px] text-slate-500">SHA-256: {success.checksum}</p>
        <p className="mt-1 text-[11px] text-slate-500">Fingerprint: {success.datasetFingerprint} · Normalization: {success.normalizationVersion}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 text-xs text-slate-300">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">Status<br /><span className={success.qualityReport.status === 'READY' ? 'text-emerald-300' : 'text-amber-300'}>{success.qualityReport.status}</span></div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">Leakage<br /><span className={success.qualityReport.leakageCheckPassed ? 'text-emerald-300' : 'text-red-300'}>{success.qualityReport.leakageCheckPassed ? 'Passed' : 'Failed'}</span></div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">Split validation<br /><span className={success.qualityReport.temporalSplitValidated ? 'text-emerald-300' : 'text-red-300'}>{success.qualityReport.temporalSplitValidated ? 'Passed' : 'Failed'}</span></div>
        </div>
      </div>}

      <section className="mb-5 grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-bold text-cyan-300"><Sparkles className="h-4 w-4" />Build dataset</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Deriv asset</span><select value={selectedSymbol} onChange={(event) => setSelectedSymbol(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-400/50"><option value="">Select a live Deriv asset</option>{availableSymbols.map((item) => <option key={item.symbol} value={item.symbol}>{item.displayName} — {item.symbol}</option>)}</select>{selectedAsset && <span className="mt-2 block text-xs text-slate-500">{selectedAsset.market} / {selectedAsset.submarket} · {selectedAsset.isOpen ? 'Open' : 'Available but closed'}</span>}</label>
            <label><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Prediction horizon (ticks)</span><input type="number" min={1} max={5000} value={horizonTicks} onChange={(event) => setHorizonTicks(Number(event.target.value))} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-400/50" /></label>
            <div><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Feature window</span><div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">300 ticks · canonical 37 features</div></div>
          </div>
          <div className="mt-5 rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.03] p-4 text-xs leading-5 text-slate-400"><strong className="text-slate-200">Pipeline contract:</strong> raw Deriv ticks → leakage checks → dynamic normalization → future direction label → chronological split with embargo. Flat outcomes are excluded. No synthetic fallback is permitted.</div>
          <button onClick={() => void buildDataset()} disabled={!selectedSymbol || building || loading} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">{building ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}{building ? 'Building leakage-safe dataset…' : 'Build Training Dataset'}</button>
        </article>

        <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-bold text-emerald-300"><ShieldCheck className="h-4 w-4" />Dataset integrity</div>
          <div className="space-y-4 text-sm">
            <div><p className="text-xs uppercase tracking-wider text-slate-500">Source policy</p><p className="mt-1 text-slate-200">Deriv real ticks only</p></div>
            <div><p className="text-xs uppercase tracking-wider text-slate-500">Feature schema</p><p className="mt-1 text-slate-200">37-dimensional canonical tick feature set</p></div>
            <div><p className="text-xs uppercase tracking-wider text-slate-500">Split</p><p className="mt-1 text-slate-200">Chronological 70% / 15% / 15%</p></div>
            <div><p className="text-xs uppercase tracking-wider text-slate-500">Leakage control</p><p className="mt-1 text-emerald-300">Future outcome excluded from feature window</p></div>
            <div><p className="text-xs uppercase tracking-wider text-slate-500">Normalization</p><p className="mt-1 text-slate-200">z-score fit on train split only</p></div>
          </div>
        </article>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
        <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Built datasets</h2><p className="mt-1 text-xs text-slate-500">Persisted dataset manifests and lineage metadata. Samples remain linked to raw market ticks.</p></div><span className="text-xs text-slate-500">{datasets.length} shown</span></div>
        {datasets.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">No training datasets have been built yet.</div> : <div className="grid gap-3 lg:grid-cols-2">{datasets.map((dataset) => {
          const quality = dataset.metadata?.qualityReport;
          return <article key={dataset.id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-100">{dataset.name}</h3><p className="mt-1 text-xs text-slate-500">{dataset.asset_symbol} · {dataset.version}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wider ${dataset.status === 'completed' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/20 bg-amber-400/10 text-amber-200'}`}>{dataset.status.toUpperCase()}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-400 sm:grid-cols-4"><div><span className="block text-slate-600">Samples</span>{Number(dataset.sample_count).toLocaleString()}</div><div><span className="block text-slate-600">Train</span>{Number(dataset.train_count).toLocaleString()}</div><div><span className="block text-slate-600">Validation</span>{Number(dataset.validation_count).toLocaleString()}</div><div><span className="block text-slate-600">Test</span>{Number(dataset.test_count).toLocaleString()}</div></div><div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500"><span>Horizon: {dataset.horizon_ticks} ticks</span><span>•</span><span>{dataset.feature_schema_version}</span><span>•</span><span className={dataset.leakage_check_passed ? 'text-emerald-300' : 'text-red-300'}>{dataset.leakage_check_passed ? 'Leakage check passed' : 'Leakage check failed'}</span>{quality ? <><span>•</span><span className={quality.status === 'READY' ? 'text-emerald-300' : 'text-amber-300'}>{quality.status}</span><span>•</span><span>{quality.normalizationVersion}</span></> : null}</div></article>;
        })}</div>}
      </section>
    </div>
  </main>;
}
