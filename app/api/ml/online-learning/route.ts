import { NextRequest, NextResponse } from 'next/server';
import {
  getOnlineLearningState,
  recordModelOutcome,
  resetOnlineLearningStats,
} from '@/lib/multi-model-evaluator';

export async function GET() {
  try {
    const state = getOnlineLearningState();
    return NextResponse.json({
      success: true,
      onlineLearning: state,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch online learning state' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, modelKey, wasCorrect } = body;

    if (action === 'reset') {
      resetOnlineLearningStats();
      return NextResponse.json({
        success: true,
        message: 'Online Learning statistics reset to baseline.',
        onlineLearning: getOnlineLearningState(),
      });
    }

    if (action === 'record' && modelKey) {
      recordModelOutcome(modelKey, Boolean(wasCorrect));
      return NextResponse.json({
        success: true,
        message: `Recorded out-of-sample outcome for model ${modelKey}: ${wasCorrect ? 'WIN' : 'LOSS'}`,
        onlineLearning: getOnlineLearningState(),
      });
    }

    return NextResponse.json({ error: 'Invalid action parameter' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Action failed' }, { status: 500 });
  }
}
