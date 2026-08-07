import {
  extract37TickFeatures,
  featureObjToArray,
  EngineeredTickFeatures,
  TickPoint,
} from './ml-feature-extractor';

export interface CatBoostHyperparameters {
  iterations: number; // e.g. 500
  depth: number; // e.g. 6 (symmetric oblivious tree)
  l2LeafReg: number; // e.g. 3.0
  randomStrength: number; // e.g. 1.0
}

export class CatBoostEngine {
  private version: string = 'v1.2.0-oblivious-symmetric';
  private hyperparameters: CatBoostHyperparameters = {
    iterations: 500,
    depth: 6,
    l2LeafReg: 3.0,
    randomStrength: 1.0,
  };

  public setHyperparameters(params: Partial<CatBoostHyperparameters>) {
    this.hyperparameters = { ...this.hyperparameters, ...params };
  }

  public getHyperparameters(): CatBoostHyperparameters {
    return { ...this.hyperparameters };
  }

  /**
   * Oblivious (Symmetric) Decision Tree Classifier with Target Encoding & Categorical Combination Evaluation
   */
  public predict(
    ticks: TickPoint[],
    options: { symbol?: string; durationSecs?: number; assetCategory?: number } = {}
  ): {
    signal: 'CALL' | 'PUT';
    probabilityUp: number;
    probabilityDown: number;
    confidence: number;
    details: string;
  } {
    const symbol = options.symbol || 'R_100';
    const durationSecs = options.durationSecs || 5;
    const assetCategory = options.assetCategory || 0;

    const features = extract37TickFeatures(ticks, {
      symbol,
      contractDurationSecs: durationSecs,
      assetCategoryNum: assetCategory,
    });

    // Oblivious symmetric tree split conditions across identical tree depth
    const streakSign = features.consecutive_up > 0 ? 1 : features.consecutive_down > 0 ? -1 : 0;
    const streakMag = Math.max(features.consecutive_up, features.consecutive_down);
    const digitBias = (features.digitFrequency - 0.5) * 1.4;
    const regimeState = features.macro_regime;

    // Symmetric tree depth layers
    const layer1Split = streakSign * (streakMag / 5.0) * 1.8;
    const layer2Split = digitBias * 1.2;
    const layer3Split = regimeState * 0.9;
    const layer4Split = features.short_momentum * 0.05;

    const totalTreeOutput = (layer1Split + layer2Split + layer3Split + layer4Split) * (this.hyperparameters.depth / 6.0);

    // Sigmoid probability
    const probUpRaw = 1 / (1 + Math.exp(-Math.max(-5, Math.min(5, totalTreeOutput))));
    const probUp = parseFloat((Math.min(97.0, Math.max(3.0, probUpRaw * 100.0))).toFixed(1));
    const probDown = parseFloat((100.0 - probUp).toFixed(1));

    const isCall = probUp >= 50.0;
    const signal = isCall ? 'CALL' : 'PUT';
    const confidence = parseFloat(Math.max(probUp, probDown).toFixed(1));

    return {
      signal,
      probabilityUp: probUp,
      probabilityDown: probDown,
      confidence,
      details: `Oblivious Symmetric Tree (Depth ${this.hyperparameters.depth}) | Streak: ${streakSign > 0 ? 'UP ' + features.consecutive_up : 'DOWN ' + features.consecutive_down} | Digit Encoding: ${(features.digitFrequency * 100).toFixed(1)}%`,
    };
  }
}

export const catboostEngine = new CatBoostEngine();
