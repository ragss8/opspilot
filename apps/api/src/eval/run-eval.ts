import '../load-env';
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runEvaluation, type EvaluationReport } from './harness';

/**
 * CLI entry point: `pnpm --filter @opspilot/api eval`.
 *
 * Prints a readable report and writes the full JSON to eval-results/ so runs
 * can be compared across providers, models, and prompt versions.
 */
async function main(): Promise<void> {
  const report = await runEvaluation();
  print(report);

  const outputDirectory = resolve(__dirname, '../../eval-results');
  mkdirSync(outputDirectory, { recursive: true });
  const fileName = `${report.provider}-${report.ranAt.replace(/[:.]/g, '-')}.json`;
  const outputPath = resolve(outputDirectory, fileName);
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to ${outputPath}`);
}

function print(report: EvaluationReport): void {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

  console.log('\nOpsPilot AI evaluation');
  console.log('='.repeat(64));
  console.log(`dataset        ${report.datasetVersion}`);
  console.log(`prompts        ${report.promptVersion}`);
  console.log(`provider       ${report.provider}`);
  console.log(`generation     ${report.generationModel}`);
  console.log(`embeddings     ${report.embeddingModel} (${report.indexedChunks} chunks)`);
  console.log(`duration       ${report.durationMs} ms`);
  console.log(`tokens / cost  ${report.totalTokens} / $${report.totalCostUsd.toFixed(6)}`);

  console.log('\nRouting');
  console.log(`  accuracy            ${percent(report.routing.accuracy)} (${report.routing.cases} cases)`);
  console.log(`  macro F1            ${report.routing.macroF1.toFixed(3)}`);

  console.log('\nRetrieval');
  console.log(`  recall@1            ${percent(report.retrieval.recallAt1)}`);
  console.log(`  recall@3            ${percent(report.retrieval.recallAt3)}`);
  console.log(`  recall@5            ${percent(report.retrieval.recallAt5)}`);
  console.log(`  MRR                 ${report.retrieval.mrr.toFixed(3)}`);

  console.log('\nClassification');
  console.log(`  category accuracy   ${percent(report.classification.accuracy)}`);
  console.log(`  category macro F1   ${report.classification.macroF1.toFixed(3)}`);
  console.log(`  severity accuracy   ${percent(report.classification.severityAccuracy)}`);
  console.log(`  escalation recall   ${percent(report.classification.escalationRecall)}`);

  console.log('\nGrounding');
  console.log(`  citation precision  ${percent(report.citations.precision)}`);
  console.log(`  answers cited       ${report.citations.answersWithCitations}/${report.citations.cases}`);
  console.log(`  summary consistency ${percent(report.summaries.factConsistency)}`);

  const failures = [
    ...report.routing.failures.map(
      (failure) => `  routing   "${failure.message}" -> ${failure.actual} (want ${failure.expected})`,
    ),
    ...report.retrieval.failures.map(
      (failure) => `  retrieval "${failure.query}" -> [${failure.ranked.slice(0, 3).join(', ')}] (want one of ${failure.relevant.join(', ')})`,
    ),
    ...report.classification.failures.map(
      (failure) => `  classify  ${failure.field}: got ${failure.actual}, want ${failure.expected} — "${failure.report.slice(0, 60)}…"`,
    ),
    ...report.summaries.failures.map(
      (failure) => `  summary   unsupported numbers [${failure.unsupported.join(', ')}] in "${failure.message}"`,
    ),
  ];

  if (failures.length > 0) {
    console.log(`\nFailures (${failures.length})`);
    failures.forEach((line) => console.log(line));
  } else {
    console.log('\nNo failures.');
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
