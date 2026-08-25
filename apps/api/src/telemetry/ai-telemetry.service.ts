import { Injectable } from '@nestjs/common';
import type { AiProviderName, AiRoute, TokenUsage } from '../ai/ai.types';

export interface AiRunRecord {
  at: string;
  operation: 'chat' | 'classify' | 'search' | 'summary' | 'index';
  route: AiRoute | null;
  provider: AiProviderName;
  model: string;
  promptVersion: string;
  latencyMs: number;
  usage: TokenUsage;
  /** True when the answer was supported by at least one validated citation. */
  grounded: boolean;
  /** True when a hosted provider failed and the local engine served instead. */
  usedFallback: boolean;
}

export interface AiTelemetrySnapshot {
  totalRuns: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  groundedRate: number;
  fallbackRate: number;
  totalTokens: number;
  totalCostUsd: number;
  byRoute: Record<string, number>;
  lastRunAt: string | null;
}

/**
 * In-process AI run telemetry.
 *
 * Every figure the product reports about its own AI behaviour is computed from
 * these records, so the health panel reflects what actually happened in this
 * process rather than a fixed placeholder. A production deployment would write
 * the same records to a durable store.
 */
@Injectable()
export class AiTelemetryService {
  private static readonly MAX_RUNS = 500;
  private runs: AiRunRecord[] = [];

  record(run: AiRunRecord): void {
    this.runs.push(run);
    if (this.runs.length > AiTelemetryService.MAX_RUNS) {
      this.runs = this.runs.slice(-AiTelemetryService.MAX_RUNS);
    }
  }

  snapshot(): AiTelemetrySnapshot {
    const answered = this.runs.filter((run) => run.operation !== 'index');
    if (answered.length === 0) {
      return {
        totalRuns: 0,
        averageLatencyMs: 0,
        p95LatencyMs: 0,
        groundedRate: 0,
        fallbackRate: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        byRoute: {},
        lastRunAt: null,
      };
    }

    const latencies = answered
      .map((run) => run.latencyMs)
      .sort((left, right) => left - right);
    const percentileIndex = Math.min(
      latencies.length - 1,
      Math.floor(latencies.length * 0.95),
    );

    const byRoute: Record<string, number> = {};
    answered.forEach((run) => {
      const key = run.route ?? run.operation;
      byRoute[key] = (byRoute[key] ?? 0) + 1;
    });

    return {
      totalRuns: answered.length,
      averageLatencyMs: Math.round(
        latencies.reduce((total, value) => total + value, 0) / latencies.length,
      ),
      p95LatencyMs: latencies[percentileIndex] ?? 0,
      groundedRate: ratio(answered.filter((run) => run.grounded).length, answered.length),
      fallbackRate: ratio(
        answered.filter((run) => run.usedFallback).length,
        answered.length,
      ),
      totalTokens: answered.reduce((total, run) => total + run.usage.totalTokens, 0),
      totalCostUsd: Number(
        answered
          .reduce((total, run) => total + run.usage.costUsd, 0)
          .toFixed(6),
      ),
      byRoute,
      lastRunAt: answered.at(-1)?.at ?? null,
    };
  }

  recent(limit = 20): AiRunRecord[] {
    return this.runs.slice(-limit).reverse();
  }

  reset(): void {
    this.runs = [];
  }
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : Number(((part / total) * 100).toFixed(1));
}
