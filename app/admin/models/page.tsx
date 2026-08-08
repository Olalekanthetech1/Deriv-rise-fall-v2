'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Cpu,
  Database,
  GitBranch,
  History,
  RefreshCw,
  Rocket,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from 'lucide-react';

type RegistryModel = {
  id?: number;
  model_id?: string;
  model_name?: string;
  version?: string;
  symbol?: string;
  horizon_secs?: number;
  format?: string;
  status?: string;
  accuracy?: number | null;
  backtest_win_rate?: number | null;
  backtest_profit_factor?: number | null;
  feature_count?: number | null;
  file_path?: string | null;
  hyperparameters?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

type RegistryResponse = {
  success?: boolean;
  count?: number;
  models?: RegistryModel[];
  dataSource?: string;
  error?: string;
};

function formatMetric(value: number | null | undefined, suffix = '') {
  return Number.isFinite(value) ? `${Number(value).toFixed(2)}${suffix}` : '—';
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function statusTone(status?: string) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'production') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
  if (normalized === 'staging') return 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200';
  return 'border-white/10 bg-white/5 text-slate-300';
}

function statusLabel(status?: string) {
  const value = String(status || '').trim();
  return value ? value.toUpperCase() : 'UNSPECIFIED';
}

export default function ModelOperationsPage() {
  const [models, setModels] = useState<RegistryModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [symbolFilter, setSymbolFilter] = useState('ALL');
  const [selectedModel, setSelectedModel] = useState<RegistryModel | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true);
    setError(null);
    try {
      const response = await fetch('/api/ml/registry', { cache: 'no-store' });
      if (response.status === 401) {
        window.location.replace('/admin');
        return;
      }
      const data: RegistryResponse = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        setModels([]);
        setDataSource(data.dataSource || null);
        setError(data.error || `Model registry returned HTTP ${response.status}.`);
        return;
      }
      setModels(Array.isArray(data.models) ? data.models : []);
      setDataSource(data.dataSource || null);
      setLastRefresh(new Date().toISOString());
    } catch {
      setError('Unable to reach the model registry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const timer = window.setInterval(() => load(false), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const symbols = useMemo(() => Array.from(new Set(models.map((model) => model.symbol).filter(Boolean))).sort(), [models]);

  const filteredModels = useMemo(() => models.filter((model) => {
    const statusMatches = statusFilter === 'ALL' || String(model.status || '').toUpperCase() === statusFilter;
    const symbolMatches = symbolFilter === 'ALL' || model.symbol === symbolFilter;
    return statusMatches && symbolMatches;
  }), [models, statusFilter, symbolFilter]);

  const productionCount = models.filter((model) => String(model.status || '').toLowerCase() === 'production').length;
  const stagingCount = models.filter((model) => String(model.status || '').toLowerCase() === 'staging').length;

  const promote = async (model: RegistryModel) => {
    if (!model.model_id || !model.symbol || !Number.isFinite(model.horizon_secs)) return;
    const confirmed = window.confirm(`Promote ${model.model_id} to production for ${model.symbol} / ${model.horizon_secs}s? The current production model for that symbol and horizon will be moved to staging.`);
    if (!confirmed) return;

    setPromoting(model.model_id);
    setError(null);
    try {
      const response = await fetch('/api/ml/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'promote', modelId: model.model_id, symbol: model.symbol, horizonSecs: model.horizon_secs }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        window.location.replace('/admin');
        return;
      }
      if (!response.ok || !data.success) {
        setError(data.error || 'Model promotion failed.');
        return;
      }
      await load();
      setSelectedModel((current) => current?.model_id === model.model_id ? { ...current, status: 'production', updated_at: data.promotedAt } : current);
    } catch {
      setError('Unable to complete model promotion.');
    } finally {
      setPromoting(null);
    }
  };

  return <main className="min-h-screen bg-[#05070b] text-slate-100">
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><Cpu className="h-6 w-6 text-cyan-300" /></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">5B-4</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Model Operations</h1><p className="mt-1 text-xs text-slate-500">Live model registry, production state, validation evidence and controlled promotion.</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10"><ArrowLeft className="h-4 w-4" />Operations Center</Link>
          <button onClick={() => load()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</button>
        </div>
      </header>

      {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-3 flex items-center justify-between"><Database className="h-5 w-5 text-cyan-300" /><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-bold text-emerald-300">{dataSource === 'live-database' ? 'LIVE DB' : 'UNCONFIRMED'}</span></div><p className="text-xs uppercase tracking-wider text-slate-500">Registered models</p><p className="mt-1 text-2xl font-black">{models.length.toLocaleString()}</p></article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-3 flex items-center justify-between"><Rocket className="h-5 w-5 text-emerald-300" /><span className="text-[10px] font-bold tracking-wider text-slate-500">PERSISTED</span></div><p className="text-xs uppercase tracking-wider text-slate-500">Production records</p><p className="mt-1 text-2xl font-black">{productionCount.toLocaleString()}</p></article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-3 flex items-center justify-between"><GitBranch className="h-5 w-5 text-cyan-300" /><span className="text-[10px] font-bold tracking-wider text-slate-500">REGISTRY</span></div><p className="text-xs uppercase tracking-wider text-slate-500">Staging records</p><p className="mt-1 text-2xl font-black">{stagingCount.toLocaleString()}</p></article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-3 flex items-center justify-between"><Clock3 className="h-5 w-5 text-slate-300" /><span className="text-[10px] font-bold tracking-wider text-slate-500">NO FABRICATION</span></div><p className="text-xs uppercase tracking-wider text-slate-500">Last registry refresh</p><p className="mt-1 text-sm font-bold">{formatDate(lastRefresh || undefined)}</p></article>
      </section>

      <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><h2 className="text-base font-bold">Model Lifecycle</h2><p className="mt-1 text-xs leading-5 text-slate-500">Only lifecycle states currently represented by the registry are treated as factual. Validation and shadow stages are not invented when the backend has no persisted state for them.</p></div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold tracking-wider text-slate-500"><span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-cyan-200">STAGING</span><ChevronRight className="h-3.5 w-3.5" /><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-emerald-300">PRODUCTION</span><ChevronRight className="h-3.5 w-3.5" /><span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">RETIRE / REPLACE</span></div>
        </div>
        <div className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex items-center gap-2 text-xs font-bold"><CircleDot className="h-4 w-4 text-cyan-300" />Registry intake</div><p className="mt-2 text-xs leading-5 text-slate-500">Real trained artifacts and measured metadata enter the registry as persisted records.</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex items-center gap-2 text-xs font-bold"><ShieldCheck className="h-4 w-4 text-emerald-300" />Production promotion</div><p className="mt-2 text-xs leading-5 text-slate-500">Promotion is scoped to a symbol and horizon and demotes the existing production record for that pair.</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex items-center gap-2 text-xs font-bold"><History className="h-4 w-4 text-slate-300" />Rollback</div><p className="mt-2 text-xs leading-5 text-slate-500">Rollback is performed by promoting a previously registered compatible model; no synthetic version is created.</p></div></div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div><h2 className="text-base font-bold">Registry</h2><p className="mt-1 text-xs text-slate-500">Source: {dataSource || 'not confirmed'} · {filteredModels.length} shown</p></div>
          <div className="flex flex-wrap gap-2">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-200 outline-none"><option value="ALL">All statuses</option><option value="PRODUCTION">Production</option><option value="STAGING">Staging</option></select>
            <select value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value)} className="max-w-[220px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-200 outline-none"><option value="ALL">All symbols</option>{symbols.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}</select>
          </div>
        </div>

        {loading ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" />Loading registry…</div> : filteredModels.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 px-5 py-12 text-center"><XCircle className="mx-auto h-7 w-7 text-slate-600" /><p className="mt-3 text-sm font-semibold text-slate-400">No registered models match the current filters.</p><p className="mt-1 text-xs text-slate-600">This is an empty live state; no model data is being fabricated.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left"><thead><tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500"><th className="px-3 py-3">Model</th><th className="px-3 py-3">Symbol</th><th className="px-3 py-3">Horizon</th><th className="px-3 py-3">Format</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Validation</th><th className="px-3 py-3">Backtest</th><th className="px-3 py-3 text-right">Action</th></tr></thead><tbody>{filteredModels.map((model) => <tr key={model.model_id || model.id} className="border-b border-white/5 align-top hover:bg-white/[0.02]">
          <td className="px-3 py-4"><button onClick={() => setSelectedModel(model)} className="text-left"><p className="font-mono text-xs font-bold text-cyan-200 hover:text-cyan-100">{model.model_id || 'Unnamed model'}</p><p className="mt-1 text-[11px] text-slate-500">{model.model_name || '—'} · {model.version || '—'}</p></button></td>
          <td className="px-3 py-4 text-xs font-semibold">{model.symbol || '—'}</td>
          <td className="px-3 py-4 text-xs text-slate-300">{Number.isFinite(model.horizon_secs) ? `${model.horizon_secs}s` : '—'}</td>
          <td className="px-3 py-4 text-xs text-slate-300">{model.format || '—'}</td>
          <td className="px-3 py-4"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wider ${statusTone(model.status)}`}>{statusLabel(model.status)}</span></td>
          <td className="px-3 py-4 text-xs font-semibold">{formatMetric(model.accuracy, '%')}</td>
          <td className="px-3 py-4 text-xs text-slate-300">{formatMetric(model.backtest_win_rate, '%')} <span className="text-slate-600">· PF {formatMetric(model.backtest_profit_factor)}</span></td>
          <td className="px-3 py-4 text-right">{String(model.status || '').toLowerCase() === 'production' ? <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300"><CheckCircle2 className="h-4 w-4" />ACTIVE</span> : <button onClick={() => promote(model)} disabled={promoting === model.model_id} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-60">{promoting === model.model_id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}Promote</button>}</td>
        </tr>)}</tbody></table></div>}
      </section>

      {selectedModel && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedModel(null); }}><aside className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0a0e15] p-5 shadow-2xl sm:rounded-3xl"><div className="mb-5 flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Model details</p><h2 className="mt-1 break-all text-lg font-black">{selectedModel.model_id || 'Unnamed model'}</h2></div><button onClick={() => setSelectedModel(null)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">Close</button></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-[11px] text-slate-500">Model</p><p className="mt-1 text-sm font-semibold">{selectedModel.model_name || '—'} · {selectedModel.version || '—'}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-[11px] text-slate-500">Deployment</p><p className="mt-1 text-sm font-semibold">{selectedModel.symbol || '—'} · {Number.isFinite(selectedModel.horizon_secs) ? `${selectedModel.horizon_secs}s` : '—'} · {selectedModel.format || '—'}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-[11px] text-slate-500">Validation accuracy</p><p className="mt-1 text-sm font-semibold">{formatMetric(selectedModel.accuracy, '%')}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-[11px] text-slate-500">Backtest win rate</p><p className="mt-1 text-sm font-semibold">{formatMetric(selectedModel.backtest_win_rate, '%')}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-[11px] text-slate-500">Profit factor</p><p className="mt-1 text-sm font-semibold">{formatMetric(selectedModel.backtest_profit_factor)}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-[11px] text-slate-500">Features</p><p className="mt-1 text-sm font-semibold">{Number.isFinite(selectedModel.feature_count) ? selectedModel.feature_count : '—'}</p></div></div><div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-[11px] text-slate-500">Artifact</p><p className="mt-1 break-all font-mono text-xs text-slate-300">{selectedModel.file_path || 'No artifact path persisted'}</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-[11px] text-slate-500">Created</p><p className="mt-1 text-xs text-slate-300">{formatDate(selectedModel.created_at)}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-[11px] text-slate-500">Updated</p><p className="mt-1 text-xs text-slate-300">{formatDate(selectedModel.updated_at)}</p></div></div><div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-4"><p className="text-xs font-bold">Operational rule</p><p className="mt-1 text-xs leading-5 text-slate-500">Promotion changes only the persisted registry state. It does not train a model, create an artifact, or manufacture validation/backtest metrics.</p></div></aside></div>}
    </div>
  </main>;
}
