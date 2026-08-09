import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '../auth/route';
import { getMlModelKeys, type MlModelKey } from '@/lib/ml-model-registry';
import { listTrainingRuns, trainDatasetModels } from '@/lib/ml-training-orchestrator';

function isAdmin(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}
function noStore() { return { 'Cache-Control': 'no-store, max-age=0' }; }

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ success: false, error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const symbol = req.nextUrl.searchParams.get('symbol')?.trim().toUpperCase() || undefined;
    const runs = await listTrainingRuns(symbol);
    return NextResponse.json({ success: true, runs, modelTypes: getMlModelKeys(), dataSource: 'live-database' }, { headers: noStore() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load training runs.' }, { status: 503, headers: noStore() });
  }
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ success: false, error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const body = await req.json().catch(() => ({}));
    const datasetId = typeof body?.datasetId === 'string' ? body.datasetId.trim() : '';
    if (!datasetId) return NextResponse.json({ success: false, error: 'datasetId is required. Select a completed leakage-validated dataset.' }, { status: 400, headers: noStore() });
    const requested = Array.isArray(body?.modelTypes) ? body.modelTypes.filter((value: unknown): value is MlModelKey => typeof value === 'string' && getMlModelKeys().includes(value as MlModelKey)) : undefined;
    if (Array.isArray(body?.modelTypes) && body.modelTypes.length > 0 && (!requested || requested.length !== body.modelTypes.length)) return NextResponse.json({ success: false, error: 'One or more requested model types are not registered.' }, { status: 400, headers: noStore() });
    const result = await trainDatasetModels({ datasetId, modelTypes: requested });
    return NextResponse.json({ success: result.status !== 'failed', dataSource: 'persisted-real-tick-dataset', ...result }, { status: 201, headers: noStore() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Model training failed.';
    const status = /DATASET|INSUFFICIENT|INVALID_|SCHEMA|REQUIRED|NO_REGISTERED/i.test(message) ? 422 : /DATABASE/i.test(message) ? 503 : 500;
    return NextResponse.json({ success: false, error: message }, { status, headers: noStore() });
  }
}
