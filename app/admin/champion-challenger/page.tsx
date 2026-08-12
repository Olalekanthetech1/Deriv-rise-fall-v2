'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Crown, RefreshCw, ShieldAlert, Trophy } from 'lucide-react';

type Model = {
  model_id?: string;
  symbol?: string;
  horizon_secs?: number;
  status?: string;
  model_name?: string;
  raw_model_family?: string;
  trained_at?: string;
  metrics?: Record<string, unknown> | null;
};

function metric(model: Model, key: string): number | null {
  const value = model.metrics?.[key];
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value: number | null) { return value == null ? '—' : `${value.toFixed(2)}%`; }

export default function ChampionChallengerPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/ml/registry', { cache: 'no-store' });
      if (response.status === 401) { window.location.replace('/admin'); return; }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Registry returned HTTP ${response.status}.`);
      setModels(Array.isArray(body.models) ? body.models : []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load model registry.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, Model[]>();
    for (const model of models) {
      const key = `${model.symbol || 'UNKNOWN'} · ${model.horizon_secs || '—'}s`;
      const list = map.get(key) || []; list.push(model); map.set(key, list);
    }
    return Array.from(map.entries());
  }, [models]);

  const promote = async (model: Model) => {
    if (!model.model_id || !model.symbol || !model.horizon_secs) return;
    if (!window.confirm(`Promote ${model.model_id} to production for ${model.symbol} / ${model.horizon_secs}s? The server will enforce lifecycle and lineage gates.`)) return;
    setBusy(model.model_id); setMessage(null); setError(null);
    try {
      const response = await fetch('/api/ml/registry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'promote', modelId: model.model_id, symbol: model.symbol, horizonSecs: model.horizon_secs }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) throw new Error(body.error || `Promotion returned HTTP ${response.status}.`);
      setMessage(`${model.model_id} promoted successfully.`); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Promotion failed.'); }
    finally { setBusy(null); }
  };

  return <main className="min-h-screen bg-[#05070b] text-slate-100"><div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
    <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3"><Trophy className="h-6 w-6 text-amber-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-300">Model Operations · Governance</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Champion / Challenger</h1><p className="mt-1 text-xs text-slate-500">Compare persisted candidates against production models and promote only through server-side lifecycle gates.</p></div></div><div className="flex flex-wrap gap-2"><Link href="/admin/models" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300"><ArrowLeft className="h-4 w-4" />Model Operations</Link><button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button></div></header>
    {error && <div className="mb-4 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200">{error}</div>}
    {message && <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-200">{message}</div>}
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><p className="text-xs text-slate-500">Registered models</p><p className="mt-1 text-2xl font-black">{models.length}</p></div><div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.03] p-4"><p className="text-xs text-slate-500">Production</p><p className="mt-1 text-2xl font-black text-emerald-200">{models.filter(m => m.status === 'production').length}</p></div><div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.03] p-4"><p className="text-xs text-slate-500">Candidates / staging</p><p className="mt-1 text-2xl font-black text-amber-200">{models.filter(m => ['candidate','staging'].includes(String(m.status).toLowerCase())).length}</p></div></div>
    {loading && !models.length ? <div className="p-12 text-center text-slate-500">Loading live model registry…</div> : !grouped.length ? <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-12 text-center"><ShieldAlert className="mx-auto h-8 w-8 text-slate-700" /><p className="mt-3 text-sm font-semibold text-slate-400">No persisted registry models available.</p><p className="mt-1 text-xs text-slate-600">No synthetic candidates are created by this page.</p></div> : <div className="space-y-5">{grouped.map(([key, list]) => { const production = list.find(m => m.status === 'production'); const challengers = list.filter(m => ['candidate','staging'].includes(String(m.status).toLowerCase())); return <section key={key} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]"><div className="border-b border-white/10 p-4"><h2 className="font-bold">{key}</h2><p className="mt-1 text-xs text-slate-500">Persisted lineage comparison · no client-side promotion bypass</p></div><div className="grid gap-4 p-4 lg:grid-cols-2">{production && <article className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4"><div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300"><Crown className="h-3.5 w-3.5" />Champion</span><span className="text-[10px] text-slate-500">{production.status}</span></div><h3 className="mt-3 font-bold">{production.model_name || production.raw_model_family || production.model_id}</h3><p className="mt-1 text-xs font-mono text-slate-600">{production.model_id}</p><div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-black/20 p-3"><span className="text-slate-500">Accuracy</span><strong className="ml-2">{pct(metric(production,'accuracy'))}</strong></div><div className="rounded-lg bg-black/20 p-3"><span className="text-slate-500">F1</span><strong className="ml-2">{metric(production,'f1')?.toFixed(3) || '—'}</strong></div></div></article>}
        <div className="space-y-3">{challengers.length ? challengers.map(challenger => <article key={challenger.model_id} className="rounded-xl border border-amber-400/15 bg-amber-400/[0.025] p-4"><div className="flex items-center justify-between gap-3"><div><span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Challenger · {challenger.status}</span><h3 className="mt-2 font-bold">{challenger.model_name || challenger.raw_model_family || challenger.model_id}</h3><p className="mt-1 text-xs font-mono text-slate-600">{challenger.model_id}</p></div><button onClick={() => void promote(challenger)} disabled={busy === challenger.model_id} className="rounded-xl bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50">{busy === challenger.model_id ? 'Promoting…' : 'Promote'}</button></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-black/20 p-3"><span className="text-slate-500">Accuracy</span><strong className="ml-2">{pct(metric(challenger,'accuracy'))}</strong></div><div className="rounded-lg bg-black/20 p-3"><span className="text-slate-500">F1</span><strong className="ml-2">{metric(challenger,'f1')?.toFixed(3) || '—'}</strong></div></div></article>) : <div className="rounded-xl border border-white/10 p-6 text-center text-xs text-slate-600">No candidate or staging challenger for this asset/horizon.</div>}</div></div></section>; })}</div>}
    <footer className="mt-5 rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.02] p-4 text-xs leading-5 text-slate-500"><strong className="text-cyan-300">Governance:</strong> this UI never promotes a model based solely on displayed metrics. The production API validates persisted model lineage, symbol, horizon, lifecycle tier and promotable status before changing production state.</footer>
  </div></main>;
}
