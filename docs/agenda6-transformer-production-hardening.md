# Agenda 6 — Transformer production hardening

## Current finding

The native training path is persisted and observable, but the admin `POST /api/admin/model-training` route previously awaited the complete native/Python training operation. Transformer training can exceed the platform HTTP request window even when the native worker remains healthy, producing a Render/edge `502 Bad Gateway` while the training process is still active.

## Change in this branch

The admin training endpoint now returns `202 Accepted` immediately after scheduling the persisted training operation. Training execution is no longer coupled to the HTTP request lifetime. The existing training orchestrator remains responsible for persisted run state, model state, heartbeats, terminal status, and stale-worker reconciliation.

The training diagnostics GET endpoint remains the source of truth for progress and terminal outcomes.

## Important production boundary

This change removes the HTTP timeout coupling, but the native training execution still shares the web process. That is an intermediate hardening step, not the final worker topology.

The next production step is a dedicated Render background worker that claims queued training runs from the database and executes them independently of the Next.js web process. That worker should reuse the existing persisted run/model tables and heartbeat/reconciliation semantics rather than introducing a second training state machine.

## Transformer policy

Transformer remains experimental and is not promoted automatically. Its training failures must remain isolated to the model attempt and must not invalidate successful production-candidate models from the same dataset/run.
