import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDbSchema } from '@/lib/db';
import { verifySessionToken } from '../auth/route';

function isAuthValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  if (verifySessionToken(cookieToken) === true) return true;

  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(headerToken) === true;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && id.trim()).map(id => id.trim())));
}

export async function GET(req: NextRequest) {
  if (!isAuthValid(req)) return NextResponse.json({ success: false, error: 'Unauthorized admin access.' }, { status: 401 });

  try {
    if (!(await initDbSchema())) return NextResponse.json({ success: false, error: 'Model registry database is unavailable.' }, { status: 503 });
    const sql = getDb();
    if (!sql) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });

    const rows = await sql`
      SELECT model_id, model_family, version, asset_symbol, asset_class, horizon_ticks, status,
             training_run_id, metrics, created_at, updated_at
      FROM ml_model_registry_v2
      WHERE LOWER(status) IN ('candidate', 'staging')
      ORDER BY updated_at DESC
    `;

    return NextResponse.json({
      success: true,
      count: rows.length,
      models: rows,
      policy: 'Only candidate/staging models are eligible. Production models are never returned for cleanup.',
      dataSource: 'live-database',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Failed to load cleanup candidates.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthValid(req)) return NextResponse.json({ success: false, error: 'Unauthorized admin access.' }, { status: 401 });

  try {
    if (!(await initDbSchema())) return NextResponse.json({ success: false, error: 'Model registry database is unavailable.' }, { status: 503 });
    const sql = getDb();
    if (!sql) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });

    const body = await req.json().catch(() => ({}));
    const modelIds = normalizeIds(body.modelIds);
    const confirm = body.confirm === true;

    if (!modelIds.length) return NextResponse.json({ success: false, error: 'At least one modelId is required.' }, { status: 400 });
    if (modelIds.length > 100) return NextResponse.json({ success: false, error: 'A maximum of 100 models may be cleaned in one operation.' }, { status: 400 });
    if (!confirm) return NextResponse.json({ success: false, error: 'Explicit confirmation is required for destructive model cleanup.' }, { status: 400 });

    const rows = await sql`
      SELECT model_id, status, asset_symbol, horizon_ticks, training_run_id
      FROM ml_model_registry_v2
      WHERE model_id = ANY(${modelIds})
    `;

    if (rows.length !== modelIds.length) {
      const found = new Set(rows.map((row: any) => String(row.model_id)));
      const missing = modelIds.filter(id => !found.has(id));
      return NextResponse.json({ success: false, error: 'Cleanup aborted: one or more requested models are not registered.', missingModelIds: missing }, { status: 409 });
    }

    const protectedRows = rows.filter((row: any) => !['candidate', 'staging'].includes(String(row.status).toLowerCase()));
    if (protectedRows.length) {
      return NextResponse.json({
        success: false,
        error: 'Cleanup aborted: only candidate/staging models may be deleted. Production models are protected.',
        protectedModels: protectedRows.map((row: any) => ({ modelId: row.model_id, status: row.status })),
      }, { status: 409 });
    }

    const activeSelections = await sql`
      SELECT selected_model_id
      FROM ops_model_selection_events
      WHERE selected_model_id = ANY(${modelIds})
      LIMIT 1
    `;
    if (activeSelections.length) {
      return NextResponse.json({
        success: false,
        error: 'Cleanup aborted: a selected model has persisted model-selection evidence. Remove/replace that selection through the normal lifecycle first.',
        selectedModelId: activeSelections[0].selected_model_id,
      }, { status: 409 });
    }

    // Atomic cleanup: deletion and audit are part of one PostgreSQL statement.
    // Re-check eligibility inside the statement so concurrent changes cannot cause a partial delete.
    const result = await sql`
      WITH requested AS (
        SELECT UNNEST(${modelIds}::text[]) AS model_id
      ),
      eligible AS (
        SELECT r.model_id
        FROM requested r
        JOIN ml_model_registry_v2 m ON m.model_id = r.model_id
        WHERE LOWER(m.status) IN ('candidate', 'staging')
          AND NOT EXISTS (
            SELECT 1
            FROM ops_model_selection_events s
            WHERE s.selected_model_id = r.model_id
          )
      ),
      deleted AS (
        DELETE FROM ml_model_registry_v2 m
        WHERE m.model_id IN (SELECT model_id FROM eligible)
          AND (SELECT COUNT(*) FROM eligible) = ${modelIds.length}
        RETURNING m.model_id
      ),
      audit AS (
        INSERT INTO ops_audit_events (category, severity, actor, action, resource_type, resource_id, metadata)
        SELECT
          'model_operations',
          'warning',
          'admin',
          'delete_candidate_models',
          'ml_model_registry_v2',
          ${modelIds.join(',')},
          jsonb_build_object(
            'modelIds', COALESCE(jsonb_agg(d.model_id), '[]'::jsonb),
            'cleanupType', 'candidate_registry_cleanup'
          )
        FROM deleted d
        HAVING COUNT(*) = ${modelIds.length}
        RETURNING id
      )
      SELECT d.model_id
      FROM deleted d
      JOIN audit a ON TRUE
    `;

    if (result.length !== modelIds.length) {
      const current = await sql`
        SELECT model_id, status
        FROM ml_model_registry_v2
        WHERE model_id = ANY(${modelIds})
      `;
      const currentById = new Map(current.map((row: any) => [String(row.model_id), String(row.status)]));
      const blocked = modelIds
        .filter(id => currentById.has(id))
        .map(id => ({ modelId: id, status: currentById.get(id) }));

      return NextResponse.json({
        success: false,
        error: 'Cleanup aborted atomically: the selected set changed or a protected dependency is present. No requested model was deleted.',
        blockedModels: blocked,
      }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      deletedCount: result.length,
      deletedModelIds: result.map((row: any) => row.model_id),
      note: 'Registry records and database-linked child records were removed according to existing foreign-key cascade/set-null rules. External artifact objects are not deleted by this operation.',
    });
  } catch (error: any) {
    console.error('[model-cleanup] cleanup failed:', error);
    return NextResponse.json({ success: false, error: 'Model cleanup failed. No safe completion could be confirmed.' }, { status: 500 });
  }
}
