export type RoadmapStatus = 'complete' | 'next' | 'planned';

export type RoadmapSection = { id: string; title: string; description: string; status: RoadmapStatus };

export const adminRoadmap: RoadmapSection[] = [
  { id: 'command-center', title: 'Command Center', description: 'System health, production state, critical alerts and operational readiness.', status: 'complete' },
  { id: 'intelligence', title: 'Trading Intelligence', description: 'Signals, confidence, strategy outcomes, features, horizons and model intelligence.', status: 'complete' },
  { id: 'models', title: 'Model Operations', description: 'Registry, validation, promotion, rollback and retraining lifecycle.', status: 'complete' },
  { id: 'experiments', title: 'Testing & Research', description: 'Backtests, paper/shadow tests, multi-horizon evaluation and persistent experiment history.', status: 'complete' },
  { id: 'infrastructure', title: 'Runtime & Infrastructure', description: 'Latency, APIs, WebSockets, database, cron and runtime diagnostics.', status: 'complete' },
  { id: 'observability', title: 'Observability', description: 'Application, trading, ML, API, error and audit telemetry.', status: 'complete' },
  { id: 'incident-center', title: 'Incident & Alert Center', description: 'Evidence-backed operational incidents, severity triage, dependency health and production response signals.', status: 'next' },
  { id: 'signal-forensics', title: 'Signal Forensics', description: 'Trace production signal evidence across symbol, model, request, correlation and execution telemetry.', status: 'next' },
  { id: 'security', title: 'Security & Configuration', description: 'Runtime environment posture, secrets exposure, session controls and security events.', status: 'complete' },
  { id: 'ml-config', title: 'ML Pipeline Configuration', description: 'Generate, validate, version and activate the effective ML pipeline configuration from canonical registries.', status: 'next' },
  { id: 'database', title: 'Database Operations', description: 'New-schema migration, live Neon verification, data integrity and safe maintenance.', status: 'complete' },
  { id: 'market-data-ingestion', title: 'Market Data Ingestion', description: 'Historical ticks, live streams and validation before they enter the training pipeline.', status: 'complete' },
  { id: 'dataset-builder', title: 'Training Dataset Builder', description: 'Real-tick feature windows, future-direction labels, chronological splits and leakage validation.', status: 'complete' },
  { id: 'training-pipeline', title: 'Model Training Pipeline', description: 'Eight-model native training from persisted duration-aware datasets with per-model validation and audit lineage.', status: 'next' },
  { id: 'retraining', title: 'Retraining & Automation', description: 'Scheduler status, last-training evidence, due-state monitoring and controlled manual retraining.', status: 'next' },
  { id: 'asset-strategy', title: 'Asset-Aware Model Strategy', description: 'Runtime asset-class and market-type strategy selection with duration-aware model adaptation and persisted lineage.', status: 'next' },
  { id: 'champion-challenger', title: 'Champion/Challenger Evaluation', description: 'Compare persisted production champions with candidates and enforce server-side promotion gates.', status: 'next' },
  { id: 'prediction-integration', title: 'Prediction & Trading Integration', description: 'Production prediction boundary readiness, model lineage and signal-path verification.', status: 'next' },
  { id: 'final-verification', title: 'Production Verification', description: 'Controlled runtime, scheduler, registry and diagnostic signal-path checks with correlation evidence and no-trade safety.', status: 'next' },
];

export function countRoadmapStatus(status: RoadmapStatus) { return adminRoadmap.filter((section) => section.status === status).length; }
