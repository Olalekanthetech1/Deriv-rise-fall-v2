import { NextRequest, NextResponse } from 'next/server';
import { extract37TickFeatures, TickPoint } from '@/lib/ml-feature-extractor';
import { evaluateProductionEnsemble, ProductionEnsembleResult } from '@/lib/production-ensemble';
import { initDbSchema, getDb } from '@/lib/db';
import { ensureMinTicks } from '@/lib/ticks-helper';
import { buildConsensus, createDuration, durationToSeconds } from '@/lib/signal-manager';

export interface DurationPrediction {
  value: number;
  unit: 't' | 'm' | 'h';
  label: string;
  direction: 'RISE' | 'FALL';
  confidence: number;
  winRate: string;
}

export interface SignalResponseItem {
  id: string;
  name: string;
  category: 'AI' | 'TECHNICAL' | 'VOLATILITY' | 'SENTIMENT';
  direction: 'RISE' | 'FALL';
  confidence: number;
  strength: 'Strong Buy' | 'Buy' | 'Strong Sell' | 'Sell' | 'Neutral';
  recommendedDurationValue: number;
  recommendedDurationUnit: 't' | 'm' | 'h';
  recommendedDurationLabel: string;
  durationMatrix: DurationPrediction[];
  targetBarrier?: string;
  expiresInSeconds: number;
  maxExpirySeconds: number;
  expiresAt: number;
  winRate: string;
  description: string;
  timestamp: number;
}

function normalizeDuration(value: unknown, unit: unknown) {
  const safeValue = Number(value);
  const normalizedValue = Number.isFinite(safeValue) && safeValue > 0 ? safeValue : 5;
  const normalizedUnit: 't' | 'm' | 'h' = unit === 'm' || unit === 'h' ? unit : 't';
  const label = `${normalizedValue} ${normalizedUnit === 't' ? 'Tick' : normalizedUnit === 'm' ? 'Min' : 'Hr'}${normalizedValue === 1 ? '' : 's'}`;
  return { value: normalizedValue, unit: normalizedUnit, label, seconds: durationToSeconds(normalizedValue, normalizedUnit) };
}

function buildSignalItems(ensemble: ProductionEnsembleResult, duration: ReturnType<typeof normalizeDuration>, now: number): SignalResponseItem[] {
  return ensemble.evaluations
    .filter((evaluation) => evaluation.status === 'AVAILABLE' && evaluation.probabilityUp !== null && evaluation.probabilityDown !== null && evaluation.signal !== null && evaluation.confidence !== null)
    .map((evaluation) => {
      const direction = evaluation.signal!;
      const confidence = evaluation.confidence!;
      const expiry = now + duration.seconds * 1000;
      const durationPrediction: DurationPrediction = {
        value: duration.value,
        unit: duration.unit,
        label: duration.label,
        direction,
        confidence,
        winRate: 'Native model probability',
      };
      return {
        id: `sig-${evaluation.modelKey}-${ensemble.symbol}`,
        name: evaluation.modelName,
        category: 'AI',
        direction,
        confidence,
        strength: direction === 'RISE' ? 'Buy' : 'Sell',
        recommendedDurationValue: duration.value,
        recommendedDurationUnit: duration.unit,
        recommendedDurationLabel: duration.label,
        durationMatrix: [durationPrediction],
        expiresInSeconds: duration.seconds,
        maxExpirySeconds: duration.seconds,
        expiresAt: expiry,
        winRate: 'Native model probability',
        description: `${evaluation.details} · Gate ${ensemble.strategyGate.accepted ? 'passed' : 'blocked'} (${ensemble.strategyGate.confidenceGateThreshold}%)`,
        timestamp: now,
      };
    });
}

function buildModeRecommendations(signals: SignalResponseItem[]) {
  if (!signals.length) return [];
  const ranked = [...signals].sort((a, b) => b.confidence - a.confidence);
  const tabular = ranked.find((signal) => /XGBoost|LightGBM|CatBoost/i.test(signal.name)) ?? ranked[0];
  const sequential = ranked.find((signal) => /TCN|LSTM|Transformer/i.test(signal.name)) ?? ranked[0];
  const ai = ranked[0];
  return [
    { mode: 'CLASSIC' as const, source: tabular, rationale: 'Highest-ranked available tabular/native model output.' },
    { mode: 'PRO' as const, source: sequential, rationale: 'Highest-ranked available sequential/native model output.' },
    { mode: 'AI' as const, source: ai, rationale: 'Highest-ranked available native ensemble model output.' },
  ].map(({ mode, source, rationale }) => ({
    mode,
    direction: source.direction,
    confidence: source.confidence,
    duration: createDuration(source.recommendedDurationValue, source.recommendedDurationUnit, source.recommendedDurationLabel),
    sourceSignalId: source.id,
    rationale: `${rationale} ${source.description}`,
  }));
}

export async function POST(req: NextRequest) {
  try {
    await initDbSchema();
    const body = await req.json().catch(() => ({}));
    const symbol = typeof body?.symbol === 'string' && body.symbol.trim() ? body.symbol.trim() : 'R_100';
    const duration = normalizeDuration(body?.durationValue, body?.durationUnit);

    let assetClass: string | undefined;
    let marketType: string | undefined;
    const sql = getDb();
    if (sql) {
      try {
        const rows = await sql`
          SELECT asset_class, market_type
          FROM market_assets
          WHERE symbol = ${symbol}
          LIMIT 1
        `;
        assetClass = rows?.[0]?.asset_class ? String(rows[0].asset_class) : undefined;
        marketType = rows?.[0]?.market_type ? String(rows[0].market_type) : undefined;
      } catch (dbErr) {
        console.warn('[Signal Asset Context Warning]:', dbErr);
      }
    }

    let tickList: TickPoint[] = Array.isArray(body?.ticks) && body.ticks.length > 0 ? body.ticks : [];
    if (tickList.length < 25) tickList = await ensureMinTicks(symbol, 100);
    if (tickList.length < 25) throw new Error(`Insufficient real ticks for signal generation on ${symbol}. Minimum 25 required.`);

    const assetCategoryNum = symbol.startsWith('FRX') || symbol.includes('USD') || symbol.includes('EUR') ? 1 : symbol.startsWith('CWM') || symbol.includes('XAU') || symbol.includes('OIL') ? 2 : 0;
    const features = extract37TickFeatures(tickList, {
      symbol,
      contractDurationSecs: duration.seconds,
      assetCategoryNum,
    });
    const ensemble = await evaluateProductionEnsemble(tickList, {
      symbol,
      durationSecs: duration.seconds,
      durationValue: duration.value,
      durationUnit: duration.unit,
      assetCategory: assetCategoryNum,
      assetClass,
      marketType,
      requiredContextTicks: 100,
    });

    const now = Date.now();
    const generatedSignals = buildSignalItems(ensemble, duration, now);
    if (!generatedSignals.length) throw new Error('NO_NATIVE_MODEL_SIGNALS_AVAILABLE');

    const modeRecommendations = buildModeRecommendations(generatedSignals);
    const consensusBase = buildConsensus(generatedSignals, now);
    const consensus = { ...consensusBase, modeRecommendations };

    let totalVerified = 0;
    let winCount = 0;
    let accuracy = '0.0%';
    if (sql) {
      try {
        const statsRes = await sql`
          SELECT COUNT(*)::int AS total,
                 COUNT(CASE WHEN status = 'WON' THEN 1 END)::int AS wins
          FROM trades
          WHERE status IN ('WON', 'LOST')
        `;
        if (statsRes?.length && statsRes[0].total > 0) {
          totalVerified = statsRes[0].total;
          winCount = statsRes[0].wins;
          accuracy = `${((winCount / totalVerified) * 100).toFixed(1)}%`;
        }
      } catch (dbErr) {
        console.warn('[Signal DB Stats Warning]:', dbErr);
      }
    }

    const winStats = { total: totalVerified, winCount, accuracy };
    const primary = generatedSignals[0];
    if (sql) {
      try {
        await sql`
          INSERT INTO trades (symbol, contract_type, stake, status, prediction_confidence, strategy)
          VALUES (${symbol}, ${primary.direction}, 10, 'PREDICTED', ${primary.confidence}, 'Native Production Ensemble Signal')
        `;
      } catch (dbErr) {
        console.warn('[Signal Prediction Log Warning]:', dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      assetContext: ensemble.assetContext,
      strategyGate: ensemble.strategyGate,
      prediction: {
        signal: ensemble.direction === 'RISE' ? 'CALL' : 'PUT',
        confidence: ensemble.confidence,
        probabilityUp: ensemble.probUp,
        probabilityDown: ensemble.probDown,
        symbol,
        features,
        timestamp: now,
        modelVersion: 'native-production-ensemble',
      },
      signals: generatedSignals,
      winStats,
      consensus,
      modeRecommendations,
      confidence: ensemble.confidence,
      marketRegime: ensemble.marketRegime,
      anomalyScore: ensemble.anomalyScore,
      modelBreakdown: ensemble.modelBreakdown,
      multiModelEnsemble: ensemble,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    console.error('[Signal Prediction Error]:', err);
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Signal prediction failed' }, { status: 503 });
  }
}
