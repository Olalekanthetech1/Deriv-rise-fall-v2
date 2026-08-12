'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock3, ExternalLink, Filter, RefreshCw, Search, ShieldAlert, XCircle } from 'lucide-react';

type EventRow = { id: string | number; category: string; severity: string; service: string | null; eventType: string; message: string; requestId: string | null; correlationId: string | null; symbol: string | null; modelId: string | null; createdAt: string; source: string };
type Health = { status?: string; timestamp?: string; services?: { database?: string; dbLatencyMs?: number | null; pythonDaemon?: string; daemonLatencyMs?: number | null } };
type Incident = EventRow & { incidentKey: string; normalizedSeverity: 'critical' | 'error' | 'warning' };

const severityWeight: Record<Incident['normalizedSeverity'], number> = { critical: 3, error: 2, warning: 1 };

function formatTime(value?: string) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(); }
function normalizeSeverity(value: string): Incident['normalizedSeverity'] | null { const s = value.toLowerCase(); return s === 'critical' ? 'critical' : s === 'error' ? 'error' : ['warn', 'warning'].includes(s) ? 'warning' : null; }

export default function IncidentCenterPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [coverage, setCoverage] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<'all' | Incident['normalizedSeverity']>('all');
  const [service, setService] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Incident | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [obsResponse, healthResponse] = await Promise.all([
        fetch('/api/admin/observability?range=24h&severity=all&limit=500', { cache: 'no-store' }),
        fetch('/api/health', { cache: 'no-store' }),
      ]);
      if (obsResponse.status === 401 || healthResponse.status === 401) { window.location.replace('/admin'); return; }
      const obs = await obsResponse.json().catch(() => ({}));
      const healthBody = await healthResponse.json().catch(() => null);
      if (!obsResponse.ok) throw new Error(obs?.error || `Observability returned HTTP ${obsResponse.status}.`);
      setEvents(Array.isArray(obs.events) ? obs.events : []); setCoverage(obs.coverage || {}); setHealth(healthBody); setLastRefresh(new Date().toISOString());
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load production incident data.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!autoRefresh) return; const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer); }, [autoRefresh, load]);

  const incidents = useMemo<Incident[]>(() => {
    const rows = events.map((event) => {
      const normalizedSeverity = normalizeSeverity(event.severity); if (!normalizedSeverity) return null;
      return { ...event, normalizedSeverity, incidentKey: [normalizedSeverity, event.service || 'system', event.eventType, event.message, event.symbol || ''].join('|') };
    }).filter((event): event is Incident => Boolean(event));
    const deduped = new Map<string, Incident>();
    for (const row of rows) { const existing = deduped.get(row.incidentKey); if (!existing || new Date(row.createdAt).getTime() > new Date(existing.createdAt).getTime()) deduped.set(row.incidentKey, row); }
    return [...deduped.values()].sort((a, b) => severityWeight[b.normalizedSeverity] - severityWeight[a.normalizedSeverity] || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [events]);

  const services = useMemo(() => ['all', ...Array.from(new Set(incidents.map(i => i.service || 'system'))).sort()], [incidents]);
  const filtered = useMemo(() => incidents.filter((incident) => severity === 'all' || incident.normalizedSeverity === severity).filter((incident) => service === 'all' || (incident.service || 'system') === service).filter((incident) => { if (!query.trim()) return true; const haystack = [incident.eventType, incident.message, incident.service, incident.symbol, incident.modelId, incident.requestId, incident.correlationId].filter(Boolean).join(' ').toLowerCase(); return haystack.includes(query.trim().toLowerCase()); } ).slice(0, 100), [incidents, severity, service, query]);

  const critical = incidents.filter(i => i.normalizedSeverity === 'critical').length;
  const errors = incidents.filter(i => i.normalizedSeverity === 'error').length;
  const warnings = incidents.filter(i => i.normalizedSeverity === 'warning').length;
  const systemHealthy = health?.status === 'healthy';

  return <main className="min-h-screen bg-[#05070b] text-slate-100"><div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
    <header className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="flex items-center gap-3"><div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-3"><ShieldAlert className="h-6 w-6 text-red-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-red-300">Operations · Incident Response</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Incident & Alert Center</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Evidence-backed triage from production health and persisted telemetry. Incidents are deduplicated for investigation; no synthetic alert state is invented here.</p></div></div><div className="flex flex-wrap gap-2"><Link href="/admin/observability" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300"><ArrowLeft className="h-4 w-4" />Observability</Link><button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button><button onClick={() => setAutoRefresh(v => !v)} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300"><Activity className="h-4 w-4" />Auto {autoRefresh ? 'ON' : 'OFF'}</button></div></div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-slate-600"><span>Last refresh: {formatTime(lastRefresh || undefined)}</span><span>•</span><span>Telemetry coverage: {coverage.persistedEvents || 'unknown'}</span><span>•</span><span>Polling: {autoRefresh ? '15s' : 'paused'}</span></div>
    </header>

    {error && <div className="mb-5 rounded-2xl border border-red-400/20 bg-red-400/[0.06] p-4 text-sm text-red-200">{error}</div>}

    <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5"><Metric icon={ShieldAlert} label="Critical" value={critical} tone="red" /><Metric icon={XCircle} label="Errors" value={errors} tone="rose" /><Metric icon={AlertTriangle} label="Warnings" value={warnings} tone="amber" /><Metric icon={Activity} label="Unique Incidents" value={incidents.length} tone="cyan" /><Metric icon={systemHealthy ? CheckCircle2 : XCircle} label="System" value={systemHealthy ? 1 : 0} tone={systemHealthy ? 'emerald' : 'red'} suffix={systemHealthy ? 'healthy' : 'attention'} /></section>

    <section className="mb-5 grid gap-4 lg:grid-cols-3"><StatusCard title="System" value={health?.status || 'unknown'} ok={systemHealthy} detail={formatTime(health?.timestamp)} /><StatusCard title="Database" value={health?.services?.database || 'unknown'} ok={health?.services?.database === 'connected'} detail={health?.services?.dbLatencyMs != null ? `${health.services.dbLatencyMs} ms` : 'Latency unavailable'} /><StatusCard title="ML Runtime" value={health?.services?.pythonDaemon || 'unknown'} ok={health?.services?.pythonDaemon === 'connected'} detail={health?.services?.daemonLatencyMs != null ? `${health.services.daemonLatencyMs} ms` : 'Latency unavailable'} /></section>

    <section className="mb-5 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400"><Filter className="h-4 w-4" />Triage filters</div><div className="grid gap-3 md:grid-cols-[1fr_180px_180px] md:items-center"><label className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search message, symbol, model, request or correlation ID" className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-3 text-xs text-slate-200 outline-none focus:border-cyan-400/40" /></label><select value={severity} onChange={e => setSeverity(e.target.value as typeof severity)} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-slate-300"><option value="all">All severities</option><option value="critical">Critical</option><option value="error">Errors</option><option value="warning">Warnings</option></select><select value={service} onChange={e => setService(e.target.value)} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-slate-300">{services.map(s => <option key={s} value={s}>{s === 'all' ? 'All services' : s}</option>)}</select></div></section>

    <section className="rounded-2xl border border-white/10 bg-white/[0.025] overflow-hidden"><div className="flex items-center justify-between border-b border-white/10 p-4"><div><h2 className="text-sm font-bold">Incident Evidence Queue</h2><p className="mt-1 text-xs text-slate-600">Showing {filtered.length} of {incidents.length} deduplicated incident signatures.</p></div><Clock3 className="h-4 w-4 text-slate-600" /></div>{loading && !incidents.length ? <div className="p-12 text-center text-sm text-slate-500">Loading incident telemetry…</div> : !filtered.length ? <div className="p-12 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" /><p className="mt-3 text-sm font-semibold text-slate-300">No incidents match the current filters.</p></div> : <div className="divide-y divide-white/5">{filtered.map((incident) => <button key={`${incident.incidentKey}-${incident.id}`} type="button" onClick={() => setSelected(incident)} className="block w-full p-4 text-left transition hover:bg-white/[0.03]"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Severity severity={incident.normalizedSeverity} /><span className="text-[10px] uppercase tracking-wider text-slate-600">{incident.service || 'system'}</span>{incident.symbol && <span className="font-mono text-[10px] text-slate-600">{incident.symbol}</span>}</div><h3 className="mt-2 text-sm font-semibold text-slate-200">{incident.eventType}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{incident.message}</p></div><span className="shrink-0 font-mono text-[10px] text-slate-600">{formatTime(incident.createdAt)}</span></div></button>)}</div>}</section>

    {selected && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={() => setSelected(null)}><article className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-3xl border border-white/10 bg-[#0a0d13] p-5 shadow-2xl" onClick={e => e.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><Severity severity={selected.normalizedSeverity} /><span className="text-[10px] uppercase tracking-wider text-slate-600">{selected.service || 'system'}</span></div><h2 className="mt-3 text-lg font-bold">{selected.eventType}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{selected.message}</p></div><button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-400">Close</button></div><dl className="mt-6 grid gap-3 sm:grid-cols-2">{[['Created', formatTime(selected.createdAt)], ['Source', selected.source], ['Category', selected.category], ['Symbol', selected.symbol || '—'], ['Model', selected.modelId || '—'], ['Request ID', selected.requestId || '—'], ['Correlation ID', selected.correlationId || '—'], ['Event ID', String(selected.id)]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/5 bg-white/[0.025] p-3"><dt className="text-[10px] uppercase tracking-wider text-slate-600">{label}</dt><dd className="mt-1 break-all font-mono text-xs text-slate-300">{value}</dd></div>)}</dl><div className="mt-5 flex flex-wrap gap-2"><Link href="/admin/observability" className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200">Open telemetry <ExternalLink className="h-3.5 w-3.5" /></Link><Link href="/admin/signal-forensics" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300">Signal forensics <ExternalLink className="h-3.5 w-3.5" /></Link></div></article></div>}
  </div></main>;
}

function Severity({ severity }: { severity: Incident['normalizedSeverity'] }) { const cls = severity === 'critical' ? 'border-red-400/20 bg-red-400/10 text-red-200' : severity === 'error' ? 'border-rose-400/20 bg-rose-400/10 text-rose-200' : 'border-amber-400/20 bg-amber-400/10 text-amber-200'; return <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${cls}`}>{severity}</span>; }
function Metric({ icon: Icon, label, value, tone, suffix }: { icon: typeof Activity; label: string; value: number; tone: string; suffix?: string }) { const cls: Record<string, string> = { red: 'text-red-300', rose: 'text-rose-300', amber: 'text-amber-300', cyan: 'text-cyan-300', emerald: 'text-emerald-300' }; return <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><Icon className={`h-4 w-4 ${cls[tone]}`} /><p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p>{suffix && <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{suffix}</p>}</div>; }
function StatusCard({ title, value, ok, detail }: { title: string; value: string; ok: boolean; detail: string }) { return <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-red-300" />}</div><p className="mt-2 text-lg font-bold">{value}</p><p className="mt-1 text-xs text-slate-600">{detail}</p></div>; }
