export type RoadmapStatus = 'complete' | 'current' | 'next' | 'planned';

export type RoadmapSection = { id: string; title: string; description: string; status: RoadmapStatus };

export const adminRoadmap: RoadmapSection[] = [
  { id: 'command-center', title: 'Command Center', description: 'System health, production state, critical alerts and operational readiness.', status: 'complete' },
  { id: 'intelligence', title: 'Trading Intelligence', description: 'Signals, confidence, strategy outcomes, features, horizons and model intelligence.', status: 'complete' },
  { id: 'models', title: 'Model Operations', description: 'Registry, validation, promotion, rollback and retraining lifecycle.', status: 'complete' },
  { id: 'experiments', title: 'Testing & Research', description: 'Backtests, paper/shadow tests, multi-horizon evaluation and persistent experiment history.', status: 'complete' },
  { id: 'infrastructure', title: 'Runtime & Infrastructure', description: 'Latency, APIs, WebSockets, database, cron and runtime diagnostics.', status: 'complete' },
  { id: 'observability', title: 'Observability', description: 'Application, trading, ML, API, error and audit telemetry.', status: 'complete' },
  { id: 'security', title: 'Security & Configuration', description: 'Runtime environment posture, secrets exposure, session controls and security events.', status: 'complete' },
  { id: 'ml-config', title: 'ML Pipeline Configuration', description: 'Generate, validate, version and activate the effective ML pipeline configuration from canonical registries.', status: 'next' },
  { id: 'database', title: 'Database Operations', description: 'New-schema migration, live Neon verification, data integrity and safe maintenance.', status: 'complete' },
  { id: 'market-data-ingestion', title: 'Market Data Ingestion', description: 'Historical ticks, live streams and validation before they enter the training pipeline.', status: 'complete' },
  { id: 'dataset-builder', title: 'Training Dataset Builder', description: 'Gate 5 confirmed complete: dynamic Deriv duration/horizon selection, real-tick dataset construction, schema/lineage controls and dependency-safe deletion are implemented and accepted.', status: 'complete' },
  { id: 'training-pipeline', title: 'Model Training Pipeline', description: 'Gate 6 — CURRENT HIGHEST PRIORITY: restore reliable worker dispatch from QUEUED through execution, artifact creation and terminal completion with persisted heartbeat and lineage evidence.', status: 'current' },
  { id: 'asset-strategy', title: 'Asset-Aware Model Strategy', description: 'Gate 7 remains behind Gate 6: runtime asset-class and market-type strategy selection with duration-aware model adaptation and persisted lineage.', status: 'next' },
  { id: 'champion-challenger', title: 'Champion/Challenger Evaluation', description: 'Out-of-sample model comparison and promotion gates.', status: 'planned' },
  { id: 'prediction-integration', title: 'Prediction & Trading Integration', description: 'Trained-model inference, execution lineage and trade persistence.', status: 'planned' },
  { id: 'final-verification', title: 'Production Verification', description: 'Build verification, deployment checks and final integrity audit.', status: 'planned' },
];

export function countRoadmapStatus(status: RoadmapStatus) { return adminRoadmap.filter((section) => section.status === status).length; }
