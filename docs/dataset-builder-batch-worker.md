# Dataset Builder batch worker contract

The multi-asset Dataset Builder persists one AUTO job per asset and drains each job server-side until all job items reach a terminal state. Browser polling is observational only.

Before an expensive build, the worker checks for an existing completed dataset with a passed leakage check using the asset symbol plus duration unit/value identity. Matching items are recorded as skipped with an `ALREADY_EXISTS` reason and are not rebuilt.
