"""Duration-aware native artifact persistence.

Artifact identity is the broker duration value/unit, not a converted seconds
or effective-tick surrogate. This prevents 5m, 300t and 300s models from
colliding or being mislabeled.
"""
from __future__ import annotations

import os
import pickle
from pathlib import Path
from typing import Any

import ml_native_runtime as native

MODEL_DIR = Path(os.getenv("MODEL_CACHE_DIR", str(Path(__file__).resolve().parent.parent / "models_cache")))
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def _safe(value: str) -> str:
    cleaned = "".join(ch for ch in str(value) if ch.isalnum() or ch in "_-.")
    if not cleaned:
        raise ValueError("INVALID_ARTIFACT_ID")
    return cleaned


def model_path(kind: str, symbol: str, duration_value: int, duration_unit: str) -> Path:
    return MODEL_DIR / f"{_safe(symbol)}_{_safe(duration_unit)}{int(duration_value)}_{_safe(kind)}.pkl"


def save_duration(kind: str, symbol: str, duration_value: int, duration_unit: str, model: dict[str, Any]) -> Path:
    schema = native.require_schema()
    model.update({
        "schemaFingerprint": schema["schemaFingerprint"],
        "featureSchemaVersion": schema["featureSchemaVersion"],
        "featureCount": schema["featureCount"],
        "featureOrder": list(schema["featureOrder"]),
        "sequenceLength": schema["sequenceLength"],
        "canonicalFeatureWindowTicks": schema["canonicalFeatureWindowTicks"],
        "durationValue": int(duration_value),
        "durationUnit": str(duration_unit),
    })
    path = model_path(kind, symbol, duration_value, duration_unit)
    temporary = Path(f"{path}.tmp")
    with temporary.open("wb") as handle:
        pickle.dump(model, handle, pickle.HIGHEST_PROTOCOL)
    temporary.replace(path)
    return path
