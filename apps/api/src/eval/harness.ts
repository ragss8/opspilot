import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AiService } from '../ai/ai.service';
import { AiRouterService } from '../ai/ai-router.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { ClassificationService } from '../ai/classification.service';
import { IndexBuilderService } from '../ai/index-builder.service';
import { buildAllowedNumbers, unsupportedNumbers } from '../ai/fact-guard';
import { PROMPT_SET_VERSION } from '../ai/prompts';
import { RetrievalService } from '../ai/retrieval.service';
import { AppModule } from '../app.module';
import { FleetService } from '../fleet/fleet.service';
import {
  CLASSIFICATION_CASES,
  DATASET_VERSION,
  GROUNDING_CASES,
  RETRIEVAL_CASES,
  ROUTING_CASES,
  SUMMARY_CASES,
} from './golden-set';
import {
  classificationReport,
  meanReciprocalRank,
  recallAtK,
  round,
  type ClassMetrics,
} from './metrics';

export interface EvaluationReport {
  datasetVersion: string;
  promptVersion: string;
  provider: string;
  generationModel: string;
  embeddingModel: string;
  indexedChunks: number;
  indexBuildMs: number;
  ranAt: string;
  durationMs: number;
  totalTokens: number;
  totalCostUsd: number;
  routing: {
    cases: number;
    accuracy: number;
    macroF1: number;
    perClass: ClassMetrics[];
    failures: { message: string; expected: string; actual: string }[];
  };
  retrieval: {
    cases: number;
    recallAt1: number;
    recallAt3: number;
    recallAt5: number;
    mrr: number;
    failures: { query: string; relevant: string[]; ranked: string[] }[];
  };
  classification: {
    cases: number;
    accuracy: number;
    macroF1: number;
    perClass: ClassMetrics[];
    severityAccuracy: number;
    /** Share of cases needing escalation that were correctly escalated. */
    escalationRecall: number;
    failures: { report: string; field: string; expected: string; actual: string }[];
  };
  citations: {
    cases: number;
    /** Share of emitted citations that resolve to a retrieved chunk. */
    precision: number;
    answersWithCitations: number;
  };
  summaries: {
    cases: number;
    /** Share of summaries whose every number appears in the computed facts. */
    factConsistency: number;
    failures: { message: string; unsupported: string[] }[];
  };
}

/**
 * Runs the golden set against the real dependency-injected pipeline.
 *
 * The same harness backs `pnpm eval` and the CI regression test, so a threshold
 * that passes locally is the threshold CI enforces.
 */
export async function runEvaluation(): Promise<EvaluationReport> {
  const startedAt = Date.now();
  Logger.overrideLogger(false);

  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const ai = context.get(AiService);
    const router = context.get(AiRouterService);
    const retrieval = context.get(RetrievalService);
    const classifier = context.get(ClassificationService);
    const provider = context.get(AiProviderService);
    const fleet = context.get(FleetService);
    const indexBuilder = context.get(IndexBuilderService);

    let totalTokens = 0;
    let totalCostUsd = 0;

    // ------------------------------------------------------------- routing
    const routingPredictions: { expected: string; actual: string }[] = [];
    const routingFailures: {
      message: string;
      expected: string;
      actual: string;
    }[] = [];

    for (const testCase of ROUTING_CASES) {
      const decision = await router.resolve(testCase.message);
      totalTokens += decision.usage.totalTokens;
      totalCostUsd += decision.usage.costUsd;
      routingPredictions.push({
        expected: testCase.expected,
        actual: decision.route,
      });
      if (decision.route !== testCase.expected) {
        routingFailures.push({
          message: testCase.message,
          expected: testCase.expected,
          actual: decision.route,
        });
      }
    }
    const routingReport = classificationReport(routingPredictions);

    // ----------------------------------------------------------- retrieval
    const retrievalRows: { relevant: string[]; ranked: string[] }[] = [];
    const retrievalFailures: {
      query: string;
      relevant: string[];
      ranked: string[];
    }[] = [];

    for (const testCase of RETRIEVAL_CASES) {
      const response = await retrieval.search(testCase.query, testCase.scope, 5);
      // Rank by document, deduplicated: two chunks of the same procedure are
      // one retrieval hit, not two.
      const ranked = [
        ...new Set(response.results.map((result) => result.documentId)),
      ];
      retrievalRows.push({ relevant: [...testCase.relevant], ranked });
      if (!ranked.slice(0, 3).some((id) => testCase.relevant.includes(id))) {
        retrievalFailures.push({
          query: testCase.query,
          relevant: [...testCase.relevant],
          ranked,
        });
      }
    }

    // ------------------------------------------------------- classification
    const categoryPredictions: { expected: string; actual: string }[] = [];
    const classificationFailures: {
      report: string;
      field: string;
      expected: string;
      actual: string;
    }[] = [];
    let severityCorrect = 0;
    let escalationExpected = 0;
    let escalationCorrect = 0;

    for (const testCase of CLASSIFICATION_CASES) {
      const result = await classifier.classify(testCase.report);
      totalTokens += result.usage.totalTokens;
      totalCostUsd += result.usage.costUsd;

      categoryPredictions.push({
        expected: testCase.category,
        actual: result.category,
      });
      if (result.category !== testCase.category) {
        classificationFailures.push({
          report: testCase.report,
          field: 'category',
          expected: testCase.category,
          actual: result.category,
        });
      }

      const acceptedSeverities = Array.isArray(testCase.severity)
        ? testCase.severity
        : [testCase.severity];
      if (acceptedSeverities.includes(result.severity)) {
        severityCorrect += 1;
      } else {
        classificationFailures.push({
          report: testCase.report,
          field: 'severity',
          expected: acceptedSeverities.join('|'),
          actual: result.severity,
        });
      }

      if (testCase.requiresSupervisor) {
        escalationExpected += 1;
        if (result.requiresSupervisor) escalationCorrect += 1;
        else {
          classificationFailures.push({
            report: testCase.report,
            field: 'requiresSupervisor',
            expected: 'true',
            actual: 'false',
          });
        }
      }
    }
    const categoryReport = classificationReport(categoryPredictions);

    // --------------------------------------------------------- citations
    let citationsEmitted = 0;
    let citationsValid = 0;
    let answersWithCitations = 0;

    for (const testCase of GROUNDING_CASES) {
      const response = await ai.chat(testCase.message);
      totalTokens += response.usage.totalTokens;
      totalCostUsd += response.usage.costUsd;

      const retrievedIds = new Set<string>();
      response.citations.forEach((citation) => {
        retrievedIds.add(citation.id.toUpperCase());
        retrievedIds.add(citation.documentId.toUpperCase());
      });

      const cited = [
        ...response.answer.matchAll(/\[((?:KB|INC)-[A-Z0-9-]+(?:#\d+)?)\]/gi),
      ].map((match) => (match[1] ?? '').toUpperCase());

      if (cited.length > 0) answersWithCitations += 1;
      citationsEmitted += cited.length;
      citationsValid += cited.filter((id) => retrievedIds.has(id)).length;
    }

    // --------------------------------------------------------- summaries
    const allowedNumbers = buildAllowedNumbers(fleet);
    let consistentSummaries = 0;
    const summaryFailures: { message: string; unsupported: string[] }[] = [];

    for (const message of SUMMARY_CASES) {
      const response = await ai.chat(message);
      totalTokens += response.usage.totalTokens;
      totalCostUsd += response.usage.costUsd;

      const unsupported = unsupportedNumbers(response.answer, allowedNumbers);
      if (unsupported.length === 0) consistentSummaries += 1;
      else summaryFailures.push({ message, unsupported });
    }

    return {
      datasetVersion: DATASET_VERSION,
      promptVersion: PROMPT_SET_VERSION,
      provider: provider.mode,
      generationModel: provider.generationModel,
      embeddingModel: retrieval.indexModel,
      indexedChunks: retrieval.indexSize,
      indexBuildMs: indexBuilder.result?.durationMs ?? 0,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      totalTokens,
      totalCostUsd: round(totalCostUsd, 6),
      routing: {
        cases: ROUTING_CASES.length,
        accuracy: routingReport.accuracy,
        macroF1: routingReport.macroF1,
        perClass: routingReport.perClass,
        failures: routingFailures,
      },
      retrieval: {
        cases: RETRIEVAL_CASES.length,
        recallAt1: recallAtK(retrievalRows, 1),
        recallAt3: recallAtK(retrievalRows, 3),
        recallAt5: recallAtK(retrievalRows, 5),
        mrr: meanReciprocalRank(retrievalRows),
        failures: retrievalFailures,
      },
      classification: {
        cases: CLASSIFICATION_CASES.length,
        accuracy: categoryReport.accuracy,
        macroF1: categoryReport.macroF1,
        perClass: categoryReport.perClass,
        severityAccuracy: round(severityCorrect / CLASSIFICATION_CASES.length),
        escalationRecall:
          escalationExpected === 0
            ? 1
            : round(escalationCorrect / escalationExpected),
        failures: classificationFailures,
      },
      citations: {
        cases: GROUNDING_CASES.length,
        precision:
          citationsEmitted === 0 ? 0 : round(citationsValid / citationsEmitted),
        answersWithCitations,
      },
      summaries: {
        cases: SUMMARY_CASES.length,
        factConsistency: round(consistentSummaries / SUMMARY_CASES.length),
        failures: summaryFailures,
      },
    };
  } finally {
    await context.close();
  }
}
