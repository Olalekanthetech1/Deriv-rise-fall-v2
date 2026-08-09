export type RoadmapStatus = 'complete' | 'next' | 'planned';

export type RoadmapSection = {
  id: string;
  title: string;
  description: string;
  status: RoadmapStatus;
};

export const adminRoadmap: RoadmapSection[] = [
  {
    id: 'command-center',
    title: 'Command Center',
    description: 'System health, production state, critical alerts and operational readiness.',
    status: 'complete',
  },
  {
    id: 'intelligence',
    title: 'Trading Intelligence',
    description: 'Signals, confidence, strategy outcomes, features, horizons and model intelligence.',
    status: 'complete',
  },
  {
    id: 'models',
    title: 'Model Operations',
    description: 'Registry, validation, promotion, rollback and retraining lifecycle.',
    status: 'complete',
  },
  {
    id: 'experiments',
    title: 'Testing & Research',
    description: 'Backtests, paper/shadow tests, multi-horizon evaluation and persistent experiment history.',
    status: 'complete',
  },
  {
    id: 'infrastructure',
    title: 'Runtime & Infrastructure',
    description: 'Latency, APIs, WebSockets, database, cron and runtime diagnostics.',
    status: 'complete',
  },
  {
    id: 'observability',
    title: 'Observability',
    description: 'Application, trading, ML, API, error and audit telemetry.',
    status: 'complete',
  },
  {
    id: 'security',
    title: 'Security & Configuration',
    description: 'Runtime environment posture, secrets exposure, session controls and security events.',
    status: 'complete',
  },
  {
    id: 'database',
    title: 'Database Operations',
    description: 'New-schema migration, live Neon verification, data integrity and safe maintenance.',
    status: 'complete',
  },
  {
    id: 'market-data-ingestion',
    title: 'Market Data Ingestion',
    description: 'Historical ticks, live streams and validation before they enter the training pipeline.',
    status: 'complete',
  },
  {
    id: 'dataset-builder',
    title: 'Training Dataset Builder',
    description: 'In progress: source/lineage, asset metadata, registry-driven feature schema and configurable horizons are implemented; target generation, leakage gates, normalization, versioned splits, quality reports, UI verification and dataset registry hardening remain.',
    status: 'next',
  },
  {
    id: 'training-pipeline',
    title: 'Model Training Pipeline',
    description: 'XGBoost, LightGBM, CatBoost and sequence-model training with validation.',
    status: 'planned',
  },
  {
    id: 'asset-strategy',
    title: 'Asset-Aware Model Strategy',
    description: 'Global, asset-class and asset-specialist model selection.',
    status: 'planned',
  },
  {
    id: 'champion-challenger',
    title: 'Champion/Challenger Evaluation',
    description: 'Out-of-sample model comparison and promotion gates.',
    status: 'planned',
  },
  {
    id: 'prediction-integration',
    title: 'Prediction & Trading Integration',
    description: 'Trained-model inference, execution lineage and trade persistence.',
    status: 'planned',
  },
  {
    id: 'final-verification',
    title: 'Production Verification',
    description: 'Build verification, deployment checks and final integrity audit.',
    status: 'planned',
  },
];

export function countRoadmapStatus(status: RoadmapStatus) {
  return adminRoadmap.filter((section) => section.status === status).length;
}
