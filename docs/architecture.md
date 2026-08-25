# Architecture decisions

## One contract, multiple providers

The orchestration layer owns the application types. Model SDK and framework types stop at their adapters, which keeps the API stable across the deterministic local engine, OpenAI, AWS Bedrock, and anything added later.

```ts
interface VectorRepository {
  readonly model: string;
  readonly dimensions: number;
  reset(model: string, dimensions: number): void;
  upsert(records: readonly VectorRecord[]): void;
  search(vector: readonly number[], limit: number, filter?: VectorFilter): VectorMatch[];
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}
```

`AiProviderService` is the only file that imports an SDK. `InMemoryVectorStore` is bound to the `VECTOR_REPOSITORY` token in one line of `AiModule`; a pgvector or OpenSearch adapter replaces that binding and nothing above it moves.

## Indexing is not searching

Chunks are embedded once, at startup, by `IndexBuilderService`. A query embeds exactly one string and compares it against the stored vectors.

This is the difference between having an index and not having one. Re-embedding the corpus per query would make every question cost N embedding calls, scale linearly with corpus size, and make a hosted embedding provider prohibitively slow and expensive. The index is rebuilt only when the embedding model changes, because vectors from two different models are not comparable.

That invariant is enforced, not assumed: `InMemoryVectorStore` throws on a dimension mismatch, and `LocalEmbeddingService.cosine` throws rather than truncating to the shorter vector. A truncating comparison returns a plausible-looking number, which is the worst possible failure mode — it produces confident nonsense instead of an error.

## Chunking

Procedures are split with LangChain's `RecursiveCharacterTextSplitter` at 900 characters with 150 characters of overlap, preferring paragraph then sentence boundaries. The overlap means a rule that straddles a boundary is still retrievable from either side. Each chunk carries its document ID, chunk index, chunk count, version, category, and owner.

Incidents are deliberately **not** split. An incident is a short atomic record, and splitting it would separate its severity and status metadata from its description — exactly what the metadata filters need to stay together.

## Two-stage retrieval

Stage one optimizes **recall**: the vector store returns the top 24 candidates by dense similarity alone, after applying metadata filters. Filters are applied before ranking, so a scoped search ranks only eligible chunks rather than ranking everything and discarding the misses.

Stage two optimizes **precision**, using signals a dense vector cannot express:

- **Okapi BM25** with corpus IDF, so rare domain terms outweigh common ones.
- **Field matching** against title and section.
- **Exact identifier hits** — `VH-2047`, `INC-1001`, `KB-SAF-001` — the strongest available signal when present.
- **Maximal Marginal Relevance** at λ = 0.72, so the final set is not four near-duplicate passages of one procedure.

MMR decides which candidates are selected and in what order. The score reported to callers stays the relevance score, because a diversity-adjusted number would be meaningless labelled as "relevance" in a UI.

The reported score decomposes into its vector and lexical components, so a ranking can be argued with rather than taken on faith.

## Hybrid routing

Deterministic rules run first: free, instant, and covering the phrasings this domain actually sees. Only when rule confidence falls below 0.8 **and** a hosted provider is configured does a model classify the intent from a few-shot prompt. The common path stays at zero cost while unusual phrasings still route correctly.

## Tools, not SQL

The model's entire access to operational data is five typed operations: `get_fleet_metrics`, `count_vehicles`, `list_incidents`, `get_vehicle`, and `get_sla_risk`. Each has a closed JSON Schema, and arguments are re-validated server-side before execution — a model will emit values outside the schema it was given, and a closed schema alone is not enforcement.

Hosted providers run the tool loop natively (OpenAI `function_call` items, Bedrock `toolUse` blocks), bounded at three rounds. Local mode reproduces the same tool contract with rules, so the whole pipeline including tool results in the prompt is demoable without credentials.

## Guardrails

- Retrieved chunks are wrapped in `<source>` tags and declared untrusted in the system prompt.
- Returned citation IDs are checked against the retrieved set; a citation outside it discards the whole answer.
- A knowledge or incident answer with no citation at all is rejected.
- Every number in a generated summary must trace to a computed fact (`fact-guard.ts`), shared by the runtime validator and the evaluation harness so the two cannot drift.
- Low-relevance retrieval returns an explicit insufficient-context answer rather than the nearest bad match.
- Provider, model, prompt version, latency, tokens, cost, and per-stage scores are exposed in the trace.
- Operational counts come from typed tools, never from model inference.

## Conversation memory

Sessions hold turns trimmed by both count (10) and token budget (1200), because a long session otherwise grows the prompt without bound. Sessions expire after an hour and are capped in number.

A follow-up like "what about the other one?" carries no retrievable terms, so it is detected and condensed against the previous operator question before routing and retrieval. Without that step, multi-turn RAG retrieves nothing useful on any follow-up. The condensation is rule-based and therefore free and deterministic; a hosted rewrite is the obvious upgrade.

## Streaming

`POST /api/ai/chat/stream` emits server-sent events for route, retrieval, tool, and token, then a `done` event carrying the complete response. Streaming is only enabled on a turn that cannot request another tool, since a partially streamed turn cannot be replayed into a tool loop.

The browser client reassembles frames across chunk boundaries and falls back to the buffered endpoint, then to seeded preview data, so the UI has one code path regardless.

## Cost accounting

Provider-reported usage is always preferred. When a provider does not return it, tokens are counted locally with `o200k_base` and the result is flagged `estimated` so an estimate is never mistaken for a measurement. The rate card in `usage.ts` is a configured default, overridable per model by environment variable — it is a starting point, not a live price feed.

## Query routes

| Route | Example | Execution path |
| --- | --- | --- |
| `DATABASE_QUERY` | "How many trips are delayed?" | Typed fleet tools |
| `KNOWLEDGE_QUERY` | "What is the breakdown procedure?" | SOP retrieval → grounded generation |
| `INCIDENT_SEARCH` | "Find similar tyre incidents" | Filtered incident retrieval → intent ordering |
| `SUMMARY` | "Summarize today" | Compute facts → constrained prompt → fact validation |
| `GENERAL` | "What can you help with?" | Capability response |
