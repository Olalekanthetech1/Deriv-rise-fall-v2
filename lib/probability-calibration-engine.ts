export interface CalibrationDetails {
  rawProbability: number;
  calibratedProbability: number | null;
  plattScaledProbability: number | null;
  isotonicProbability: number | null;
  expectedCalibrationError: number | null;
  calibrationMethod: 'Platt Scaling (Sigmoidal)' | 'Isotonic Regression (Piecewise Monotonic)' | 'UNAVAILABLE';
  confidenceReductionPct: number | null;
  calibrationBins: Array<{
    binRange: string;
    rawAvg: number;
    calibratedAvg: number;
    accuracy: number;
    sampleCount: number;
  }>;
  status: 'CALIBRATED' | 'UNAVAILABLE';
  reason?: string;
}

export interface CalibrationSample {
  probability: number;
  outcome: 0 | 1;
}

/**
 * Probability calibration must be fitted from real out-of-sample model
 * predictions and their realized outcomes. This class intentionally does not
 * contain preset Platt coefficients, isotonic splines, or fabricated
 * reliability bins.
 */
export class ProbabilityCalibrationEngine {
  private samples: CalibrationSample[] = [];

  public record(sample: CalibrationSample): void {
    if (!Number.isFinite(sample.probability) || sample.probability < 0 || sample.probability > 100) return;
    this.samples.push({ probability: sample.probability, outcome: sample.outcome });
  }

  public clear(): void {
    this.samples = [];
  }

  public sampleCount(): number {
    return this.samples.length;
  }

  /**
   * Returns calibration only when empirical outcome data exists. Until then,
   * the raw model probability is exposed and calibration is explicitly marked
   * unavailable rather than being replaced by a synthetic estimate.
   */
  public calibrate(rawProbUp: number): CalibrationDetails {
    const raw = Math.max(0, Math.min(100, Number(rawProbUp)));
    if (this.samples.length < 2) {
      return {
        rawProbability: raw >= 50 ? raw : 100 - raw,
        calibratedProbability: null,
        plattScaledProbability: null,
        isotonicProbability: null,
        expectedCalibrationError: null,
        calibrationMethod: 'UNAVAILABLE',
        confidenceReductionPct: null,
        calibrationBins: [],
        status: 'UNAVAILABLE',
        reason: 'Insufficient real out-of-sample outcomes for calibration',
      };
    }

    // Empirical reliability estimate. The sample set is made exclusively from
    // recorded model predictions and realized outcomes; no synthetic values
    // are introduced here. A future persistent calibration trainer can replace
    // this with fitted Platt/isotonic parameters without changing the API.
    const dominant = raw >= 50 ? raw : 100 - raw;
    const bins = 10;
    const binIndex = Math.min(bins - 1, Math.floor((dominant / 100) * bins));
    const lower = binIndex / bins;
    const upper = (binIndex + 1) / bins;
    const inBin = this.samples.filter(s => {
      const p = s.probability / 100;
      return p >= lower && p < upper;
    });

    if (inBin.length === 0) {
      return {
        rawProbability: dominant,
        calibratedProbability: null,
        plattScaledProbability: null,
        isotonicProbability: null,
        expectedCalibrationError: null,
        calibrationMethod: 'UNAVAILABLE',
        confidenceReductionPct: null,
        calibrationBins: [],
        status: 'UNAVAILABLE',
        reason: 'No realized outcomes in the current probability bin',
      };
    }

    const empiricalAccuracy = inBin.reduce((sum, s) => sum + s.outcome, 0) / inBin.length;
    const calibrated = empiricalAccuracy * 100;
    const ece = Math.abs((inBin.reduce((sum, s) => sum + s.probability, 0) / inBin.length) - calibrated);
    const calibratedDominant = Math.max(50, Math.min(100, calibrated));

    return {
      rawProbability: dominant,
      calibratedProbability: Number(calibratedDominant.toFixed(2)),
      plattScaledProbability: null,
      isotonicProbability: null,
      expectedCalibrationError: Number(ece.toFixed(2)),
      calibrationMethod: 'UNAVAILABLE',
      confidenceReductionPct: Number((calibratedDominant - dominant).toFixed(2)),
      calibrationBins: [{
        binRange: `${Math.floor(lower * 100)}-${Math.floor(upper * 100)}%`,
        rawAvg: Number((inBin.reduce((sum, s) => sum + s.probability, 0) / inBin.length).toFixed(2)),
        calibratedAvg: Number(calibratedDominant.toFixed(2)),
        accuracy: Number(calibrated.toFixed(2)),
        sampleCount: inBin.length,
      }],
      status: 'CALIBRATED',
    };
  }
}

export const probabilityCalibrator = new ProbabilityCalibrationEngine();