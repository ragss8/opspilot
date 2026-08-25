import { Inject, Injectable } from '@nestjs/common';
import type {
  IndexedChunk,
  RetrievalResponse,
  RetrievalRun,
  SearchResult,
  SearchScope,
  VectorFilter,
} from './ai.types';
import { AiProviderService } from './ai-provider.service';
import { IndexBuilderService } from './index-builder.service';
import { RerankerService } from './reranker.service';
import { VECTOR_REPOSITORY, type VectorRepository } from './vector-store';

/**
 * Two-stage retrieval over a pre-built index.
 *
 * Stage 1 embeds the query — one embedding call, regardless of corpus size —
 * and asks the vector store for a wide candidate set by dense similarity.
 * Stage 2 reranks those candidates with BM25, field matching, and MMR.
 */
@Injectable()
export class RetrievalService {
  /** Candidates pulled from the vector stage before reranking. */
  static readonly RECALL_CANDIDATES = 24;
  /** Minimum rerank score for a chunk to be returned at all. */
  static readonly MIN_RELEVANCE_SCORE = 0.12;

  constructor(
    private readonly provider: AiProviderService,
    private readonly reranker: RerankerService,
    private readonly indexBuilder: IndexBuilderService,
    @Inject(VECTOR_REPOSITORY) private readonly store: VectorRepository,
  ) {}

  async search(
    query: string,
    scope: SearchScope = 'all',
    limit = 8,
  ): Promise<RetrievalResponse> {
    const run = await this.retrieve(query, scope, limit);
    return {
      query: run.query,
      results: run.results,
      embeddingModel: run.embeddingModel,
      candidatesConsidered: run.candidatesConsidered,
      latencyMs: run.latencyMs,
    };
  }

  async retrieve(
    query: string,
    scope: SearchScope = 'all',
    limit = 5,
    filter: Omit<VectorFilter, 'scope'> = {},
  ): Promise<RetrievalRun> {
    const startedAt = performance.now();
    await this.indexBuilder.ensureCurrent();

    // One embedding call for the query. The corpus was embedded at index time.
    const vectorStartedAt = performance.now();
    const batch = await this.provider.embedTexts([query]);
    const queryVector = batch.vectors[0] ?? [];

    const candidates = this.store.search(
      queryVector,
      RetrievalService.RECALL_CANDIDATES,
      { ...filter, scope },
    );
    const vectorLatencyMs = Math.max(
      1,
      Math.round(performance.now() - vectorStartedAt),
    );

    const rerankStartedAt = performance.now();
    const ranked = this.reranker.rerank(query, candidates, {
      limit: Math.max(1, Math.min(limit, 12)),
      minScore: RetrievalService.MIN_RELEVANCE_SCORE,
      requireLexicalSignal: batch.provider === 'local',
    });
    const rerankLatencyMs = Math.max(
      1,
      Math.round(performance.now() - rerankStartedAt),
    );

    const results: SearchResult[] = ranked.map((entry) => ({
      id: entry.chunk.id,
      documentId: entry.chunk.documentId,
      title: entry.chunk.title,
      section: entry.chunk.section,
      excerpt: excerpt(entry.chunk.text),
      score: entry.finalScore,
      type: entry.chunk.type,
      chunkIndex: entry.chunk.chunkIndex,
      chunkCount: entry.chunk.chunkCount,
      vectorScore: entry.vectorScore,
      lexicalScore: entry.lexicalScore,
      metadata: entry.chunk.metadata,
    }));

    return {
      query,
      results,
      embeddingModel: batch.model,
      candidatesConsidered: candidates.length,
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      provider: batch.provider,
      usedFallback: batch.usedFallback,
      chunks: ranked.map((entry) => entry.chunk),
      ranked,
      vectorLatencyMs,
      rerankLatencyMs,
    };
  }

  get indexSize(): number {
    return this.store.size;
  }

  get indexModel(): string {
    return this.store.model;
  }

  get lastIndexedAt(): string | null {
    return this.store.lastIndexedAt;
  }

  chunk(id: string): IndexedChunk | undefined {
    return this.store.get(id);
  }
}

function excerpt(text: string, maxLength = 240): string {
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength - 3);
  const boundary = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, Math.max(boundary, Math.floor(maxLength * 0.75)))}…`;
}
