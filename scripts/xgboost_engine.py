"""Compatibility entrypoint for the production ML runtime.

The historical implementation mixed training, random model creation, and live
inference. The v4 runtime is the single source of truth and never fabricates a
model during inference.
"""
from ml_runtime_v4 import main

if __name__ == "__main__":
    main()
