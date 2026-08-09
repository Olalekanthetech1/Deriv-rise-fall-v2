import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalIngestionCheckpoint, ingestDerivHistoricalTicks, listHistoricalIngestionRuns } from '@/lib/deriv-historical-ingestion';
import { verifySessionToken } from '../auth/route';

function isAuthenticated(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

function jsonHeaders() {
  return { 'Cache-Control': 'no-store, max-age=0' };
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized admin access.' }, { status: 401, headers: jsonHeaders() });
  }

  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol')?.trim() || undefined;

  const [recentRuns, checkpoint] = await Promise.all([
    listHistoricalIngestionRuns(symbol ? 20 : 10),
    getHistoricalIngestionCheckpoint(symbol),
  ]);

  return NextResponse.json(
    {
      success: true,
      dataSource: 'live-database',
      recentRuns,
      checkpoint,
      realDataOnly: true,
      syntheticDataDisabled: true,
    },
    { headers: jsonHeaders() },
  );
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized admin access.' }, { status: 401, headers: jsonHeaders() });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const symbol = String(body?.symbol || '').trim();
    const count = Number(body?.count ?? 5000);
    const resumeFromCheckpoint = Boolean(body?.resumeFromCheckpoint);

    if (!symbol || symbol.length < 2) {
      return NextResponse.json({ success: false, error: 'A valid Deriv symbol is required.' }, { status: 400, headers: jsonHeaders() });
    }

    if (!Number.isFinite(count) || count < 50 || count > 50000) {
      return NextResponse.json({ success: false, error: 'Count must be between 50 and 50000.' }, { status: 400, headers: jsonHeaders() });
    }

    const checkpoint = resumeFromCheckpoint ? await getHistoricalIngestionCheckpoint(symbol) : null;
    const endEpoch = checkpoint?.lastTickEpoch ? Math.max(1, Math.floor(checkpoint.lastTickEpoch) - 1) : undefined;

    const result = await ingestDerivHistoricalTicks({
      symbol,
      count,
      resumeFromCheckpoint,
      endEpoch,
    });

    return NextResponse.json(
      {
        success: true,
        ...result,
        checkpointUsed: checkpoint,
        realDataOnly: true,
        syntheticDataDisabled: true,
      },
      { headers: jsonHeaders() },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Historical ingestion failed.',
        realDataOnly: true,
      },
      { status: 500, headers: jsonHeaders() },
    );
  }
}
