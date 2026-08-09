import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '../auth/route';
import { buildDurationTrainingDataset, getSupportedDurationDiscovery, listDurationTrainingDatasets } from '@/lib/training-dataset-builder-duration-v2';
import { expandTrainingDurations, type DerivDurationRange, type DerivDurationUnit } from '@/lib/deriv-duration-registry';

function isAuthenticated(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}
function noStore() { return { 'Cache-Control': 'no-store, max-age=0' }; }
function validUnit(value: unknown): value is DerivDurationUnit { return value === 't' || value === 's' || value === 'm' || value === 'h' || value === 'd'; }
function matchingRanges(discovery: Awaited<ReturnType<typeof getSupportedDurationDiscovery>>, value: number, unit: DerivDurationUnit) {
  return discovery.ranges.filter((range) => {
    if (range.unit !== unit || value < range.min || value > range.max) return false;
    const step = Number.isSafeInteger(range.step) && range.step > 0 ? range.step : 1;
    return (value - range.min) % step === 0;
  });
}

function expandTrainingHorizonLadder(ranges: DerivDurationRange[]): Array<{ value: number; unit: DerivDurationUnit; rangeId: string }> {
  const result: Array<{ value: number; unit: DerivDurationUnit; rangeId: string }> = [];
  for (const range of ranges) {
    const brokerStep = Number.isSafeInteger(range.step) && range.step > 0 ? range.step : 1;
    let displayStep = brokerStep;
    let start = range.min;
    if ((range.unit === 's' || range.unit === 'm') && brokerStep === 1 && range.max - range.min >= 15) {
      displayStep = Math.max(15, range.min);
      start = Math.ceil(range.min / displayStep) * displayStep;
      if (start > range.max) start = range.min;
      if (start !== range.min) result.push({ value: range.min, unit: range.unit, rangeId: range.id });
    }
    const count = Math.floor((range.max - start) / displayStep) + 1;
    const boundedCount = Math.min(count, 10000);
    for (let index = 0; index < boundedCount; index += 1) {
      const value = start + index * displayStep;
      if (value > range.max) break;
      result.push({ value, unit: range.unit, rangeId: range.id });
    }
    if (!result.some((item) => item.rangeId === range.id && item.value === range.max)) result.push({ value: range.max, unit: range.unit, rangeId: range.id });
  }
  const seen = new Set<string>();
  return result.filter((item) => { const key = `${item.value}:${item.unit}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

type AutoJob = { id: string; symbol: string; status: 'running' | 'completed' | 'failed'; requestedCount: number; completedCount: number; failedCount: number; failures: Array<{ value: number; unit: DerivDurationUnit; error: string }>; startedAt: string; finishedAt?: string };
const autoJobs = new Map<string, AutoJob>();
const activeAutoJobs = new Map<string, string>();

function startAutoBuild(symbol: string, discovery: Awaited<ReturnType<typeof getSupportedDurationDiscovery>>): AutoJob {
  const existingId = activeAutoJobs.get(symbol);
  if (existingId) { const existing = autoJobs.get(existingId); if (existing?.status === 'running') return existing; activeAutoJobs.delete(symbol); }
  const durations = expandTrainingHorizonLadder(discovery.ranges);
  const job: AutoJob = { id: crypto.randomUUID(), symbol, status: 'running', requestedCount: durations.length, completedCount: 0, failedCount: 0, failures: [], startedAt: new Date().toISOString() };
  autoJobs.set(job.id, job); activeAutoJobs.set(symbol, job.id);
  void (async () => {
    try {
      for (const duration of durations) {
        try { await buildDurationTrainingDataset({ symbol, durationValue: duration.value, durationUnit: duration.unit, durationRangeId: duration.rangeId }); job.completedCount += 1; }
        catch (error) { job.failedCount += 1; job.failures.push({ value: duration.value, unit: duration.unit, error: error instanceof Error ? error.message : String(error) }); }
      }
      job.status = 'completed';
    } catch (error) { job.status = 'failed'; job.failures.push({ value: 0, unit: 't', error: error instanceof Error ? error.message : String(error) }); }
    finally { job.finishedAt = new Date().toISOString(); activeAutoJobs.delete(symbol); }
  })();
  return job;
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const symbol = req.nextUrl.searchParams.get('symbol')?.trim().toUpperCase() || undefined;
    const autoJobId = req.nextUrl.searchParams.get('autoJobId')?.trim();
    if (autoJobId) { const job = autoJobs.get(autoJobId); if (!job) return NextResponse.json({ success: false, error: 'AUTO dataset build job was not found on this application instance.' }, { status: 404, headers: noStore() }); return NextResponse.json({ success: true, job }, { headers: noStore() }); }
    const datasets = await listDurationTrainingDatasets(symbol);
    if (!symbol) return NextResponse.json({ success: true, datasets, durationSource: 'deriv-dynamic' }, { headers: noStore() });
    const discovery = await getSupportedDurationDiscovery(symbol);
    return NextResponse.json({ success: true, datasets, durationSource: discovery.source, durationDiscovery: discovery, trainingHorizons: expandTrainingHorizonLadder(discovery.ranges), brokerTrainingHorizons: expandTrainingDurations(discovery.ranges) }, { headers: noStore() });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load training dataset operations.' }, { status: 503, headers: noStore() }); }
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const body = await req.json().catch(() => ({}));
    const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    if (!symbol) return NextResponse.json({ success: false, error: 'A Deriv symbol is required.' }, { status: 400, headers: noStore() });
    const discovery = await getSupportedDurationDiscovery(symbol);
    if (body?.buildAllSupportedHorizons === true) {
      const job = startAutoBuild(symbol, discovery);
      const result = { status: job.status, jobId: job.id, requestedCount: job.requestedCount, completedCount: job.completedCount, failedCount: job.failedCount };
      return NextResponse.json({ success: true, accepted: true, dataSource: 'deriv-real-ticks', durationSource: discovery.source, result, job, message: `AUTO dataset build started for ${job.requestedCount} dynamically discovered training horizons.` }, { status: 202, headers: noStore() });
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
    const result = await buildDurationTrainingDataset({ symbol, durationValue, durationUnit, windowTicks, datasetName, contractType: requestedContractType || discoveredContractTypes, durationRangeId });
    return NextResponse.json({ success: true, dataSource: 'deriv-real-ticks', durationSource: discovery.source, dataset: result }, { status: 201, headers: noStore() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Training dataset construction failed.';
    const status = /insufficient|required|duration|leakage|Temporal split|No non-flat/i.test(message) ? 422 : 500;
    return NextResponse.json({ success: false, error: message }, { status, headers: noStore() });
  }
}
