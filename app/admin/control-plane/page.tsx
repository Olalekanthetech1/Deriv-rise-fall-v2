import Link from 'next/link';

const routes = [
  ['command-center', 'Command Center'],
  ['observability', 'Observability'],
  ['incident-center', 'Incident Center'],
  ['signal-forensics', 'Signal Forensics'],
  ['models', 'Model Operations'],
  ['ml-config', 'ML Pipeline Configuration'],
  ['training-pipeline', 'Training Pipeline'],
  ['retraining', 'Retraining & Automation'],
  ['asset-strategy', 'Asset-Aware Strategy'],
  ['champion-challenger', 'Champion / Challenger'],
  ['prediction-integration', 'Prediction Integration'],
  ['final-verification', 'Production Verification'],
  ['security', 'Security'],
  ['market-data-ingestion', 'Market Data Ingestion'],
  ['dataset-builder', 'Training Dataset Builder'],
  ['experiments', 'Testing & Research'],
  ['database', 'Database Operations'],
] as const;

export default function ControlPlanePage() {
  return (
    <main className="min-h-screen bg-[#05070b] px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <Link href="/admin" className="text-xs text-cyan-300">← Operations Center</Link>
        <h1 className="mt-5 text-3xl font-black">Operations Directory</h1>
        <p className="mt-2 text-sm text-slate-500">Central index of production administration surfaces.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {routes.map(([id, title]) => (
            <Link key={id} href={`/admin/${id}`} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 hover:border-cyan-400/20">
              <p className="font-bold">{title}</p>
              <p className="mt-1 text-xs text-slate-600">Open operational surface →</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
