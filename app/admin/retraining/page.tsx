'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarClock, CheckCircle2, Play, RefreshCw, ShieldAlert, Timer, XCircle } from 'lucide-react';

type RetrainingStatus = {
  status?: string;
  scheduleConfigured?: boolean;
  scheduleIntervalMs?: number | null;
  scheduleIntervalHours?: number | null;
  lastTrainedAt?: string | null;
  timeSinceLastTrainMinutes?: number | null;
  isDue?: boolean | null;
  nextScheduledRunInMinutes?: number | null;
  error?: string;
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wider ${ok ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/20 bg-amber-400/10 text-amber-200'}`}>{ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{label}</span>;
}

export default function RetrainingPage() {
  const [data, setData] = useState<RetrainingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [symbol, setSymbol] = useState('ALL_ASSETS');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/ml/cron-retrain', { cache: 'no-store' });
      if (response.status === 401) { window.location.replace('/admin'); return; }
      const body: RetrainingStatus = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Retraining status returned HTTP ${response.status}.`);
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load retraining status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 30000); return () => window.clearInterval(timer); }, [load]);

  const runNow = async () => {
    if (!window.confirm(`Start a forced retraining request for ${symbol}? This queues training work and may consume significant compute.`)) return;
    setRunning(true); setMessage(null); setError(null);
    try {
      const response = await fetch('/api/ml/cron-retrain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, force: true }) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) { window.location.replace('/admin'); return; }
      if (!response.ok || body.success === false) throw new Error(body.error || `Retraining request returned HTTP ${response.status}.`);
      setMessage(body.message || 'Retraining request accepted and queued.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start retraining.');
    } finally {
      setRunning(false);
    }
  };

  const configured = data?.scheduleConfigured === true;
  const due = data?.isDue === true;
  const active = data?.status === 'active';

  return <main className="min-h-screen bg-[#05070b] text-slate-100"><div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8">
    <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><CalendarClock className="h-6 w-6 text-cyan-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Model Operations · Automation</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Retraining & Automation</h1><p className="mt-1 text-xs text-slate-500">Source-backed visibility and controlled execution for the production retraining scheduler.</p></div></div>
      <div className="flex flex-wrap gap-2"><Link href="/admin/models" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10"><ArrowLeft className="h-4 w-4" />Model Operations</Link><Link href="/admin/training-pipeline" className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10">Training Pipeline</Link><button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button></div>
    </header>

    {error && <div className="mb-5 rounded-2xl border border-red-400/20 bg-red-400/[0.06] p-4 text-sm text-red-200">{error}</div>}
    {message && <div className="mb-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-sm text-emerald-200">{message}</div>}

    <section className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-3 flex items-center justify-between"><Timer className="h-5 w-5 text-cyan-300" /><StatusPill ok={configured} label={configured ? 'CONFIGURED' : 'NOT CONFIGURED'} /></div><p className="text-xs uppercase tracking-wider text-slate-500">Schedule</p><p className="mt-1 text-xl font-black">{data?.scheduleIntervalHours != null ? `${data.scheduleIntervalHours}h` : '—'}</p></article>
      <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-3 flex items-center justify-between"><CheckCircle2 className="h-5 w-5 text-emerald-300" /><StatusPill ok={active} label={active ? 'ACTIVE' : String(data?.status || 'UNKNOWN').toUpperCase()} /></div><p className="text-xs uppercase tracking-wider text-slate-500">Scheduler state</p><p className="mt-1 text-xl font-black">{active ? 'Ready' : 'Attention'}</p></article>
      <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-3 flex items-center justify-between"><CalendarClock className="h-5 w-5 text-slate-300" /><span className="text-[10px] font-bold tracking-wider text-slate-500">PERSISTED</span></div><p className="text-xs uppercase tracking-wider text-slate-500">Last training</p><p className="mt-1 text-sm font-bold">{formatDate(data?.lastTrainedAt)}</p></article>
      <article className={`rounded-2xl border p-5 ${due ? 'border-amber-400/20 bg-amber-400/[0.05]' : 'border-white/10 bg-white/[0.025]'}`}><div className="mb-3 flex items-center justify-between"><ShieldAlert className={`h-5 w-5 ${due ? 'text-amber-300' : 'text-slate-400'}`} /><span className="text-[10px] font-bold tracking-wider text-slate-500">SCHEDULE</span></div><p className="text-xs uppercase tracking-wider text-slate-500">Next run</p><p className="mt-1 text-xl font-black">{data?.nextScheduledRunInMinutes != null ? `${data.nextScheduledRunInMinutes}m` : due ? 'DUE' : '—'}</p></article>
    </section>

    <section className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
      <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div className="mb-5"><h2 className="text-base font-bold">Scheduler Diagnostics</h2><p className="mt-1 text-xs leading-5 text-slate-500">The page reads the actual retraining endpoint. No health state is inferred from configuration alone.</p></div><dl className="divide-y divide-white/5 text-sm"><div className="flex items-center justify-between gap-4 py-3"><dt className="text-slate-500">Backend status</dt><dd className="font-mono text-slate-200">{data?.status || 'loading…'}</dd></div><div className="flex items-center justify-between gap-4 py-3"><dt className="text-slate-500">Schedule configured</dt><dd className="font-mono text-slate-200">{configured ? 'true' : 'false'}</dd></div><div className="flex items-center justify-between gap-4 py-3"><dt className="text-slate-500">Time since last train</dt><dd className="font-mono text-slate-200">{data?.timeSinceLastTrainMinutes != null ? `${data.timeSinceLastTrainMinutes} min` : '—'}</dd></div><div className="flex items-center justify-between gap-4 py-3"><dt className="text-slate-500">Due now</dt><dd className={`font-mono ${due ? 'text-amber-300' : 'text-slate-200'}`}>{data?.isDue == null ? '—' : String(data.isDue)}</dd></div></dl></article>
      <article className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.025] p-5"><div className="mb-5"><h2 className="text-base font-bold">Controlled Manual Run</h2><p className="mt-1 text-xs leading-5 text-slate-500">Use this only when you intentionally want to queue retraining outside the normal schedule.</p></div><label className="mb-2 block text-xs font-semibold text-slate-400">Training scope</label><select value={symbol} onChange={(event) => setSymbol(event.target.value)} className="mb-4 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-xs text-slate-200 outline-none"><option value="ALL_ASSETS">ALL_ASSETS</option><option value="R_10">R_10</option><option value="R_25">R_25</option><option value="R_50">R_50</option><option value="R_75">R_75</option><option value="R_100">R_100</option></select><button onClick={runNow} disabled={running} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60">{running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{running ? 'Queueing…' : 'Force Retraining Run'}</button><p className="mt-3 text-[10px] leading-4 text-slate-600">Execution remains server-side and authenticated. The UI does not bypass scheduler or database eligibility checks.</p></article>
    </section>
  </div></main>;
}
