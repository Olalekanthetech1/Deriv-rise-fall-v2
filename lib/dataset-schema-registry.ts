import crypto from 'crypto';

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

export type FeatureDefinition = {
  key: string;
  sourceKey: string;
  name: string;
  pillar: string;
  ordinal: number;
  active: boolean;
  parameters: Record<string, unknown>;
};

export type HorizonDefinition = {
  id: string;
  label: string;
  tickCount: number;
  durationSeconds: number | null;
  active: boolean;
  metadata: Record<string, unknown>;
};

const BOOTSTRAP_FEATURES: Array<Omit<FeatureDefinition, 'active'>> = [
  { key: 'deltaP1', sourceKey: 'deltaP1', name: 'Delta P1', pillar: 'Price Behaviour', ordinal: 1, parameters: { windowTicks: 2 } },
  { key: 'deltaP2', sourceKey: 'deltaP2', name: 'Delta P2', pillar: 'Price Behaviour', ordinal: 2, parameters: { windowTicks: 3 } },
  { key: 'deltaP3', sourceKey: 'deltaP3', name: 'Delta P3', pillar: 'Price Behaviour', ordinal: 3, parameters: { windowTicks: 4 } },
  { key: 'micro_momentum', sourceKey: 'micro_momentum', name: 'Micro Momentum', pillar: 'Price Behaviour', ordinal: 4, parameters: { windowTicks: 5 } },
  { key: 'short_momentum', sourceKey: 'short_momentum', name: 'Short Momentum', pillar: 'Price Behaviour', ordinal: 5, parameters: { windowTicks: 25 } },
  { key: 'medium_momentum', sourceKey: 'medium_momentum', name: 'Medium Momentum', pillar: 'Price Behaviour', ordinal: 6, parameters: { windowTicks: 100 } },
  { key: 'macro_momentum', sourceKey: 'macro_momentum', name: 'Macro Momentum', pillar: 'Price Behaviour', ordinal: 7, parameters: { windowTicks: 300 } },
  { key: 'short_range', sourceKey: 'short_range', name: 'Short Range', pillar: 'Price Behaviour', ordinal: 8, parameters: { windowTicks: 25 } },
  { key: 'medium_displacement', sourceKey: 'medium_displacement', name: 'Medium Displacement', pillar: 'Price Behaviour', ordinal: 9, parameters: { windowTicks: 100 } },
  { key: 'macro_displacement', sourceKey: 'macro_displacement', name: 'Macro Displacement', pillar: 'Price Behaviour', ordinal: 10, parameters: { windowTicks: 300 } },
  { key: 'up_tick_ratio', sourceKey: 'up_tick_ratio', name: 'Up Tick Ratio', pillar: 'Tick Pressure & Sequencing', ordinal: 11, parameters: { windowTicks: 300 } },
  { key: 'down_tick_ratio', sourceKey: 'down_tick_ratio', name: 'Down Tick Ratio', pillar: 'Tick Pressure & Sequencing', ordinal: 12, parameters: { windowTicks: 300 } },
  { key: 'directional_imbalance', sourceKey: 'directional_imbalance', name: 'Directional Imbalance', pillar: 'Tick Pressure & Sequencing', ordinal: 13, parameters: { windowTicks: 300 } },
  { key: 'consecutive_up', sourceKey: 'consecutive_up', name: 'Consecutive Up', pillar: 'Tick Pressure & Sequencing', ordinal: 14, parameters: { windowTicks: 300 } },
  { key: 'consecutive_down', sourceKey: 'consecutive_down', name: 'Consecutive Down', pillar: 'Tick Pressure & Sequencing', ordinal: 15, parameters: { windowTicks: 300 } },
  { key: 'micro_persistence', sourceKey: 'micro_persistence', name: 'Micro Persistence', pillar: 'Tick Pressure & Sequencing', ordinal: 16, parameters: { windowTicks: 5 } },
  { key: 'short_persistence', sourceKey: 'short_persistence', name: 'Short Persistence', pillar: 'Tick Pressure & Sequencing', ordinal: 17, parameters: { windowTicks: 25 } },
  { key: 'short_reversal_rate', sourceKey: 'short_reversal_rate', name: 'Short Reversal Rate', pillar: 'Tick Pressure & Sequencing', ordinal: 18, parameters: { windowTicks: 25 } },
  { key: 'medium_reversal_rate', sourceKey: 'medium_reversal_rate', name: 'Medium Reversal Rate', pillar: 'Tick Pressure & Sequencing', ordinal: 19, parameters: { windowTicks: 100 } },
  { key: 'micro_velocity', sourceKey: 'micro_velocity', name: 'Micro Velocity', pillar: 'Tick Velocity & Acceleration', ordinal: 20, parameters: { windowTicks: 5 } },
  { key: 'short_velocity', sourceKey: 'short_velocity', name: 'Short Velocity', pillar: 'Tick Velocity & Acceleration', ordinal: 21, parameters: { windowTicks: 25 } },
  { key: 'medium_velocity', sourceKey: 'medium_velocity', name: 'Medium Velocity', pillar: 'Tick Velocity & Acceleration', ordinal: 22, parameters: { windowTicks: 100 } },
  { key: 'acceleration', sourceKey: 'acceleration', name: 'Acceleration', pillar: 'Tick Velocity & Acceleration', ordinal: 23, parameters: { windowTicks: 25 } },
  { key: 'ticks_per_second', sourceKey: 'ticks_per_second', name: 'Ticks Per Second', pillar: 'Tick Velocity & Acceleration', ordinal: 24, parameters: { windowTicks: 300 } },
  { key: 'velocity_per_second', sourceKey: 'velocity_per_second', name: 'Velocity Per Second', pillar: 'Tick Velocity & Acceleration', ordinal: 25, parameters: { windowTicks: 300 } },
  { key: 'short_volatility', sourceKey: 'short_volatility', name: 'Short Volatility', pillar: 'Volatility', ordinal: 26, parameters: { windowTicks: 25 } },
  { key: 'medium_volatility', sourceKey: 'medium_volatility', name: 'Medium Volatility', pillar: 'Volatility', ordinal: 27, parameters: { windowTicks: 100 } },
  { key: 'macro_volatility', sourceKey: 'macro_volatility', name: 'Macro Volatility', pillar: 'Volatility', ordinal: 28, parameters: { windowTicks: 300 } },
  { key: 'short_rangeCompression', sourceKey: 'short_rangeCompression', name: 'Short Range Compression', pillar: 'Volatility', ordinal: 29, parameters: { windowTicks: 25 } },
  { key: 'medium_distHigh', sourceKey: 'medium_distHigh', name: 'Medium Distance To High', pillar: 'Volatility', ordinal: 30, parameters: { windowTicks: 100 } },
  { key: 'medium_distLow', sourceKey: 'medium_distLow', name: 'Medium Distance To Low', pillar: 'Volatility', ordinal: 31, parameters: { windowTicks: 100 } },
  { key: 'macro_regime', sourceKey: 'macro_regime', name: 'Macro Regime', pillar: 'Context & Regime', ordinal: 32, parameters: { windowTicks: 300 } },
  { key: 'is1SecondSynthetic', sourceKey: 'is1SecondSynthetic', name: 'One Second Synthetic Flag', pillar: 'Context & Regime', ordinal: 33, parameters: {} },
  { key: 'contractDurationSecs', sourceKey: 'contractDurationSecs', name: 'Contract Duration Seconds', pillar: 'Context & Regime', ordinal: 34, parameters: {} },
  { key: 'durationFactor', sourceKey: 'durationFactor', name: 'Duration Factor', pillar: 'Context & Regime', ordinal: 35, parameters: {} },
  { key: 'digitFrequency', sourceKey: 'digitFrequency', name: 'Digit Frequency', pillar: 'Context & Regime', ordinal: 36, parameters: { windowTicks: 300 } },
  { key: 'assetCategory', sourceKey: 'assetCategory', name: 'Asset Category', pillar: 'Context & Regime', ordinal: 37, parameters: {} },
];

const BOOTSTRAP_HORIZONS: HorizonDefinition[] = [
  { id: 'micro', label: 'Micro — 5 ticks', tickCount: 5, durationSeconds: null, active: true, metadata: { role: 'short-term' } },
  { id: 'short', label: 'Short — 25 ticks', tickCount: 25, durationSeconds: null, active: true, metadata: { role: 'short-term' } },
  { id: 'medium', label: 'Medium — 100 ticks', tickCount: 100, durationSeconds: null, active: true, metadata: { role: 'medium-term' } },
  { id: 'macro', label: 'Macro — 300 ticks', tickCount: 300, durationSeconds: null, active: true, metadata: { role: 'long-term' } },
];

export async function ensureDatasetSchemaRegistry(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS training_feature_registry (
      key VARCHAR(96) PRIMARY KEY,
      source_key VARCHAR(96) NOT NULL,
      name VARCHAR(160) NOT NULL,
      pillar VARCHAR(96) NOT NULL,
      ordinal INTEGER NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
      schema_version VARCHAR(64) NOT NULL DEFAULT 'v1',
      calculation_version VARCHAR(64) NOT NULL DEFAULT 'v1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS training_horizon_registry (
      id VARCHAR(96) PRIMARY KEY,
      label VARCHAR(160) NOT NULL,
      tick_count INTEGER NOT NULL UNIQUE,
      duration_seconds INTEGER,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  for (const feature of BOOTSTRAP_FEATURES) {
    await sql`
      INSERT INTO training_feature_registry (key, source_key, name, pillar, ordinal, active, parameters)
      VALUES (${feature.key}, ${feature.sourceKey}, ${feature.name}, ${feature.pillar}, ${feature.ordinal}, TRUE, ${JSON.stringify(feature.parameters)}::jsonb)
      ON CONFLICT (key) DO NOTHING
    `;
  }

  for (const horizon of BOOTSTRAP_HORIZONS) {
    await sql`
      INSERT INTO training_horizon_registry (id, label, tick_count, duration_seconds, active, metadata)
      VALUES (${horizon.id}, ${horizon.label}, ${horizon.tickCount}, ${horizon.durationSeconds}, ${horizon.active}, ${JSON.stringify(horizon.metadata)}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

export async function getActiveFeatureSchema(sql: SqlClient): Promise<FeatureDefinition[]> {
  const rows = await sql`
    SELECT key, source_key, name, pillar, ordinal, active, parameters
    FROM training_feature_registry
    WHERE active = TRUE
    ORDER BY ordinal ASC
  `;
  return rows.map((row: any) => ({
    key: String(row.key),
    sourceKey: String(row.source_key),
    name: String(row.name),
    pillar: String(row.pillar),
    ordinal: Number(row.ordinal),
    active: Boolean(row.active),
    parameters: row.parameters && typeof row.parameters === 'object' ? row.parameters : {},
  }));
}

export async function getActiveHorizons(sql: SqlClient): Promise<HorizonDefinition[]> {
  const rows = await sql`
    SELECT id, label, tick_count, duration_seconds, active, metadata
    FROM training_horizon_registry
    WHERE active = TRUE
    ORDER BY tick_count ASC
  `;
  return rows.map((row: any) => ({
    id: String(row.id),
    label: String(row.label),
    tickCount: Number(row.tick_count),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    active: Boolean(row.active),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  }));
}

export function getFeatureSchemaVersion(features: FeatureDefinition[]): string {
  const payload = features.map((feature) => ({
    key: feature.key,
    sourceKey: feature.sourceKey,
    ordinal: feature.ordinal,
    parameters: feature.parameters,
  }));
  const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
  return `features-${digest}`;
}

export function getRequiredWindowTicks(features: FeatureDefinition[]): number {
  return features.reduce((max, feature) => {
    const value = Number(feature.parameters?.windowTicks);
    return Number.isSafeInteger(value) && value > max ? value : max;
  }, 1);
}

export function getWindowProfile(features: FeatureDefinition[]) {
  const findWindow = (name: string, fallback: number) => {
    const feature = features.find((item) => item.key === name || item.sourceKey === name);
    const value = Number(feature?.parameters?.windowTicks);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  };

  return {
    micro: findWindow('micro_momentum', 5),
    short: findWindow('short_momentum', 25),
    medium: findWindow('medium_momentum', 100),
    macro: findWindow('macro_momentum', 300),
  };
}

export function featureVectorFromRecord(features: Record<string, number>, schema: FeatureDefinition[]): number[] {
  return schema.map((definition) => {
    const value = Number(features[definition.sourceKey]);
    if (!Number.isFinite(value)) throw new Error(`Feature ${definition.key} produced a non-finite value.`);
    return value;
  });
}
