"""Bounded parallel execution for the native ML production ensemble.

The Node production resolver selects a durable artifact from the production
registry and materializes it for this request. Python never guesses legacy
filenames and never selects models independently of production governance.
"""
from __future__ import annotations

import hashlib
import os
import pickle
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np

import ml_native_runtime as runtime
from ml_deep_models import predict as predict_deep


def _load_governed_artifact(production_model: dict[str, Any]) -> dict[str, Any]:
    artifact_path = str(production_model.get("artifactPath") or "").strip()
    expected_sha = str(production_model.get("artifactSha256") or "").strip().lower()
    if not artifact_path:
        raise ValueError("PROMOTED_MODEL_ARTIFACT_UNAVAILABLE")
    path = Path(artifact_path)
    if not path.is_file():
        raise ValueError("PROMOTED_MODEL_ARTIFACT_UNAVAILABLE")
    raw = path.read_bytes()
    if expected_sha and hashlib.sha256(raw).hexdigest().lower() != expected_sha:
        raise ValueError("PROMOTED_MODEL_ARTIFACT_CHECKSUM_MISMATCH")
    record = pickle.loads(raw)
    if not isinstance(record, dict):
        raise ValueError("PROMOTED_MODEL_ARTIFACT_INVALID")
    return record


def _predict_governed_one(request: dict[str, Any], model_type: str, production_model: dict[str, Any]) -> dict[str, Any]:
    try:
        record = _load_governed_artifact(production_model)
    except Exception as exc:
        return {
            "success": False,
            "id": request.get("id"),
            "modelType": model_type,
            "error": str(exc),
            "modelId": production_model.get("modelId"),
            "trainingRunId": production_model.get("trainingRunId"),
            "durationValue": production_model.get("durationValue"),
            "durationUnit": production_model.get("durationUnit"),
        }

    schema = runtime.require_schema()
    metadata = {
        "validation": record.get("validation", {}),
        "schemaVersion": schema["featureSchemaVersion"],
        "schemaFingerprint": schema["schemaFingerprint"],
        "featureCount": schema["featureCount"],
        "trainedAt": record.get("trainedAt"),
        "modelId": production_model.get("modelId"),
        "trainingRunId": production_model.get("trainingRunId"),
        "durationValue": production_model.get("durationValue"),
        "durationUnit": production_model.get("durationUnit"),
        "governanceStatus": "production",
    }

    if str(record.get("modelType") or "") != model_type:
        return {"success": False, "id": request.get("id"), "modelType": model_type, "error": "PRODUCTION_MODEL_TYPE_MISMATCH", **metadata}
    if record.get("schemaFingerprint") != schema["schemaFingerprint"]:
        return {"success": False, "id": request.get("id"), "modelType": model_type, "error": "MODEL_SCHEMA_MISMATCH:schemaFingerprint", **metadata}

    vector = np.asarray([runtime.validate_vector(request.get("featureVector"))], dtype=np.float32)
    if model_type in {"xgboost", "lightgbm", "catboost"}:
        model = record.get("model")
        if model is None:
            return {"success": False, "id": request.get("id"), "modelType": model_type, "error": "PREDICTIVE_ARTIFACT_MODEL_MISSING", **metadata}
        probabilities = model.predict_proba(vector)[0]
        down, up = float(probabilities[0]), float(probabilities[1])
        return {**runtime.prediction_result(request, model_type, up, down), **metadata}

    if model_type in {"tcn", "lstm", "transformer"}:
        if predict_deep is None:
            return {"success": False, "id": request.get("id"), "modelType": model_type, "error": "PYTORCH_SEQUENCE_RUNTIME_UNAVAILABLE", **metadata}
        sequence = request.get("featureSequence")
        if not isinstance(sequence, list) or len(sequence) != schema["sequenceLength"]:
            return {"success": False, "id": request.get("id"), "modelType": model_type, "error": "FEATURE_SEQUENCE_REQUIRED", **metadata}
        sequence_array = np.asarray([[runtime.validate_vector(row) for row in sequence]], dtype=np.float32)
        state_dict = record.get("state_dict")
        if not isinstance(state_dict, dict):
            return {"success": False, "id": request.get("id"), "modelType": model_type, "error": "SEQUENCE_ARTIFACT_STATE_DICT_MISSING", **metadata}
        probabilities = predict_deep(model_type, state_dict, sequence_array)[0]
        return {**runtime.prediction_result(request, model_type, float(probabilities[1]), float(probabilities[0])), **metadata}

    if model_type == "hmm":
        model = record.get("model")
        if model is None:
            return {"success": False, "id": request.get("id"), "modelType": model_type, "error": "REGIME_ARTIFACT_MODEL_MISSING", **metadata}
        probabilities = model.predict_proba(vector)[0]
        state = int(model.predict(vector)[0])
        return {"success": True, "id": request.get("id"), "modelType": model_type, "primaryRegime": f"REGIME_{state + 1}", "regimeState": state + 1, "regimeProbabilities": [round(float(value) * 100.0, 2) for value in probabilities], "engine": "Trained native GaussianHMM", **metadata}

    if model_type == "isolation_forest":
        model = record.get("model")
        if model is None:
            return {"success": False, "id": request.get("id"), "modelType": model_type, "error": "ANOMALY_ARTIFACT_MODEL_MISSING", **metadata}
        raw = float(model.score_samples(vector)[0])
        return {"success": True, "id": request.get("id"), "modelType": model_type, "isAnomaly": int(model.predict(vector)[0]) == -1, "anomalyScore": round(max(0.0, min(1.0, 0.5 - raw)), 4), "engine": "Trained native IsolationForest", **metadata}

    return {"success": False, "id": request.get("id"), "modelType": model_type, "error": f"UNSUPPORTED_MODEL:{model_type}", **metadata}


def _predict_one(request: dict[str, Any], model_type: str) -> tuple[str, dict[str, Any]]:
    try:
        production_models = request.get("productionModels")
        if not isinstance(production_models, dict) or not isinstance(production_models.get(model_type), dict):
            return model_type, {"success": False, "id": request.get("id"), "modelType": model_type, "error": "PRODUCTION_MODEL_RESOLUTION_REQUIRED"}
        return model_type, _predict_governed_one(request, model_type, production_models[model_type])
    except Exception as exc:
        return model_type, {"success": False, "id": request.get("id"), "modelType": model_type, "error": str(exc)}


def predict_ensemble(request: dict[str, Any]) -> dict[str, Any]:
    requested = request.get("modelTypes")
    model_types = requested if isinstance(requested, list) and requested else []
    model_types = [str(model_type) for model_type in model_types]
    if not model_types:
        return {"success": False, "id": request.get("id"), "models": {}, "error": "NO_PRODUCTION_MODELS_REQUESTED"}

    configured_workers = int(os.getenv("ML_ENSEMBLE_MAX_WORKERS", "3"))
    max_workers = max(1, min(configured_workers, len(model_types)))
    models: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="ml-ensemble") as executor:
        futures = {executor.submit(_predict_one, request, model_type): model_type for model_type in model_types}
        for future in as_completed(futures):
            model_type, result = future.result()
            models[model_type] = result

    ordered_models = {model_type: models[model_type] for model_type in model_types}
    return {
        "success": True,
        "id": request.get("id"),
        "models": ordered_models,
        "execution": {"mode": "bounded_parallel", "workerCount": max_workers, "requestedModelCount": len(model_types), "governedProductionArtifacts": True},
    }
