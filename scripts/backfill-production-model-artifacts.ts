import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { getDb, initDbSchema } from '../lib/db';
import { persistModelArtifact } from '../lib/ml-model-artifact-store';

const modelCacheDir = path.resolve(process.env.MODEL_CACHE_DIR || path.join(process.cwd(), 'models_cache'));
const apply = process.argv.includes('--apply');
const status = process.env.BACKFILL_STATUS || 'production';

function safe(value: unknown): string { return String(value || '').replace(/[^A-Za-z0-9_.-]/g, ''); }

async function main() {
  if (!(await initDbSchema())) throw new Error('DATABASE_UNAVAILABLE');
  const sql = getDb(); if (!sql) throw new Error('DATABASE_UNAVAILABLE');
  const files = await readdir(modelCacheDir).catch(() => [] as string[]);
  const rows = await sql`
    SELECT model_id, asset_symbol, duration_value, duration_unit, model_family, training_run_id, metrics, status
    FROM ml_model_registry_v2
    WHERE status = ${status}::varchar
    ORDER BY updated_at DESC
  `;
  let ready = 0; let persisted = 0; let missing = 0;
  for (const row of rows as any[]) {
    const modelId = String(row.model_id);
    const symbol = String(row.asset_symbol);
    const duration = `${String(row.duration_unit)}${Number(row.duration_value)}`;
    const metrics = row.metrics && typeof row.metrics === 'object' ? row.metrics : {};
    const modelKey = safe(metrics.modelKey || row.model_family);
    const prefix = `${safe(symbol)}_${duration}_${modelKey}`;
    const candidates = files.filter((file) => file.startsWith(prefix) && file.endsWith('.pkl'));
    if (!candidates.length) { missing += 1; console.log(JSON.stringify({ modelId, status: 'MISSING_LOCAL_ARTIFACT', prefix })); continue; }
    const runPrefix = safe(row.training_run_id).slice(0, 12);
    const exact = candidates.sort().find((file) => file.includes(runPrefix)) || candidates[0];
    const artifactPath = path.join(modelCacheDir, exact);
    ready += 1;
    if (!apply) { console.log(JSON.stringify({ modelId, status: 'READY_TO_PERSIST', artifactPath })); continue; }
    const result = await persistModelArtifact(modelId, artifactPath);
    persisted += 1;
    console.log(JSON.stringify({ modelId, status: 'PERSISTED', artifactPath, ...result }));
  }
  console.log(JSON.stringify({ complete: true, apply, sourceDirectory: modelCacheDir, registryStatus: status, total: rows.length, ready, persisted, missing }));
}

main().catch((error) => { console.error('[Artifact Backfill] failed:', error); process.exitCode = 1; });
