"""Bounded parallel execution for the native ML ensemble.

Production inference is registry-governed: the Node layer resolves the current
production model(s) and sends their duration/lineage metadata. This module then
loads the exact duration-aware artifact rather than guessing a legacy filename.
"""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import numpy as np

import ml_native_runtime as runtime
from ml_duration_artifacts import load_duration
from ml_deep_models import predict as predict_deep


def _predict_governed_one(request: dict[str, Any], model_type: str, production_model: dict[str, Any]) -> dict[str, Any]:
    symbol = str(request.get("symbol") or "")
    duration_value = int(production_model.get("durationValue"))
    duration_unit = str(production_model.get("durationUnit") or "")
    training_run_id = str(production_model.get("trainingRunId") or "") or None
    record = load_duration(model_type, symbol, duration_value, duration_unit, training_run_id)
    if record is None:
        return {
            "success": False,
            "id": request.get("id"),
            "modelType": model_type,
            "error": "PROMOTED_MODEL_ARTIFACT_UNAVAILABLE",
            "modelId": production_model.get("modelId"),
            "trainingRunId": training_run_id,
            "durationValue": duration_value,
            "durationUnit": duration_unit,
        }

    schema = runtime.require_schema()
    metadata = {
        "validation": record.get("validation", {}),
        "schemaVersion": schema["featureSchemaVersion"],
        "schemaFingerprint": schema["schemaFingerprint"],
        "featureCount": schema["featureCount"],
        "trainedAt": record.get("trainedAt"),
        "modelId": production_model.get("modelId"),
        "trainingRunId": training_run_id,
        "durationValue": duration_value,
        "durationUnit": duration_unit,
        "governanceStatus": "production",
    }

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
        probabilities = model.predict_proba(vector)[0]
        state = int(model.predict(vector)[0])
        return {
            "success": True,
            "id": request.get("id"),
            "modelType": model_type,
            "primaryRegime": f"REGIME_{state + 1}",
            "regimeState": state + 1,
            "regimeProbabilities": [round(float(value) * 100.0, 2) for value in probabilities],
            "engine": "Trained native GaussianHMM",
            **metadata,
        }

    if model_type == "isolation_forest":
        model = record.get("model")
        raw = float(model.score_samples(vector)[0])
        return {
            "success": True,
            "id": request.get("id"),
            "modelType": model_type,
            "isAnomaly": int(model.predict(vector)[0]) == -1,
            "anomalyScore": round(max(0.0, min(1.0, 0.5 - raw)), 4),
            "engine": "Trained native IsolationForest",
            **metadata,
        }

    return {"success": False, "id": request.get("id"), "modelType": model_type, "error": f"UNSUPPORTED_MODEL:{model_type}", **metadata}


def _predict_one(request: dict[str, Any], model_type: str) -> tuple[str, dict[str, Any]]:
    try:
        production_models = request.get("productionModels")
        production_model = production_models.get(model_type) if isinstance(production_models, dict) else None
        if isinstance(production_model, dict):
            return model_type, _predict_governed_one(request, model_type, production_model)
        result = runtime.predict_one({**request, "modelType": model_type})
        return model_type, result
    except Exception as exc:
        return model_type, {
            "success": False,
            "id": request.get("id"),
            "modelType": model_type,
            "error": str(exc),
        }


def predict_ensemble(request: dict[str, Any]) -> dict[str, Any]:
    requested = request.get("modelTypes")
    model_types = requested if isinstance(requested, list) and requested else runtime.model_types()
    model_types = [str(model_type) for model_type in model_types]
    if not model_types:
        return {"success": False, "id": request.get("id"), "models": {}, "error": "NO_MODELS_REQUESTED"}

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
        "execution": {
            "mode": "bounded_parallel",
            "workerCount": max_workers,
            "requestedModelCount": len(model_types),
            "governedProductionArtifacts": bool(request.get("productionModels")),
        },
    }
