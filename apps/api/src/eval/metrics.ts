/** Classification and ranking metrics used by the evaluation harness. */

export interface ConfusionCounts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface ClassMetrics {
  label: string;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

export function accuracy(predictions: readonly { expected: string; actual: string }[]): number {
  if (predictions.length === 0) return 0;
  const correct = predictions.filter((row) => row.expected === row.actual).length;
  return round(correct / predictions.length);
}

/**
 * Per-class precision, recall, and F1, plus the macro average across classes.
 * Macro averaging is the right choice here because the rare safety classes
 * matter more than the common operational ones.
 */
export function classificationReport(
  predictions: readonly { expected: string; actual: string }[],
): { perClass: ClassMetrics[]; macroF1: number; accuracy: number } {
  const labels = [
    ...new Set(predictions.flatMap((row) => [row.expected, row.actual])),
  ].sort();

  const perClass = labels.map((label): ClassMetrics => {
    const counts = predictions.reduce<ConfusionCounts>(
      (totals, row) => ({
        truePositives:
          totals.truePositives + (row.expected === label && row.actual === label ? 1 : 0),
        falsePositives:
          totals.falsePositives + (row.expected !== label && row.actual === label ? 1 : 0),
        falseNegatives:
          totals.falseNegatives + (row.expected === label && row.actual !== label ? 1 : 0),
      }),
      { truePositives: 0, falsePositives: 0, falseNegatives: 0 },
    );

    const precision = safeDivide(
      counts.truePositives,
      counts.truePositives + counts.falsePositives,
    );
    const recall = safeDivide(
      counts.truePositives,
      counts.truePositives + counts.falseNegatives,
    );
    return {
      label,
      support: predictions.filter((row) => row.expected === label).length,
      precision: round(precision),
      recall: round(recall),
      f1: round(safeDivide(2 * precision * recall, precision + recall)),
    };
  });

  // Classes with no support are prediction-only artifacts; exclude them from
  // the macro average so a single spurious label cannot halve the score.
  const supported = perClass.filter((entry) => entry.support > 0);
  return {
    perClass,
    macroF1: round(
      supported.reduce((total, entry) => total + entry.f1, 0) /
        Math.max(1, supported.length),
    ),
    accuracy: accuracy(predictions),
  };
}

/** Share of cases where a relevant document appears in the top k results. */
export function recallAtK(
  cases: readonly { relevant: readonly string[]; ranked: readonly string[] }[],
  k: number,
): number {
  if (cases.length === 0) return 0;
  const hits = cases.filter((entry) =>
    entry.ranked
      .slice(0, k)
      .some((id) => entry.relevant.includes(id)),
  ).length;
  return round(hits / cases.length);
}

/** Mean reciprocal rank of the first relevant document. */
export function meanReciprocalRank(
  cases: readonly { relevant: readonly string[]; ranked: readonly string[] }[],
): number {
  if (cases.length === 0) return 0;
  const total = cases.reduce((sum, entry) => {
    const position = entry.ranked.findIndex((id) => entry.relevant.includes(id));
    return sum + (position === -1 ? 0 : 1 / (position + 1));
  }, 0);
  return round(total / cases.length);
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
