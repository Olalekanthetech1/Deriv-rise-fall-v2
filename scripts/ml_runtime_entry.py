"""Final runtime entrypoint with corrected sequence training.
Patches the v5 dispatcher without duplicating its stable tree/HMM/anomaly code.
"""
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
        'trainedAt': __import__('time').time(),
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
runtime.main()
