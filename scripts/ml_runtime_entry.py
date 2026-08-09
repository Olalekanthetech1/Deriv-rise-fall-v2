"""Production ML runtime entrypoint with mandatory Node-owned schema synchronization."""
import json
import sys
import time
import traceback

import numpy as np
import ml_runtime_v5 as runtime

_NATIVE_TRAIN_ONE = runtime.train_one


def _canonical_dataset(ticks, duration, asset, symbol):
    schema = runtime.require_schema()
    prices = [runtime.f(t.get('price')) for t in ticks]
    look = max(1, int(duration))
    context = int(schema['canonicalFeatureWindowTicks'])
    if len(prices) <= context + look:
        raise ValueError(f"Insufficient ticks: need at least {context + look + 1}")
    X, y = [], []
    for i in range(context, len(prices) - look):
        X.append(runtime.features(ticks[:i], duration, asset, symbol))
        y.append(int(prices[i + look] > prices[i]))
    if len(set(y)) < 2:
        raise ValueError('Training labels contain only one class')
    return np.asarray(X, dtype=np.float32), np.asarray(y, dtype=np.int64)


# The Python model implementation delegates dataset construction to this
# contract-driven adapter. Canonical training context is owned by Node config,
# not by a Python constant.
runtime.dataset = _canonical_dataset


def _sequence_dataset(ticks, duration, asset, symbol, look):
    prices = [runtime.f(t.get('price')) for t in ticks]
    if len(prices) <= runtime.SEQ + look:
        raise ValueError(f'Insufficient ticks: need at least {runtime.SEQ + look + 1}')
    X, y = [], []
    for i in range(runtime.SEQ, len(prices) - look):
        sequence = []
        for j in range(i - runtime.SEQ + 1, i + 1):
            start = max(0, j - runtime.SEQ)
            sequence.append(runtime.features(ticks[start:j], duration, asset, symbol))
        X.append(sequence)
        y.append(int(prices[i + look] > prices[i]))
    if len(set(y)) < 2:
        raise ValueError('Sequence training labels contain only one class')
    return np.asarray(X, dtype=np.float32), np.asarray(y, dtype=np.int64)


def train_one(kind, ticks, duration, asset, symbol, hyperparams):
    if kind not in {'tcn', 'lstm', 'transformer'}:
        result = _NATIVE_TRAIN_ONE(kind, ticks, duration, asset, symbol, hyperparams)
        if not isinstance(result, dict):
            raise RuntimeError('Native training runtime returned an invalid result.')
        result.setdefault('featureCount', runtime.FEATURES)
        result.setdefault('hyperparameters', hyperparams)
        return result
    if runtime.train_deep is None:
        raise RuntimeError('PyTorch sequence runtime unavailable')
    X, y = _sequence_dataset(ticks, duration, asset, symbol, max(1, int(duration)))
    split = max(1, int(len(X) * float(runtime.require_schema()['splitRatios']['train'])))
    if split >= len(X):
        raise ValueError('Not enough validation samples')
    model = runtime.train_deep(kind, X[:split], y[:split], epochs=int(hyperparams.get('epochs', 8)), batch_size=int(hyperparams.get('batchSize', 64)), lr=float(hyperparams.get('learningRate', 0.001)))
    import torch
    from sklearn.metrics import log_loss
    model.eval()
    with torch.no_grad():
        state = {k: v.cpu() for k, v in model.state_dict().items()}
        probs = runtime.predict_deep(kind, state, X[split:])
    pred = np.argmax(probs, axis=1)
    metrics = {'accuracy': round(float(np.mean(pred == y[split:])) * 100.0, 3), 'logLoss': round(float(log_loss(y[split:], probs, labels=[0, 1])), 6)}
    schema = runtime.require_schema()
    runtime.save(kind, symbol, duration, {'schemaVersion': schema['featureSchemaVersion'], 'modelType': kind, 'state_dict': state, 'validation': metrics, 'trainedAt': time.time()})
    return {'success': True, 'modelId': f'{symbol}_{duration}s_{kind}', 'modelType': kind, 'samplesCount': len(X), 'validationSamples': len(X) - split, 'featureCount': schema['featureCount'], 'schemaVersion': schema['featureSchemaVersion'], 'schemaFingerprint': schema['schemaFingerprint'], 'sequenceLength': schema['sequenceLength'], 'hyperparameters': hyperparams, **metrics, 'engine': f'Trained PyTorch {kind}'}


def backtest(ticks, symbol, horizons, asset, min_confidence=None, stake=None, payout_rate=None):
    schema = runtime.require_schema()
    if not symbol: raise ValueError('Backtest symbol is required')
    if not horizons: raise ValueError('At least one backtest horizon is required')
    if min_confidence is not None and (not np.isfinite(min_confidence) or not 0 <= min_confidence <= 100): raise ValueError('minConfidence must be between 0 and 100')
    if stake is not None and (not np.isfinite(stake) or stake <= 0): raise ValueError('stake must be positive')
    if payout_rate is not None and (not np.isfinite(payout_rate) or payout_rate <= 0 or payout_rate > 1): raise ValueError('payoutRate must be greater than 0 and no greater than 1')
    if (stake is None) != (payout_rate is None): raise ValueError('stake and payoutRate must be supplied together')

    prices = [runtime.f(t.get('price')) for t in ticks]
    context = int(schema['canonicalFeatureWindowTicks'])
    required_ticks = context + max(int(h) for h in horizons)
    if len(prices) <= required_ticks: raise ValueError(f'Backtest requires more than {required_ticks} ticks')

    matrix = {}
    for raw_h in horizons:
        h = int(raw_h)
        if h <= 0: raise ValueError('Backtest horizons must be positive')
        model = runtime.load('xgboost', symbol, h)
        if model is None:
            matrix[str(h)] = {'horizonSecs': h, 'available': False, 'trades': 0, 'wins': 0, 'losses': 0, 'rejected': 0, 'accuracy': None, 'winRate': None, 'profitFactor': None, 'totalProfit': None, 'error': 'MODEL_UNAVAILABLE_OR_SCHEMA_MISMATCH'}
            continue
        start = context
        end = len(ticks) - h
        if end <= start:
            matrix[str(h)] = {'horizonSecs': h, 'available': False, 'trades': 0, 'wins': 0, 'losses': 0, 'rejected': 0, 'accuracy': None, 'winRate': None, 'profitFactor': None, 'totalProfit': None, 'error': 'INSUFFICIENT_TICKS'}
            continue
        wins = losses = rejected = 0
        gross_profit = gross_loss = 0.0
        for i in range(start, end):
            current = prices[i]; future = prices[i + h]
            pred = model['model'].predict_proba(runtime.X(ticks[:i], h, asset, symbol))[0]
            probability_up = float(pred[1]); probability_down = float(pred[0]); confidence = max(probability_up, probability_down) * 100.0
            if min_confidence is not None and confidence < min_confidence:
                rejected += 1; continue
            predicted_up = probability_up >= probability_down; actual_up = future > current
            if predicted_up == actual_up:
                wins += 1
                if stake is not None and payout_rate is not None: gross_profit += stake * payout_rate
            else:
                losses += 1
                if stake is not None: gross_loss += stake
        trades = wins + losses; total_profit = gross_profit - gross_loss if stake is not None else None
        profit_factor = gross_profit / gross_loss if stake is not None and gross_loss > 0 else None; win_rate = (wins / trades) * 100.0 if trades else None
        matrix[str(h)] = {'horizonSecs': h, 'available': True, 'trades': trades, 'wins': wins, 'losses': losses, 'rejected': rejected, 'accuracy': round(win_rate, 3) if win_rate is not None else None, 'winRate': round(win_rate, 3) if win_rate is not None else None, 'profitFactor': round(profit_factor, 6) if profit_factor is not None else None, 'profitFactorInfinite': bool(stake is not None and gross_profit > 0 and gross_loss == 0), 'totalProfit': round(total_profit, 8) if total_profit is not None else None}
    available = [item for item in matrix.values() if item.get('available') and item.get('winRate') is not None]
    best = max(available, key=lambda item: float(item['winRate'])) if available else None
    return {'success': True, 'symbol': symbol, 'sampleCount': len(ticks), 'minConfidence': min_confidence, 'stake': stake, 'payoutRate': payout_rate, 'horizonMatrix': matrix, 'bestHorizon': best.get('horizonSecs') if best else None, 'schemaVersion': schema['featureSchemaVersion'], 'schemaFingerprint': schema['schemaFingerprint'], 'engine': 'Native trained XGBoost out-of-sample backtest', 'timestamp': int(time.time() * 1000)}


def dispatch(r):
    runtime.configure_schema(r.get('schemaContract'))
    action = r.get('action')
    if action == 'predict': return runtime.predict_one(r)
    if action == 'train':
        schema = runtime.require_schema()
        return train_one(r.get('modelType', 'xgboost'), r.get('ticks', []), int(r.get('durationSecs', schema['defaultHorizonTicks'])), int(r.get('assetCategory', 0)), r.get('symbol'), r.get('hyperparams', {}))
    if action == 'predict_ensemble':
        models = tuple(r.get('modelTypes') or ('xgboost', 'lightgbm', 'catboost', 'tcn', 'lstm', 'transformer', 'hmm', 'isolation_forest'))
        return {'success': True, 'id': r.get('id'), 'models': {k: runtime.predict_one({**r, 'modelType': k}) for k in models}}
    if action == 'backtest':
        min_confidence = float(r['minConfidence']) if r.get('minConfidence') is not None else None
        stake = float(r['stake']) if r.get('stake') is not None else None
        payout_rate = float(r['payoutRate']) if r.get('payoutRate') is not None else None
        return {'id': r.get('id'), **backtest(r.get('ticks', []), r.get('symbol'), r.get('horizons'), int(r.get('assetCategory', 0)), min_confidence, stake, payout_rate)}
    if action == 'ping':
        schema = runtime.require_schema()
        return {'success': True, 'id': r.get('id'), 'pong': True, 'schemaVersion': schema['featureSchemaVersion'], 'schemaFingerprint': schema['schemaFingerprint'], 'featureCount': schema['featureCount']}
    if action == 'list_models': return {'success': True, 'id': r.get('id'), 'schemaFingerprint': runtime.require_schema()['schemaFingerprint'], 'models': [p.name for p in runtime.MODEL_DIR.glob('*.pkl')]}
    return {'success': False, 'id': r.get('id'), 'error': f'Unknown action {action}'}


def main():
    sys.stdout.write(json.dumps({'type': 'ready', 'schemaContractRequired': True, 'actions': ['predict', 'predict_ensemble', 'train', 'list_models', 'ping', 'backtest']}) + '\n')
    sys.stdout.flush()
    for line in sys.stdin:
        r = {}
        try:
            r = json.loads(line); out = dispatch(r)
        except Exception as exc:
            out = {'success': False, 'id': r.get('id') if isinstance(r, dict) else None, 'error': str(exc)}
        sys.stdout.write(json.dumps(out, default=str) + '\n'); sys.stdout.flush()


if __name__ == '__main__': main()
