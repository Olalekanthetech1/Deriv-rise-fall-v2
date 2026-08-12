'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, BrainCircuit, CheckCircle2, Clock3, Filter, RefreshCw, Search, ShieldAlert } from 'lucide-react';

type EventRow = { id: string | number; category: string; severity: string; service: string | null; eventType: string; message: string; requestId: string | null; correlationId: string | null; symbol: string | null; modelId: string | null; createdAt: string; source: string; metadata?: unknown };

type Coverage = Record<string, string>;

export default function SignalForensicsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [coverage, setCoverage] = useState<Coverage>({});
  const [symbol, setSymbol] = useState('');
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ range: '24h', category: 'all', severity, symbol, q: query, limit: '300' });
      const response = await fetch(`/api/admin/observability?${params.toString()}`, { cache: 'no-store' });
      if (response.status === 401) { window.location.replace('/admin'); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Signal telemetry returned HTTP ${response.status}.`);
      setEvents(Array.isArray(data.events) ? data.events.filter((event: EventRow) => ['trading', 'ml', 'api'].includes(event.category)) : []);
      setCoverage(data.coverage || {});
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load signal forensics.'); }
    finally { setLoading(false); }
  }, [query, severity, symbol]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer); }, [load]);

  const modelEvents = useMemo(() => events.filter(e => e.category === 'ml'), [events]);
  const tradeEvents = useMemo(() => events.filter(e => e.category === 'trading'), [events]);
  const apiEvents = useMemo(() => events.filter(e => e.category === 'api'), [events]);

  return <main className="min-h-screen bg-[#05070b] text-slate-100"><div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
    <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><BrainCircuit className="h-6 w-6 text-cyan-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Trading Intelligence · Forensics</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Signal Forensics</h1><p className="mt-1 text-xs text-slate-500">Trace persisted ML, API and trading evidence without inventing missing signal lineage.</p></div></div><div className="flex flex-wrap gap-2"><Link href="/admin/intelligence" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300"><ArrowLeft className="h-4 w-4" />Trading Intelligence</Link><button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button></div></header>
    {error && <div className="mb-5 rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] p-4 text-sm text-rose-200">{error}</div>}
    <section className="mb-5 grid gap-3 grid-cols-2 lg:grid-cols-4"><Metric label="ML events" value={modelEvents.length} icon={BrainCircuit} /><Metric label="Trading events" value={tradeEvents.length} icon={Activity} /><Metric label="API events" value={apiEvents.length} icon={ShieldAlert} /><Metric label="Evidence" value={events.length ? 1 : 0} icon={CheckCircle2} /></section>
    <section className="mb-5 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="mb-3 flex items-center gap-2 text-sm font-bold"><Filter className="h-4 w-4 text-cyan-300" />Forensic filters</div><div className="grid gap-3 md:grid-cols-3"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search event, request or model" className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-9 pr-3 text-xs text-slate-200 outline-none" /></div><input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="Symbol (e.g. 1HZ100V)" className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-xs text-slate-200 outline-none" /><select value={severity} onChange={e => setSeverity(e.target.value)} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-xs text-slate-200 outline-none"><option value="all">All severity</option><option value="info">Info</option><option value="warn">Warning</option><option value="error">Error</option><option value="critical">Critical</option></select></div></section>
    <section className="mb-5 grid gap-4 lg:grid-cols-3"><EvidenceCard title="ML Runtime Evidence" events={modelEvents} coverage={coverage.mlLogs} /><EvidenceCard title="Trading Evidence" events={tradeEvents} coverage={coverage.tradingLogs} /><EvidenceCard title="API Evidence" events={apiEvents} coverage={coverage.applicationApi} /></section>
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]"><div className="border-b border-white/10 p-4"><h2 className="text-sm font-bold">Trace Stream</h2><p className="mt-1 text-xs text-slate-600">Correlation/request/model identifiers are displayed when persisted. Missing lineage stays explicitly unavailable.</p></div>{loading && !events.length ? <div className="p-12 text-center text-sm text-slate-500">Loading forensic evidence…</div> : !events.length ? <div className="p-12 text-center"><Clock3 className="mx-auto h-8 w-8 text-slate-700" /><p className="mt-3 text-sm font-semibold text-slate-400">No persisted signal evidence matches the filters.</p></div> : <div className="divide-y divide-white/5">{events.map(event => <article key={`${event.source}-${event.id}`} className="p-4"><div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-200">{event.category}</span><span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">{event.severity}</span><span className="text-[10px] text-slate-600">{event.service || 'service unavailable'}</span>{event.symbol && <span className="font-mono text-[10px] text-slate-600">{event.symbol}</span>}</div><h3 className="mt-2 text-sm font-semibold text-slate-200">{event.eventType}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{event.message}</p></div><div className="shrink-0 text-left xl:text-right"><p className="font-mono text-[10px] text-slate-600">{new Date(event.createdAt).toLocaleString()}</p><p className="mt-1 max-w-sm truncate font-mono text-[10px] text-slate-700">Model: {event.modelId || 'unavailable'}</p><p className="mt-1 max-w-sm truncate font-mono text-[10px] text-slate-700">Request: {event.requestId || 'unavailable'}</p><p className="mt-1 max-w-sm truncate font-mono text-[10px] text-slate-700">Correlation: {event.correlationId || 'unavailable'}</p></div></div></article>)}</div>}</section>
  </div></main>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Activity }) { return <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><Icon className="h-4 w-4 text-cyan-300" /><p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>; }
function EvidenceCard({ title, events, coverage }: { title: string; events: EventRow[]; coverage?: string }) { return <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-bold">{title}</h2><span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{coverage || 'UNAVAILABLE'}</span></div><p className="mt-1 text-2xl font-black">{events.length}</p><p className="mt-1 text-xs text-slate-500">Persisted evidence records</p></article>; }
