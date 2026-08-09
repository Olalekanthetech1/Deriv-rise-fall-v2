import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '../auth/route';
import { buildTrainingDataset, getDatasetBuilderSchema, listTrainingDatasets } from '@/lib/training-dataset-builder-v2';

function isAuthenticated(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

function noStore() {
  return { 'Cache-Control': 'no-store, max-age=0' };
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });

  try {
    const symbol = req.nextUrl.searchParams.get('symbol')?.trim() || undefined;
    const [datasets, schema] = await Promise.all([
      listTrainingDatasets(symbol),
      getDatasetBuilderSchema(),
    ]);
    return NextResponse.json({ success: true, datasets, schema }, { headers: noStore() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load dataset operations.' }, { status: 500, headers: noStore() });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });

  try {
    const body = await req.json().catch(() => ({}));
    const symbol = typeof body?.symbol === 'string' ? body.symbol.trim() : '';
    const horizonTicks = Number(body?.horizonTicks);
    const datasetName = typeof body?.datasetName === 'string' ? body.datasetName.trim() : undefined;

    if (!symbol) return NextResponse.json({ success: false, error: 'A Deriv symbol is required.' }, { status: 400, headers: noStore() });
    if (!Number.isSafeInteger(horizonTicks) || horizonTicks <= 0 || horizonTicks > 5000) {
      return NextResponse.json({ success: false, error: 'horizonTicks must be a positive integer no greater than 5,000.' }, { status: 400, headers: noStore() });
    }

    const result = await buildTrainingDataset({ symbol, horizonTicks, datasetName });
    return NextResponse.json({ success: true, dataSource: 'deriv-real-ticks', dataset: result }, { status: 201, headers: noStore() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Training dataset construction failed.';
    const status = /insufficient|required|configured|active|non-flat|leakage/i.test(message) ? 422 : 500;
    return NextResponse.json({ success: false, error: message }, { status, headers: noStore() });
  }
}
