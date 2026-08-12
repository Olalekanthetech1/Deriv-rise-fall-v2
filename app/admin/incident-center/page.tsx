'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock3, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';

type EventRow = { id: string | number; category: string; severity: string; service: string | null; eventType: string; message: string; requestId: string | null; correlationId: string | null; symbol: string | null; modelId: string | null; createdAt: string; source: string };
type Health = { status?: string; timestamp?: string; services?: { database?: string; dbLatencyMs?: number | null; pythonDaemon?: string; daemonLatencyMs?: number | null } };

type Incident = { severity: 'critical' | 'error' | 'warning'; title: string; message: string; service?: string | null; symbol?: string | null; createdAt?: string };

const severityWeight: Record<string, number> = { critical: 3, error: 2, warn: 1 };

function formatTime(value?: string) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(); }

export default function IncidentCenterPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [coverage, setCoverage] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [obsResponse, healthResponse] = await Promise.all([
        fetch('/api/admin/observability?range=24h&severity=all&limit=300', { cache: 'no-store' }),
        fetch('/api/health', { cache: 'no-store' }),
      ]);
      if (obsResponse.status === 401 || healthResponse.status === 401) { window.location.replace('/admin'); return; }
      const obs = await obsResponse.json().catch(() => ({}));
      const healthBody = await healthResponse.json().catch(() => null);
      if (!obsResponse.ok) throw new Error(obs?.error || `Observability returned HTTP ${obsResponse.status}.`);
      setEvents(Array.isArray(obs.events) ? obs.events : []);
      setCoverage(obs.coverage || {});
      setHealth(healthBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load production incident data.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer); }, [load]);

  const incidents = useMemo<Incident[]>(() => {
    const items: Incident[] = [];
    if (health?.status === 'degraded') items.push({ severity: 'critical', title: 'System health degraded', message: 'The production health endpoint reports degraded state.' });
    if (health?.services?.database && health.services.database !== 'connected') items.push({ severity: 'critical', title: 'Database not confirmed connected', message: `Database status: ${health.services.database}.` , service: 'database' });
    if (health?.services?.pythonDaemon && health.services.pythonDaemon !== 'connected') items.push({ severity: 'critical', title: 'ML runtime not confirmed connected', message: `Python runtime status: ${health.services.pythonDaemon}.`, service: 'ml-runtime' });
    for (const event of events.filter((row) => ['critical', 'error', 'warn'].includes(String(row.severity).toLowerCase())).slice(0, 80)) {
      const severity = String(event.severity).toLowerCase() === 'critical' ? 'critical' : String(event.severity).toLowerCase() === 'error' ? 'error' : 'warning';
      items.push({ severity, title: event.eventType, message: event.message, service: event.service, symbol: event.symbol, createdAt: event.createdAt });
    }
    return items.sort((a, b) => severityWeight[b.severity === 'warning' ? 'warn' : b.severity] - severityWeight[a.severity === 'warning' ? 'warn' : a.severity] || new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, 50);
  }, [events, health]);

  const critical = incidents.filter(i => i.severity === 'critical').length;
  const errors = incidents.filter(i => i.severity === 'error').length;
  const warnings = incidents.filter(i => i.severity === 'warning').length;

  return <main className="min-h-screen bg-[#05070b] text-slate-100"><div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
    <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-3"><ShieldAlert className="h-6 w-6 text-red-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-red-300">Operations · Incident Response</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Incident & Alert Center</h1><p className="mt-1 text-xs text-slate-500">Source-backed incidents from production health and persisted telemetry. No synthetic alerts.</p></div></div>
      <div className="flex flex-wrap gap-2"><Link href="/admin/observability" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300"><ArrowLeft className="h-4 w-4" />Observability</Link><button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button></div>
    </header>
    {error && <div className="mb-5 rounded-2xl border border-red-400/20 bg-red-400/[0.06] p-4 text-sm text-red-200">{error}</div>}
    <section className="mb-5 grid gap-3 grid-cols-2 lg:grid-cols-4"><Metric icon={ShieldAlert} label="Critical" value={critical} tone="red" /><Metric icon={XCircle} label="Errors" value={errors} tone="rose" /><Metric icon={AlertTriangle} label="Warnings" value={warnings} tone="amber" /><Metric icon={Activity} label="Telemetry" value={events.length} tone="cyan" /></section>
    <section className="mb-5 grid gap-4 lg:grid-cols-3"><StatusCard title="System" value={health?.status || 'unknown'} ok={health?.status === 'healthy'} detail={formatTime(health?.timestamp)} /><StatusCard title="Database" value={health?.services?.database || 'unknown'} ok={health?.services?.database === 'connected'} detail={health?.services?.dbLatencyMs != null ? `${health.services.dbLatencyMs} ms` : 'Latency unavailable'} /><StatusCard title="ML Runtime" value={health?.services?.pythonDaemon || 'unknown'} ok={health?.services?.pythonDaemon === 'connected'} detail={health?.services?.daemonLatencyMs != null ? `${health.services.daemonLatencyMs} ms` : 'Latency unavailable'} /></section>
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] overflow-hidden"><div className="flex items-center justify-between border-b border-white/10 p-4"><div><h2 className="text-sm font-bold">Active / Recent Incidents</h2><p className="mt-1 text-xs text-slate-600">Coverage: {coverage.persistedEvents || 'unknown'} · refresh 15s</p></div><Clock3 className="h-4 w-4 text-slate-600" /></div>{loading && !incidents.length ? <div className="p-12 text-center text-sm text-slate-500">Loading incident telemetry…</div> : !incidents.length ? <div className="p-12 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" /><p className="mt-3 text-sm font-semibold text-slate-300">No critical, error, or warning conditions are currently reported.</p></div> : <div className="divide-y divide-white/5">{incidents.map((incident, index) => <article key={`${incident.title}-${incident.createdAt}-${index}`} className="p-4"><div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Severity severity={incident.severity} /><span className="text-[10px] uppercase tracking-wider text-slate-600">{incident.service || 'system'}</span>{incident.symbol && <span className="font-mono text-[10px] text-slate-600">{incident.symbol}</span>}</div><h3 className="mt-2 text-sm font-semibold text-slate-200">{incident.title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{incident.message}</p></div><span className="shrink-0 font-mono text-[10px] text-slate-600">{formatTime(incident.createdAt)}</span></div></article>)}</div>}</section>
  </div></main>;
}

function Severity({ severity }: { severity: Incident['severity'] }) { const cls = severity === 'critical' ? 'border-red-400/20 bg-red-400/10 text-red-200' : severity === 'error' ? 'border-rose-400/20 bg-rose-400/10 text-rose-200' : 'border-amber-400/20 bg-amber-400/10 text-amber-200'; return <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${cls}`}>{severity}</span>; }
function Metric({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: number; tone: string }) { const cls: Record<string, string> = { red: 'text-red-300', rose: 'text-rose-300', amber: 'text-amber-300', cyan: 'text-cyan-300' }; return <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><Icon className={`h-4 w-4 ${cls[tone]}`} /><p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>; }
function StatusCard({ title, value, ok, detail }: { title: string; value: string; ok: boolean; detail: string }) { return <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-red-300" />}</div><p className="mt-2 text-lg font-bold">{value}</p><p className="mt-1 text-xs text-slate-600">{detail}</p></div>; }
