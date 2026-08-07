"""Production ML runtime entrypoint.

Keeps the canonical model/training implementation in ml_runtime_v5 while
providing a single JSONL dispatcher for prediction, training and backtesting.
"""
import json
import sys
import time
import traceback

import numpy as np
import ml_runtime_v5 as runtime


def _sequence_dataset(ticks, duration, asset, symbol, look):
    prices = [runtime.f(t.get('price')) for t in ticks]
    if len(prices) <= runtime.SEQ + look:
        raise ValueError(f'Insufficient ticks: need at least {runtime.SEQ + look + 1}')
    X, y = [], []
    for i in range(runtime.SEQ, len(prices) - look):
        sequence = []
        for j in range(i - runtime.SEQ + 1, i + 1):
            start = max(0, j - 25)
            sequence.append(runtime.features(ticks[start:j], duration, asset, symbol))
        X.append(sequence)
        y.append(int(prices[i + look] > prices[i]))
    if len(set(y)) < 2:
        raise ValueError('Sequence training labels contain only one class')
    return np.asarray(X, dtype=np.float32), np.asarray(y, dtype=np.int64)


def train_one(kind, ticks, duration, asset, symbol, hyperparams):
    if kind not in {'tcn', 'lstm', 'transformer'}:
        return runtime.train_one(kind, ticks, duration, asset, symbol, hyperparams)
    if runtime.train_deep is None:
        raise RuntimeError('PyTorch sequence runtime unavailable')
    X, y = _sequence_dataset(ticks, duration, asset, symbol, max(1, int(duration)))
    split = max(1, int(len(X) * 0.8))
    if split >= len(X):
        raise ValueError('Not enough validation samples')
    model = runtime.train_deep(
        kind, X[:split], y[:split],
        epochs=int(hyperparams.get('epochs', 8)),
        batch_size=int(hyperparams.get('batchSize', 64)),
        lr=float(hyperparams.get('learningRate', 0.001)),
    )
    import torch
    from sklearn.metrics import log_loss
    model.eval()
    with torch.no_grad():
        state = {k: v.cpu() for k, v in model.state_dict().items()}
        probs = runtime.predict_deep(kind, state, X[split:])
    pred = np.argmax(probs, axis=1)
    metrics = {
        'accuracy': round(float(np.mean(pred == y[split:])) * 100.0, 3),
        'logLoss': round(float(log_loss(y[split:], probs, labels=[0, 1])), 6),
    }
    runtime.save(kind, symbol, duration, {
        'schemaVersion': runtime.SCHEMA,
        'modelType': kind,
        'featureCount': runtime.FEATURES,
        'sequenceLength': runtime.SEQ,
        'state_dict': state,
        'validation': metrics,
        'trainedAt': time.time(),
    })
    return {
        'success': True,
        'modelId': f'{symbol}_{duration}s_{kind}',
        'modelType': kind,
        'samplesCount': len(X),
        'validationSamples': len(X) - split,
        **metrics,
        'engine': f'Trained PyTorch {kind}',
    }


runtime.train_one = train_one


def backtest(ticks, symbol, horizons, asset=0):
    """Evaluate a persisted XGBoost model out-of-sample on historical ticks.

    This intentionally refuses to manufacture a model. If a horizon has no
    trained XGBoost artifact, that horizon is reported as unavailable.
    Profit factor here is a unit-stake diagnostic (wins/losses), not a broker
    payout simulation.
    """
    prices = [runtime.f(t.get('price')) for t in ticks]
    if len(prices) < 30:
        raise ValueError('Backtest requires at least 30 ticks')
    matrix = {}
    for raw_h in horizons or [5]:
        h = max(1, int(raw_h))
        model = runtime.load('xgboost', symbol, h)
        if model is None:
            matrix[str(h)] = {
                'horizonSecs': h,
                'available': False,
                'trades': 0,
                'wins': 0,
                'losses': 0,
                'accuracy': None,
                'profitFactor': None,
                'error': 'MODEL_UNAVAILABLE',
            }
            continue
        start = 25
        end = len(ticks) - h
        wins = losses = 0
        if end <= start:
            raise ValueError(f'Insufficient ticks for {h}s backtest horizon')
        for i in range(start, end):
            current = prices[i]
            future = prices[i + h]
            pred = model['model'].predict_proba(runtime.X(ticks[:i], h, asset, symbol))[0]
            predicted_up = float(pred[1]) >= float(pred[0])
            actual_up = future > current
            if predicted_up == actual_up:
                wins += 1
            else:
                losses += 1
        trades = wins + losses
        matrix[str(h)] = {
            'horizonSecs': h,
            'available': True,
            'trades': trades,
            'wins': wins,
            'losses': losses,
            'accuracy': round((wins / trades) * 100.0, 3) if trades else 0.0,
            'profitFactor': round(wins / losses, 6) if losses else float('inf'),
        }
    return {
        'success': True,
        'symbol': symbol,
        'sampleCount': len(ticks),
        'horizonMatrix': matrix,
        'engine': 'Native trained XGBoost out-of-sample backtest',
        'timestamp': int(time.time() * 1000),
    }


def dispatch(r):
    action = r.get('action')
    if action == 'predict':
        return runtime.predict_one(r)
    if action == 'train':
        return train_one(
            r.get('modelType', 'xgboost'), r.get('ticks', []),
            int(r.get('durationSecs', 5)), int(r.get('assetCategory', 0)),
            r.get('symbol', 'R_100'), r.get('hyperparams', {}),
        )
    if action == 'predict_ensemble':
        models = ('xgboost', 'lightgbm', 'catboost', 'tcn', 'lstm', 'transformer', 'hmm', 'isolation_forest')
        return {'success': True, 'id': r.get('id'), 'models': {
            k: runtime.predict_one({**r, 'modelType': k}) for k in models
        }}
    if action == 'backtest':
        return {'id': r.get('id'), **backtest(
            r.get('ticks', []), r.get('symbol', 'R_100'), r.get('horizons', [5]),
            int(r.get('assetCategory', 0)),
        )}
    if action == 'ping':
        return {'success': True, 'id': r.get('id'), 'pong': True, 'schemaVersion': runtime.SCHEMA}
    if action == 'list_models':
        return {'success': True, 'id': r.get('id'), 'models': [p.name for p in runtime.MODEL_DIR.glob('*.pkl')]}
    return {'success': False, 'id': r.get('id'), 'error': f'Unknown action {action}'}


def main():
    sys.stdout.write(json.dumps({
        'type': 'ready',
        'schemaVersion': runtime.SCHEMA,
        'featureCount': runtime.FEATURES,
        'xgb': runtime.xgb is not None,
        'lgb': runtime.lgb is not None,
        'cat': runtime.cb is not None,
        'hmm': runtime.GaussianHMM is not None,
        'isolationForest': runtime.IsolationForest is not None,
        'torch': runtime.train_deep is not None,
        'actions': ['predict', 'predict_ensemble', 'train', 'list_models', 'ping', 'backtest'],
    }) + '\n')
    sys.stdout.flush()
    for line in sys.stdin:
        r = {}
        try:
            r = json.loads(line)
            out = dispatch(r)
        except Exception as exc:
            out = {
                'success': False,
                'id': r.get('id') if isinstance(r, dict) else None,
                'error': str(exc),
                'trace': traceback.format_exc(limit=4),
            }
        sys.stdout.write(json.dumps(out, default=str) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
