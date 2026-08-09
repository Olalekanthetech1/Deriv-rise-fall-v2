"""Compatibility adapter for duration-aware native model artifacts.

Agenda 6 artifacts are named with their broker duration unit/value and training
lineage. The legacy native runtime loader only understands the old seconds-only
filename. This adapter extends that loader without duplicating model inference.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import ml_native_runtime as runtime


_original_load = runtime.load


def _duration_candidates(kind: str, symbol: str, duration_value: int, duration_unit: str) -> list[Path]:
    safe_symbol = "".join(ch for ch in str(symbol) if ch.isalnum() or ch == "_")
    safe_unit = "".join(ch for ch in str(duration_unit) if ch.isalnum())
    safe_kind = "".join(ch for ch in str(kind) if ch.isalnum() or ch == "_")
    if not safe_symbol or not safe_unit or not safe_kind:
        return []
    prefix = f"{safe_symbol}_{safe_unit}{int(duration_value)}_{safe_kind}"
    return sorted(
        runtime.MODEL_DIR.glob(f"{prefix}*.pkl"),
        key=lambda path: path.stat().st_mtime_ns,
        reverse=True,
    )


def load_duration_aware(kind: str, symbol: str, duration_value: int, duration_unit: str) -> Any | None:
    candidates = _duration_candidates(kind, symbol, duration_value, duration_unit)
    for path in candidates:
        try:
            with path.open("rb") as handle:
                model = runtime.pickle.load(handle)
            runtime.validate_model_schema(model)
            if int(model.get("durationValue", duration_value)) != int(duration_value):
                continue
            if str(model.get("durationUnit", duration_unit)) != str(duration_unit):
                continue
            runtime.CACHE[(kind, symbol, int(duration_value))] = model
            return model
        except Exception:
            continue
    return None


def install() -> None:
    def load(kind: str, symbol: str, duration: int) -> Any | None:
        model = _original_load(kind, symbol, duration)
        if model is not None:
            return model
        return load_duration_aware(kind, symbol, duration, "s")

    runtime.load = load
