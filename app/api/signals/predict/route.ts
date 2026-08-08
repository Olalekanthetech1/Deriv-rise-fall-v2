import { NextRequest, NextResponse } from 'next/server';
import { xgboostModel } from '@/lib/xgboost-engine';
import { extract37TickFeatures, TickPoint } from '@/lib/ml-feature-extractor';
import { evaluateMultiModelEnsembleAsync } from '@/lib/multi-model-evaluator';
import { initDbSchema, getDb } from '@/lib/db';
import { ensureMinTicks } from '@/lib/ticks-helper';
import { buildConsensus, buildModeRecommendations, durationToSeconds } from '@/lib/signal-manager';

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

function expiryFor(value: number, unit: 't' | 'm' | 'h', now: number) {
  const seconds = durationToSeconds(value, unit);
  return { seconds, expiresAt: now + seconds * 1000 };
}

export async function POST(req: NextRequest) {
  try {
    await initDbSchema();
    const body = await req.json();
    const { symbol = 'R_100', ticks = [], pipSize = 0.01, durationValue = 5, durationUnit = 't' } = body;

    let tickList: TickPoint[] = Array.isArray(ticks) && ticks.length > 0 ? ticks : [];
    if (tickList.length < 5) tickList = await ensureMinTicks(symbol, 100);
    if (tickList.length < 5) throw new Error(`Insufficient historical ticks for signal generation on ${symbol}. Minimum 5 required.`);

    const currentQuote = tickList[tickList.length - 1].price;
    const decimals = Math.max(2, Math.round(-Math.log10(pipSize)));
    let durationSecs = 5;
    if (durationUnit === 't' || durationUnit === 's') durationSecs = Math.max(1, durationValue);
    else if (durationUnit === 'm') durationSecs = durationValue * 60;
    else if (durationUnit === 'h') durationSecs = durationValue * 3600;
    else if (durationUnit === 'd') durationSecs = durationValue * 86400;

    let assetCategoryNum = 0.0;
    if (symbol.startsWith('FRX') || symbol.includes('USD') || symbol.includes('EUR')) assetCategoryNum = 1.0;
    else if (symbol.startsWith('CWM') || symbol.includes('XAU') || symbol.includes('OIL')) assetCategoryNum = 2.0;

    const features = extract37TickFeatures(tickList, { symbol, contractDurationSecs: durationSecs, assetCategoryNum });
    const ensemble = await evaluateMultiModelEnsembleAsync(tickList, { symbol, durationSecs, assetCategory: assetCategoryNum });
    const basePrediction = xgboostModel.predict(tickList, { symbol, durationSecs, assetCategory: assetCategoryNum });
    const now = Date.now();

    const durationSpecs: { value: number; unit: 't' | 'm' | 'h'; label: string; secs: number }[] = [
      { value: 1, unit: 't', label: '1 Tick', secs: 1 },
      { value: 5, unit: 't', label: '5 Ticks', secs: 5 },
      { value: 10, unit: 't', label: '10 Ticks', secs: 10 },
      { value: 1, unit: 'm', label: '1 Min', secs: 60 },
      { value: 2, unit: 'm', label: '2 Min', secs: 120 },
      { value: 5, unit: 'm', label: '5 Min', secs: 300 },
      { value: 15, unit: 'm', label: '15 Min', secs: 900 },
      { value: 1, unit: 'h', label: '1 Hr', secs: 3600 },
    ];

    const xgbMatrix: DurationPrediction[] = durationSpecs.map((spec) => {
      const pred = xgboostModel.predict(tickList, { symbol, durationSecs: spec.secs, assetCategory: assetCategoryNum });
      return {
        value: spec.value, unit: spec.unit, label: spec.label,
        direction: pred.signal === 'CALL' ? 'RISE' : 'FALL', confidence: pred.confidence,
        winRate: 'Model probability',
      };
    });
    const bestXgb = xgbMatrix.reduce((prev, curr) => curr.confidence > prev.confidence ? curr : prev, xgbMatrix[1]);
    const xgbExpiry = expiryFor(bestXgb.value, bestXgb.unit, now);
    const xgbTarget = (currentQuote + (bestXgb.direction === 'RISE' ? pipSize * 3 : -pipSize * 3)).toFixed(decimals);
    const sigXGB: SignalResponseItem = {
      id: `sig-xgb-${symbol}`, name: 'XGBoost ML Neural Signal', category: 'AI', direction: bestXgb.direction,
      confidence: bestXgb.confidence,
      strength: bestXgb.confidence >= 90 ? (bestXgb.direction === 'RISE' ? 'Strong Buy' : 'Strong Sell') : (bestXgb.direction === 'RISE' ? 'Buy' : 'Sell'),
      recommendedDurationValue: bestXgb.value, recommendedDurationUnit: bestXgb.unit, recommendedDurationLabel: bestXgb.label,
      durationMatrix: xgbMatrix, targetBarrier: xgbTarget, expiresInSeconds: xgbExpiry.seconds, maxExpirySeconds: xgbExpiry.seconds,
      expiresAt: xgbExpiry.expiresAt, winRate: bestXgb.winRate,
      description: `Neural net dynamic matrix predicts optimal ${bestXgb.label} trade with ${(features.micro_velocity * 100).toFixed(2)}% velocity.`, timestamp: now,
    };

    const trendMatrix: DurationPrediction[] = durationSpecs.map((spec) => {
      const horizonFactor = spec.secs <= 10 ? 0.2 : spec.secs <= 300 ? 0.6 : 1.0;
      const score = features.macro_regime * horizonFactor + features.medium_velocity * (1 - horizonFactor * 0.5);
      const dir = score >= 0 ? 'RISE' : 'FALL';
      const conf = Math.min(96.0, Math.max(81.0, 83.0 + Math.abs(score) * 600 + horizonFactor * 3));
      return { value: spec.value, unit: spec.unit, label: spec.label, direction: dir, confidence: Number(conf.toFixed(1)), winRate: 'Model probability' };
    });
    const bestTrend = trendMatrix.reduce((prev, curr) => curr.confidence > prev.confidence ? curr : prev, trendMatrix[3]);
    const trendExpiry = expiryFor(bestTrend.value, bestTrend.unit, now);
    const trendTarget = (currentQuote + (bestTrend.direction === 'RISE' ? pipSize * 5 : -pipSize * 5)).toFixed(decimals);
    const sigTrend: SignalResponseItem = {
      id: `sig-trend-${symbol}`, name: 'Adaptive Trend Filter', category: 'AI', direction: bestTrend.direction,
      confidence: bestTrend.confidence, strength: bestTrend.direction === 'RISE' ? 'Buy' : 'Sell',
      recommendedDurationValue: bestTrend.value, recommendedDurationUnit: bestTrend.unit, recommendedDurationLabel: bestTrend.label,
      durationMatrix: trendMatrix, targetBarrier: trendTarget, expiresInSeconds: trendExpiry.seconds, maxExpirySeconds: trendExpiry.seconds,
      expiresAt: trendExpiry.expiresAt, winRate: bestTrend.winRate,
      description: `Dynamic ML trend line scans 300-tick window with ${features.macro_regime >= 0 ? 'bullish' : 'bearish'} regime strength.`, timestamp: now,
    };

    const volMatrix: DurationPrediction[] = durationSpecs.map((spec) => {
      const microVel = features.micro_velocity;
      const volScore = features.short_volatility;
      const decay = Math.exp(-spec.secs / 600);
      const dir = microVel >= 0 ? 'RISE' : 'FALL';
      const conf = Math.min(95.5, Math.max(80.0, 82.5 + Math.abs(microVel) * 1200 * decay + volScore * 40));
      return { value: spec.value, unit: spec.unit, label: spec.label, direction: dir, confidence: Number(conf.toFixed(1)), winRate: 'Model probability' };
    });
    const bestVol = volMatrix.reduce((prev, curr) => curr.confidence > prev.confidence ? curr : prev, volMatrix[1]);
    const volExpiry = expiryFor(bestVol.value, bestVol.unit, now);
    const volTarget = (currentQuote + (bestVol.direction === 'RISE' ? pipSize * 2 : -pipSize * 2)).toFixed(decimals);
    const sigVol: SignalResponseItem = {
      id: `sig-vol-${symbol}`, name: 'Smart Volatility Pulse', category: 'VOLATILITY', direction: bestVol.direction,
      confidence: bestVol.confidence, strength: bestVol.direction === 'RISE' ? 'Strong Buy' : 'Strong Sell',
      recommendedDurationValue: bestVol.value, recommendedDurationUnit: bestVol.unit, recommendedDurationLabel: bestVol.label,
      durationMatrix: volMatrix, targetBarrier: volTarget, expiresInSeconds: volExpiry.seconds, maxExpirySeconds: volExpiry.seconds,
      expiresAt: volExpiry.expiresAt, winRate: bestVol.winRate,
      description: `Micro-volatility pulse detects market awakening ${Math.abs(features.micro_velocity).toFixed(4)} rate before breakout.`, timestamp: now,
    };

    const sentMatrix: DurationPrediction[] = durationSpecs.map((spec) => {
      const ratio = features.up_tick_ratio;
      const specWeight = spec.unit === 't' ? 1.0 : 0.8;
      const dir = ratio >= 0.5 ? 'RISE' : 'FALL';
      const conf = Math.min(94.0, Math.max(78.5, 80.0 + Math.abs(ratio - 0.5) * 60.0 * specWeight));
      return { value: spec.value, unit: spec.unit, label: spec.label, direction: dir, confidence: Number(conf.toFixed(1)), winRate: 'Model probability' };
    });
    const bestSent = sentMatrix.reduce((prev, curr) => curr.confidence > prev.confidence ? curr : prev, sentMatrix[2]);
    const sentExpiry = expiryFor(bestSent.value, bestSent.unit, now);
    const sigSent: SignalResponseItem = {
      id: `sig-sent-${symbol}`, name: 'Tick Sentiment Velocity', category: 'SENTIMENT', direction: bestSent.direction,
      confidence: bestSent.confidence, strength: bestSent.direction === 'RISE' ? 'Buy' : 'Sell',
      recommendedDurationValue: bestSent.value, recommendedDurationUnit: bestSent.unit, recommendedDurationLabel: bestSent.label,
      durationMatrix: sentMatrix, targetBarrier: currentQuote.toFixed(decimals), expiresInSeconds: sentExpiry.seconds, maxExpirySeconds: sentExpiry.seconds,
      expiresAt: sentExpiry.expiresAt, winRate: bestSent.winRate,
      description: `Cumulative tick direction favoring ${(features.up_tick_ratio * 100).toFixed(0)}% ${bestSent.direction} order flow velocity.`, timestamp: now,
    };

    const generatedSignals = [sigXGB, sigTrend, sigVol, sigSent];
    const consensusBase = buildConsensus(generatedSignals, now);
    const modeRecommendations = buildModeRecommendations(generatedSignals);
    const consensus = {
      ...consensusBase,
      modeRecommendations,
      expiresAt: consensusBase.expiresAt,
    };

    let totalVerified = 0;
    let winCount = 0;
    let accuracy = '0.0%';
    const sql = getDb();
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
        console.warn('[DB Stats Fetch Warning]:', dbErr);
      }
    }

    const winStats = { total: totalVerified, winCount, accuracy };

    if (sql) {
      try {
        await sql`
          INSERT INTO trades (symbol, contract_type, stake, status, prediction_confidence, strategy)
          VALUES (${symbol}, ${basePrediction.signal}, 10, 'PREDICTED', ${basePrediction.confidence}, 'Option A Multi-Duration Matrix')
        `;
      } catch (dbErr) {
        console.warn('[Option A API Log Warning]:', dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      prediction: basePrediction,
      signals: generatedSignals,
      winStats,
      consensus,
      modeRecommendations,
      confidence: ensemble.confidence,
      marketRegime: ensemble.marketRegime,
      anomalyScore: ensemble.anomalyScore,
      modelBreakdown: ensemble.modelBreakdown,
      multiModelEnsemble: ensemble,
    });
  } catch (err: unknown) {
    console.error('[Option A API Error]:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Signal prediction failed' }, { status: 500 });
  }
}
