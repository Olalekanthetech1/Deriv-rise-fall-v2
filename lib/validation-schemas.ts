import { z } from 'zod';

export const PredictSchema = z.object({
  symbol: z.string().regex(/^[A-Za-z0-9_]+$/).max(50).default('R_100'),
  ticks: z.array(
    z.object({
      price: z.number(),
      timestamp: z.number().int().positive().optional(),
    })
  ).optional().default([]),
  durationSecs: z.number().int().min(1).max(3600).default(5),
  assetCategory: z.number().int().optional().default(0),
});

export const TrainSchema = z.object({
  symbol: z.string().regex(/^[A-Za-z0-9_]+$/).max(50).default('R_100'),
  category: z.string().optional(),
  retrainAll: z.boolean().optional().default(false),
  maxDepth: z.number().int().optional().default(6),
  learningRate: z.number().optional().default(0.05),
  numEstimators: z.number().int().optional().default(100),
  subsample: z.number().optional().default(0.8),
});

export const BacktestSchema = z.object({
  symbol: z.string().regex(/^[A-Za-z0-9_]+$/).max(50).default('R_100'),
  horizons: z.array(z.number().int().positive()).optional().default([5, 60, 300]),
  sampleLimit: z.number().int().positive().optional().default(500),
});
