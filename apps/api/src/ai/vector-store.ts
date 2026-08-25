import { Injectable, Logger } from '@nestjs/common';
import type {
  IndexedChunk,
  VectorFilter,
  VectorMatch,
  VectorRecord,
} from './ai.types';

/**
 * The application-owned vector persistence contract.
 *
 * Everything above this interface is provider-agnostic. Swapping the in-memory
 * implementation for PostgreSQL + pgvector or Amazon OpenSearch Serverless
 * means implementing this interface and rebinding the provider token in
 * `AiModule` — no orchestration, retrieval, or API change.
 */
export interface VectorRepository {
  /** Embedding model whose vectors currently populate the index. */
  readonly model: string;
  /** Dimensionality every stored vector must match. */
  readonly dimensions: number;
  readonly size: number;
  readonly lastIndexedAt: string | null;

  reset(model: string, dimensions: number): void;
  upsert(records: readonly VectorRecord[]): void;
  search(
    vector: readonly number[],
    limit: number,
    filter?: VectorFilter,
  ): VectorMatch[];
  chunks(): readonly IndexedChunk[];
  get(id: string): IndexedChunk | undefined;
}

export const VECTOR_REPOSITORY = Symbol('VECTOR_REPOSITORY');

interface StoredRecord {
  chunk: IndexedChunk;
  /** Unit-normalized at write time so search is a plain dot product. */
  vector: Float64Array;
}

@Injectable()
export class InMemoryVectorStore implements VectorRepository {
  private readonly logger = new Logger(InMemoryVectorStore.name);
  private records: StoredRecord[] = [];
  private byId = new Map<string, StoredRecord>();
  private indexModel = 'uninitialized';
  private indexDimensions = 0;
  private indexedAt: string | null = null;

  get model(): string {
    return this.indexModel;
  }

  get dimensions(): number {
    return this.indexDimensions;
  }

  get size(): number {
    return this.records.length;
  }

  get lastIndexedAt(): string | null {
    return this.indexedAt;
  }

  reset(model: string, dimensions: number): void {
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error(
        `Vector index requires a positive integer dimension, received ${dimensions}`,
      );
    }
    this.records = [];
    this.byId = new Map();
    this.indexModel = model;
    this.indexDimensions = dimensions;
    this.indexedAt = null;
  }

  upsert(records: readonly VectorRecord[]): void {
    records.forEach(({ chunk, vector }) => {
      this.assertDimensions(vector.length, `chunk ${chunk.id}`);
      const stored: StoredRecord = {
        chunk,
        vector: normalize(vector),
      };
      const existing = this.byId.get(chunk.id);
      if (existing) {
        this.records[this.records.indexOf(existing)] = stored;
      } else {
        this.records.push(stored);
      }
      this.byId.set(chunk.id, stored);
    });
    this.indexedAt = new Date().toISOString();
    this.logger.log(
      `Vector index holds ${this.records.length} chunks (${this.indexModel}, ${this.indexDimensions}d)`,
    );
  }

  /**
   * Metadata filters are applied BEFORE ranking, so a scoped search ranks only
   * eligible chunks instead of ranking everything and discarding afterwards.
   */
  search(
    vector: readonly number[],
    limit: number,
    filter: VectorFilter = {},
  ): VectorMatch[] {
    this.assertDimensions(vector.length, 'query');
    const query = normalize(vector);

    const eligible = this.records.filter((record) =>
      matchesFilter(record.chunk, filter),
    );

    return eligible
      .map((record) => ({
        chunk: record.chunk,
        score: dot(query, record.vector),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(0, limit));
  }

  chunks(): readonly IndexedChunk[] {
    return this.records.map((record) => record.chunk);
  }

  get(id: string): IndexedChunk | undefined {
    return this.byId.get(id)?.chunk;
  }

  private assertDimensions(length: number, subject: string): void {
    if (length !== this.indexDimensions) {
      throw new Error(
        `Vector dimension mismatch for ${subject}: index is ${this.indexDimensions}d but received ${length}d. ` +
          'This usually means the embedding provider changed without a reindex.',
      );
    }
  }
}

function matchesFilter(chunk: IndexedChunk, filter: VectorFilter): boolean {
  if (filter.scope === 'incidents' && chunk.type !== 'incident') return false;
  if (filter.scope === 'knowledge' && chunk.type !== 'knowledge') return false;
  if (filter.documentId && chunk.documentId !== filter.documentId) return false;
  if (
    filter.category &&
    String(chunk.metadata.category ?? '').toLowerCase() !==
      filter.category.toLowerCase()
  ) {
    return false;
  }
  if (
    filter.severity &&
    String(chunk.metadata.severity ?? '').toLowerCase() !==
      filter.severity.toLowerCase()
  ) {
    return false;
  }
  if (
    filter.status &&
    String(chunk.metadata.status ?? '').toLowerCase() !==
      filter.status.toLowerCase()
  ) {
    return false;
  }
  return true;
}

function normalize(vector: readonly number[]): Float64Array {
  const output = new Float64Array(vector.length);
  let magnitude = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index] ?? 0;
    output[index] = value;
    magnitude += value * value;
  }
  if (magnitude === 0) return output;
  const inverse = 1 / Math.sqrt(magnitude);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = (output[index] as number) * inverse;
  }
  return output;
}

function dot(left: Float64Array, right: Float64Array): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += (left[index] as number) * (right[index] as number);
  }
  return total;
}
