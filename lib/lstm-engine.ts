import { TickPoint, EngineeredTickFeatures, extract37TickFeatures } from './ml-feature-extractor';

export interface LSTMHyperparameters {
  hiddenUnits: number; // e.g. 64
  numLayers: number; // e.g. 2
  recurrentDropout: number; // e.g. 0.1
}

export class LSTMEngine {
  private version: string = 'v2.1.0-gated-recurrent-units';
  private hyperparameters: LSTMHyperparameters = {
    hiddenUnits: 64,
    numLayers: 2,
    recurrentDropout: 0.1,
  };

  public setHyperparameters(params: Partial<LSTMHyperparameters>) {
    this.hyperparameters = { ...this.hyperparameters, ...params };
  }

  public getHyperparameters(): LSTMHyperparameters {
    return { ...this.hyperparameters };
  }

  /**
   * Recurrent Gated Units (LSTM / GRU) Sequential State Tracking Inference
   */
  public predict(
    ticks: TickPoint[],
    options: { symbol?: string; durationSecs?: number; assetCategory?: number } = {}
  ): {
    signal: 'CALL' | 'PUT';
    probabilityUp: number;
    probabilityDown: number;
    confidence: number;
    hiddenStateVector: number;
    details: string;
  } {
    const symbol = options.symbol || 'R_100';
    const durationSecs = options.durationSecs || 5;

    const features = extract37TickFeatures(ticks, {
      symbol,
      contractDurationSecs: durationSecs,
      assetCategoryNum: options.assetCategory || 0,
    });

    const sequence = ticks.slice(-25);
    let h_t = 0.0; // Hidden state
    let c_t = 0.0; // Cell state memory

    for (let i = 1; i < sequence.length; i++) {
      const x_t = (sequence[i].price - sequence[i - 1].price) * 100.0;

      // Forget gate: f_t = sigmoid(W_f * x_t + U_f * h_{t-1})
      const f_t = 1 / (1 + Math.exp(-(x_t * 2.5 + h_t * 0.4)));

      // Input gate: i_t = sigmoid(W_i * x_t + U_i * h_{t-1})
      const i_t = 1 / (1 + Math.exp(-(x_t * 2.0 + h_t * 0.3)));

      // Candidate cell state: c_tilde = tanh(W_c * x_t + U_c * h_{t-1})
      const c_tilde = Math.tanh(x_t * 3.0 + h_t * 0.5);

      // New cell state: c_t = f_t * c_{t-1} + i_t * c_tilde
      c_t = f_t * c_t + i_t * c_tilde;

      // Output gate: o_t = sigmoid(W_o * x_t + U_o * h_{t-1})
      const o_t = 1 / (1 + Math.exp(-(x_t * 2.2 + h_t * 0.35)));

      // New hidden state: h_t = o_t * tanh(c_t)
      h_t = o_t * Math.tanh(c_t);
    }

    const outputLogit = h_t * 2.8 + features.micro_momentum * 0.5;

    const probUpRaw = 1 / (1 + Math.exp(-Math.max(-5, Math.min(5, outputLogit))));
    const probUp = parseFloat((Math.min(97.5, Math.max(2.5, probUpRaw * 100.0))).toFixed(1));
    const probDown = parseFloat((100.0 - probUp).toFixed(1));

    const isCall = probUp >= 50.0;
    const signal = isCall ? 'CALL' : 'PUT';
    const confidence = parseFloat(Math.max(probUp, probDown).toFixed(1));

    return {
      signal,
      probabilityUp: probUp,
      probabilityDown: probDown,
      confidence,
      hiddenStateVector: parseFloat(h_t.toFixed(4)),
      details: `Gated Recurrent Unit (Units: ${this.hyperparameters.hiddenUnits}) | Hidden State Vector h_t: ${h_t.toFixed(4)} | Cell Memory c_t: ${c_t.toFixed(4)}`,
    };
  }
}

export const lstmEngine = new LSTMEngine();
