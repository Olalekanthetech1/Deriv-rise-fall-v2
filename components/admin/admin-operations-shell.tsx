'use client';

import Link from 'next/link';
import { useEffect, useState, type ComponentType, type FormEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Database,
  FlaskConical,
  Gauge,
  KeyRound,
  Lock,
  LogOut,
  Network,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  TerminalSquare,
  Wrench,
} from 'lucide-react';

type AdminSection = {
  id: string;
  title: string;
  description: string;
  status: 'next' | 'planned';
  icon: ComponentType<{ className?: string }>;
};

const sections: AdminSection[] = [
  { id: 'command-center', title: 'Command Center', description: 'System health, production state, critical alerts and operational readiness.', status: 'next', icon: Gauge },
  { id: 'intelligence', title: 'Trading Intelligence', description: 'Signals, ensemble agreement, regimes, features and model performance.', status: 'planned', icon: BrainCircuit },
  { id: 'models', title: 'Model Operations', description: 'Registry, validation, promotion, rollback and retraining lifecycle.', status: 'planned', icon: BarChart3 },
  { id: 'experiments', title: 'Testing & Research', description: 'Backtests, paper/shadow tests, scenarios and experiment history.', status: 'planned', icon: FlaskConical },
  { id: 'infrastructure', title: 'Runtime & Infrastructure', description: 'Latency, APIs, WebSockets, database, cron and runtime diagnostics.', status: 'planned', icon: Server },
  { id: 'observability', title: 'Observability', description: 'Application, trading, ML, API, error and audit telemetry.', status: 'planned', icon: Activity },
  { id: 'security', title: 'Security & Configuration', description: 'Secrets, environment configuration, sessions and security events.', status: 'planned', icon: KeyRound },
  { id: 'database', title: 'Database Operations', description: 'Data domains, health, schema visibility, exports and safe maintenance.', status: 'planned', icon: Database },
];

function StatusBadge({ status }: { status: AdminSection['status'] }) {
  const label = status === 'next' ? 'NEXT' : 'PLANNED';
  return <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-slate-300">{label}</span>;
}

export default function AdminOperationsShell() {
  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passkey, setPasskey] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const checkSession = async () => {
    setAuthChecking(true);
    try {
      const response = await fetch('/api/admin/auth', { cache: 'no-store' });
      const data = await response.json();
      setIsAuthenticated(Boolean(data?.isAuthenticated));
    } catch {
      setIsAuthenticated(false);
    } finally {
      setAuthChecking(false);
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passkey.trim()) {
      setAuthError('Enter the admin passkey.');
      return;
    }

    setIsSubmitting(true);
    setAuthError(null);
    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: passkey }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        setAuthError(data?.error || 'Authentication failed.');
        return;
      }
      setPasskey('');
      setIsAuthenticated(true);
    } catch {
      setAuthError('Unable to reach the authentication service.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/auth', { method: 'DELETE' });
    } finally {
      setIsAuthenticated(false);
    }
  };

  if (authChecking) {
    return <main className="min-h-screen bg-[#05070b] text-slate-100"><div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4"><div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-sm text-slate-300"><RefreshCw className="h-4 w-4 animate-spin" />Verifying admin session…</div></div></main>;
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-[#05070b] px-4 py-10 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
          <form onSubmit={handleLogin} className="w-full rounded-3xl border border-white/10 bg-white/[0.035] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
            <div className="mb-7 flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><Lock className="h-6 w-6 text-cyan-300" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Admin Operations</p><h1 className="text-xl font-bold">Secure Console</h1></div></div>
            <p className="mb-6 text-sm leading-6 text-slate-400">Authentication is required before accessing production administration tools.</p>
            <input type="password" value={passkey} onChange={(event) => setPasskey(event.target.value)} autoComplete="current-password" placeholder="Admin passkey" className="mb-3 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none transition focus:border-cyan-400/50" />
            {authError && <p className="mb-3 text-xs text-red-300">{authError}</p>}
            <button disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{isSubmitting ? 'Authorizing…' : 'Unlock Admin Console'}</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#05070b] text-slate-100">
      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3"><TerminalSquare className="h-6 w-6 text-cyan-300" /></div><div><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">AI Trader</p><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Admin Operations Center</h1><p className="mt-1 text-xs text-slate-500">5B-1 · Modular dashboard architecture</p></div></div>
          <div className="flex flex-wrap items-center gap-2"><Link href="/admin/legacy" className="inline-flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/10"><Wrench className="h-4 w-4" />Legacy Console</Link><button onClick={handleLogout} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10"><LogOut className="h-4 w-4" />Lock Session</button></div>
        </header>

        <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-300"><CheckCircle2 className="h-4 w-4" />AUTHENTICATED</div><p className="text-sm text-slate-400">Admin session is active.</p></div>
          <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cyan-300"><Network className="h-4 w-4" />ARCHITECTURE</div><p className="text-sm text-slate-400">8 operational domains defined.</p></div>
          <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.04] p-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" />MIGRATION</div><p className="text-sm text-slate-400">Legacy functionality is preserved.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-300"><Radio className="h-4 w-4" />NEXT</div><p className="text-sm text-slate-400">5B-2 Command Center.</p></div>
        </section>

        <section className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-lg font-bold">Operational Domains</h2><p className="mt-1 max-w-3xl text-sm text-slate-500">The old monolithic console is being decomposed without changing backend contracts. Each domain will become an independently testable route.</p></div></section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {sections.map((section) => {
            const Icon = section.icon;
            return <article key={section.id} className="group rounded-2xl border border-white/10 bg-white/[0.025] p-5 transition hover:-translate-y-0.5 hover:border-cyan-400/20 hover:bg-white/[0.04]"><div className="mb-5 flex items-start justify-between gap-3"><div className="rounded-xl border border-white/10 bg-black/20 p-2.5"><Icon className="h-5 w-5 text-cyan-300" /></div><StatusBadge status={section.status} /></div><h3 className="text-base font-bold">{section.title}</h3><p className="mt-2 min-h-12 text-sm leading-5 text-slate-500">{section.description}</p><div className="mt-5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600"><span>{section.status === 'next' ? 'Next migration target' : 'Migration queued'}</span><ArrowRight className="h-3.5 w-3.5" /></div></article>;
          })}
        </section>

        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 text-sm font-bold"><TerminalSquare className="h-4 w-4 text-cyan-300" />Transitional compatibility</div><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">The previous admin console remains available at <span className="font-mono text-slate-300">/admin/legacy</span> while each domain is migrated and verified. No production API is being rewritten as part of 5B-1.</p></div><Link href="/admin/legacy" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-400/10">Open preserved console <ArrowRight className="h-4 w-4" /></Link></div></section>
      </div>
    </main>
  );
}
