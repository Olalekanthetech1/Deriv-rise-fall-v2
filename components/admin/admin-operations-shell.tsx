'use client';

import Link from 'next/link';
import { useEffect, useState, type ComponentType, type FormEvent } from 'react';
import { Activity, AlertTriangle, ArrowRight, BarChart3, Beaker, BrainCircuit, CheckCircle2, Database, FlaskConical, Gauge, KeyRound, Lock, LogOut, Moon, Radio, RefreshCw, Server, ShieldAlert, ShieldCheck, Sun, TerminalSquare } from 'lucide-react';
import AdminDashboardOverview from '@/components/admin/admin-dashboard-overview';
import { adminRoadmap, type RoadmapSection } from '@/lib/admin-roadmap';

type AdminSection = RoadmapSection & { icon: ComponentType<{ className?: string }>; };

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  'command-center': Gauge,
  intelligence: BrainCircuit,
  models: BarChart3,
  experiments: FlaskConical,
  infrastructure: Server,
  observability: Activity,
  'incident-center': AlertTriangle,
  'signal-forensics': ShieldAlert,
  security: KeyRound,
  database: Database,
  'market-data-ingestion': Radio,
  'dataset-builder': Beaker,
  'training-pipeline': BarChart3,
  retraining: RefreshCw,
  'asset-strategy': BrainCircuit,
  'champion-challenger': CheckCircle2,
  'prediction-integration': Gauge,
  'final-verification': ShieldCheck,
};

const sections: AdminSection[] = adminRoadmap.map((section) => ({ ...section, icon: iconMap[section.id] ?? TerminalSquare }));

function StatusBadge({ status }: { status: AdminSection['status'] }) {
  const label = status === 'complete' ? 'COMPLETE' : status === 'next' ? 'NEXT' : 'PLANNED';
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wider ${status === 'complete' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : status === 'next' ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200' : 'border-white/10 bg-white/5 text-slate-300'}`}>{label}</span>;
}

export default function AdminOperationsShell() {
  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passkey, setPasskey] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLightTheme, setIsLightTheme] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem('admin-theme');
    const light = saved === 'light';
    setIsLightTheme(light);
    document.documentElement.classList.toggle('admin-theme-light', light);
    return () => document.documentElement.classList.remove('admin-theme-light');
  }, []);

  const toggleTheme = () => {
    setIsLightTheme((current) => {
      const next = !current;
      window.localStorage.setItem('admin-theme', next ? 'light' : 'dark');
      document.documentElement.classList.toggle('admin-theme-light', next);
      return next;
    });
  };

  const checkSession = async () => {
    setAuthChecking(true);
    try { const response = await fetch('/api/admin/auth', { cache: 'no-store' }); const data = await response.json(); setIsAuthenticated(Boolean(data?.isAuthenticated)); }
    catch { setIsAuthenticated(false); }
    finally { setAuthChecking(false); }
  };
  useEffect(() => { void checkSession(); }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passkey.trim()) { setAuthError('Enter the admin passkey.'); return; }
    setIsSubmitting(true); setAuthError(null);
    try { const response = await fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: passkey }) }); const data = await response.json(); if (!response.ok || !data?.success) { setAuthError(data?.error || 'Authentication failed.'); return; } setPasskey(''); setIsAuthenticated(true); }
    catch { setAuthError('Unable to reach the authentication service.'); }
    finally { setIsSubmitting(false); }
  };
  const handleLogout = async () => { try { await fetch('/api/admin/auth', { method: 'DELETE' }); } finally { setIsAuthenticated(false); } };

  if (authChecking) return <main className="min-h-screen bg-[#05070b] text-slate-100 admin-dashboard-surface"><div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4"><div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-sm text-slate-300"><RefreshCw className="h-4 w-4 animate-spin" />Verifying admin session…</div></div></main>;
  if (!isAuthenticated) return <main className="min-h-screen bg-[#05070b] px-4 py-10 text-slate-100 admin-dashboard-surface"><div className="mx-auto flex min-h-[80vh] max-w-md items-center"><form onSubmit={handleLogin} className="w-full rounded-3xl border border-white/10 bg-white/[0.035] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8"><div className="mb-7 flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><Lock className="h-6 w-6 text-cyan-300" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Admin Operations</p><h1 className="text-xl font-bold">Secure Console</h1></div></div><p className="mb-6 text-sm leading-6 text-slate-400">Authentication is required before accessing production administration tools.</p><input type="password" value={passkey} onChange={(event) => setPasskey(event.target.value)} autoComplete="current-password" placeholder="Admin passkey" className="mb-3 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none transition focus:border-cyan-400/50" />{authError && <p className="mb-3 text-xs text-red-300">{authError}</p>}<button disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{isSubmitting ? 'Authorizing…' : 'Unlock Admin Console'}</button></form></div></main>;

  return <main className="min-h-screen bg-[#05070b] text-slate-100 admin-dashboard-surface"><div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
    <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><TerminalSquare className="h-6 w-6 text-cyan-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">AI Trader</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Admin Operations Center</h1><p className="mt-1 text-xs text-slate-500">5B · Modular dashboard architecture · {adminRoadmap.length} domains</p></div></div><div className="flex flex-wrap items-center gap-2"><button onClick={toggleTheme} type="button" aria-label={isLightTheme ? 'Switch admin dashboard to dark theme' : 'Switch admin dashboard to light theme'} title={isLightTheme ? 'Dark theme' : 'Light theme'} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10"><span className="rounded-md bg-black/20 p-1">{isLightTheme ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}</span>{isLightTheme ? 'Dark' : 'Light'}</button><Link href="/admin/command-center" className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/10"><Gauge className="h-4 w-4" />Command Center</Link><Link href="/admin/intelligence" className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/10"><BrainCircuit className="h-4 w-4" />Trading Intelligence</Link><Link href="/admin/models" className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/10"><BarChart3 className="h-4 w-4" />Model Operations</Link><Link href="/admin/experiments" className="inline-flex items-center gap-2 rounded-xl border border-purple-400/20 bg-purple-400/5 px-3 py-2 text-xs font-semibold text-purple-200 transition hover:bg-purple-400/10"><Beaker className="h-4 w-4" />Testing & Research</Link><Link href="/admin/infrastructure" className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/10"><Server className="h-4 w-4" />Runtime & Infrastructure</Link><Link href="/admin/observability" className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/10"><Activity className="h-4 w-4" />Observability</Link><Link href="/admin/incident-center" className="inline-flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/10"><AlertTriangle className="h-4 w-4" />Incidents</Link><Link href="/admin/signal-forensics" className="inline-flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-400/10"><ShieldAlert className="h-4 w-4" />Signal Forensics</Link><Link href="/admin/security" className="inline-flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/10"><KeyRound className="h-4 w-4" />Security</Link><Link href="/admin/database" className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/10"><Database className="h-4 w-4" />Database</Link><button onClick={handleLogout} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10"><LogOut className="h-4 w-4" />Lock Session</button></div></header>
    <AdminDashboardOverview />
    <section className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-lg font-bold">Operational Domains</h2><p className="mt-1 max-w-3xl text-sm text-slate-500">New-system operations are runtime-backed; the retired admin console is not used as an implementation dependency.</p></div></section>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{sections.map(section => { const Icon = section.icon; const card = <article className="group rounded-2xl border border-white/10 bg-white/[0.025] p-5 transition hover:-translate-y-0.5 hover:border-cyan-400/20 hover:bg-white/[0.04]"><div className="mb-5 flex items-start justify-between gap-3"><div className="rounded-xl border border-white/10 bg-black/20 p-2.5"><Icon className="h-5 w-5 text-cyan-300" /></div><StatusBadge status={section.status} /></div><h3 className="text-base font-bold">{section.title}</h3><p className="mt-2 min-h-12 text-sm leading-5 text-slate-500">{section.description}</p><div className="mt-5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600"><span>{section.status === 'complete' ? 'Implemented and ready for verification' : section.status === 'next' ? 'Active migration target' : 'Migration queued'}</span><ArrowRight className="h-3.5 w-3.5" /></div></article>; const navigable = section.status === 'complete' || section.status === 'next'; return navigable ? <Link key={section.id} href={`/admin/${section.id}`} className="block">{card}</Link> : <div key={section.id}>{card}</div>; })}</section>
  </div></main>;
}
