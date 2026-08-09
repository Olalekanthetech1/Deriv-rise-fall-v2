import sys, os, json, time, math, pickle, traceback
from pathlib import Path
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
import numpy as np
try: import xgboost as xgb
except Exception: xgb = None
try: import lightgbm as lgb
except Exception: lgb = None
try: import catboost as cb
except Exception: cb = None
try: from sklearn.ensemble import IsolationForest
except Exception: IsolationForest = None
try: from sklearn.metrics import accuracy_score, log_loss
except Exception: accuracy_score = log_loss = None
try: from hmmlearn.hmm import GaussianHMM
except Exception: GaussianHMM = None
try: from ml_deep_models import train as train_deep, predict as predict_deep
except Exception: train_deep = predict_deep = None

MODEL_DIR = Path(os.getenv('MODEL_CACHE_DIR', str(Path(__file__).resolve().parent.parent / 'models_cache')))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

RUNTIME_SCHEMA = None
SCHEMA = None
FEATURES = None
SEQ = None
FEATURE_ORDER = ()
FEATURE_INDEX = {}
WINDOWS = {}
CACHE = {}


def configure_schema(contract):
    global RUNTIME_SCHEMA, SCHEMA, FEATURES, SEQ, FEATURE_ORDER, FEATURE_INDEX, WINDOWS
    if not isinstance(contract, dict): raise ValueError('ML_SCHEMA_CONTRACT_REQUIRED')
    order = contract.get('featureOrder'); definitions = contract.get('featureDefinitions'); windows = contract.get('featureWindows')
    count = contract.get('featureCount'); sequence_length = contract.get('sequenceLength'); fingerprint = contract.get('schemaFingerprint')
    if not isinstance(order, list) or not order or len(set(order)) != len(order): raise ValueError('INVALID_FEATURE_ORDER')
    if not isinstance(definitions, list) or len(definitions) != len(order): raise ValueError('INVALID_FEATURE_DEFINITIONS')
    if not isinstance(windows, dict) or not windows: raise ValueError('INVALID_FEATURE_WINDOWS')
    if not isinstance(count, int) or count != len(order): raise ValueError('FEATURE_COUNT_MISMATCH')
    if not isinstance(sequence_length, int) or sequence_length <= 0: raise ValueError('INVALID_SEQUENCE_LENGTH')
    if not isinstance(fingerprint, str) or not fingerprint: raise ValueError('INVALID_SCHEMA_FINGERPRINT')
    required_windows = ('micro', 'short', 'medium', 'macro')
    if any(k not in windows or not isinstance(windows[k], int) or windows[k] <= 0 for k in required_windows): raise ValueError('INVALID_FEATURE_WINDOW_VALUES')
    if sequence_length != int(windows['short']): raise ValueError('SEQUENCE_WINDOW_MISMATCH')
    split_ratios = contract.get('splitRatios')
    if not isinstance(split_ratios, dict): raise ValueError('INVALID_SPLIT_RATIOS')
    RUNTIME_SCHEMA = contract
    SCHEMA = str(contract.get('featureSchemaVersion') or fingerprint)
    FEATURES = count
    SEQ = sequence_length
    FEATURE_ORDER = tuple(order)
    FEATURE_INDEX = {key: index for index, key in enumerate(FEATURE_ORDER)}
    WINDOWS = {key: int(windows[key]) for key in required_windows}


def require_schema():
    if RUNTIME_SCHEMA is None: raise RuntimeError('ML_SCHEMA_CONTRACT_NOT_CONFIGURED')
    return RUNTIME_SCHEMA


def f(v, d=0.0):
    try:
        v = float(v)
        return v if math.isfinite(v) else d
    except Exception: return d


def std(a): return float(np.std(a)) if len(a) > 1 else 0.0

def mom(a): return 0.0 if len(a) < 2 or a[0] == 0 else (a[-1] - a[0]) / a[0] * 100

def vel(a): return 0.0 if len(a) < 2 else (a[-1] - a[0]) / len(a)

def persist(a):
    if len(a) < 2: return 0.0
    best = cur = 1
    for i in range(1, len(a)):
        c = np.sign(a[i] - a[i - 1]); p = np.sign(a[i - 1] - a[i - 2]) if i > 1 else 0
        cur = cur + 1 if c and c == p else 1; best = max(best, cur)
    return best / len(a)

def reversal(a):
    return 0.0 if len(a) < 3 else sum(1 for i in range(2, len(a)) if (a[i - 1] - a[i - 2]) * (a[i] - a[i - 1]) < 0) / (len(a) - 2)


def validate_vector(vector):
    schema = require_schema()
    values = [f(v) for v in vector]
    if len(values) != schema['featureCount']:
        raise ValueError(f"FEATURE_VECTOR_LENGTH_MISMATCH: expected {schema['featureCount']}, got {len(values)}")
    return values


def features(ticks, duration=None, asset=0, symbol=''):
    schema = require_schema()
    if not ticks: raise ValueError('REAL_TICKS_REQUIRED')
    p = [f(t.get('price')) for t in ticks]
    if not p or any(not math.isfinite(x) for x in p): raise ValueError('INVALID_TICK_PRICES')
    duration = schema['defaultHorizonTicks'] if duration is None else duration
    n = len(p); cur = p[-1]; sub = lambda k: p[max(0, n - int(k)):]
    p1 = p[-2] if n > 1 else cur; p2 = p[-3] if n > 2 else p1; p3 = p[-4] if n > 3 else p2
    d1 = cur - p1; d2 = cur - p2; d3 = cur - p3
    up = sum(p[i] > p[i - 1] for i in range(1, n)); down = sum(p[i] < p[i - 1] for i in range(1, n)); td = max(1, n - 1); cu = cd = 0
    for i in range(n - 1, 0, -1):
        d = p[i] - p[i - 1]
        if d > 0:
            if cd: break
            cu += 1
        elif d < 0:
            if cu: break
            cd += 1
        else: break
    mi = sub(WINDOWS['micro']); sh = sub(WINDOWS['short']); md = sub(WINDOWS['medium']); ma = sub(WINDOWS['macro'])
    half = max(1, len(sh) // 2); sr = max(sh) - min(sh); comp = .5 if sr == 0 else (cur - min(sh)) / sr
    first = f(ticks[0].get('timestamp'), time.time() * 1000); last = f(ticks[-1].get('timestamp'), time.time() * 1000); elapsed = max(1, (last - first) / 1000); mm = mom(ma)
    precision = int(schema['digitPrecision']); even = sum(int(f'{x:.{precision}f}'[-1]) % 2 == 0 for x in p)
    values = {
        'deltaP1': d1, 'deltaP2': d2, 'deltaP3': d3,
        'micro_momentum': mom(mi), 'short_momentum': mom(sh), 'medium_momentum': mom(md), 'macro_momentum': mm,
        'short_range': sr, 'medium_displacement': abs(md[-1] - md[0]), 'macro_displacement': abs(ma[-1] - ma[0]),
        'up_tick_ratio': up / td, 'down_tick_ratio': down / td, 'directional_imbalance': (up - down) / td,
        'consecutive_up': cu, 'consecutive_down': cd, 'micro_persistence': persist(mi), 'short_persistence': persist(sh),
        'short_reversal_rate': reversal(sh), 'medium_reversal_rate': reversal(md), 'micro_velocity': vel(mi), 'short_velocity': vel(sh),
        'medium_velocity': vel(md), 'acceleration': vel(sh[half:]) - vel(sh[:half]), 'ticks_per_second': n / elapsed,
        'velocity_per_second': (cur - p[0]) / elapsed, 'short_volatility': std(sh), 'medium_volatility': std(md),
        'macro_volatility': std(ma), 'short_rangeCompression': comp, 'medium_distHigh': max(md) - cur, 'medium_distLow': cur - min(md),
        'macro_regime': 1 if mm > schema['regimeThreshold'] else -1 if mm < -schema['regimeThreshold'] else 0,
        'is1SecondSynthetic': 1 if any(str(symbol).upper().startswith(prefix.upper()) for prefix in schema['syntheticSymbolPrefixes']) else 0,
        'contractDurationSecs': float(duration), 'durationFactor': math.log(max(1, duration)), 'digitFrequency': even / max(1, n), 'assetCategory': float(asset),
    }
    missing = [key for key in FEATURE_ORDER if key not in values]
    if missing: raise ValueError(f'MISSING_FEATURE_DEFINITIONS: {missing}')
    return validate_vector([values[key] for key in FEATURE_ORDER])


def X(t, d, a, s): return np.asarray([features(t, d, a, s)], dtype=np.float32)

def seq_X(t, d, a, s):
    if len(t) < SEQ: raise ValueError(f'INSUFFICIENT_SEQUENCE_TICKS: need {SEQ}, got {len(t)}')
    rows = [features(t[max(0, i - SEQ):i], d, a, s) for i in range(1, len(t) + 1)]
    return np.asarray([rows[-SEQ:]], dtype=np.float32)

def path(k, s, d): return MODEL_DIR / f'{s}_{d}s_{k}.pkl'

def load(k, s, d):
    key = (k, s, d)
    if key in CACHE: return CACHE[key]
    p = path(k, s, d)
    if not p.exists(): return None
    try:
        with open(p, 'rb') as h: model = pickle.load(h)
        validate_model_schema(model)
        CACHE[key] = model
        return model
    except Exception: return None


def validate_model_schema(model):
    schema = require_schema()
    required = {
        'schemaFingerprint': schema['schemaFingerprint'], 'featureSchemaVersion': schema['featureSchemaVersion'],
        'featureCount': schema['featureCount'], 'featureOrder': schema['featureOrder'],
        'sequenceLength': schema['sequenceLength'], 'canonicalFeatureWindowTicks': schema['canonicalFeatureWindowTicks'],
    }
    for key, value in required.items():
        if model.get(key) != value: raise ValueError(f'MODEL_SCHEMA_MISMATCH: {key}')


def save(k, s, d, model):
    schema = require_schema()
    model.update({
        'schemaFingerprint': schema['schemaFingerprint'], 'featureSchemaVersion': schema['featureSchemaVersion'],
        'featureCount': schema['featureCount'], 'featureOrder': list(schema['featureOrder']),
        'sequenceLength': schema['sequenceLength'], 'canonicalFeatureWindowTicks': schema['canonicalFeatureWindowTicks'],
    })
    p = path(k, s, d); tmp = Path(str(p) + '.tmp')
    with open(tmp, 'wb') as h: pickle.dump(model, h, pickle.HIGHEST_PROTOCOL)
    tmp.replace(p); CACHE[(k, s, d)] = model


def dataset(t, d, a, s):
    prices = [f(x.get('price')) for x in t]; look = max(1, int(d)); ctx = SEQ
    if len(prices) <= ctx + look: raise ValueError(f'Insufficient ticks: need at least {ctx + look + 1}')
    xx = []; yy = []
    for i in range(ctx, len(prices) - look): xx.append(features(t[:i], d, a, s)); yy.append(int(prices[i + look] > prices[i]))
    if len(set(yy)) < 2: raise ValueError('Training labels contain only one class')
    return np.asarray(xx, np.float32), np.asarray(yy, np.int64)


def split(Xv, y):
    ratio = float(require_schema()['splitRatios']['train']); k = max(1, int(len(Xv) * ratio))
    if k >= len(Xv): raise ValueError('Not enough validation samples')
    return Xv[:k], Xv[k:], y[:k], y[k:]


def train_one(kind, t, d, a, s, h):
    schema = require_schema(); Xv, y = dataset(t, d, a, s); Xt, Xval, yt, yval = split(Xv, y)
    if kind in ('xgboost', 'lightgbm', 'catboost'):
        if kind == 'xgboost':
            if xgb is None: raise RuntimeError('xgboost unavailable')
            m = xgb.XGBClassifier(max_depth=int(h.get('maxDepth', 6)), learning_rate=float(h.get('learningRate', .05)), n_estimators=int(h.get('numEstimators', 100)), subsample=float(h.get('subsample', .8)), random_state=42, eval_metric='logloss', n_jobs=2).fit(Xt, yt)
        elif kind == 'lightgbm':
            if lgb is None: raise RuntimeError('lightgbm unavailable')
            m = lgb.LGBMClassifier(n_estimators=int(h.get('numEstimators', 100)), num_leaves=31, learning_rate=float(h.get('learningRate', .05)), random_state=42, verbosity=-1, n_jobs=2).fit(Xt, yt)
        else:
            if cb is None: raise RuntimeError('catboost unavailable')
            m = cb.CatBoostClassifier(iterations=int(h.get('numEstimators', 100)), depth=int(h.get('maxDepth', 6)), learning_rate=float(h.get('learningRate', .05)), verbose=False, random_seed=42, thread_count=2).fit(Xt, yt)
        pr = m.predict_proba(Xval); metrics = {'accuracy': round(float(accuracy_score(yval, np.argmax(pr, axis=1))) * 100, 3), 'logLoss': round(float(log_loss(yval, pr, labels=[0, 1])), 6)}
        save(kind, s, d, {'schemaVersion': schema['featureSchemaVersion'], 'modelType': kind, 'model': m, 'validation': metrics, 'trainedAt': time.time()})
        return {'success': True, 'modelId': f'{s}_{d}s_{kind}', 'modelType': kind, 'samplesCount': len(Xv), 'validationSamples': len(Xval), **metrics, 'schemaVersion': schema['featureSchemaVersion'], 'schemaFingerprint': schema['schemaFingerprint'], 'featureCount': schema['featureCount'], 'engine': f'Trained native Python {kind}'}
    if kind in ('tcn', 'lstm', 'transformer'):
        if train_deep is None: raise RuntimeError('PyTorch sequence runtime unavailable')
        prices = [f(x.get('price')) for x in t]; look = max(1, int(d))
        if len(prices) <= SEQ + look: raise ValueError(f'Insufficient ticks: need at least {SEQ + look + 1}')
        SX = []; sy = []
        for i in range(SEQ, len(prices) - look): SX.append([features(t[max(0, j - SEQ):j], d, a, s) for j in range(i - SEQ + 1, i + 1)]); sy.append(int(prices[i + look] > prices[i]))
        SX = np.asarray(SX, np.float32); sy = np.asarray(sy, np.int64); k = max(1, int(len(SX) * float(schema['splitRatios']['train'])))
        if k >= len(SX): raise ValueError('Not enough validation samples')
        m = train_deep(kind, SX[:k], sy[:k], epochs=int(h.get('epochs', 8)), batch_size=int(h.get('batchSize', 64)), lr=float(h.get('learningRate', .001)))
        import torch
        with torch.no_grad(): state = {x: v.cpu() for x, v in m.state_dict().items()}; pr = predict_deep(kind, state, SX[k:])
        metrics = {'accuracy': round(float(np.mean(np.argmax(pr, axis=1) == sy[k:])) * 100, 3), 'logLoss': round(float(log_loss(sy[k:], pr, labels=[0, 1])), 6)}
        save(kind, s, d, {'schemaVersion': schema['featureSchemaVersion'], 'modelType': kind, 'state_dict': state, 'validation': metrics, 'trainedAt': time.time()})
        return {'success': True, 'modelId': f'{s}_{d}s_{kind}', 'modelType': kind, 'samplesCount': len(SX), 'validationSamples': len(SX) - k, **metrics, 'schemaVersion': schema['featureSchemaVersion'], 'schemaFingerprint': schema['schemaFingerprint'], 'featureCount': schema['featureCount'], 'sequenceLength': schema['sequenceLength'], 'engine': f'Trained PyTorch {kind}'}
    if kind == 'hmm':
        if GaussianHMM is None: raise RuntimeError('hmmlearn unavailable')
        selected = [FEATURE_INDEX[name] for name in ('deltaP1', 'micro_momentum', 'up_tick_ratio', 'short_volatility')]
        m = GaussianHMM(n_components=int(h.get('components', 4)), covariance_type='diag', n_iter=int(h.get('iterations', 100)), random_state=42).fit(Xt[:, selected]); m.state_labels = ['LOW_VOLATILITY', 'DIRECTIONAL_EXPANSION', 'CHOPPY_REVERSAL', 'SPIKE_REGIME']
        save(kind, s, d, {'model': m, 'validationSamples': len(Xval), 'trainedAt': time.time(), 'schemaVersion': schema['featureSchemaVersion']})
        return {'success': True, 'modelId': f'{s}_{d}s_hmm', 'modelType': 'hmm', 'samplesCount': len(Xv), 'validationSamples': len(Xval), 'schemaVersion': schema['featureSchemaVersion'], 'schemaFingerprint': schema['schemaFingerprint'], 'featureCount': schema['featureCount'], 'engine': 'Trained hmmlearn GaussianHMM'}
    if kind == 'isolation_forest':
        if IsolationForest is None: raise RuntimeError('scikit-learn unavailable')
        model = IsolationForest(n_estimators=int(h.get('numEstimators', 200)), contamination='auto', random_state=42, n_jobs=2).fit(Xt)
        save(kind, s, d, {'model': model, 'validationSamples': len(Xval), 'trainedAt': time.time(), 'schemaVersion': schema['featureSchemaVersion']})
        return {'success': True, 'modelId': f'{s}_{d}s_isolation_forest', 'modelType': kind, 'samplesCount': len(Xv), 'validationSamples': len(Xval), 'schemaVersion': schema['featureSchemaVersion'], 'schemaFingerprint': schema['schemaFingerprint'], 'featureCount': schema['featureCount'], 'engine': 'Trained scikit-learn IsolationForest'}
    raise ValueError(kind)


def predict_one(req):
    schema = require_schema(); s = req.get('symbol')
    if not isinstance(s, str) or not s.strip(): raise ValueError('SYMBOL_REQUIRED')
    t = req.get('ticks', []); d = int(req.get('durationSecs', schema['defaultHorizonTicks'])); a = req.get('assetCategory', 0); k = req.get('modelType', 'xgboost'); m = load(k, s, d)
    if m is None: return {'success': False, 'id': req.get('id'), 'modelType': k, 'error': 'MODEL_UNAVAILABLE_OR_SCHEMA_MISMATCH', 'schemaVersion': schema['featureSchemaVersion'], 'schemaFingerprint': schema['schemaFingerprint']}
    validation = m.get('validation', {}) if isinstance(m, dict) else {}
    metadata = {'validation': validation, 'modelSchema': m.get('schemaVersion', schema['featureSchemaVersion']) if isinstance(m, dict) else schema['featureSchemaVersion'], 'schemaFingerprint': schema['schemaFingerprint'], 'featureCount': schema['featureCount'], 'trainedAt': m.get('trainedAt') if isinstance(m, dict) else None}
    if k in ('xgboost', 'lightgbm', 'catboost'):
        pr = m['model'].predict_proba(X(t, d, a, s))[0]; down, up = float(pr[0]), float(pr[1]); return {**result(req, k, up, down, m), **metadata}
    if k in ('tcn', 'lstm', 'transformer'):
        if predict_deep is None: return {'success': False, 'id': req.get('id'), 'modelType': k, 'error': 'PYTORCH_UNAVAILABLE'}
        pr = predict_deep(k, m['state_dict'], seq_X(t, d, a, s))[0]; return {**result(req, k, float(pr[1]), float(pr[0]), m), **metadata}
    if k == 'hmm':
        model = m['model']; v = X(t, d, a, s); selected = [FEATURE_INDEX[name] for name in ('deltaP1', 'micro_momentum', 'up_tick_ratio', 'short_volatility')]; obs = v[:, selected]; state = int(model.predict(obs)[0]); p = model.predict_proba(obs)[0]; labels = getattr(model, 'state_labels', [str(i) for i in range(len(p))]); return {**{'success': True, 'id': req.get('id'), 'modelType': 'hmm', 'primaryRegime': labels[state % len(labels)], 'regimeState': state + 1, 'regimeProbabilities': [round(float(x) * 100, 2) for x in p], 'engine': 'Trained GaussianHMM'}, **metadata}
    if k == 'isolation_forest':
        v = X(t, d, a, s); raw = float(m['model'].score_samples(v)[0]); return {**{'success': True, 'id': req.get('id'), 'modelType': k, 'isAnomaly': int(m['model'].predict(v)[0]) == -1, 'anomalyScore': round(max(0, min(1, .5 - raw)), 4), 'engine': 'Trained IsolationForest'}, **metadata}
    return {'success': False, 'id': req.get('id'), 'error': 'UNSUPPORTED_MODEL'}


def result(req, k, up, down, m):
    schema = require_schema(); return {'success': True, 'id': req.get('id'), 'symbol': req.get('symbol'), 'durationSecs': req.get('durationSecs', schema['defaultHorizonTicks']), 'modelType': k, 'signal': 'CALL' if up >= down else 'PUT', 'confidence': round(max(up, down) * 100, 2), 'probabilityUp': round(up * 100, 2), 'probabilityDown': round(down * 100, 2), 'rawScore': round(up - down, 6), 'modelVersion': schema['featureSchemaVersion'], 'engine': f'Trained native {k}'}
