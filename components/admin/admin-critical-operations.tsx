'use client';

import Link from 'next/link';
import { AlertTriangle, BrainCircuit, CalendarClock, CheckCircle2, FileSearch, FlaskConical, Gauge, GitCompareArrows, ShieldCheck, SlidersHorizontal, Workflow } from 'lucide-react';

const operations = [
  { href: '/admin/command-center', label: 'Command Center', description: 'System readiness and dependency health.', icon: Gauge, tone: 'cyan' },
  { href: '/admin/observability', label: 'Observability', description: 'Live telemetry, coverage and error evidence.', icon: FileSearch, tone: 'cyan' },
  { href: '/admin/incident-center', label: 'Incident Center', description: 'Evidence-backed alerts and triage.', icon: AlertTriangle, tone: 'amber' },
  { href: '/admin/signal-forensics', label: 'Signal Forensics', description: 'Trace ML, API and trading evidence.', icon: BrainCircuit, tone: 'rose' },
  { href: '/admin/ml-config', label: 'ML Configuration', description: 'Versioned pipeline configuration control.', icon: SlidersHorizontal, tone: 'violet' },
  { href: '/admin/training-pipeline', label: 'Training Pipeline', description: 'Training runs and model lifecycle evidence.', icon: Workflow, tone: 'violet' },
  { href: '/admin/retraining', label: 'Retraining', description: 'Scheduler status and controlled retraining.', icon: CalendarClock, tone: 'amber' },
  { href: '/admin/champion-challenger', label: 'Champion / Challenger', description: 'Candidate comparison and promotion gates.', icon: GitCompareArrows, tone: 'emerald' },
  { href: '/admin/final-verification', label: 'Production Verification', description: 'Controlled no-trade runtime verification.', icon: CheckCircle2, tone: 'emerald' },
  { href: '/admin/security', label: 'Security', description: 'Security posture and configuration controls.', icon: ShieldCheck, tone: 'red' },
  { href: '/admin/experiments', label: 'Testing & Research', description: 'Backtests and persistent experiments.', icon: FlaskConical, tone: 'violet' },
] as const;

const toneClasses: Record<string, string> = {
  cyan: 'border-cyan-400/15 bg-cyan-400/[0.035] hover:border-cyan-400/30',
  amber: 'border-amber-400/15 bg-amber-400/[0.035] hover:border-amber-400/30',
  rose: 'border-rose-400/15 bg-rose-400/[0.035] hover:border-rose-400/30',
  violet: 'border-violet-400/15 bg-violet-400/[0.035] hover:border-violet-400/30',
  emerald: 'border-emerald-400/15 bg-emerald-400/[0.035] hover:border-emerald-400/30',
  red: 'border-red-400/15 bg-red-400/[0.035] hover:border-red-400/30',
};

export default function AdminCriticalOperations() {
  return (
    <section className="mb-6 rounded-3xl border border-cyan-400/10 bg-cyan-400/[0.018] p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Control Plane</p>
          <h2 className="mt-1 text-lg font-black tracking-tight">Critical Operations</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Direct access to the production control surfaces that should be checked during incidents, model changes, retraining, or release verification.</p>
        </div>
        <span className="w-fit rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">11 control surfaces</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {operations.map(({ href, label, description, icon: Icon, tone }) => (
          <Link key={href} href={href} className={`group rounded-2xl border p-3 transition hover:-translate-y-0.5 ${toneClasses[tone]}`}>
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-white/10 bg-black/20 p-2"><Icon className="h-4 w-4 text-cyan-300" /></div>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-200 group-hover:text-white">{label}</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-600 group-hover:text-slate-500">{description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
