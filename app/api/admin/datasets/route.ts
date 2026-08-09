import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '../auth/route';
import { buildAllSupportedDurationDatasets, buildDurationTrainingDataset, getSupportedDurationDiscovery, listDurationTrainingDatasets } from '@/lib/training-dataset-builder-duration';
import { expandTrainingDurations } from '@/lib/deriv-duration-registry';

function isAuthenticated(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}
function noStore() { return { 'Cache-Control': 'no-store, max-age=0' }; }
function validUnit(value: unknown): value is 't' | 's' | 'm' | 'h' | 'd' { return value === 't' || value === 's' || value === 'm' || value === 'h' || value === 'd'; }
function matchingRanges(discovery: Awaited<ReturnType<typeof getSupportedDurationDiscovery>>, value: number, unit: 't' | 's' | 'm' | 'h' | 'd') { return discovery.ranges.filter((range) => range.unit === unit && value >= range.min && value <= range.max); }

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const symbol = req.nextUrl.searchParams.get('symbol')?.trim().toUpperCase() || undefined;
    const datasets = await listDurationTrainingDatasets(symbol);
    if (!symbol) return NextResponse.json({ success: true, datasets, durationSource: 'deriv-dynamic' }, { headers: noStore() });
    const discovery = await getSupportedDurationDiscovery(symbol);
    return NextResponse.json({ success: true, datasets, durationSource: discovery.source, durationDiscovery: discovery, trainingHorizons: expandTrainingDurations(discovery.ranges) }, { headers: noStore() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load training dataset operations.' }, { status: 503, headers: noStore() });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const body = await req.json().catch(() => ({}));
    const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    if (!symbol) return NextResponse.json({ success: false, error: 'A Deriv symbol is required.' }, { status: 400, headers: noStore() });

    const discovery = await getSupportedDurationDiscovery(symbol);
    if (body?.buildAllSupportedHorizons === true) {
      const result = await buildAllSupportedDurationDatasets(symbol);
      return NextResponse.json({ success: true, dataSource: 'deriv-real-ticks', durationSource: discovery.source, result }, { status: 201, headers: noStore() });
    }

    const legacyHorizon = body?.horizonTicks;
    const durationValue = legacyHorizon != null ? Number(legacyHorizon) : Number(body?.durationValue);
    const durationUnit = legacyHorizon != null ? 't' : body?.durationUnit;
    const windowTicks = body?.windowTicks == null ? undefined : Number(body.windowTicks);
    const datasetName = typeof body?.datasetName === 'string' ? body.datasetName.trim() : undefined;
    const requestedContractType = typeof body?.contractType === 'string' ? body.contractType.trim() : undefined;
    const durationRangeId = typeof body?.durationRangeId === 'string' ? body.durationRangeId.trim() : undefined;

    if (!Number.isSafeInteger(durationValue) || durationValue <= 0) return NextResponse.json({ success: false, error: 'A broker-discovered positive duration value is required.' }, { status: 400, headers: noStore() });
    if (!validUnit(durationUnit)) return NextResponse.json({ success: false, error: 'A valid Deriv duration unit (ticks, seconds, minutes, hours, or days) is required.' }, { status: 400, headers: noStore() });

    const supported = matchingRanges(discovery, durationValue, durationUnit);
    if (!supported.length) return NextResponse.json({ success: false, error: `Deriv does not currently advertise ${durationValue}${durationUnit} for ${symbol}.` }, { status: 422, headers: noStore() });

    const discoveredContractTypes = Array.from(new Set(supported.flatMap((range) => range.tradeTypes))).filter(Boolean).join(',').slice(0, 64) || undefined;
    const contractType = requestedContractType || discoveredContractTypes;
    const result = await buildDurationTrainingDataset({ symbol, durationValue, durationUnit, windowTicks, datasetName, contractType, durationRangeId });
    return NextResponse.json({ success: true, dataSource: 'deriv-real-ticks', durationSource: discovery.source, dataset: result }, { status: 201, headers: noStore() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Training dataset construction failed.';
    const status = /insufficient|required|duration|leakage|Temporal split|No non-flat/i.test(message) ? 422 : 500;
    return NextResponse.json({ success: false, error: message }, { status, headers: noStore() });
  }
}
