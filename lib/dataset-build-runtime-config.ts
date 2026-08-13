import os from 'os';

type DatasetBuildRuntimeConfig = {
  maxAssets: number | null;
  concurrency: number;
  pollIntervalMs: number;
};

function optionalPositiveInteger(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`[Dataset Build Config] ${name} must be a positive safe integer.`);
  return value;
}

function requiredPositiveInteger(name: string): number {
  const value = optionalPositiveInteger(name);
  if (value === null) throw new Error(`[Dataset Build Config] ${name} is required.`);
  return value;
}

export function getDatasetBuildRuntimeConfig(): DatasetBuildRuntimeConfig {
  const configuredMaxAssets = optionalPositiveInteger('DATASET_BUILD_MAX_ASSETS');
  const trainingConcurrency = requiredPositiveInteger('ML_TRAINING_CONCURRENCY');
  const pollIntervalMs = requiredPositiveInteger('DATASET_BUILD_POLL_INTERVAL_MS');
  const hostParallelism = Math.max(1, os.availableParallelism());
  return {
    maxAssets: configuredMaxAssets,
    concurrency: Math.max(1, Math.min(trainingConcurrency, hostParallelism)),
    pollIntervalMs,
  };
}
