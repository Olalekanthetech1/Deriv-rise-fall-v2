"""Production ML daemon entrypoint.

Node/TypeScript owns feature calculation and sends validated canonical vectors,
datasets and schema contracts. Python owns only native model execution.
"""
from __future__ import annotations

import json
import sys

import ml_native_runtime as runtime


ACTIONS = ("predict", "predict_ensemble", "train", "list_models", "ping", "backtest")


def dispatch(request: dict) -> dict:
    runtime.configure_schema(request.get("schemaContract"))
    action = request.get("action")

    if action == "predict":
        return runtime.predict_one(request)

    if action == "train":
        return runtime.train_one(request.get("modelType", "xgboost"), request)

    if action == "predict_ensemble":
        requested = request.get("modelTypes")
        model_types = requested if isinstance(requested, list) and requested else runtime.model_types()
        return {
            "success": True,
            "id": request.get("id"),
            "models": {
                model_type: runtime.predict_one({**request, "modelType": model_type})
                for model_type in model_types
            },
        }

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

    return {
        "success": False,
        "id": request.get("id"),
        "error": f"Unknown action {action}",
    }


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
            output = {
                "success": False,
                "id": request.get("id") if isinstance(request, dict) else None,
                "error": str(exc),
            }
        sys.stdout.write(json.dumps(output, default=str) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
