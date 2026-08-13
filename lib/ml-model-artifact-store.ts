import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDb, initDbSchema } from './db';

const ARTIFACT_TABLE = 'ml_model_artifacts';
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;

function safeModelId(value: string): string {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9_.:-]+$/.test(normalized)) throw new Error('INVALID_MODEL_ID');
  return normalized;
}

export async function ensureModelArtifactStore(): Promise<void> {
  if (!(await initDbSchema())) throw new Error('DATABASE_UNAVAILABLE');
  const sql = getDb();
  if (!sql) throw new Error('DATABASE_UNAVAILABLE');
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql.unsafe(ARTIFACT_TABLE)} (
      model_id TEXT PRIMARY KEY,
      artifact_bytes BYTEA NOT NULL,
      sha256 TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function persistModelArtifact(modelId: string, artifactPath: string): Promise<{ sha256: string; byteSize: number }> {
  const safeId = safeModelId(modelId);
  const bytes = await fs.readFile(artifactPath);
  if (!bytes.length) throw new Error('EMPTY_MODEL_ARTIFACT');
  if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error(`MODEL_ARTIFACT_TOO_LARGE:${bytes.length}`);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  await ensureModelArtifactStore();
  const sql = getDb()!;
  await sql`
    INSERT INTO ml_model_artifacts (model_id, artifact_bytes, sha256, byte_size, updated_at)
    VALUES (${safeId}::text, ${bytes}::bytea, ${sha256}::text, ${bytes.length}::integer, NOW())
    ON CONFLICT (model_id) DO UPDATE SET
      artifact_bytes = EXCLUDED.artifact_bytes,
      sha256 = EXCLUDED.sha256,
      byte_size = EXCLUDED.byte_size,
      updated_at = NOW()
  `;
  return { sha256, byteSize: bytes.length };
}

export async function materializeModelArtifact(modelId: string): Promise<{ path: string; sha256: string; byteSize: number }> {
  const safeId = safeModelId(modelId);
  await ensureModelArtifactStore();
  const sql = getDb()!;
  const rows = await sql`
    SELECT artifact_bytes, sha256, byte_size
    FROM ml_model_artifacts
    WHERE model_id = ${safeId}::text
    LIMIT 1
  `;
  const row = rows[0] as { artifact_bytes?: Buffer | Uint8Array; sha256?: string; byte_size?: number } | undefined;
  if (!row?.artifact_bytes) throw new Error('PRODUCTION_MODEL_ARTIFACT_MISSING');
  const bytes = Buffer.from(row.artifact_bytes);
  const actualSha = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualSha !== String(row.sha256 || '')) throw new Error('PRODUCTION_MODEL_ARTIFACT_CHECKSUM_MISMATCH');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniace-model-'));
  const filePath = path.join(tempDir, `${safeId}.pkl`);
  await fs.writeFile(filePath, bytes, { mode: 0o600 });
  return { path: filePath, sha256: actualSha, byteSize: Number(row.byte_size || bytes.length) };
}

export async function purgeModelArtifact(modelId: string): Promise<void> {
  const safeId = safeModelId(modelId);
  await ensureModelArtifactStore();
  await getDb()!`DELETE FROM ml_model_artifacts WHERE model_id = ${safeId}::text`;
}
