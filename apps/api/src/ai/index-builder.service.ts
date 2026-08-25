import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { INCIDENTS, KNOWLEDGE_DOCUMENTS } from '../fleet/fleet.data';
import { AiTelemetryService } from '../telemetry/ai-telemetry.service';
import type { IndexedChunk, VectorRecord } from './ai.types';
import { AiProviderService } from './ai-provider.service';
import { ChunkingService } from './chunking.service';
import { RerankerService } from './reranker.service';
import { VECTOR_REPOSITORY, type VectorRepository } from './vector-store';

export interface IndexBuildResult {
  chunks: number;
  documents: number;
  model: string;
  dimensions: number;
  provider: string;
  durationMs: number;
}

/**
 * Builds the vector index exactly once at startup, and again only when the
 * embedding model changes.
 *
 * This is the difference between an index and a search: chunks are embedded
 * here, not per query. A query embeds one string; retrieval then compares that
 * single vector against the stored ones.
 */
@Injectable()
export class IndexBuilderService implements OnModuleInit {
  private readonly logger = new Logger(IndexBuilderService.name);
  private building: Promise<IndexBuildResult> | null = null;
  private lastResult: IndexBuildResult | null = null;

  constructor(
    private readonly chunking: ChunkingService,
    private readonly provider: AiProviderService,
    private readonly reranker: RerankerService,
    private readonly telemetry: AiTelemetryService,
    @Inject(VECTOR_REPOSITORY) private readonly store: VectorRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureCurrent();
  }

  get result(): IndexBuildResult | null {
    return this.lastResult;
  }

  /**
   * Rebuilds when the index is empty or was built with a different embedding
   * model. Vectors from two models are not comparable, so a model change makes
   * the existing index invalid rather than merely stale.
   */
  async ensureCurrent(): Promise<IndexBuildResult> {
    const expectedModel = this.provider.embeddingModel;
    if (this.store.size > 0 && this.store.model === expectedModel) {
      return (
        this.lastResult ?? {
          chunks: this.store.size,
          documents: KNOWLEDGE_DOCUMENTS.length + INCIDENTS.length,
          model: this.store.model,
          dimensions: this.store.dimensions,
          provider: this.provider.mode,
          durationMs: 0,
        }
      );
    }

    // Collapse concurrent callers onto a single build.
    this.building ??= this.build().finally(() => {
      this.building = null;
    });
    return this.building;
  }

  private async build(): Promise<IndexBuildResult> {
    const startedAt = performance.now();

    const knowledgeChunks = (
      await Promise.all(
        KNOWLEDGE_DOCUMENTS.map((document) =>
          this.chunking.chunkDocument(document),
        ),
      )
    ).flat();
    const incidentChunks = INCIDENTS.map((incident) =>
      this.chunking.chunkIncident(incident),
    );
    const chunks: IndexedChunk[] = [...knowledgeChunks, ...incidentChunks];

    // One batch for the whole corpus, once — not one batch per query.
    const batch = await this.provider.embedTexts(
      chunks.map((chunk) => this.embeddingText(chunk)),
    );

    const dimensions = batch.dimensions || (batch.vectors[0]?.length ?? 0);
    if (dimensions === 0) {
      throw new Error('Embedding provider returned no usable vectors');
    }

    this.store.reset(batch.model, dimensions);
    this.store.upsert(
      chunks.map(
        (chunk, index): VectorRecord => ({
          chunk,
          vector: batch.vectors[index] ?? [],
        }),
      ),
    );

    // BM25 corpus statistics are derived from the same chunk set.
    this.reranker.fit(chunks);

    const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
    const result: IndexBuildResult = {
      chunks: chunks.length,
      documents: KNOWLEDGE_DOCUMENTS.length + INCIDENTS.length,
      model: batch.model,
      dimensions,
      provider: batch.provider,
      durationMs,
    };
    this.lastResult = result;

    this.telemetry.record({
      at: new Date().toISOString(),
      operation: 'index',
      route: null,
      provider: batch.provider,
      model: batch.model,
      promptVersion: 'n/a',
      latencyMs: durationMs,
      usage: batch.usage,
      grounded: true,
      usedFallback: batch.usedFallback,
    });

    this.logger.log(
      `Indexed ${chunks.length} chunks from ${result.documents} documents in ${durationMs}ms ` +
        `(${batch.provider}/${batch.model}, ${dimensions}d)`,
    );
    return result;
  }

  /** Metadata is embedded alongside the text so filters have semantic signal. */
  private embeddingText(chunk: IndexedChunk): string {
    const metadata = Object.entries(chunk.metadata)
      .filter(([key]) => key !== 'chunkIndex' && key !== 'chunkCount')
      .map(
        ([key, value]) =>
          `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`,
      )
      .join('; ');
    return `${chunk.title}. ${chunk.section}. ${chunk.text} [${metadata}]`;
  }
}
