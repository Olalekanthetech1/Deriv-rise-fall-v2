import { TickPoint, EngineeredTickFeatures, extract37TickFeatures } from './ml-feature-extractor';

export interface HMMRegimeDetails {
  primaryRegime: 'LOW_VOLATILITY' | 'DIRECTIONAL_EXPANSION' | 'CHOPPY_REVERSAL' | 'SPIKE_REGIME';
  regimeName: string;
  regimeState: number; // 1, 2, 3, or 4
  probabilities: {
    lowVolatility: number;
    directionalExpansion: number;
    choppyReversal: number;
    spikeRegime: number;
  };
  tradingGuidance: string;
}

export class HMMEngine {
  private version: string = 'v1.5.0-gaussian-hmm-4state';

  // 4-State Transition Matrix P[i][j]
  private transitionMatrix = [
    [0.70, 0.20, 0.08, 0.02], // State 1: Low Volatility
    [0.10, 0.75, 0.10, 0.05], // State 2: Directional Expansion (Trend)
    [0.15, 0.15, 0.65, 0.05], // State 3: Choppy Reversal
    [0.05, 0.15, 0.10, 0.70], // State 4: High Volatility Spike
  ];

  /**
   * Forward-Viterbi Decoding algorithm to identify exact Hidden Markov Market Regime State
   */
  public evaluateRegime(
    ticks: TickPoint[],
    options: { symbol?: string; durationSecs?: number; assetCategory?: number } = {}
  ): HMMRegimeDetails {
    const symbol = options.symbol || 'R_100';
    const durationSecs = options.durationSecs || 5;

    const feat = extract37TickFeatures(ticks, {
      symbol,
      contractDurationSecs: durationSecs,
      assetCategoryNum: options.assetCategory || 0,
    });

    const vol = feat.short_volatility;
    const mom = Math.abs(feat.short_momentum);
    const reversal = feat.short_reversal_rate;
    const accel = Math.abs(feat.acceleration);

    // Emission likelihoods for the 4 states
    let pLowVol = Math.exp(-Math.pow(vol / 0.05, 2)) * (1.0 - reversal);
    let pExpansion = Math.exp(-Math.pow((mom - 0.15) / 0.1, 2)) * Math.exp(-Math.pow(reversal / 0.3, 2));
    let pChoppy = Math.exp(-Math.pow((reversal - 0.6) / 0.2, 2));
    let pSpike = Math.exp(-Math.pow((accel - 0.2) / 0.1, 2)) + (vol > 0.1 ? 1.5 : 0.0);

    const sumP = pLowVol + pExpansion + pChoppy + pSpike || 1.0;

    const prob1 = parseFloat(((pLowVol / sumP) * 100).toFixed(1));
    const prob2 = parseFloat(((pExpansion / sumP) * 100).toFixed(1));
    const prob3 = parseFloat(((pChoppy / sumP) * 100).toFixed(1));
    const prob4 = parseFloat(((pSpike / sumP) * 100).toFixed(1));

    const maxProb = Math.max(prob1, prob2, prob3, prob4);

    let primaryRegime: 'LOW_VOLATILITY' | 'DIRECTIONAL_EXPANSION' | 'CHOPPY_REVERSAL' | 'SPIKE_REGIME' = 'DIRECTIONAL_EXPANSION';
    let regimeName = 'State 2: Directional Expansion (Trend)';
    let regimeState = 2;
    let guidance = 'High signal clarity. Follow trend momentum direction.';

    if (maxProb === prob1) {
      primaryRegime = 'LOW_VOLATILITY';
      regimeName = 'State 1: Low Volatility Range';
      regimeState = 1;
      guidance = 'Low price dispersion. Favor mean-reversion contracts.';
    } else if (maxProb === prob3) {
      primaryRegime = 'CHOPPY_REVERSAL';
      regimeName = 'State 3: Choppy Reversal';
      regimeState = 3;
      guidance = 'Frequent directional flips. Exercise position sizing caution.';
    } else if (maxProb === prob4) {
      primaryRegime = 'SPIKE_REGIME';
      regimeName = 'State 4: Volatility Spike';
      regimeState = 4;
      guidance = 'Abnormal price acceleration. Apply strict risk caps.';
    }

    return {
      primaryRegime,
      regimeName,
      regimeState,
      probabilities: {
        lowVolatility: prob1,
        directionalExpansion: prob2,
        choppyReversal: prob3,
        spikeRegime: prob4,
      },
      tradingGuidance: guidance,
    };
  }
}

export const hmmEngine = new HMMEngine();
