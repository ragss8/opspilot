# Evaluation

The golden set is implemented, runnable, and gates CI. It is not a plan.

```bash
pnpm eval                              # full report, written to apps/api/eval-results/
pnpm --filter @opspilot/api test       # includes the regression gate
```

`runEvaluation()` boots the real dependency-injected application context, so the harness measures the same code path the API serves. Every report is tagged with dataset version, prompt version, provider, generation model, embedding model, indexed chunk count, duration, tokens, and cost — results are only comparable across runs that share a dataset and prompt version.

## What is measured

| Capability | Metric | Failure it catches |
| --- | --- | --- |
| Intent routing | accuracy, macro F1 | Knowledge questions sent to data tools |
| Retrieval | recall@1, recall@3, recall@5, MRR | Correct SOP chunk ranked too low |
| Classification | category accuracy, macro F1 | Safety events filed as routine operations |
| Classification | severity accuracy | Under-rating an urgent event |
| Classification | escalation recall | A report that needed a supervisor not getting one |
| Grounding | citation precision | An answer citing a chunk that was not retrieved |
| Summarization | fact consistency | A generated count the records do not support |

Macro averaging is used for F1 because the rare safety classes matter more than the common operational ones, and classes with no support are excluded so a single spurious label cannot halve the score.

Retrieval is scored per document, deduplicated: two chunks of the same procedure are one hit, not two.

## Thresholds

`src/eval/eval.spec.ts` fails the build below these:

| Metric | Threshold | Rationale |
| --- | --- | --- |
| Routing accuracy | ≥ 0.90 | quality target, with headroom |
| Routing macro F1 | ≥ 0.85 | quality target |
| Retrieval recall@3 | ≥ 0.90 | quality target |
| Retrieval MRR | ≥ 0.85 | quality target |
| Category accuracy | ≥ 0.90 | quality target |
| Severity accuracy | ≥ 0.85 | quality target |
| **Escalation recall** | **= 1.00** | correctness: never miss a mandatory escalation |
| **Citation precision** | **= 1.00** | correctness: never cite outside retrieval |
| **Summary fact consistency** | **= 1.00** | correctness: never state an unsupported number |

The three exact thresholds are safety and honesty properties, not quality targets. A change that improves every other metric while dropping one of these is still blocked.

## Current baseline

`golden@1.1.0`, `opspilot-prompts@2.1.0`, deterministic local engine, 32 indexed chunks:

```
Routing          accuracy 100.0%   macro F1 1.000      (28 cases)
Retrieval        recall@1 95.7%    recall@3 100.0%     MRR 0.978   (23 cases)
Classification   category 100.0%   severity 100.0%     escalation 100.0%   (14 cases)
Grounding        citation precision 100.0%             5/5 answers cited
Summarization    fact consistency 100.0%               (3 cases)
```

These are a **regression baseline for a deterministic engine**, not a claim about hosted-model quality. The local router and classifier are rule-based, and the routing and classification cases were partly written against the behaviour those rules encode, so perfect scores there mostly demonstrate that the rules and the labels agree. The retrieval and grounding numbers are more informative, since they exercise real embeddings, BM25, and MMR over a corpus the cases do not reference by name.

Run `pnpm eval` with `AI_PROVIDER=openai` or `AI_PROVIDER=aws` to measure a hosted model on the same set. Comparing those reports is the point of the provenance fields.

## Cases that are deliberately hard

The dataset includes colloquial paraphrases sharing almost no vocabulary with the source, so a lexical-only match cannot carry them:

- "is it ok to pour water on a hot wheel" → `KB-SAF-001`
- "the load got too warm, who decides if we can still sell it" → `KB-OPS-014`
- "can dispatch tell a driver to keep going past their limit" → `KB-CMP-006`
- "we think someone took a trailer from the yard overnight" → `KB-SEC-009`

And classification cases that describe a hazard without naming it:

- "There is a burning smell and the rear of the trailer is glowing." → critical Safety, escalate
- "Someone drove the unit off the yard and we have no work order for it." → Security, escalate
- "The logbook shows the driver has been at the wheel past the permitted window." → high Compliance, escalate

## What the harness has already caught

Writing and running it surfaced three real defects that the unit tests did not:

1. **The fact-consistency guard counted digits inside identifiers.** `INC-1001` and `VH-2047` contributed "1001" and "2047" to the extracted-number set, so every valid summary was scored as inconsistent. Left unfixed, this would have rejected every hosted summary at runtime and silently fallen back to the template. Fixed by stripping identifiers and timestamps in `fact-guard.ts`, now shared by the validator and the harness.

2. **The classifier missed a fire described in plain language.** "Burning smell and the rear of the trailer is glowing" classified as `Other` / `low` / no escalation, because the rules keyed on "fire", "smoke", and "flame". Escalation recall dropped to 66.7%.

3. **The router dropped colloquial guidance questions.** "Do we need a supervisor before releasing a vehicle?" and "What proportion of the fleet is in maintenance?" both fell through to `GENERAL`.

A separate defect — a `\bdelay\b` pattern that never matched the word "delayed", so `count_vehicles` ran unfiltered and reported the whole fleet — was caught by the end-to-end suite and is now covered by a tool-selection test.

## Extending it

Add cases to `src/eval/golden-set.ts` and bump `DATASET_VERSION`. If a new case fails, fix the pipeline rather than the label, or record explicitly why the label was wrong. Reports land in `apps/api/eval-results/` and are uploaded as a CI artifact on every run, so a metric change is reviewable in the pull request rather than only visible as a pass or fail.

Worth adding next: adversarial prompt-injection cases against retrieved content, latency and cost budgets per route, and a second dataset version graded by a human rather than derived from the seed data.
