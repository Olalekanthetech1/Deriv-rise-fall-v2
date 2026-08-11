'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BrainCircuit, CheckCircle2, Database, Filter, Layers3, Play, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react';

type ModelKey = 'xgboost'|'lightgbm'|'catboost'|'tcn'|'lstm'|'hmm'|'isolation_forest';
type Dataset = { id:string; name:string; asset_symbol:string; raw_asset_symbol?:string; duration_value:number; duration_unit:string; duration_seconds:number|null; horizon_ticks:number; status:string; leakage_check_passed:boolean; sample_count:number; train_count:number };
type ModelRun = { model_type:string; status:string; model_id?:string; metrics?:Record<string,unknown>; error?:string; heartbeat_at?:string|null };
type Run = { run_id:string; dataset_id:string; asset_symbol:string; raw_asset_symbol?:string; duration_value:number; duration_unit:string; duration_seconds:number|null; horizon_ticks:number; status:string; completed_models:number; failed_models:number; requested_models:ModelKey[]; models:ModelRun[]; created_at:string; completed_at?:string|null; heartbeat_at?:string|null };
type BatchItem = { dataset_id:string; status:string; requested_models:ModelKey[]; skipped_models:ModelKey[]; completed_models:number; failed_models:number; asset_symbol?:string; duration_value?:number; duration_unit?:string; horizon_ticks?:number; run_id?:string|null; error?:string|null };
type Batch = { batch_id:string; status:string; requested_datasets:number; requested_models:number; total_jobs:number; completed_jobs:number; failed_jobs:number; skipped_jobs:number; heartbeat_at?:string|null; completed_at?:string|null; error?:string|null; items:BatchItem[] };

type HorizonOption = { key:string; value:number; unit:string; seconds:number; label:string };

const MODEL_LABELS: Record<ModelKey,string> = { xgboost:'XGBoost', lightgbm:'LightGBM', catboost:'CatBoost', tcn:'TCN', lstm:'LSTM / GRU', hmm:'HMM Regime', isolation_forest:'Isolation Forest' };
const ALL_MODELS = Object.keys(MODEL_LABELS) as ModelKey[];
const UNIT_LABELS: Record<string,string> = { t:'ticks', s:'seconds', m:'minutes', h:'hours', d:'days' };
const UNIT_SHORT: Record<string,string> = { t:'t', s:'s', m:'m', h:'h', d:'d' };
const durationText = (value:number, unit:string) => `${value} ${UNIT_LABELS[unit] || unit}`;
const metric = (metrics?:Record<string,unknown>) => { const value = Number(metrics?.accuracy); return Number.isFinite(value) ? `${value.toFixed(2)}%` : '—'; };
const failureStatus = (status:string) => ['failed','timed_out','cancelled'].includes(status);

function durationSeconds(dataset: Pick<Dataset,'duration_value'|'duration_unit'|'duration_seconds'>) {
  if (Number.isFinite(dataset.duration_seconds)) return Number(dataset.duration_seconds);
  const value = Number(dataset.duration_value);
  switch (dataset.duration_unit) {
    case 't': return value;
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return value;
  }
}

function statusClass(status:string) {
  if (status === 'completed') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
  if (status === 'partial') return 'border-amber-400/20 bg-amber-400/10 text-amber-200';
  if (failureStatus(status)) return 'border-red-400/20 bg-red-400/10 text-red-200';
  return 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200';
}

export default function TrainingPipelinePage() {
  const [datasets,setDatasets] = useState<Dataset[]>([]);
  const [runs,setRuns] = useState<Run[]>([]);
  const [selectedDataset,setSelectedDataset] = useState('');
  const [selectedDatasets,setSelectedDatasets] = useState<string[]>([]);
  const [models,setModels] = useState<ModelKey[]>(ALL_MODELS);
  const [skipCompleted,setSkipCompleted] = useState(true);
  const [retryFailed,setRetryFailed] = useState(false);
  const [batch,setBatch] = useState<Batch|null>(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [message,setMessage] = useState<string|null>(null);
  const [assetFilter,setAssetFilter] = useState('all');
  const [horizonFilter,setHorizonFilter] = useState('all');

  const readyDatasets = useMemo(() => datasets.filter((d) => d.status === 'completed' && d.leakage_check_passed), [datasets]);
  const assetOptions = useMemo(() => Array.from(new Map(readyDatasets.map((d) => [d.asset_symbol, d])).values()).sort((a,b) => a.asset_symbol.localeCompare(b.asset_symbol)), [readyDatasets]);
  const horizonOptions = useMemo<HorizonOption[]>(() => {
    const map = new Map<string,HorizonOption>();
    for (const dataset of readyDatasets) {
      const seconds = durationSeconds(dataset);
      const key = Number.isFinite(dataset.duration_seconds) ? `sec:${seconds}` : `${dataset.duration_value}:${dataset.duration_unit}`;
      if (!map.has(key)) map.set(key, { key, value: dataset.duration_value, unit: dataset.duration_unit, seconds, label: `${dataset.duration_value}${UNIT_SHORT[dataset.duration_unit] || dataset.duration_unit}` });
    }
    return [...map.values()].sort((a,b) => a.seconds - b.seconds || a.label.localeCompare(b.label));
  }, [readyDatasets]);
  const filteredDatasets = useMemo(() => readyDatasets.filter((dataset) => {
    const assetMatch = assetFilter === 'all' || dataset.asset_symbol === assetFilter;
    const horizonMatch = horizonFilter === 'all' || horizonOptions.some((option) => option.key === horizonFilter && Math.abs(durationSeconds(dataset) - option.seconds) < 0.000001);
    return assetMatch && horizonMatch;
  }), [readyDatasets, assetFilter, horizonFilter, horizonOptions]);
  const selected = useMemo(() => datasets.find((d) => d.id === selectedDataset), [datasets, selectedDataset]);
  const runningRuns = useMemo(() => runs.filter((run) => run.status === 'running'), [runs]);
  const failedRunCount = useMemo(() => runs.filter((run) => failureStatus(run.status)).length, [runs]);
  const batchActive = !!batch && ['queued','running','partial'].includes(batch.status);
  const estimatedJobs = selectedDatasets.length * models.length;
  const allFilteredSelected = filteredDatasets.length > 0 && filteredDatasets.every((dataset) => selectedDatasets.includes(dataset.id));

  async function load() {
    setLoading(true); setError(null);
    try {
      const [datasetsRes,runsRes] = await Promise.all([fetch('/api/admin/datasets?eligibleForTraining=1',{cache:'no-store'}),fetch('/api/admin/model-training',{cache:'no-store'})]);
      const datasetsData = await datasetsRes.json().catch(() => ({}));
      const runsData = await runsRes.json().catch(() => ({}));
      const next = Array.isArray(datasetsData?.datasets) ? datasetsData.datasets as Dataset[] : [];
      const runList = Array.isArray(runsData?.runs) ? runsData.runs as Run[] : [];
      if (datasetsRes.ok) {
        setDatasets(next);
        setSelectedDataset((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id || '');
        setSelectedDatasets((current) => current.filter((id) => next.some((item) => item.id === id)));
      }
      if (runsRes.ok) setRuns(runList);
      const failures:string[] = [];
      if (!datasetsRes.ok) failures.push(`Datasets: ${datasetsData?.error || 'unable to load training datasets.'}`);
      if (!runsRes.ok) failures.push(`Training runs: ${runsData?.error || 'unable to load training run diagnostics.'}`);
      setError(failures.length ? failures.join(' ') : null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load model training operations.'); }
    finally { setLoading(false); }
  }

  async function loadBatch(batchId:string) {
    const response = await fetch(`/api/admin/model-training/batch?batchId=${encodeURIComponent(batchId)}`,{cache:'no-store'});
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load training batch.');
    setBatch(data.batch as Batch);
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!runningRuns.length && !batchActive) return;
    const timer = setInterval(() => { void load(); if (batch?.batch_id) void loadBatch(batch.batch_id).catch(() => undefined); }, 5000);
    return () => clearInterval(timer);
  }, [runningRuns.length, batchActive, batch?.batch_id]);
  useEffect(() => {
    if (selectedDataset && filteredDatasets.some((dataset) => dataset.id === selectedDataset)) return;
    setSelectedDataset(filteredDatasets[0]?.id || '');
  }, [filteredDatasets, selectedDataset]);
  useEffect(() => {
    if (horizonFilter !== 'all' && !horizonOptions.some((option) => option.key === horizonFilter)) setHorizonFilter('all');
    if (assetFilter !== 'all' && !assetOptions.some((option) => option.asset_symbol === assetFilter)) setAssetFilter('all');
  }, [horizonOptions, assetOptions, horizonFilter, assetFilter]);

  function toggleDataset(id:string) { setSelectedDatasets((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current,id]); }
  function toggleModel(model:ModelKey) { setModels((current) => current.includes(model) ? current.filter((item) => item !== model) : [...current,model]); }
  function selectFilteredDatasets() {
    if (allFilteredSelected) {
      const visibleIds = new Set(filteredDatasets.map((dataset) => dataset.id));
      setSelectedDatasets((current) => current.filter((id) => !visibleIds.has(id)));
      return;
    }
    setSelectedDatasets((current) => Array.from(new Set([...current, ...filteredDatasets.map((dataset) => dataset.id)])));
  }
  function clearDatasetSelection() { setSelectedDatasets([]); }
  function selectAllModels() { setModels(models.length === ALL_MODELS.length ? [] : ALL_MODELS); }

  async function startSingle() {
    if (!selectedDataset || !models.length || runningRuns.length || batchActive) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/admin/model-training',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({datasetId:selectedDataset,modelTypes:models})});
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to queue model training.');
      setMessage(`Training job ${data.jobId} queued. The dedicated ML worker will execute it outside the web service.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to queue model training.'); }
    finally { setBusy(false); }
  }

  async function startBatch() {
    if (!selectedDatasets.length || !models.length || runningRuns.length || batchActive) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/admin/model-training/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({datasetIds:selectedDatasets,modelTypes:models,skipCompleted,retryFailed})});
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to start training batch.');
      await loadBatch(String(data.batchId));
      setMessage(`Training plan queued: ${Number(data.totalJobs).toLocaleString()} jobs, ${Number(data.skippedJobs).toLocaleString()} already satisfied.`);
      setSelectedDatasets([]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to start training batch.'); }
    finally { setBusy(false); }
  }

  async function resumeBatch() {
    if (!batch?.batch_id) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/admin/model-training/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resume',batchId:batch.batch_id})});
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to resume training batch.');
      setBatch(data.batch as Batch);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to resume training batch.'); }
    finally { setBusy(false); }
  }

  async function clearFailedHistory() {
    if (runningRuns.length || batchActive || busy || !failedRunCount) return;
    if (!window.confirm('Clear failed training history only? Completed and partial runs, datasets, registered models and artifacts will be preserved.')) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/admin/model-training',{method:'DELETE',headers:{'x-confirm-training-history-reset':'DELETE_TRAINING_HISTORY'}});
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to clear failed training history.');
      setRuns((current) => current.filter((run) => !failureStatus(run.status)));
      setMessage(`Cleared ${Number(data.deletedRuns || 0).toLocaleString()} failed/timed-out training runs and ${Number(data.deletedRunModels || 0).toLocaleString()} failed model-run records. Completed history was preserved.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to clear failed training history.'); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-[#05070b] px-4 py-5 text-slate-100 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1500px]">
    <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:flex-row sm:items-center sm:justify-between"><div><Link href="/admin" className="mb-3 inline-flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300"><ArrowLeft className="h-3.5 w-3.5"/>Back to Operations</Link><div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><BrainCircuit className="h-6 w-6 text-cyan-300"/></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Agenda 6</p><h1 className="text-2xl font-black sm:text-3xl">Model Training Pipeline</h1><p className="mt-1 text-sm text-slate-500">Native training from persisted, leakage-validated datasets.</p></div></div></div><div className="flex gap-2"><button onClick={() => void load()} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Refresh</button><button onClick={() => void clearFailedHistory()} disabled={busy || loading || runningRuns.length > 0 || batchActive || failedRunCount === 0} className="inline-flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-2.5 text-sm font-semibold text-red-200 disabled:opacity-40"><Trash2 className="h-4 w-4"/>Clear Failed{failedRunCount > 0 ? ` (${failedRunCount})` : ''}</button></div></header>

    {error && <div className="mb-5 rounded-2xl border border-red-400/20 bg-red-400/[0.05] p-4 text-sm text-red-200">{error}</div>}
    {message && <div className="mb-5 flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4"/>{message}</div>}

    <section className="mb-6 rounded-3xl border border-cyan-400/15 bg-cyan-400/[0.025] p-5"><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-cyan-300"/><div><h2 className="text-sm font-bold">Training Plan — Multiple Datasets</h2><p className="mt-1 text-xs text-slate-500">Filter by asset and horizon, then select individual datasets or all currently visible eligible datasets.</p></div></div><div className="flex flex-wrap gap-2"><button onClick={selectFilteredDatasets} disabled={!filteredDatasets.length || busy || batchActive} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40">{allFilteredSelected ? 'Clear filtered' : 'Select all filtered'}</button><button onClick={clearDatasetSelection} disabled={!selectedDatasets.length || busy || batchActive} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 disabled:opacity-40">Clear selection</button></div></div>

      <div className="mb-4 grid gap-3 md:grid-cols-2"><label className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Filter className="h-3.5 w-3.5"/>Asset</span><select value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} disabled={busy || batchActive} className="w-full bg-transparent text-sm font-semibold outline-none"><option value="all">All assets</option>{assetOptions.map((asset) => <option key={asset.asset_symbol} value={asset.asset_symbol}>{asset.asset_symbol}</option>)}</select></label><label className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3"><span className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-cyan-300"><Filter className="h-3.5 w-3.5"/>Horizon</span><select value={horizonFilter} onChange={(e) => setHorizonFilter(e.target.value)} disabled={busy || batchActive} className="w-full bg-transparent text-sm font-semibold outline-none"><option value="all">All horizons</option>{horizonOptions.map((option) => <option key={option.key} value={option.key}>{option.label} — {durationText(option.value,option.unit)}</option>)}</select></label></div>

      <div className="mb-4 flex flex-wrap gap-2"><button onClick={() => setHorizonFilter('all')} disabled={busy || batchActive} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${horizonFilter === 'all' ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' : 'border-white/10 bg-black/20 text-slate-500'}`}>All</button>{horizonOptions.map((option) => <button key={option.key} onClick={() => setHorizonFilter(option.key)} disabled={busy || batchActive} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${horizonFilter === option.key ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' : 'border-white/10 bg-black/20 text-slate-500'}`}>{option.label}</button>)}</div>

      <div className="mb-3 flex items-center justify-between text-[11px] text-slate-500"><span>Showing <strong className="text-slate-300">{filteredDatasets.length}</strong> of {readyDatasets.length} eligible datasets</span><span>Selected <strong className="text-cyan-200">{selectedDatasets.length}</strong></span></div>
      {filteredDatasets.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">No eligible datasets match the current filters.</div> : <div className="grid max-h-72 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">{filteredDatasets.map((dataset) => <button key={dataset.id} onClick={() => toggleDataset(dataset.id)} disabled={busy || batchActive} className={`flex items-center justify-between rounded-xl border px-3 py-3 text-left ${selectedDatasets.includes(dataset.id) ? 'border-cyan-400/25 bg-cyan-400/[0.08]' : 'border-white/10 bg-black/20'}`}><span><span className="block text-xs font-bold">{dataset.asset_symbol} · {durationText(dataset.duration_value,dataset.duration_unit)}</span><span className="mt-1 block text-[10px] text-slate-500">{dataset.sample_count.toLocaleString()} samples · {dataset.horizon_ticks.toLocaleString()} ticks</span></span>{selectedDatasets.includes(dataset.id) ? <CheckCircle2 className="h-4 w-4 text-emerald-300"/> : <XCircle className="h-4 w-4 text-slate-700"/>}</button>)}</div>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs"><input type="checkbox" checked={skipCompleted} onChange={(e) => setSkipCompleted(e.target.checked)} disabled={busy || batchActive}/><span><strong>Skip completed</strong><span className="block text-[10px] text-slate-500">Do not retrain compatible registered models.</span></span></label><label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs"><input type="checkbox" checked={retryFailed} onChange={(e) => setRetryFailed(e.target.checked)} disabled={busy || batchActive}/><span><strong>Retry failed</strong><span className="block text-[10px] text-slate-500">Leave failed models eligible for a future plan.</span></span></label><div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3"><span className="block text-[10px] uppercase text-slate-600">Datasets</span><strong className="text-lg">{selectedDatasets.length}</strong></div><div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.05] px-3 py-3"><span className="block text-[10px] uppercase text-slate-600">Estimated jobs</span><strong className="text-lg text-cyan-200">{estimatedJobs.toLocaleString()}</strong></div></div><button onClick={() => void startBatch()} disabled={!selectedDatasets.length || !models.length || busy || batchActive || runningRuns.length > 0 || loading} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50"><Play className="h-4 w-4"/>{busy ? 'Working…' : `Train ${selectedDatasets.length} dataset${selectedDatasets.length === 1 ? '' : 's'} × ${models.length} model${models.length === 1 ? '' : 's'}`}</button>
    </section>

    {batch && <section className="mb-6 rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-bold">Training Plan Status</h2><p className="mt-1 font-mono text-[10px] text-slate-600">{batch.batch_id}</p></div><div className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusClass(batch.status)}`}>{batch.status.toUpperCase()}</div></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><div><span className="block text-[10px] uppercase text-slate-600">Jobs</span><strong>{batch.total_jobs}</strong></div><div><span className="block text-[10px] uppercase text-slate-600">Completed</span><strong className="text-emerald-300">{batch.completed_jobs}</strong></div><div><span className="block text-[10px] uppercase text-slate-600">Failed</span><strong className="text-red-300">{batch.failed_jobs}</strong></div><div><span className="block text-[10px] uppercase text-slate-600">Skipped</span><strong>{batch.skipped_jobs}</strong></div></div><div className="mt-4 h-2 rounded-full bg-white/5"><div className="h-full rounded-full bg-cyan-400" style={{width:`${batch.total_jobs ? Math.min(100,((batch.completed_jobs + batch.failed_jobs)/batch.total_jobs)*100) : 100}%`}}/></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{batch.items.map((item) => <div key={item.dataset_id} className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="flex justify-between gap-2"><span className="text-xs font-semibold">{item.asset_symbol || item.dataset_id}</span><span className={`text-[10px] font-bold ${item.status === 'completed' ? 'text-emerald-300' : item.status === 'failed' || item.status === 'partial' ? 'text-red-300' : 'text-cyan-300'}`}>{item.status}</span></div><p className="mt-1 text-[10px] text-slate-500">{item.duration_value != null ? durationText(Number(item.duration_value),String(item.duration_unit)) : 'dataset'}</p>{item.error && <p className="mt-2 text-[10px] text-red-300">{item.error}</p>}</div>)}</div>{['queued','partial'].includes(batch.status) && <button onClick={() => void resumeBatch()} disabled={busy} className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] px-4 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40">Resume batch</button>}</section>}

    <section className="mb-6 grid gap-4 lg:grid-cols-[1fr_.9fr]"><article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-4 flex items-center gap-2 text-sm font-bold text-cyan-300"><Database className="h-4 w-4"/>Single Dataset</div><select value={selectedDataset} onChange={(e) => setSelectedDataset(e.target.value)} disabled={busy || batchActive} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm"><option value="">Select a completed dataset</option>{filteredDatasets.map((d) => <option key={d.id} value={d.id}>{d.asset_symbol} · {durationText(d.duration_value,d.duration_unit)} · {d.sample_count.toLocaleString()} samples</option>)}</select>{selected && filteredDatasets.some((d) => d.id === selected.id) && <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="block text-[10px] uppercase text-slate-600">Horizon</span><strong>{durationText(selected.duration_value,selected.duration_unit)}</strong></div><div className="rounded-xl border border-emerald-400/10 bg-emerald-400/[0.03] p-3"><span className="block text-[10px] uppercase text-slate-600">Leakage</span><strong className="text-emerald-300">PASSED</strong></div></div>}<button onClick={() => void startSingle()} disabled={!selectedDataset || !models.length || busy || batchActive || runningRuns.length > 0 || loading || !filteredDatasets.some((d) => d.id === selectedDataset)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-4 py-3 text-sm font-semibold text-cyan-200 disabled:opacity-40"><Play className="h-4 w-4"/>Queue selected dataset</button></article>

    <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-bold">Production Candidate Models</h2><p className="mt-1 text-xs text-slate-500">Transformer is isolated in the Experimental Lab.</p></div><button onClick={selectAllModels} disabled={busy || batchActive} className="text-xs font-semibold text-cyan-300">{models.length === ALL_MODELS.length ? 'Clear' : 'Select all'}</button></div><div className="grid gap-2 sm:grid-cols-2">{ALL_MODELS.map((model) => <button key={model} onClick={() => toggleModel(model)} disabled={busy || batchActive} className={`flex items-center justify-between rounded-xl border px-3 py-3 text-left text-xs ${models.includes(model) ? 'border-cyan-400/20 bg-cyan-400/[0.06]' : 'border-white/10 bg-black/20 text-slate-500'}`}><span>{MODEL_LABELS[model]}</span>{models.includes(model) ? <CheckCircle2 className="h-4 w-4 text-emerald-300"/> : <XCircle className="h-4 w-4"/>}</button>)}</div></article></section>

    <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-bold">Training Run History</h2><p className="mt-1 text-xs text-slate-500">Persisted status, metrics, errors, heartbeats and dataset lineage. Completed and partial runs are retained for auditability.</p></div><div className="text-right text-xs text-slate-600"><span>{runs.length} runs</span>{failedRunCount > 0 && <span className="ml-2 text-red-300">· {failedRunCount} failed</span>}</div></div>{runs.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">No training runs yet.</div> : <div className="space-y-3">{runs.map((run) => <article key={run.run_id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between"><div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusClass(run.status)}`}>{run.status.toUpperCase()}</span><span className="ml-2 text-xs font-bold">{run.asset_symbol} · {durationText(run.duration_value,run.duration_unit)}</span><p className="mt-2 font-mono text-[10px] text-slate-600">{run.run_id}</p></div><div className="text-xs text-slate-500">{run.completed_models}/{run.requested_models.length} completed · {run.failed_models} failed</div></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{run.models.map((model) => <div key={model.model_type} className="rounded-xl border border-white/5 bg-white/[0.02] p-3"><div className="flex justify-between gap-2"><span className="text-xs font-semibold">{MODEL_LABELS[model.model_type as ModelKey] || model.model_type}</span><span className="text-[10px] font-bold text-slate-500">{model.status}</span></div>{model.status === 'completed' ? <p className="mt-2 text-[10px] text-slate-500">Accuracy: <span className="text-slate-300">{metric(model.metrics)}</span></p> : model.error ? <p className="mt-2 text-[10px] text-red-300">{model.error}</p> : <p className="mt-2 text-[10px] text-slate-600">Waiting / running</p>}</div>)}</div></article>)}</div>}</section>

    <div className="mt-5 flex items-center gap-2 text-[11px] text-slate-600"><ShieldCheck className="h-3.5 w-3.5"/>Candidate models are not automatically promoted to production.</div>
  </div></main>;
}
