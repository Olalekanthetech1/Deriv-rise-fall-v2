'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BrainCircuit, CheckCircle2, Database, Play, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';

type ModelKey = 'xgboost'|'lightgbm'|'catboost'|'tcn'|'lstm'|'transformer'|'hmm'|'isolation_forest';
type Dataset = { id:string; name:string; asset_symbol:string; duration_value:number; duration_unit:string; duration_seconds:number|null; horizon_ticks:number; status:string; leakage_check_passed:boolean; sample_count:number; train_count:number; validation_count:number; test_count:number };
type ModelRun = { model_type:string; status:string; model_id?:string; metrics?:Record<string,unknown>; error?:string };
type Run = { run_id:string; dataset_id:string; asset_symbol:string; duration_value:number; duration_unit:string; duration_seconds:number|null; horizon_ticks:number; status:string; completed_models:number; failed_models:number; requested_models:ModelKey[]; models:ModelRun[]; created_at:string; completed_at?:string|null };

const MODEL_LABELS: Record<ModelKey,string> = { xgboost:'XGBoost', lightgbm:'LightGBM', catboost:'CatBoost', tcn:'TCN', lstm:'LSTM / GRU', transformer:'Transformer', hmm:'HMM Regime', isolation_forest:'Isolation Forest' };
const ALL_MODELS = Object.keys(MODEL_LABELS) as ModelKey[];
const UNIT_LABELS: Record<string,string> = { t:'ticks', s:'seconds', m:'minutes', h:'hours', d:'days' };

function durationText(value:number, unit:string) { return `${value} ${UNIT_LABELS[unit] || unit}`; }
function metric(metrics?:Record<string,unknown>) { const value = Number(metrics?.accuracy); return Number.isFinite(value) ? `${value.toFixed(2)}%` : '—'; }

export default function TrainingPipelinePage() {
  const [datasets,setDatasets] = useState<Dataset[]>([]);
  const [runs,setRuns] = useState<Run[]>([]);
  const [selectedDataset,setSelectedDataset] = useState('');
  const [models,setModels] = useState<ModelKey[]>(ALL_MODELS);
  const [loading,setLoading] = useState(true);
  const [training,setTraining] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [message,setMessage] = useState<string|null>(null);

  const selected = useMemo(() => datasets.find((d) => d.id === selectedDataset), [datasets,selectedDataset]);
  const readyDatasets = useMemo(() => datasets.filter((d) => d.status === 'completed' && d.leakage_check_passed), [datasets]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [datasetResponse,runResponse] = await Promise.all([fetch('/api/admin/datasets',{cache:'no-store'}),fetch('/api/admin/model-training',{cache:'no-store'})]);
      const datasetData = await datasetResponse.json().catch(()=>({})); const runData = await runResponse.json().catch(()=>({}));
      if (!datasetResponse.ok) throw new Error(datasetData?.error || 'Unable to load training datasets.');
      if (!runResponse.ok) throw new Error(runData?.error || 'Unable to load training runs.');
      const nextDatasets = Array.isArray(datasetData?.datasets) ? datasetData.datasets : [];
      setDatasets(nextDatasets); setRuns(Array.isArray(runData?.runs) ? runData.runs : []);
      setSelectedDataset((current) => current || nextDatasets.find((d:Dataset)=>d.status==='completed' && d.leakage_check_passed)?.id || '');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load model training operations.'); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ void load(); },[]);

  function toggleModel(model:ModelKey) { setModels((current)=>current.includes(model)?current.filter((m)=>m!==model):[...current,model]); }

  async function startTraining() {
    if (!selectedDataset || !models.length) return;
    setTraining(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/admin/model-training',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({datasetId:selectedDataset,modelTypes:models})});
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Model training failed.');
      setMessage(`Training run ${data.runId} finished with ${data.completedModels}/${data.totalModels} models completed.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Model training failed.'); }
    finally { setTraining(false); }
  }

  return <main className="min-h-screen bg-[#05070b] px-4 py-5 text-slate-100 sm:px-6 lg:px-8"><div className="mx-auto max-w-[1500px]">
    <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between"><div><Link href="/admin" className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-300"><ArrowLeft className="h-3.5 w-3.5"/>Back to Operations</Link><div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><BrainCircuit className="h-6 w-6 text-cyan-300"/></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Agenda 6</p><h1 className="text-2xl font-black sm:text-3xl">Model Training Pipeline</h1><p className="mt-1 text-sm text-slate-500">Native eight-model training from persisted, leakage-validated Deriv datasets.</p></div></div></div><button onClick={()=>void load()} disabled={loading||training} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>Refresh</button></header>

    {error && <div className="mb-5 rounded-2xl border border-red-400/20 bg-red-400/[0.05] p-4 text-sm text-red-200">{error}</div>}
    {message && <div className="mb-5 flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4"/>{message}</div>}

    <section className="mb-6 grid gap-4 lg:grid-cols-[1fr_.9fr]">
      <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-5 flex items-center gap-2 text-sm font-bold text-cyan-300"><Database className="h-4 w-4"/>Training source</div><label className="block"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Completed dataset</span><select value={selectedDataset} onChange={(e)=>setSelectedDataset(e.target.value)} disabled={training} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-400/50"><option value="">Select a completed dataset</option>{readyDatasets.map((d)=><option key={d.id} value={d.id}>{d.asset_symbol} · {durationText(Number(d.duration_value),d.duration_unit)} · {Number(d.sample_count).toLocaleString()} samples</option>)}</select></label>{selected && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-600">Horizon</span><span className="mt-1 block text-sm font-bold">{durationText(Number(selected.duration_value),selected.duration_unit)}</span></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-600">Effective ticks</span><span className="mt-1 block text-sm font-bold">{Number(selected.horizon_ticks).toLocaleString()}</span></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-600">Train</span><span className="mt-1 block text-sm font-bold">{Number(selected.train_count).toLocaleString()}</span></div><div className="rounded-xl border border-emerald-400/10 bg-emerald-400/[0.03] p-3"><span className="block text-[10px] uppercase tracking-wider text-slate-600">Leakage</span><span className="mt-1 block text-sm font-bold text-emerald-300">PASSED</span></div></div>}<div className="mt-4 rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.03] p-4 text-xs leading-5 text-slate-400"><strong className="text-slate-200">Boundary:</strong> training consumes only the persisted dataset. No direct live-tick training, synthetic fallback data, or client-provided feature vectors are accepted.</div></article>

      <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-bold">Eight native models</h2><p className="mt-1 text-xs text-slate-500">All are selected by default.</p></div><button onClick={()=>setModels(models.length===ALL_MODELS.length?[]:ALL_MODELS)} className="text-xs font-semibold text-cyan-300">{models.length===ALL_MODELS.length?'Clear':'Select all'}</button></div><div className="grid gap-2 sm:grid-cols-2">{ALL_MODELS.map((model)=><button key={model} onClick={()=>toggleModel(model)} className={`flex items-center justify-between rounded-xl border px-3 py-3 text-left text-xs font-semibold transition ${models.includes(model)?'border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-100':'border-white/10 bg-black/20 text-slate-500'}`}><span>{MODEL_LABELS[model]}</span>{models.includes(model)?<CheckCircle2 className="h-4 w-4 text-emerald-300"/>:<XCircle className="h-4 w-4 text-slate-700"/>}</button>)}</div><button onClick={()=>void startTraining()} disabled={!selectedDataset||!models.length||training||loading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{training?<RefreshCw className="h-4 w-4 animate-spin"/>:<Play className="h-4 w-4"/>}{training?'Training native models…':`Train ${models.length} selected model${models.length===1?'':'s'}`}</button></article>
    </section>

    <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-5 flex items-end justify-between"><div><h2 className="text-lg font-bold">Training run history</h2><p className="mt-1 text-xs text-slate-500">Every model attempt is persisted with status, metrics, error and dataset lineage.</p></div><span className="text-xs text-slate-600">{runs.length} runs</span></div>{runs.length===0?<div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">No training runs yet.</div>:<div className="space-y-3">{runs.map((run)=><article key={run.run_id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wider ${run.status==='completed'?'border-emerald-400/20 bg-emerald-400/10 text-emerald-300':run.status==='partial'?'border-amber-400/20 bg-amber-400/10 text-amber-200':run.status==='failed'?'border-red-400/20 bg-red-400/10 text-red-200':'border-cyan-400/20 bg-cyan-400/10 text-cyan-200'}`}>{run.status.toUpperCase()}</span><span className="text-xs font-bold text-slate-200">{run.asset_symbol} · {durationText(Number(run.duration_value),run.duration_unit)}</span></div><p className="mt-2 font-mono text-[10px] text-slate-600">{run.run_id}</p></div><div className="text-left text-xs text-slate-500 lg:text-right"><p>{run.completed_models}/{run.requested_models?.length || 0} completed · {run.failed_models} failed</p><p className="mt-1">{new Date(run.created_at).toLocaleString()}</p></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{(run.models||[]).map((model)=><div key={model.model_type} className="rounded-xl border border-white/5 bg-white/[0.02] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{MODEL_LABELS[model.model_type as ModelKey] || model.model_type}</span><span className={`text-[10px] font-bold ${model.status==='completed'?'text-emerald-300':model.status==='failed'?'text-red-300':'text-cyan-300'}`}>{model.status}</span></div>{model.status==='completed'?<p className="mt-2 text-[11px] text-slate-500">Accuracy: <span className="text-slate-300">{metric(model.metrics)}</span></p>:model.error?<p className="mt-2 break-words text-[10px] text-red-300">{model.error}</p>:<p className="mt-2 text-[10px] text-slate-600">Waiting / running</p>}</div>)}</div></article>)}</div>}</section>

    <div className="mt-5 flex items-center gap-2 text-[11px] text-slate-600"><ShieldCheck className="h-3.5 w-3.5"/>Candidate models are not automatically promoted to production. Promotion remains a separate lifecycle decision.</div>
  </div></main>;
}
