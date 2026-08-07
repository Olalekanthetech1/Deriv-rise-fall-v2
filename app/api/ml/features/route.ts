import { NextRequest, NextResponse } from 'next/server';
import { xgboostModel } from '@/lib/xgboost-engine';

export async function GET(req: NextRequest) {
  try {
    const featuresImportance = xgboostModel.getFeatureImportance();
    const hyperparams = xgboostModel.getHyperparameters();

    return NextResponse.json({
      success: true,
      totalFeatures: featuresImportance.length,
      hyperparameters: hyperparams,
      features: featuresImportance,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch feature importance' }, { status: 500 });
  }
}
