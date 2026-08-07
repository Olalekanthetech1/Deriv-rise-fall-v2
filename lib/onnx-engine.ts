import path from 'path';
import fs from 'fs';
import { xgboostDaemon } from './xgboost-daemon';
import { extract37TickFeatures, TickPoint } from './ml-feature-extractor';

export interface MultiHorizonPrediction {
  symbol: string;
  bestDurationSecs: number;
  confidence: number;
  signal: 'CALL' | 'PUT';
  horizons: {
    [key: string]: {
      durationSecs: number;
      signal: 'CALL' | 'PUT';
      confidence: number;
      rawScore: number;
      engine: string;
    };
  };
  timestamp: number;
}

export class OnnxMultiHorizonEngine {
  /**
   * Run multi-horizon predictions across 5s, 60s, and 300s contract durations simultaneously.
   * Dynamically selects the duration horizon with the highest edge confidence.
   */
  public async predictMultiHorizon(
    ticks: TickPoint[],
    options: { symbol?: string; assetCategory?: number } = {}
  ): Promise<MultiHorizonPrediction> {
    const symbol = options.symbol || 'R_100';
    const durations = [5, 60, 300];
    const horizonResults: Record<string, any> = {};

    let bestDuration = 5;
    let maxConfidence = 0.0;
    let primarySignal: 'CALL' | 'PUT' = 'CALL';

    for (const durationSecs of durations) {
      // Attempt prediction via persistent Python daemon (ONNX/XGBoost)
      const daemonRes = await xgboostDaemon.sendCommand('predict', {
        symbol,
        durationSecs,
        assetCategory: options.assetCategory || 0,
        ticks: ticks.map((t) => ({ price: t.price, timestamp: t.timestamp })),
      });

      if (!daemonRes || !daemonRes.success) {
        throw new Error(`Python Engine failed to predict for ${symbol} at ${durationSecs}s. Reason: ${daemonRes?.error || 'Unknown Error'}`);
      }

      const resultSignal = daemonRes.signal;
      const resultConfidence = daemonRes.confidence || 50.0;
      const resultRawScore = daemonRes.rawScore || 0.5;
      const engineName = daemonRes.engine || 'Warm Python Daemon';

      horizonResults[`${durationSecs}s`] = {
        durationSecs,
        signal: resultSignal,
        confidence: resultConfidence,
        rawScore: resultRawScore,
        engine: engineName,
      };

      if (resultConfidence > maxConfidence) {
        maxConfidence = resultConfidence;
        bestDuration = durationSecs;
        primarySignal = resultSignal as 'CALL' | 'PUT';
      }
    }

    return {
      symbol,
      bestDurationSecs: bestDuration,
      confidence: maxConfidence,
      signal: primarySignal,
      horizons: horizonResults,
      timestamp: Date.now(),
    };
  }
}

export const onnxMultiHorizonEngine = new OnnxMultiHorizonEngine();
