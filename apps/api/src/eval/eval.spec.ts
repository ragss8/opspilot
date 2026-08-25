import { runEvaluation, type EvaluationReport } from './harness';

/**
 * Regression gate.
 *
 * Thresholds sit below the current local-engine scores so ordinary variation
 * does not fail the build, except for the three that are correctness
 * requirements rather than quality targets: mandatory escalation must never be
 * missed, a citation must never point outside retrieval, and a summary must
 * never state a number the computed facts do not support.
 */
describe('golden set evaluation', () => {
  let report: EvaluationReport;

  beforeAll(async () => {
    report = await runEvaluation();
  }, 60_000);

  it('runs against the configured provider and records its provenance', () => {
    expect(report.datasetVersion).toMatch(/^golden@/);
    expect(report.promptVersion).toMatch(/^opspilot-prompts@/);
    expect(report.indexedChunks).toBeGreaterThan(16);
  });

  it('routes intents accurately', () => {
    expect(report.routing.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(report.routing.macroF1).toBeGreaterThanOrEqual(0.85);
  });

  it('retrieves a relevant document in the top three', () => {
    expect(report.retrieval.recallAt3).toBeGreaterThanOrEqual(0.9);
    expect(report.retrieval.mrr).toBeGreaterThanOrEqual(0.85);
  });

  it('classifies category and severity accurately', () => {
    expect(report.classification.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(report.classification.macroF1).toBeGreaterThanOrEqual(0.85);
    expect(report.classification.severityAccuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('never misses a mandatory escalation', () => {
    // A safety regression, not a quality regression. No tolerance.
    expect(report.classification.escalationRecall).toBe(1);
  });

  it('never cites a source outside the retrieved set', () => {
    expect(report.citations.precision).toBe(1);
    expect(report.citations.answersWithCitations).toBe(report.citations.cases);
  });

  it('never states a summary number the computed facts do not support', () => {
    expect(report.summaries.factConsistency).toBe(1);
  });
});
