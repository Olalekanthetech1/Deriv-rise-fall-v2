import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '../auth/route';
import { listDurationTrainingDatasets, buildDurationTrainingDataset } from '@/lib/training-dataset-builder-duration-v2';
import { expandTrainingDurations, type DerivDurationRange, type DerivDurationUnit } from '@/lib/deriv-duration-registry';
import { getCachedOrDiscoverDuration } from '@/lib/deriv-duration-cache';
import { initializeMlPipelineConfig } from '@/lib/ml-pipeline-config';
import { getDatasetBuildRuntimeConfig } from '@/lib/dataset-build-runtime-config';
import { archiveAutoDatasetJob, claimNextAutoDatasetJobItem, completeAutoDatasetJobItem, createAutoDatasetJob, failAutoDatasetJobItem, getAutoDatasetJob, getAutoDatasetJobItemStatus, refreshAutoDatasetJobStatus, discardAutoDatasetBuild, skipAutoDatasetJobItem } from '@/lib/auto-dataset-job-store';
import { formatReadableDatasetName } from '@/lib/ml-display-formatters';

const activeWorkers = new Set<string>();

function auth(req: NextRequest) {
  const cookie = req.cookies.get('admin_session_token')?.value;
  const header = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookie) || verifySessionToken(header);
}
function noStore() { return { 'Cache-Control': 'no-store, max-age=0' }; }
function validUnit(v: unknown): v is DerivDurationUnit { return v === 't' || v === 's' || v === 'm' || v === 'h' || v === 'd'; }
function symbolsFrom(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(values.filter((v): v is string => typeof v === 'string').map((v) => v.trim().toUpperCase()).filter((v) => /^[A-Z0-9_./:-]{2,64}$/.test(v)))];
}
function ladder(ranges: DerivDurationRange[]) { return expandTrainingDurations(ranges); }
function matching(ranges: DerivDurationRange[], value: number, unit: DerivDurationUnit) {
  return ranges.filter((range) => {
    if (range.unit !== unit || value < range.min || value > range.max) return false;
    const step = Number.isSafeInteger(range.step) && range.step > 0 ? range.step : 1;
    return (value - range.min) % step === 0;
  });
}
function pretty(datasets: any[]) {
  return datasets.map((dataset) => ({ ...dataset, name: formatReadableDatasetName({ name: dataset.name, assetSymbol: dataset.asset_symbol, assetDisplayName: dataset.metadata?.assetDisplayName, durationValue: dataset.duration_value, durationUnit: dataset.duration_unit }), raw_name: dataset.name }));
}
function feasibility(message: string) { return /^(No persisted real ticks can satisfy|No non-flat directional samples could be constructed|Temporal split validation failed|Insufficient real Deriv ticks|The duration-aware feature window requires)/i.test(message.trim()); }

async function worker(jobId: string, concurrency: number) {
  if (activeWorkers.has(jobId) || activeWorkers.size >= concurrency) return;
  activeWorkers.add(jobId);
  try {
    const job = await getAutoDatasetJob(jobId);
    if (!job || job.status !== 'running') return;
    await initializeMlPipelineConfig();
    const item = await claimNextAutoDatasetJobItem(jobId);
    if (!item) { await refreshAutoDatasetJobStatus(jobId); return; }
    try {
      const result = await buildDurationTrainingDataset({ symbol: job.symbol, durationValue: item.value, durationUnit: item.unit, durationRangeId: item.rangeId });
      const itemStatus = await getAutoDatasetJobItemStatus(jobId, item.id);
      if (itemStatus === 'cancelled') { await discardAutoDatasetBuild(result.datasetId); await refreshAutoDatasetJobStatus(jobId); return; }
      await completeAutoDatasetJobItem(jobId, item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (feasibility(message)) await skipAutoDatasetJobItem(jobId, item.id, message); else await failAutoDatasetJobItem(jobId, item.id, message);
    }
  } finally { activeWorkers.delete(jobId); }
}
function resume(jobIds: string[], concurrency: number) { for (const id of [...new Set(jobIds)]) { if (activeWorkers.size >= concurrency) break; void worker(id, concurrency); } }

async function state(symbol: string) {
  const [datasets, resolved] = await Promise.all([listDurationTrainingDatasets(symbol), getCachedOrDiscoverDuration(symbol)]);
  return { symbol, datasets: pretty(datasets as any[]), durationSource: resolved.source, durationRefreshing: resolved.refreshing, durationCachedAt: resolved.cachedAt, durationDiscovery: resolved.discovery, trainingHorizons: expandTrainingDurations(resolved.discovery.ranges), autoTrainingHorizons: ladder(resolved.discovery.ranges) };
}

function limits() {
  const config = getDatasetBuildRuntimeConfig();
  return { maxAssets: config.maxAssets, concurrency: config.concurrency, pollIntervalMs: config.pollIntervalMs };
}

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const runtime = getDatasetBuildRuntimeConfig();
    const jobIds = symbolsFrom(req.nextUrl.searchParams.get('jobIds') || '').filter((id) => id.includes('-'));
    if (jobIds.length) {
      if (runtime.maxAssets !== null && jobIds.length > runtime.maxAssets) return NextResponse.json({ success: false, error: `A maximum of ${runtime.maxAssets} job IDs may be polled at once.` }, { status: 422, headers: noStore() });
      const running: string[] = [];
      for (const id of jobIds) { const job = await getAutoDatasetJob(id); if (job?.status === 'running') running.push(id); }
      resume(running, runtime.concurrency);
      const jobs = [] as any[];
      for (const id of jobIds) { const job = await getAutoDatasetJob(id); if (job) jobs.push((await refreshAutoDatasetJobStatus(id)) ?? job); }
      return NextResponse.json({ success: true, jobs, limits: { maxAssets: runtime.maxAssets, concurrency: runtime.concurrency, pollIntervalMs: runtime.pollIntervalMs } }, { headers: noStore() });
    }
    const symbols = symbolsFrom(req.nextUrl.searchParams.get('symbols') || req.nextUrl.searchParams.get('symbol') || '');
    if (!symbols.length) return NextResponse.json({ success: false, error: 'At least one asset is required.', limits: limits() }, { status: 400, headers: noStore() });
    if (runtime.maxAssets !== null && symbols.length > runtime.maxAssets) return NextResponse.json({ success: false, error: `A maximum of ${runtime.maxAssets} assets may be selected.`, limits: limits() }, { status: 422, headers: noStore() });
    const assets = await Promise.all(symbols.map(state));
    return NextResponse.json({ success: true, assets, datasets: assets.flatMap((asset) => asset.datasets), selectedSymbols: symbols, limits: { maxAssets: runtime.maxAssets, concurrency: runtime.concurrency, pollIntervalMs: runtime.pollIntervalMs } }, { headers: noStore() });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load dataset builder state.' }, { status: 503, headers: noStore() }); }
}

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const runtime = getDatasetBuildRuntimeConfig();
    const body = await req.json().catch(() => ({}));
    const symbols = symbolsFrom(body?.symbols ?? body?.symbol);
    if (!symbols.length) return NextResponse.json({ success: false, error: 'Select at least one Deriv asset.', limits: { maxAssets: runtime.maxAssets, concurrency: runtime.concurrency, pollIntervalMs: runtime.pollIntervalMs } }, { status: 400, headers: noStore() });
    if (runtime.maxAssets !== null && symbols.length > runtime.maxAssets) return NextResponse.json({ success: false, error: `A maximum of ${runtime.maxAssets} assets may be selected.`, limits: { maxAssets: runtime.maxAssets, concurrency: runtime.concurrency, pollIntervalMs: runtime.pollIntervalMs } }, { status: 422, headers: noStore() });
    await initializeMlPipelineConfig();
    const buildAll = body?.buildAllSupportedHorizons === true;
    const value = Number(body?.durationValue);
    const unit = body?.durationUnit;
    if (!buildAll && (!Number.isSafeInteger(value) || value <= 0 || !validUnit(unit))) return NextResponse.json({ success: false, error: 'A valid duration value and unit are required.' }, { status: 400, headers: noStore() });

    const jobs: any[] = [];
    const results: any[] = [];
    for (const symbol of symbols) {
      try {
        const resolved = await getCachedOrDiscoverDuration(symbol);
        const durations = buildAll
          ? ladder(resolved.discovery.ranges.filter((range) => !unit || range.unit === unit))
          : (() => { const matches = matching(resolved.discovery.ranges, value, unit as DerivDurationUnit); return matches.length ? [{ value, unit: unit as DerivDurationUnit, rangeId: matches[0].id }] : []; })();
        if (!durations.length) { results.push({ symbol, accepted: false, status: 'skipped', reason: 'HORIZON_NOT_SUPPORTED' }); continue; }
        const job = await createAutoDatasetJob(symbol, durations);
        jobs.push(job);
        results.push({ symbol, accepted: true, status: job.status, jobId: job.id, requestedCount: job.requestedCount });
      } catch (error) {
        results.push({ symbol, accepted: false, status: 'failed', error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!jobs.length) return NextResponse.json({ success: false, error: 'None of the selected assets had a supported build scope.', results, limits: { maxAssets: runtime.maxAssets, concurrency: runtime.concurrency, pollIntervalMs: runtime.pollIntervalMs } }, { status: 422, headers: noStore() });
    resume(jobs.map((job) => job.id), runtime.concurrency);
    return NextResponse.json({ success: true, mode: 'MULTI_ASSET_DATASET_BUILD', selectedSymbols: symbols, autoJobIds: jobs.map((job) => job.id), jobs, results, limits: { maxAssets: runtime.maxAssets, concurrency: runtime.concurrency, pollIntervalMs: runtime.pollIntervalMs }, message: buildAll ? `Dataset builds started for ${jobs.length} assets using their own supported horizon ladders.` : `Dataset build started for ${jobs.length} assets at the selected horizon.` }, { status: 202, headers: noStore() });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to start dataset build.' }, { status: 500, headers: noStore() }); }
}

export async function DELETE(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const runtime = getDatasetBuildRuntimeConfig();
    const ids = symbolsFrom(req.nextUrl.searchParams.get('jobIds') || '').filter((id) => id.includes('-'));
    if (!ids.length) return NextResponse.json({ success: false, error: 'jobIds are required.' }, { status: 400, headers: noStore() });
    if (runtime.maxAssets !== null && ids.length > runtime.maxAssets) return NextResponse.json({ success: false, error: `A maximum of ${runtime.maxAssets} job IDs may be archived at once.` }, { status: 422, headers: noStore() });
    const results = await Promise.all(ids.map((id) => archiveAutoDatasetJob(id)));
    if (results.some((result) => result.active)) return NextResponse.json({ success: false, error: 'One or more dataset builds are still running.' }, { status: 409, headers: noStore() });
    return NextResponse.json({ success: true, archivedCount: results.filter((result) => result.archived).length, limits: { maxAssets: runtime.maxAssets, concurrency: runtime.concurrency, pollIntervalMs: runtime.pollIntervalMs } }, { headers: noStore() });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to archive dataset reports.' }, { status: 500, headers: noStore() }); }
}
