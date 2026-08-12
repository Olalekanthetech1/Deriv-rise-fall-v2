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

    const auditPayload = JSON.stringify({
      modelIds,
      models: rows.map((row: any) => ({ modelId: row.model_id, status: row.status, symbol: row.asset_symbol, horizonTicks: row.horizon_ticks, trainingRunId: row.training_run_id })),
      cleanupType: 'candidate_registry_cleanup',
    });

    await sql`
      INSERT INTO ops_audit_events (category, severity, actor, action, resource_type, resource_id, metadata)
      VALUES ('model_operations', 'warning', 'admin', 'delete_candidate_models', 'ml_model_registry_v2', ${modelIds.join(',')}, ${auditPayload}::jsonb)
    `;

    const deleted = await sql`
      DELETE FROM ml_model_registry_v2
      WHERE model_id = ANY(${modelIds})
        AND LOWER(status) IN ('candidate', 'staging')
      RETURNING model_id
    `;

    if (deleted.length !== modelIds.length) {
      return NextResponse.json({
        success: false,
        error: 'Cleanup completed only partially. Stop and inspect the registry before retrying.',
        deletedModelIds: deleted.map((row: any) => row.model_id),
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deletedCount: deleted.length,
      deletedModelIds: deleted.map((row: any) => row.model_id),
      note: 'Registry records and database-linked child records were removed according to existing foreign-key cascade/set-null rules. External artifact objects are not deleted by this operation.',
    });
  } catch (error: any) {
    console.error('[model-cleanup] cleanup failed:', error);
    return NextResponse.json({ success: false, error: 'Model cleanup failed. No safe completion could be confirmed.' }, { status: 500 });
  }
}
