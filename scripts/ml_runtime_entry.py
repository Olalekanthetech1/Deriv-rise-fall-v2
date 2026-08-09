"""Production ML runtime entrypoint.

Feature engineering is intentionally NOT implemented here. Node/TypeScript owns
feature calculation and sends validated canonical vectors/datasets to Python.
Python owns model training, inference, persistence and evaluation only.
"""
import json
import sys
import time

import numpy as np
import ml_runtime_v5 as runtime

_NATIVE_TRAIN_ONE = runtime.train_one


def _validate_vector(vector):
    schema = runtime.require_schema()
    if not isinstance(vector, list) or len(vector) != schema['featureCount']:
        raise ValueError(f"FEATURE_VECTOR_LENGTH_MISMATCH: expected {schema['featureCount']}")
    values = [runtime.f(v) for v in vector]
    if not all(np.isfinite(values)):
        raise ValueError('INVALID_FEATURE_VECTOR')
    return values


def _tabular_dataset(payload):
    dataset = payload.get('featureDataset')
    if not isinstance(dataset, dict):
        raise ValueError('CANONICAL_FEATURE_DATASET_REQUIRED')
    schema = runtime.require_schema()
    vectors = dataset.get('featureVectors')
    labels = dataset.get('labels')
    if not isinstance(vectors, list) or not isinstance(labels, list) or len(vectors) != len(labels) or not vectors:
        raise ValueError('INVALID_FEATURE_DATASET')
    if int(dataset.get('featureCount', -1)) != schema['featureCount']:
        raise ValueError('FEATURE_DATASET_SCHEMA_MISMATCH')
    if dataset.get('schemaFingerprint') != schema['schemaFingerprint']:
        raise ValueError('FEATURE_DATASET_FINGERPRINT_MISMATCH')
    X = np.asarray([_validate_vector(row) for row in vectors], dtype=np.float32)
    y = np.asarray([int(v) for v in labels], dtype=np.int64)
    if len(set(y.tolist())) < 2:
        raise ValueError('Training labels contain only one class')
    return X, y


def _sequence_dataset(payload):
    dataset = payload.get('sequenceDataset')
    if not isinstance(dataset, dict):
        raise ValueError('CANONICAL_SEQUENCE_DATASET_REQUIRED')
    schema = runtime.require_schema()
    sequences = dataset.get('featureSequences')
    labels = dataset.get('labels')
    if not isinstance(sequences, list) or not isinstance(labels, list) or len(sequences) != len(labels) or not sequences:
        raise ValueError('INVALID_SEQUENCE_DATASET')
    if int(dataset.get('featureCount', -1)) != schema['featureCount'] or int(dataset.get('sequenceLength', -1)) != schema['sequenceLength']:
        raise ValueError('SEQUENCE_DATASET_SCHEMA_MISMATCH')
    if dataset.get('schemaFingerprint') != schema['schemaFingerprint']:
        raise ValueError('SEQUENCE_DATASET_FINGERPRINT_MISMATCH')
    X = np.asarray([[_validate_vector(row) for row in sequence] for sequence in sequences], dtype=np.float32)
    y = np.asarray([int(v) for v in labels], dtype=np.int64)
    if len(set(y.tolist())) < 2:
        raise ValueError('Sequence training labels contain only one class')
    return X, y


def _split(X, y):
    ratio = float(runtime.require_schema()['splitRatios']['train'])
    split = max(1, int(len(X) * ratio))
    if split >= len(X):
        raise ValueError('Not enough validation samples')
    return X[:split], X[split:], y[:split], y[split:]


def train_one(kind, payload):
    schema = runtime.require_schema()
    if kind in {'tcn', 'lstm', 'transformer'}:
        if runtime.train_deep is None:
            raise RuntimeError('PyTorch sequence runtime unavailable')
        X, y = _sequence_dataset(payload)
        Xt, Xval, yt, yval = _split(X, y)
        hyper = payload.get('hyperparams', {})
        model = runtime.train_deep(
            kind,
            Xt,
            yt,
            epochs=int(hyper.get('epochs', 8)),
            batch_size=int(hyper.get('batchSize', 64)),
            lr=float(hyper.get('learningRate', 0.001)),
        )
        import torch
        from sklearn.metrics import log_loss
        model.eval()
        with torch.no_grad():
            state = {k: v.cpu() for k, v in model.state_dict().items()}
            probs = runtime.predict_deep(kind, state, Xval)
        pred = np.argmax(probs, axis=1)
        metrics = {
            'accuracy': round(float(np.mean(pred == yval)) * 100.0, 3),
            'logLoss': round(float(log_loss(yval, probs, labels=[0, 1])), 6),
        }
        runtime.save(kind, payload.get('symbol'), int(payload.get('durationSecs')), {
            'schemaVersion': schema['featureSchemaVersion'],
            'modelType': kind,
            'state_dict': state,
            'validation': metrics,
            'trainedAt': time.time(),
        })
        return {
            'success': True,
            'modelId': f"{payload.get('symbol')}_{payload.get('durationSecs')}s_{kind}",
            'modelType': kind,
            'samplesCount': len(X),
            'validationSamples': len(Xval),
            'featureCount': schema['featureCount'],
            'sequenceLength': schema['sequenceLength'],
            'schemaVersion': schema['featureSchemaVersion'],
            'schemaFingerprint': schema['schemaFingerprint'],
            'hyperparameters': hyper,
            **metrics,
            'engine': f'Trained PyTorch {kind} from canonical Node feature dataset',
        }

    # Native tabular/HMM/anomaly models continue to live in the existing
    # Python model implementation, but receive only the canonical dataset.
    X, y = _tabular_dataset(payload)
    original_dataset = runtime.dataset
    runtime.dataset = lambda _t, _d, _a, _s: (X, y)
    try:
        result = _NATIVE_TRAIN_ONE(kind, [], payload.get('durationSecs'), payload.get('assetCategory', 0), payload.get('symbol'), payload.get('hyperparams', {}))
    finally:
        runtime.dataset = original_dataset
    if not isinstance(result, dict):
        raise RuntimeError('Native training runtime returned an invalid result.')
    result.setdefault('featureCount', schema['featureCount'])
    result.setdefault('schemaVersion', schema['featureSchemaVersion'])
    result.setdefault('schemaFingerprint', schema['schemaFingerprint'])
    return result


def _install_prediction_vectors(payload):
    vector = _validate_vector(payload.get('featureVector'))
    sequence = payload.get('featureSequence')
    if sequence is not None:
        sequence = np.asarray([_validate_vector(row) for row in sequence], dtype=np.float32)
        if len(sequence) != runtime.require_schema()['sequenceLength']:
            raise ValueError('FEATURE_SEQUENCE_LENGTH_MISMATCH')
    vector_array = np.asarray([vector], dtype=np.float32)
    original_x = runtime.X
    original_seq_x = runtime.seq_X
    runtime.X = lambda *_args, **_kwargs: vector_array
    runtime.seq_X = lambda *_args, **_kwargs: np.asarray([sequence], dtype=np.float32) if sequence is not None else (_ for _ in ()).throw(ValueError('FEATURE_SEQUENCE_REQUIRED'))
    return original_x, original_seq_x


def _restore_prediction_vectors(original_x, original_seq_x):
    runtime.X = original_x
    runtime.seq_X = original_seq_x


def predict(payload):
    original_x, original_seq_x = _install_prediction_vectors(payload)
    try:
        return runtime.predict_one(payload)
    finally:
        _restore_prediction_vectors(original_x, original_seq_x)


def predict_ensemble(payload):
    models = tuple(payload.get('modelTypes') or ('xgboost', 'lightgbm', 'catboost', 'tcn', 'lstm', 'transformer', 'hmm', 'isolation_forest'))
    original_x, original_seq_x = _install_prediction_vectors(payload)
    try:
        return {
            'success': True,
            'id': payload.get('id'),
            'models': {key: runtime.predict_one({**payload, 'modelType': key}) for key in models},
        }
    finally:
        _restore_prediction_vectors(original_x, original_seq_x)


def backtest(payload):
    schema = runtime.require_schema()
    ticks = payload.get('ticks', [])
    horizons = payload.get('horizons')
    vectors_by_horizon = payload.get('featureVectorsByHorizon')
    symbol = payload.get('symbol')
    if not symbol or not horizons or not isinstance(vectors_by_horizon, dict):
        raise ValueError('CANONICAL_BACKTEST_FEATURE_VECTORS_REQUIRED')

    prices = [runtime.f(t.get('price')) for t in ticks]
    context = int(schema['canonicalFeatureWindowTicks'])
    matrix = {}
    min_confidence = float(payload['minConfidence']) if payload.get('minConfidence') is not None else None
    stake = float(payload['stake']) if payload.get('stake') is not None else None
    payout_rate = float(payload['payoutRate']) if payload.get('payoutRate') is not None else None
    if (stake is None) != (payout_rate is None):
        raise ValueError('stake and payoutRate must be supplied together')

    for raw_h in horizons:
        h = int(raw_h)
        vectors = vectors_by_horizon.get(str(h))
        if not isinstance(vectors, list):
            raise ValueError(f'MISSING_BACKTEST_FEATURE_VECTORS:{h}')
        model = runtime.load('xgboost', symbol, h)
        if model is None:
            matrix[str(h)] = {'horizonSecs': h, 'available': False, 'trades': 0, 'wins': 0, 'losses': 0, 'rejected': 0, 'accuracy': None, 'winRate': None, 'profitFactor': None, 'totalProfit': None, 'error': 'MODEL_UNAVAILABLE_OR_SCHEMA_MISMATCH'}
            continue
        start = context
        end = len(prices) - h
        expected = max(0, end - start)
        if len(vectors) != expected:
            raise ValueError(f'BACKTEST_FEATURE_VECTOR_COUNT_MISMATCH:{h}:expected={expected}:got={len(vectors)}')
        wins = losses = rejected = 0
        gross_profit = gross_loss = 0.0
        for offset, i in enumerate(range(start, end)):
            vector = np.asarray([_validate_vector(vectors[offset])], dtype=np.float32)
            pred = model['model'].predict_proba(vector)[0]
            probability_up = float(pred[1]); probability_down = float(pred[0]); confidence = max(probability_up, probability_down) * 100.0
            if min_confidence is not None and confidence < min_confidence:
                rejected += 1
                continue
            predicted_up = probability_up >= probability_down
            actual_up = prices[i + h] > prices[i]
            if predicted_up == actual_up:
                wins += 1
                if stake is not None and payout_rate is not None: gross_profit += stake * payout_rate
            else:
                losses += 1
                if stake is not None: gross_loss += stake
        trades = wins + losses
        total_profit = gross_profit - gross_loss if stake is not None else None
        profit_factor = gross_profit / gross_loss if stake is not None and gross_loss > 0 else None
        win_rate = (wins / trades) * 100.0 if trades else None
        matrix[str(h)] = {
            'horizonSecs': h,
            'available': True,
            'trades': trades,
            'wins': wins,
            'losses': losses,
            'rejected': rejected,
            'accuracy': round(win_rate, 3) if win_rate is not None else None,
            'winRate': round(win_rate, 3) if win_rate is not None else None,
            'profitFactor': round(profit_factor, 6) if profit_factor is not None else None,
            'profitFactorInfinite': bool(stake is not None and gross_profit > 0 and gross_loss == 0),
            'totalProfit': round(total_profit, 8) if total_profit is not None else None,
        }

    available = [item for item in matrix.values() if item.get('available') and item.get('winRate') is not None]
    best = max(available, key=lambda item: float(item['winRate'])) if available else None
    return {
        'success': True,
        'symbol': symbol,
        'sampleCount': len(ticks),
        'minConfidence': min_confidence,
        'stake': stake,
        'payoutRate': payout_rate,
        'horizonMatrix': matrix,
        'bestHorizon': best.get('horizonSecs') if best else None,
        'schemaVersion': schema['featureSchemaVersion'],
        'schemaFingerprint': schema['schemaFingerprint'],
        'engine': 'Native trained XGBoost out-of-sample backtest using canonical Node feature vectors',
        'timestamp': int(time.time() * 1000),
    }


def dispatch(request):
    runtime.configure_schema(request.get('schemaContract'))
    action = request.get('action')
    if action == 'predict': return predict(request)
    if action == 'train': return train_one(request.get('modelType', 'xgboost'), request)
    if action == 'predict_ensemble': return predict_ensemble(request)
    if action == 'backtest': return backtest(request)
    if action == 'ping':
        schema = runtime.require_schema()
        return {'success': True, 'id': request.get('id'), 'pong': True, 'schemaVersion': schema['featureSchemaVersion'], 'schemaFingerprint': schema['schemaFingerprint'], 'featureCount': schema['featureCount']}
    if action == 'list_models':
        return {'success': True, 'id': request.get('id'), 'schemaFingerprint': runtime.require_schema()['schemaFingerprint'], 'models': [p.name for p in runtime.MODEL_DIR.glob('*.pkl')]}
    return {'success': False, 'id': request.get('id'), 'error': f'Unknown action {action}'}


def main():
    sys.stdout.write(json.dumps({'type': 'ready', 'schemaContractRequired': True, 'featureSource': 'node-canonical-registry', 'actions': ['predict', 'predict_ensemble', 'train', 'list_models', 'ping', 'backtest']}) + '\n')
    sys.stdout.flush()
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            output = dispatch(request)
        except Exception as exc:
            output = {'success': False, 'id': request.get('id') if isinstance(request, dict) else None, 'error': str(exc)}
        sys.stdout.write(json.dumps(output, default=str) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
