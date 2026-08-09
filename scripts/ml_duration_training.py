"""Partition-aware native training for duration-specific persisted datasets."""
from __future__ import annotations
import time
from typing import Any
import numpy as np
import ml_native_runtime as native
from ml_duration_artifacts import save_duration
try:
    import xgboost as xgb
except Exception: xgb = None
try:
    import lightgbm as lgb
except Exception: lgb = None
try:
    import catboost as cb
except Exception: cb = None
try:
    from sklearn.ensemble import IsolationForest
    from sklearn.metrics import accuracy_score, log_loss
except Exception: IsolationForest = None; accuracy_score = None; log_loss = None
try:
    from hmmlearn.hmm import GaussianHMM
except Exception: GaussianHMM = None
try:
    from ml_deep_models import train as train_deep, predict as predict_deep
except Exception: train_deep = None; predict_deep = None

def _partition(payload: dict[str, Any], key: str, sequence: bool = False):
    data = payload.get(key)
    if not isinstance(data, dict): raise ValueError(f"{key.upper()}_REQUIRED")
    vectors = data.get("featureSequences" if sequence else "featureVectors"); labels = data.get("labels")
    if not isinstance(vectors,list) or not isinstance(labels,list) or len(vectors)!=len(labels) or not vectors: raise ValueError(f"INVALID_{key.upper()}")
    schema=native.require_schema()
    if int(data.get("featureCount",-1))!=schema["featureCount"]: raise ValueError("FEATURE_DATASET_SCHEMA_MISMATCH")
    if data.get("schemaFingerprint")!=schema["schemaFingerprint"]: raise ValueError("FEATURE_DATASET_FINGERPRINT_MISMATCH")
    if sequence and int(data.get("sequenceLength",-1))!=schema["sequenceLength"]: raise ValueError("SEQUENCE_DATASET_SEQUENCE_LENGTH_MISMATCH")
    X=np.asarray([[[float(x) for x in row] for row in seq] for seq in vectors],dtype=np.float32) if sequence else np.asarray([native.validate_vector(vec) for vec in vectors],dtype=np.float32)
    return X,np.asarray([int(v) for v in labels],dtype=np.int64)

def _require_two_classes(y: np.ndarray,name: str):
    if len(y)<2 or len(set(y.tolist()))<2: raise ValueError(f"{name}_LABELS_SINGLE_CLASS")

def train_partitioned(kind: str,payload: dict[str,Any])->dict[str,Any]:
    kind=native.validate_model_type(kind); schema=native.require_schema(); symbol=str(payload.get("symbol") or "").strip(); duration_key=int(payload.get("effectiveHorizonTicks")); duration_value=payload.get("durationValue"); duration_unit=str(payload.get("durationUnit") or ""); duration_seconds=payload.get("durationSeconds"); training_run_id=payload.get("trainingRunId")
    if not symbol: raise ValueError("SYMBOL_REQUIRED")
    if not isinstance(duration_key,int) or duration_key<=0: raise ValueError("EFFECTIVE_HORIZON_TICKS_REQUIRED")
    if not isinstance(duration_value,int) or duration_value<=0 or duration_unit not in {"t","s","m","h","d"}: raise ValueError("DURATION_METADATA_REQUIRED")
    hyper=payload.get("hyperparams") or {}; family=native.MODEL_SPECS[kind]["family"]
    Xt,yt=_partition(payload,"trainSequenceDataset",True) if family=="sequential" else _partition(payload,"trainTabularDataset")
    Xv,yv=_partition(payload,"validationSequenceDataset",True) if family=="sequential" else _partition(payload,"validationTabularDataset")
    _require_two_classes(yt,"TRAINING"); _require_two_classes(yv,"VALIDATION"); metrics={}
    if family=="sequential":
        if train_deep is None or predict_deep is None: raise RuntimeError("PYTORCH_SEQUENCE_RUNTIME_UNAVAILABLE")
        model=train_deep(kind,Xt,yt,epochs=int(hyper.get("epochs",8)),batch_size=int(hyper.get("batchSize",64)),lr=float(hyper.get("learningRate",.001)))
        import torch
        with torch.no_grad(): state={k:v.cpu() for k,v in model.state_dict().items()}; probabilities=predict_deep(kind,state,Xv)
        predictions=np.argmax(probabilities,axis=1); metrics={"accuracy":round(float(accuracy_score(yv,predictions))*100,3),"logLoss":round(float(log_loss(yv,probabilities,labels=[0,1])),6)}; record={"modelType":kind,"state_dict":state,"validation":metrics,"trainedAt":time.time()}; engine=f"Trained native PyTorch {kind} from persisted duration partition"
    else:
        if kind=="xgboost":
            if xgb is None: raise RuntimeError("XGBOOST_RUNTIME_UNAVAILABLE")
            model=xgb.XGBClassifier(max_depth=int(hyper.get("maxDepth",6)),learning_rate=float(hyper.get("learningRate",.05)),n_estimators=int(hyper.get("numEstimators",100)),subsample=float(hyper.get("subsample",.8)),eval_metric="logloss",n_jobs=int(hyper.get("nJobs",2))).fit(Xt,yt); engine="Trained native Python XGBoost from persisted duration partition"
        elif kind=="lightgbm":
            if lgb is None: raise RuntimeError("LIGHTGBM_RUNTIME_UNAVAILABLE")
            model=lgb.LGBMClassifier(n_estimators=int(hyper.get("numEstimators",100)),learning_rate=float(hyper.get("learningRate",.05)),num_leaves=int(hyper.get("numLeaves",31)),random_state=int(hyper.get("randomState",42)),verbosity=-1,n_jobs=int(hyper.get("nJobs",2))).fit(Xt,yt); engine="Trained native Python LightGBM from persisted duration partition"
        elif kind=="catboost":
            if cb is None: raise RuntimeError("CATBOOST_RUNTIME_UNAVAILABLE")
            model=cb.CatBoostClassifier(iterations=int(hyper.get("numEstimators",100)),depth=int(hyper.get("maxDepth",6)),learning_rate=float(hyper.get("learningRate",.05)),verbose=False,random_seed=int(hyper.get("randomState",42))).fit(Xt,yt); engine="Trained native Python CatBoost from persisted duration partition"
        elif kind=="hmm":
            if GaussianHMM is None: raise RuntimeError("HMMLEARN_RUNTIME_UNAVAILABLE")
            model=GaussianHMM(n_components=int(hyper.get("components",4)),covariance_type="diag",n_iter=int(hyper.get("iterations",100)),random_state=int(hyper.get("randomState",42))).fit(Xt); engine="Trained native hmmlearn GaussianHMM from persisted duration partition"
        elif kind=="isolation_forest":
            if IsolationForest is None: raise RuntimeError("SCIKIT_LEARN_RUNTIME_UNAVAILABLE")
            model=IsolationForest(n_estimators=int(hyper.get("numEstimators",200)),contamination="auto",random_state=int(hyper.get("randomState",42)),n_jobs=int(hyper.get("nJobs",2))).fit(Xt,yt); engine="Trained native scikit-learn IsolationForest from persisted duration partition"
        else: raise ValueError(f"UNSUPPORTED_TABULAR_MODEL:{kind}")
        if kind in {"xgboost","lightgbm","catboost"}:
            probabilities=model.predict_proba(Xv); predictions=np.argmax(probabilities,axis=1); metrics={"accuracy":round(float(accuracy_score(yv,predictions))*100,3),"logLoss":round(float(log_loss(yv,probabilities,labels=[0,1])),6)}
        record={"modelType":kind,"model":model,"validation":metrics,"trainedAt":time.time()}
    artifact=save_duration(kind,symbol,duration_value,duration_unit,record,str(training_run_id) if training_run_id else None)
    lineage=str(training_run_id)[:12] if training_run_id else "legacy"
    model_id=f"{symbol}_{duration_unit}{duration_value}_{kind}_{lineage}"
    return {"success":True,"modelId":model_id,"modelType":kind,"artifactPath":str(artifact),"effectiveHorizonTicks":duration_key,"durationValue":duration_value,"durationUnit":duration_unit,"durationSeconds":duration_seconds,"samplesCount":int(len(Xt)),"validationSamples":int(len(Xv)),"featureCount":schema["featureCount"],"sequenceLength":schema["sequenceLength"],"metrics":metrics,"accuracy":metrics.get("accuracy"),"schemaVersion":schema["featureSchemaVersion"],"schemaFingerprint":schema["schemaFingerprint"],"engine":engine}
