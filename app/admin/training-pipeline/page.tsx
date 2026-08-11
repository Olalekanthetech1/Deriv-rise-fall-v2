'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BrainCircuit, CheckCircle2, Database, Layers3, Play, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react';

type ModelKey = 'xgboost'|'lightgbm'|'catboost'|'tcn'|'lstm'|'transformer'|'hmm'|'isolation_forest';
type Dataset = { id:string; name:string; asset_symbol:string; duration_value:number; duration_unit:string; duration_seconds:number|null; horizon_ticks:number; status:string; leakage_check_passed:boolean; sample_count:number; train_count:number; validation_count:number; test_count };
type ModelRun = { model_type:string; status:string; model_id?:string; metrics?:Record<string,unknown>; error?:string; heartbeat_at?:string|null };
type Run = { run_id:string; dataset_id:string; asset_symbol:string; duration_value:number; duration_unit:string; duration_seconds:number|null; horizon_ticks:number; status:string; completed_models:number; failed_models:number; requested_models:ModelKey[]; models:ModelRun[]; created_at:string; completed_at?:string|null; heartbeat_at?:string|null; worker_id?:string|null };
type Batch = { batch_id:string; status:string; requested_datasets:number; requested_models:number; total_jobs:number; completed_jobs:number; failed_jobs:number; skipped_jobs:number; started_at?:string|null; completed_at?:string|null; heartbeat_at?:string|null; error?:string|null; items:Array<{dataset_id:string;status:string;requested_models:ModelKey[];skipped_models:ModelKey[];completed_models:number;failed_models:number;asset_symbol?:string;duration_value?:number;duration_unit?:string;horizon_ticks?:number;run_id?:string}> };

const MODEL_LABELS: Record<ModelKey,string> = { xgboost:'XGBoost', lightgbm:'LightGBM', catboost:'CatBoost', tcn:'TCN', lstm:'LSTM / GRU', transformer:'Transformer', hmm:'HMM Regime', isolation_forest:'Isolation Forest' };
const ALL_MODELS = Object.keys(MODEL_LABELS) as ModelKey[];
const UNIT_LABELS: Record<string,string> = { t:'ticks', s:'seconds', m:'minutes', h:'hours', d:'days' };

function durationText(value:number, unit:string) { return `${value} ${UNIT_LABELS[unit] || unit}`; }
function metric(metrics?:Record<string,unknown>) { const value = Number(metrics?.accuracy); return Number.isFinite(value) ? `${value.toFixed(2)}%` : '—'; }
function runStatusClass(status:string) {
  if (status === 'completed') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
  if (status === 'partial') return 'border-amber-400/20 bg-amber-400/10 text-amber-200';
  if (status === 'failed' || status === 'timed_out') return 'border-red-400/20 bg-red-400/10 text-red-200';
  return 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200';
}
function modelStatusClass(status:string) {
  if (status === 'completed') return 'text-emerald-300';
  if (status === 'failed' || status === 'timed_out') return 'text-red-300';
  if (status === 'cancelled') return 'text-slate-500';
  return 'text-cyan-300';
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
  const [training,setTraining] = useState(false);
  const [batchStarting,setBatchStarting] = useState(false);
  const [clearing,setClearing] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [message,setMessage] = useState<string|null>(null);

  const selected = useMemo(() => datasets.find((d) => d.id === selectedDataset), [datasets,selectedDataset]);
  const readyDatasets = useMemo(() => datasets.filter((d) => d.status === 'completed' && d.leakage_check_passed), [datasets]);
  const runningRuns = useMemo(() => runs.filter((run) => run.status === 'running'), [runs]);
  const batchActive = Boolean(batch && ['queued','running','partial'].includes(batch.status));
  const canClearHistory = !loading && !training && !batchStarting && !clearing && runningRuns.length === 0 && !batchActive;
  const estimatedJobs = selectedDatasets.length * models.length;

  async function load() {
    setLoading(true); setError(null);
    try {
      const [datasetResponse,runResponse] = await Promise.all([
        fetch('/api/admin/datasets?eligibleForTraining=1',{cache:'no-store'}),
        fetch('/api/admin/model-training',{cache:'no-store'}),
      ]);
      const datasetData = await datasetResponse.json().catch(()=>({}));
      const runData = await runResponse.json().catch(()=>({}));
      if (!datasetResponse.ok) throw new Error(datasetData?.error || 'Unable to load training datasets.');
      if (!runResponse.ok) throw new Error(runData?.error || 'Unable to load training runs.');
      const nextDatasets = Array.isArray(datasetData?.datasets) ? datasetData.datasets : [];
      setDatasets(nextDatasets);
      setRuns(Array.isArray(runData?.runs) ? runData.runs : []);
      setSelectedDataset((current) => current && nextDatasets.some((d:Dataset)=>d.id===current) ? current : nextDatasets[0]?.id || '');
      setSelectedDatasets((current) => current.filter((id) => nextDatasets.some((d:Dataset)=>d.id===id)));
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load model training operations.'); }
    finally { setLoading(false); }
  }

  async function loadBatch(batchId:string) {
    try {
      const response = await fetch(`/api/admin/model-training/batch?batchId=${encodeURIComponent(batchId)}`,{cache:'no-store'});
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load training batch.');
      setBatch(data.batch);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load training batch.');
    }
  }

  useEffect(()=>{ void load(); },[]);
  useEffect(()=>{
    if (!runningRuns.length && !batchActive) return;
    const timer = setInterval(() => { void load(); if (batch?.batch_id) void loadBatch(batch.batch_id); }, 5000);
    return () => clearInterval(timer);
  },[runningRuns.length,batchActive,batch?.batch_id]);

  function toggleModel(model:ModelKey) { setModels((current)=>current.includes(model)?current.filter((m)=>m!==model):[...current,model]); }
  function toggleDataset(datasetId:string) { setSelectedDatasets((current)=>current.includes(datasetId)?current.filter((id)=>id!==datasetId):[...current,datasetId]); }
  function selectAllDatasets() { setSelectedDatasets(selectedDatasets.length === readyDatasets.length ? [] : readyDatasets.map((d)=>d.id)); }

  async function startTraining() {
    if (!selectedDataset || !models.length) return;
    setTraining(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/admin/model-training',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({datasetId:selectedDataset,modelTypes:models})});
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Model training failed.');
      setMessage(`Training run ${data.runId} finished with ${data.completedModels}/${data.totalModels} models completed.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Model training failed.'); await load(); }
    finally { setTraining(false); }
  }

  async function startBatch() {
    if (!selectedDatasets.length || !models.length) return;
    if (runningRuns.length || batchActive) return;
    setBatchStarting(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/admin/model-training/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({datasetIds:selectedDatasets,modelTypes:models,skipCompleted,retryFailed})});
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to start training batch.');
      setMessage(`Training plan ${data.batchId} queued: ${Number(data.totalJobs).toLocaleString()} training jobs, ${Number(data.skippedJobs).toLocaleString()} already satisfied.`);
      setSelectedDatasets([]);
      await loadBatch(data.batchId);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to start training batch.'); }
    finally { setBatchStarting(false); }
  }

  async function resumeBatch() {
    if (!batch?.batch_id) return;
    try {
      const response = await fetch('/api/admin/model-training/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resume',batchId:batch.batch_id})});
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to resume training batch.');
      setBatch(data.batch);
      setMessage(`Training batch ${batch.batch_id} resume requested.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to resume training batch.'); }
  }

  async function clearHistory() {
    if (!canClearHistory) return;
    const confirmed = window.confirm('Clear all training run history? This deletes only ml_training_runs and its run-model records. Datasets, samples, registered models, artifacts, market data and configuration will be kept.');
    if (!confirmed) return;
    setClearing(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/admin/model-training',{method:'DELETE',headers:{'x-confirm-training-history-reset':'DELETE_TRAINING_HISTORY','cache-control':'no-cache'}});
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to clear training history.');
      setRuns([]); setMessage(`Training history cleared: ${Number(data.deletedRuns || 0).toLocaleString()} runs and ${Number(data.deletedRunModels || 0).toLocaleString()} model-run records removed. Datasets and models were preserved.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to clear training history.'); await load(); }
    finally { setClearing(false); }
  }

  return <main className="min-h-screen bg-[#05070b] px-4 py-5 text-slate-100 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1500px]">
    <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between"><div><Link href="/admin" className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-300"><ArrowLeft className="h-3.5 w-3.5"/>Back to Operations</Link><div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><BrainCircuit className="h-6 w-6 text-cyan-300"/></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Agenda 6</p><h1 className="text-2xl font-black sm:text-3xl">Model Training Pipeline</h1><p className="mt-1 text-sm text-slate-500">Native eight-model training from persisted, leakage-validated Deriv datasets.</p></div></div></div><div className="flex flex-wrap items-center gap-2"><button onClick={()=>void load()} disabled={loading||training||batchStarting||clearing} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>Refresh</button><button onClick={()=>void clearHistory()} disabled={!canClearHistory} title={batchActive?'Finish the training plan before clearing history.':'Clear persisted training run history'} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-4 py-2.5 text-sm font-semibold text-red-200 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-4 w-4"/>{clearing?'Clearing…':'Clear History'}</button></div></header>

    {runningRuns.length>0 && <div className="mb-5 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-sm text-amber-100"><strong>Training is actively observable.</strong> {runningRuns.length} run{runningRuns.length===1?' is':'s are'} running. Heartbeats are persisted and stale workers are automatically reconciled.</div>}
    {error && <div className="mb-5 rounded-2xl border border-red-400/20 bg-red-400/[0.05] p-4 text-sm text-red-200">{error}</div>}
    {message && <div className="mb-5 flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4"/>{message}</div>}

    <section className="mb-6 rounded-3xl border border-cyan-400/15 bg-cyan-400/[0.025] p-5"><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-cyan-300"/><div><h2 className="text-sm font-bold">Training Plan — Multiple Datasets</h2><p className="mt-1 text-xs text-slate-500">Select one, several, or all completed datasets. Existing compatible models can be skipped automatically.</p></div></div><button onClick={selectAllDatasets} disabled={!readyDatasets.length||training||batchStarting||clearing||batchActive} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40">{selectedDatasets.length===readyDatasets.length&&readyDatasets.length?'Clear all':'Select all'}</button></div>
      <div className="grid max-h-72 gap-2 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">{readyDatasets.map((dataset)=><button key={dataset.id} onClick={()=>toggleDataset(dataset.id)} disabled={training||batchStarting||clearing||batchActive} className={`flex items-center justify-between rounded-xl border px-3 py-3 text-left transition ${selectedDatasets.includes(dataset.id)?'border-cyan-400/25 bg-cyan-400/[0.08]':'border-white/10 bg-black/20 hover:border-white/20'}`}><span><span className="block text-xs font-bold text-slate-100">{dataset.asset_symbol} · {durationText(Number(dataset.duration_value),dataset.duration_unit)}</span><span className="mt-1 block text-[10px] text-slate-500">{Number(dataset.sample_count).toLocaleString()} samples · {Number(dataset.horizon_ticks).toLocaleString()} ticks</span></span>{selectedDatasets.includes(dataset.id)?<CheckCircle2 className="h-4 w-4 text-emerald-300"/>:<XCircle className="h-4 w-4 text-slate-700"/>}</button>)}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs"><input type="checkbox" checked={skipCompleted} onChange={(e)=>setSkipCompleted(e.target.checked)} disabled={batchStarting||batchActive} className="accent-cyan-400"/><span><strong className="text-slate-200">Skip completed</strong><span className="mt-0.5 block text-[10px] text-slate-500">Do not retrain an existing compatible model.</span></span></label><label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs"><input type="checkbox" checked={retryFailed} onChange={(e)=>setRetryFailed(e.target.checked)} disabled={batchStarting||batchActive} className="accent-cyan-400"/><span><strong className="text-slate-200">Retry failed</strong><span className="mt-0.5 block text-[10px] text-slate-500">Leave failed models eligible for another training plan.</span></span></label><div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs"><span className="block text-[10px] uppercase tracking-wider text-slate-600">Datasets</span><strong className="mt-1 block text-slate-100">{selectedDatasets.length}</strong></div><div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.05] px-3 py-3 text-xs"><span className="block text-[10px] uppercase tracking-wider text-slate-600">Estimated jobs</span><strong className="mt-1 block text-cyan-200">{estimatedJobs.toLocaleString()}</strong></div></div>
      <button onClick={()=>void startBatch()} disabled={!selectedDatasets.length||!models.length||batchStarting||batchActive||runningRuns.length>0||loading||training||clearing} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{batchStarting?<RefreshCw className="h-4 w-4 animate-spin"/>:<Play className="h-4 w-4"/>}{batchStarting?'Creating training plan…':batchActive?'Training plan is active':`Train ${selectedDatasets.length} dataset${selectedDatasets.length===1?'':'s'} × ${models.length} model${models.length===1?'':'s'}`}</button>
    </section>

    {batch && <section className="mb-6 rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-cyan-300"/><h2 className="text-sm font-bold">Active Training Plan</h2><span className={`rounded-full border px-2 py-1 text-[9px] font-bold ${runStatusClass(batch.status)}`}>{String(batch.status).toUpperCase()}</span></div><p className="mt-1 font-mono text-[10px] text-slate-600">{batch.batch_id}</p></div>{['queued','partial'].includes(batch.status)&&<button onClick={()=>void resumeBatch()} className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] px-3 py-2 text-xs font-semibold text-cyan-200">Resume</button>}</div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="block text-[10px] uppercase text-slate-600">Requested jobs</span><strong className="mt-1 block">{Number(batch.total_jobs).toLocaleString()}</strong></div><div className="rounded-xl border border-emerald-400/10 bg-emerald-400/[0.03] p-3"><span className="block text-[10px] uppercase text-slate-600">Completed</span><strong className="mt-1 block text-emerald-300">{Number(batch.completed_jobs).toLocaleString()}</strong></div><div className="rounded-xl border border-red-400/10 bg-red-400/[0.03] p-3"><span className="block text-[10px] uppercase text-slate-600">Failed</span><strong className="mt-1 block text-red-300">{Number(batch.failed_jobs).toLocaleString()}</strong></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="block text-[10px] uppercase text-slate-600">Skipped</span><strong className="mt-1 block">{Number(batch.skipped_jobs).toLocaleString()}</strong></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-cyan-400 transition-all" style={{width:`${batch.total_jobs ? Math.min(100,((Number(batch.completed_jobs)+Number(batch.failed_jobs))/Number(batch.total_jobs))*100):100}%`}}/></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(batch.items||[]).map((item)=><div key={item.dataset_id} className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{item.asset_symbol || item.dataset_id}</span><span className={`text-[10px] font-bold ${modelStatusClass(item.status)}`}>{item.status}</span></div><p className="mt-1 text-[10px] text-slate-500">{item.duration_value != null ? durationText(Number(item.duration_value),String(item.duration_unit)) : 'dataset'}</p>{item.error&&<p className="mt-2 break-words text-[10px] text-red-300">{String(item.error)}</p>}</div>)}</div></section>}

    <section className="mb-6 grid gap-4 lg:grid-cols-[1fr_.9fr]">
      <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-5 flex items-center gap-2 text-sm font-bold text-cyan-300"><Database className="h-4 w-4"/>Single training source</div><label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Completed dataset</span><select value={selectedDataset} onChange={(e)=>setSelectedDataset(e.target.value)} disabled={training||batchActive||clearing} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-400/50"><option value="">Select a completed dataset</option>{readyDatasets.map((d)=><option key={d.id} value={d.id}>{d.asset_symbol} · {durationText(Number(d.duration_value),d.duration_unit)} · {Number(d.sample_count).toLocaleString()} samples</option>)}</select></label>{selected && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-600">Horizon</span><span className="mt-1 block text-sm font-bold">{durationText(Number(selected.duration_value),selected.duration_unit)}</span></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-600">Effective ticks</span><span className="mt-1 block text-sm font-bold">{Number(selected.horizon_ticks).toLocaleString()}</span></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-600">Train</span><span className="mt-1 block text-sm font-bold">{Number(selected.train_count).toLocaleString()}</span></div><div className="rounded-xl border border-emerald-400/10 bg-emerald-400/[0.03] p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-600">Leakage</span><span className="mt-1 block text-sm font-bold text-emerald-300">PASSED</span></div></div>}<div className="mt-4 rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.03] p-4 text-xs leading-5 text-slate-400"><strong className="text-slate-200">Boundary:</strong> training consumes only the persisted dataset. No direct live-tick training, synthetic fallback data, or client-provided feature vectors are accepted.</div></article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-bold">Eight native models</h2><p className="mt-1 text-xs text-slate-500">Shared by single-run and training-plan modes.</p></div><button onClick={()=>setModels(models.length===ALL_MODELS.length?[]:ALL_MODELS)} disabled={training||batchStarting||batchActive||clearing} className="text-xs font-semibold text-cyan-300 disabled:opacity-40">{models.length===ALL_MODELS.length?'Clear':'Select all'}</button></div><div className="grid gap-2 sm:grid-cols-2">{ALL_MODELS.map((model)=><button key={model} onClick={()=>toggleModel(model)} disabled={training||batchStarting||batchActive||clearing} className={`flex items-center justify-between rounded-xl border px-3 py-3 text-left text-xs font-semibold transition ${models.includes(model)?'border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-100':'border-white/10 bg-black/20 text-slate-500'}`}><span>{MODEL_LABELS[model]}</span>{models.includes(model)?<CheckCircle2 className="h-4 w-4 text-emerald-300"/>:<XCircle className="h-4 w-4 text-slate-700"/>}</button>)}</div><button onClick={()=>void startTraining()} disabled={!selectedDataset||!models.length||training||batchStarting||batchActive||clearing||loading||runningRuns.length>0} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{training?<RefreshCw className="h-4 w-4 animate-spin"/>:<Play className="h-4 w-4"/>}{training?'Training native models…':batchActive?'Training plan is active':runningRuns.length?'Another training run is active':`Train ${models.length} selected model${models.length===1?'':'s'}`}</button></article>
    </section>

    <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-5 flex items-end justify-between"><div><h2 className="text-lg font-bold">Training run history</h2><p className="mt-1 text-xs text-slate-500">Every model attempt is persisted with status, metrics, error, heartbeat and dataset lineage.</p></div><span className="text-xs text-slate-600">{runs.length} runs</span></div>{runs.length===0?<div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">No training runs yet.</div>:<div className="space-y-3">{runs.map((run)=><article key={run.run_id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wider ${runStatusClass(run.status)}`}>{run.status.toUpperCase()}</span><span className="text-xs font-bold text-slate-200">{run.asset_symbol} · {durationText(Number(run.duration_value),run.duration_unit)}</span></div><p className="mt-2 font-mono text-[10px] text-slate-600">{run.run_id}</p></div><div className="text-left text-xs text-slate-500 lg:text-right"><p>{run.completed_models}/{run.requested_models?.length || 0} completed · {run.failed_models} failed</p><p className="mt-1">{new Date(run.created_at).toLocaleString()}</p>{run.status==='running'&&run.heartbeat_at&&<p className="mt-1 text-cyan-300">Heartbeat: {new Date(run.heartbeat_at).toLocaleTimeString()}</p>}</div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{(run.models||[]).map((model)=><div key={model.model_type} className="rounded-xl border border-white/5 bg-white/[0.02] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{MODEL_LABELS[model.model_type as ModelKey] || model.model_type}</span><span className={`text-[10px] font-bold ${modelStatusClass(model.status)}`}>{model.status}</span></div>{model.status==='completed'?<p className="mt-2 text-[11px] text-slate-500">Accuracy: <span className="text-slate-300">{metric(model.metrics)}</span></p>:model.error?<p className="mt-2 break-words text-[10px] text-red-300">{model.error}</p>:<p className="mt-2 text-[10px] text-slate-600">Waiting / running</p>}</div>)}</div></article>)}</div>}</section>

    <div className="mt-5 flex items-center gap-2 text-[11px] text-slate-600"><ShieldCheck className="h-3.5 w-3.5"/>Candidate models are not automatically promoted to production. Promotion remains a separate lifecycle decision.</div>
  </div></main>;
}
