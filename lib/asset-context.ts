import { durationToSeconds, type SignalDirection } from './signal-manager';

export type AssetDurationUnit = 't' | 'm' | 'h';
export type AssetClass = 'synthetic' | 'forex' | 'commodity' | 'index' | 'crypto' | 'equity' | 'unknown';
export type MarketType = 'synthetic' | 'spot' | 'cfd' | 'options' | 'unknown';

export interface AssetAwareContextInput {
  symbol: string;
  durationValue?: number | null;
  durationUnit?: AssetDurationUnit | null;
  durationSeconds?: number | null;
  assetCategory?: number | null;
  assetClass?: string | null;
  marketType?: string | null;
  tickCount?: number | null;
  requiredContextTicks?: number | null;
  pipSize?: number | null;
}

export interface AssetDurationDescriptor {
  value: number;
  unit: AssetDurationUnit;
  seconds: number;
  label: string;
  band: 'tick' | 'seconds' | 'minutes' | 'hours';
}

export interface AssetAwareSignalContext {
  symbol: string;
  assetCategory: number;
  assetClass: AssetClass;
  marketType: MarketType;
  assetLabel: string;
  duration: AssetDurationDescriptor;
  tickCount: number | null;
  requiredContextTicks: number;
  qualityScore: number;
  confidenceGateThreshold: number;
  strategyMode: 'CLASSIC' | 'PRO' | 'AI';
  accepted: boolean;
  rationale: string[];
}

export interface SignalStrategyGate {
  accepted: boolean;
  confidenceGateThreshold: number;
  riskTier: 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH';
  action: 'EXECUTE_CALL' | 'EXECUTE_PUT' | 'HOLD_NO_SIGNAL';
  reasons: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function inferAssetCategory(symbol: string, assetCategory?: number | null): number {
  if (Number.isFinite(assetCategory)) return Math.max(0, Math.min(3, Number(assetCategory)));
  const text = symbol.toUpperCase();
  if (/^(FRX|FX)/.test(text) || /(USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD|XAU|XAG)/.test(text)) return 1;
  if (/^(R_|1HZ|2HZ|3HZ|4HZ|5HZ|6HZ|7HZ|8HZ|9HZ|10HZ)/.test(text)) return 0;
  if (/(XAU|XAG|OIL|WTI|BRENT|COM|GOLD|SILVER|NATGAS)/.test(text)) return 2;
  if (/(BTC|ETH|SOL|XRP|ADA|DOGE|LTC|BNB)/.test(text)) return 3;
  return 0;
}

function inferAssetClass(symbol: string, category: number, assetClass?: string | null): AssetClass {
  const normalized = normalizeText(assetClass);
  if (normalized === 'synthetic' || normalized === 'forex' || normalized === 'commodity' || normalized === 'index' || normalized === 'crypto' || normalized === 'equity') {
    return normalized;
  }
  const text = symbol.toUpperCase();
  if (category === 1 || /^(FRX|FX)/.test(text) || /(USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD)/.test(text)) return 'forex';
  if (category === 2 || /(XAU|XAG|OIL|WTI|BRENT|COM|GOLD|SILVER|NATGAS)/.test(text)) return 'commodity';
  if (category === 3 || /(BTC|ETH|SOL|XRP|ADA|DOGE|LTC|BNB)/.test(text)) return 'crypto';
  if (/^(R_|1HZ|2HZ|3HZ|4HZ|5HZ|6HZ|7HZ|8HZ|9HZ|10HZ)/.test(text)) return 'synthetic';
  if (/INDEX|VOLATILITY|CWM|IDX/.test(text)) return 'index';
  return 'unknown';
}

function inferMarketType(symbol: string, marketType?: string | null): MarketType {
  const normalized = normalizeText(marketType);
  if (normalized === 'synthetic' || normalized === 'spot' || normalized === 'cfd' || normalized === 'options') {
    return normalized;
  }
  const text = symbol.toUpperCase();
  if (/^(R_|1HZ|2HZ|3HZ|4HZ|5HZ|6HZ|7HZ|8HZ|9HZ|10HZ)/.test(text)) return 'synthetic';
  if (/(FRX|FX|BTC|ETH|SOL|XRP|ADA|DOGE|LTC|BNB)/.test(text)) return 'spot';
  if (/(XAU|XAG|OIL|WTI|BRENT|COM|INDEX|VOLATILITY|CWM|IDX)/.test(text)) return 'cfd';
  return 'unknown';
}

function resolveDurationDescriptor(input: AssetAwareContextInput): AssetDurationDescriptor {
  const valueCandidate = Number(input.durationValue);
  const secondsCandidate = Number(input.durationSeconds);
  const unitCandidate = input.durationUnit;

  const hasExplicitDuration = Number.isFinite(valueCandidate) && valueCandidate > 0 && (unitCandidate === 't' || unitCandidate === 'm' || unitCandidate === 'h');
  if (hasExplicitDuration) {
    const seconds = durationToSeconds(valueCandidate, unitCandidate!);
    const band = unitCandidate === 'm' ? 'minutes' : unitCandidate === 'h' ? 'hours' : 'tick';
    const label = `${valueCandidate} ${unitCandidate === 't' ? 'Tick' : unitCandidate === 'm' ? 'Min' : 'Hr'}${valueCandidate === 1 ? '' : 's'}`;
    return { value: valueCandidate, unit: unitCandidate!, seconds, label, band };
  }

  const inferredSeconds = Number.isFinite(secondsCandidate) && secondsCandidate > 0 ? secondsCandidate : 1;
  if (inferredSeconds >= 3600 && inferredSeconds % 3600 === 0) {
    const hours = Math.max(1, Math.round(inferredSeconds / 3600));
    return { value: hours, unit: 'h', seconds: inferredSeconds, label: `${hours} Hr${hours === 1 ? '' : 's'}`, band: 'hours' };
  }
  if (inferredSeconds >= 60 && inferredSeconds % 60 === 0) {
    const minutes = Math.max(1, Math.round(inferredSeconds / 60));
    return { value: minutes, unit: 'm', seconds: inferredSeconds, label: `${minutes} Min${minutes === 1 ? '' : 's'}`, band: 'minutes' };
  }
  const ticks = Math.max(1, Math.round(Number.isFinite(valueCandidate) && valueCandidate > 0 ? valueCandidate : inferredSeconds));
  return { value: ticks, unit: 't', seconds: Math.max(1, Math.round(inferredSeconds)), label: `${ticks} Tick${ticks === 1 ? '' : 's'}`, band: 'tick' };
}

function deriveStrategyMode(assetClass: AssetClass, marketType: MarketType, durationBand: AssetDurationDescriptor['band']): 'CLASSIC' | 'PRO' | 'AI' {
  const text = `${assetClass} ${marketType}`;
  if (assetClass === 'synthetic' || durationBand === 'tick') return 'CLASSIC';
  if (assetClass === 'commodity' || assetClass === 'equity' || durationBand === 'hours') return 'AI';
  if (/forex|crypto|spot/.test(text)) return 'PRO';
  return 'PRO';
}

export function resolveAssetAwareSignalContext(input: AssetAwareContextInput): AssetAwareSignalContext {
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const assetCategory = inferAssetCategory(symbol, input.assetCategory);
  const assetClass = inferAssetClass(symbol, assetCategory, input.assetClass);
  const marketType = inferMarketType(symbol, input.marketType);
  const duration = resolveDurationDescriptor(input);
  const requiredContextTicks = Math.max(25, Number.isFinite(input.requiredContextTicks) ? Number(input.requiredContextTicks) : 25);
  const tickCount = Number.isFinite(input.tickCount) && Number(input.tickCount) > 0 ? Number(input.tickCount) : null;
  const qualityScoreRaw = tickCount !== null ? tickCount / requiredContextTicks : 1;
  const qualityScore = clamp(qualityScoreRaw, 0.4, 1);

  let confidenceGateThreshold = 70;
  if (assetClass === 'synthetic') confidenceGateThreshold += 2;
  if (assetClass === 'commodity' || assetClass === 'equity') confidenceGateThreshold += 3;
  if (assetClass === 'crypto') confidenceGateThreshold += 1;
  if (duration.band === 'minutes') confidenceGateThreshold += 1;
  if (duration.band === 'hours') confidenceGateThreshold += 2;
  if (qualityScore < 0.75) confidenceGateThreshold += 1;
  if (qualityScore < 0.6) confidenceGateThreshold += 2;
  confidenceGateThreshold = clamp(confidenceGateThreshold, 68, 92);

  return {
    symbol,
    assetCategory,
    assetClass,
    marketType,
    assetLabel: `${assetClass.toUpperCase()} · ${marketType.toUpperCase()}`,
    duration,
    tickCount,
    requiredContextTicks,
    qualityScore: Number(qualityScore.toFixed(3)),
    confidenceGateThreshold,
    strategyMode: deriveStrategyMode(assetClass, marketType, duration.band),
    accepted: qualityScore >= 0.5,
    rationale: [
      `Symbol context resolved as ${assetClass} on ${marketType}.`,
      `Duration band resolved to ${duration.label} (${duration.band}).`,
      `Context quality score: ${Number(qualityScore.toFixed(3))}.`,
      `Confidence gate threshold: ${confidenceGateThreshold}%.`,
    ],
  };
}

export function evaluateSignalStrategyGate(
  context: AssetAwareSignalContext,
  ensembleConfidence: number,
  availableModels: number,
  anomalyRisk: string | null | undefined,
): SignalStrategyGate {
  const reasons = [...context.rationale];
  const numericConfidence = Number(ensembleConfidence);
  const validConfidence = Number.isFinite(numericConfidence) ? numericConfidence : 0;
  const hasModels = Number.isFinite(availableModels) && Number(availableModels) > 0;
  const anomalyHigh = String(anomalyRisk || '').toUpperCase() === 'HIGH';
  const accepted = context.accepted && hasModels && !anomalyHigh && validConfidence >= context.confidenceGateThreshold;

  reasons.push(`Ensemble confidence: ${validConfidence.toFixed(2)}%.`);
  reasons.push(`Available models: ${Math.max(0, Math.floor(Number.isFinite(availableModels) ? Number(availableModels) : 0))}.`);
  reasons.push(anomalyHigh ? 'Anomaly risk is HIGH.' : `Anomaly risk: ${String(anomalyRisk || 'UNKNOWN').toUpperCase()}.`);
  reasons.push(accepted ? 'Strategy gate accepted.' : 'Strategy gate blocked.' );

  return {
    accepted,
    confidenceGateThreshold: context.confidenceGateThreshold,
    riskTier: !hasModels || anomalyHigh ? 'HIGH' : validConfidence < context.confidenceGateThreshold ? 'ELEVATED' : context.qualityScore < 0.75 ? 'MODERATE' : 'LOW',
    action: accepted ? 'EXECUTE_CALL' : 'HOLD_NO_SIGNAL',
    reasons,
  };
}
