import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '../auth/route';
import { buildTrainingDataset, listTrainingDatasets } from '@/lib/training-dataset-builder';
import { getCanonicalWindowTicks, getDefaultHorizonTicks, getMlPipelineConfig } from '@/lib/ml-pipeline-config';

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
    const datasets = await listTrainingDatasets(symbol);
    const pipelineConfig = getMlPipelineConfig();
    return NextResponse.json(
      {
        success: true,
        datasets,
        pipelineConfig,
        defaults: {
          horizonTicks: getDefaultHorizonTicks(pipelineConfig),
          windowTicks: getCanonicalWindowTicks(pipelineConfig),
        },
      },
      { headers: noStore() },
    );
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load training datasets.' }, { status: 500, headers: noStore() });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });

  try {
    const body = await req.json().catch(() => ({}));
    const symbol = typeof body?.symbol === 'string' ? body.symbol.trim() : '';
    const horizonTicks = Number(body?.horizonTicks);
    const requestedWindowTicks = Number(body?.windowTicks);
    const datasetName = typeof body?.datasetName === 'string' ? body.datasetName.trim() : undefined;
    const pipelineConfig = getMlPipelineConfig();
    const windowTicks = Number.isSafeInteger(requestedWindowTicks) && requestedWindowTicks > 0 ? requestedWindowTicks : getCanonicalWindowTicks(pipelineConfig);

    if (!symbol) return NextResponse.json({ success: false, error: 'A Deriv symbol is required.' }, { status: 400, headers: noStore() });
    if (!Number.isSafeInteger(horizonTicks) || horizonTicks < 1 || horizonTicks > pipelineConfig.maxHorizonTicks) {
      return NextResponse.json({ success: false, error: `horizonTicks must be an integer between 1 and ${pipelineConfig.maxHorizonTicks}.` }, { status: 400, headers: noStore() });
    }
    if (windowTicks !== getCanonicalWindowTicks(pipelineConfig)) {
      return NextResponse.json({ success: false, error: `The configured feature window requires ${getCanonicalWindowTicks(pipelineConfig)} real ticks.` }, { status: 400, headers: noStore() });
    }

    const result = await buildTrainingDataset({ symbol, horizonTicks, windowTicks, datasetName });
    return NextResponse.json({ success: true, dataSource: 'deriv-real-ticks', dataset: result, pipelineConfig }, { status: 201, headers: noStore() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Training dataset construction failed.';
    const status = /insufficient|required|canonical|No non-flat|leakage|Temporal split/i.test(message) ? 422 : 500;
    return NextResponse.json({ success: false, error: message }, { status, headers: noStore() });
  }
}
