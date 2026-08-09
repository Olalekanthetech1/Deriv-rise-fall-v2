"""Production ML daemon entrypoint.

Node/TypeScript owns feature calculation and sends validated canonical vectors,
datasets and schema contracts. Python owns only native model execution.
"""
from __future__ import annotations

import json
import sys

import ml_native_runtime as runtime
import ml_duration_training as duration_training
from ml_ensemble_runtime import predict_ensemble
from ml_duration_runtime_adapter import install as install_duration_runtime_adapter


install_duration_runtime_adapter()

ACTIONS = ("predict", "predict_ensemble", "train", "train_partitioned", "list_models", "ping", "backtest")


def dispatch(request: dict) -> dict:
    runtime.configure_schema(request.get("schemaContract"))
    action = request.get("action")

    if action == "predict":
        return runtime.predict_one(request)

    if action == "train":
        return runtime.train_one(request.get("modelType", "xgboost"), request)

    if action == "train_partitioned":
        return duration_training.train_partitioned(request.get("modelType", "xgboost"), request)

    if action == "predict_ensemble":
        return predict_ensemble(request)

    if action == "backtest":
        return runtime.backtest(request)

    if action == "ping":
        schema = runtime.require_schema()
        return {
            "success": True,
            "id": request.get("id"),
            "pong": True,
            "schemaVersion": schema["featureSchemaVersion"],
            "schemaFingerprint": schema["schemaFingerprint"],
            "featureCount": schema["featureCount"],
            "models": runtime.model_types(),
        }

    if action == "list_models":
        schema = runtime.require_schema()
        return {
            "success": True,
            "id": request.get("id"),
            "schemaFingerprint": schema["schemaFingerprint"],
            "models": [path.name for path in runtime.MODEL_DIR.glob("*.pkl")],
            "supportedModelTypes": runtime.model_types(),
        }

    return {"success": False, "id": request.get("id"), "error": f"Unknown action {action}"}


def main() -> None:
    sys.stdout.write(
        json.dumps(
            {
                "type": "ready",
                "schemaContractRequired": True,
                "featureSource": "node-canonical-registry",
                "modelSource": "native-python-runtime",
                "actions": list(ACTIONS),
                "models": runtime.model_types(),
            }
        )
        + "\n"
    )
    sys.stdout.flush()

    for line in sys.stdin:
        request: dict = {}
        try:
            request = json.loads(line)
            output = dispatch(request)
        except Exception as exc:
            output = {"success": False, "id": request.get("id") if isinstance(request, dict) else None, "error": str(exc)}
        sys.stdout.write(json.dumps(output, default=str) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
