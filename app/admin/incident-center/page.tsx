'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock3, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';

type IncidentStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved';
type Incident = { id: number; fingerprint: string; severity: string; status: IncidentStatus; title: string; message: string; service: string | null; symbol: string | null; model_id: string | null; source_event_id: number | null; first_seen_at: string; last_seen_at: string; acknowledged_at: string | null; investigating_at: string | null; resolved_at: string | null; updated_at: string; };
type Summary = Record<IncidentStatus, number>;
const emptySummary: Summary = { open: 0, acknowledged: 0, investigating: 0, resolved: 0 };

function formatTime(value?: string | null) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(); }
function severityClass(value: string) { return value === 'critical' ? 'border-red-400/20 bg-red-400/10 text-red-200' : value === 'error' ? 'border-rose-400/20 bg-rose-400/10 text-rose-200' : 'border-amber-400/20 bg-amber-400/10 text-amber-200'; }
function statusClass(value: IncidentStatus) { return value === 'resolved' ? 'text-emerald-300' : value === 'investigating' ? 'text-cyan-300' : value === 'acknowledged' ? 'text-violet-300' : 'text-amber-300'; }

export default function IncidentCenterPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [filter, setFilter] = useState<'active' | IncidentStatus>('active');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/admin/incidents?status=${filter}&limit=100`, { cache: 'no-store' });
      if (response.status === 401) { window.location.replace('/admin'); return; }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Incident API returned HTTP ${response.status}.`);
      setIncidents(Array.isArray(body.incidents) ? body.incidents : []);
      setSummary({ ...emptySummary, ...(body.summary || {}) });
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load incident state.'); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer); }, [load]);

  async function transition(id: number, status: IncidentStatus) {
    setUpdating(id); setError(null);
    try {
      const response = await fetch('/api/admin/incidents', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Unable to transition incident (HTTP ${response.status}).`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to update incident.'); }
    finally { setUpdating(null); }
  }

  const activeCount = summary.open + summary.acknowledged + summary.investigating;
  const criticalCount = useMemo(() => incidents.filter(i => i.severity === 'critical').length, [incidents]);

  return <main className="min-h-screen bg-[#05070b] text-slate-100"><div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
    <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-3"><ShieldAlert className="h-6 w-6 text-red-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-red-300">Operations · Incident Response</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Incident & Alert Center</h1><p className="mt-1 text-xs text-slate-500">Persistent incident lifecycle: open → acknowledge → investigate → resolve, with source-backed evidence.</p></div></div>
      <div className="flex flex-wrap gap-2"><Link href="/admin/operational-intelligence" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300"><ArrowLeft className="h-4 w-4" />Operational Intelligence</Link><button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button></div>
    </header>

    {error && <div className="mb-5 rounded-2xl border border-red-400/20 bg-red-400/[0.06] p-4 text-sm text-red-200">{error}</div>}

    <section className="mb-5 grid gap-3 grid-cols-2 lg:grid-cols-5"><Metric icon={ShieldAlert} label="Active" value={activeCount} tone="amber" /><Metric icon={XCircle} label="Critical visible" value={criticalCount} tone="red" /><Metric icon={Activity} label="Open" value={summary.open} tone="amber" /><Metric icon={Clock3} label="Investigating" value={summary.investigating} tone="cyan" /><Metric icon={CheckCircle2} label="Resolved" value={summary.resolved} tone="green" /></section>

    <section className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-white/[0.025] p-3">{(['active', 'open', 'acknowledged', 'investigating', 'resolved'] as const).map(value => <button key={value} onClick={() => setFilter(value)} className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${filter === value ? 'bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/20' : 'bg-white/5 text-slate-500 hover:bg-white/10'}`}>{value === 'active' ? `Active (${activeCount})` : `${value} (${summary[value]})`}</button>)}</section>

    <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]"><div className="flex items-center justify-between border-b border-white/10 p-4"><div><h2 className="text-sm font-bold">{filter === 'active' ? 'Active Incidents' : `${filter[0].toUpperCase()}${filter.slice(1)} Incidents`}</h2><p className="mt-1 text-xs text-slate-600">State is persisted server-side. Refresh does not erase acknowledgements or resolutions.</p></div><span className="text-[10px] uppercase tracking-wider text-slate-600">15s refresh</span></div>
      {loading && !incidents.length ? <div className="p-12 text-center text-sm text-slate-500">Loading incident state…</div> : !incidents.length ? <div className="p-12 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" /><p className="mt-3 text-sm font-semibold text-slate-300">No incidents in this view.</p><p className="mt-1 text-xs text-slate-600">Only persisted or explicitly instrumented telemetry can create an incident.</p></div> : <div className="divide-y divide-white/5">{incidents.map(incident => <article key={incident.id} className="p-4"><div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${severityClass(incident.severity)}`}>{incident.severity}</span><span className={`text-[10px] font-bold uppercase tracking-wider ${statusClass(incident.status)}`}>{incident.status}</span>{incident.service && <span className="text-[10px] uppercase tracking-wider text-slate-600">{incident.service}</span>}{incident.symbol && <span className="font-mono text-[10px] text-slate-600">{incident.symbol}</span>}</div><h3 className="mt-2 text-sm font-semibold text-slate-200">{incident.title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{incident.message}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-slate-600"><span>First seen: {formatTime(incident.first_seen_at)}</span><span>Last seen: {formatTime(incident.last_seen_at)}</span>{incident.source_event_id != null && <span>Source event: #{incident.source_event_id}</span>}</div></div><div className="flex shrink-0 flex-wrap gap-2 xl:max-w-[360px] xl:justify-end">{incident.status === 'open' && <><ActionButton label="Acknowledge" onClick={() => void transition(incident.id, 'acknowledged')} disabled={updating === incident.id} /><ActionButton label="Investigate" onClick={() => void transition(incident.id, 'investigating')} disabled={updating === incident.id} /></>}{incident.status === 'acknowledged' && <><ActionButton label="Investigate" onClick={() => void transition(incident.id, 'investigating')} disabled={updating === incident.id} /><ActionButton label="Resolve" onClick={() => void transition(incident.id, 'resolved')} disabled={updating === incident.id} /></>}{incident.status === 'investigating' && <ActionButton label="Resolve" onClick={() => void transition(incident.id, 'resolved')} disabled={updating === incident.id} />}{incident.status === 'resolved' && <ActionButton label="Reopen" onClick={() => void transition(incident.id, 'open')} disabled={updating === incident.id} />}</div></div></article>)}</div>}
    </section>

    <section className="mt-5 grid gap-4 lg:grid-cols-3"><InfoCard title="Detection" text="Critical/error/warn telemetry is deduplicated by a deterministic fingerprint and materialized into persistent incidents." /><InfoCard title="Response" text="Administrators can acknowledge, investigate, resolve, or reopen incidents through validated state transitions." /><InfoCard title="Auditability" text="Status changes emit a security-category observability event, preserving an operational audit trail without exposing secrets." /></section>
  </div></main>;
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: number; tone: string }) { const cls: Record<string, string> = { red: 'text-red-300', amber: 'text-amber-300', cyan: 'text-cyan-300', green: 'text-emerald-300' }; return <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><Icon className={`h-4 w-4 ${cls[tone]}`} /><p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>; }
function ActionButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) { return <button onClick={onClick} disabled={disabled} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-50">{disabled ? 'Updating…' : label}</button>; }
function InfoCard({ title, text }: { title: string; text: string }) { return <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h3><p className="mt-2 text-xs leading-5 text-slate-600">{text}</p></article>; }
