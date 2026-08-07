"""Production ML daemon entrypoint.

All model training and inference is delegated to ml_runtime_v5. The runtime
never trains or fabricates a model during live prediction.
"""
from ml_runtime_v5 import main

if __name__ == "__main__":
    main()
