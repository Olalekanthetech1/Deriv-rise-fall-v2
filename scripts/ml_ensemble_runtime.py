"""Bounded parallel execution for the native ML ensemble.

The daemon remains single-request-at-a-time on stdin, but the independent model
inference calls inside one predict_ensemble request run concurrently with a
small configurable worker pool. This avoids serial eight-model latency while
preventing unbounded CPU/thread pressure.
"""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import ml_native_runtime as runtime


def _predict_one(request: dict[str, Any], model_type: str) -> tuple[str, dict[str, Any]]:
    try:
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
        },
    }
