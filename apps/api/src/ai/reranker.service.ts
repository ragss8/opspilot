import { Injectable } from '@nestjs/common';
import type { IndexedChunk, RankedChunk, VectorMatch } from './ai.types';
import { LocalEmbeddingService } from './local-embedding.service';

/**
 * Second-stage reranker.
 *
 * Stage one (the vector store) optimises recall: it returns a wide candidate
 * set by dense similarity alone. This stage optimises precision using signals
 * the dense vector cannot express:
 *
 *  - Okapi BM25 with corpus IDF, so rare domain terms outweigh common ones.
 *  - Field-level matching against title, section, and metadata identifiers.
 *  - Exact identifier and phrase hits (VH-2047, INC-1001, KB-SAF-001).
 *  - Maximal Marginal Relevance, so the final set is not four near-duplicate
 *    passages of the same procedure.
 *
 * The ordering this produces genuinely differs from the stage-one ordering.
 */

const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Relevance/diversity trade-off for MMR. 1.0 disables diversity entirely. */
const DEFAULT_MMR_LAMBDA = 0.72;

const WEIGHT_VECTOR = 0.55;
const WEIGHT_BM25 = 0.3;
const WEIGHT_FIELD = 0.15;

const IDENTIFIER_PATTERN = /\b(?:VH-\d{3,4}|INC-\d{4}|KB-[A-Z]{3}-\d{3})\b/gi;

export interface RerankOptions {
  limit: number;
  lambda?: number;
  /** Candidates below this rerank score are dropped before MMR selection. */
  minScore?: number;
  /**
   * When set, a candidate must carry some lexical or field evidence to survive.
   * The local hash embedder has no semantic generalization, so a dense-only
   * match against it is noise; hosted embeddings do not need this guard.
   */
  requireLexicalSignal?: boolean;
}

@Injectable()
export class RerankerService {
  private documentFrequency = new Map<string, number>();
  private termFrequency = new Map<string, Map<string, number>>();
  private tokenSets = new Map<string, Set<string>>();
  private lengths = new Map<string, number>();
  private averageLength = 0;
  private corpusSize = 0;

  constructor(private readonly analyzer: LocalEmbeddingService) {}

  /** Builds BM25 corpus statistics. Called once whenever the index is built. */
  fit(chunks: readonly IndexedChunk[]): void {
    this.documentFrequency = new Map();
    this.termFrequency = new Map();
    this.tokenSets = new Map();
    this.lengths = new Map();
    this.corpusSize = chunks.length;

    let totalLength = 0;

    chunks.forEach((chunk) => {
      const tokens = this.analyzer.tokenize(this.searchableText(chunk));
      const frequencies = new Map<string, number>();
      tokens.forEach((token) => {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      });

      this.termFrequency.set(chunk.id, frequencies);
      this.tokenSets.set(chunk.id, new Set(tokens));
      this.lengths.set(chunk.id, tokens.length);
      totalLength += tokens.length;

      new Set(tokens).forEach((token) => {
        this.documentFrequency.set(
          token,
          (this.documentFrequency.get(token) ?? 0) + 1,
        );
      });
    });

    this.averageLength = chunks.length > 0 ? totalLength / chunks.length : 0;
  }

  get isFitted(): boolean {
    return this.corpusSize > 0;
  }

  rerank(
    query: string,
    candidates: readonly VectorMatch[],
    options: RerankOptions,
  ): RankedChunk[] {
    if (candidates.length === 0) return [];

    const queryTokens = this.analyzer.tokenize(query);
    const identifiers = (query.match(IDENTIFIER_PATTERN) ?? []).map((value) =>
      value.toUpperCase(),
    );
    const normalizedQuery = query.toLowerCase().trim();

    const scored = candidates.map((candidate) => {
      const bm25 = this.bm25(candidate.chunk, queryTokens);
      const field = this.fieldScore(
        candidate.chunk,
        queryTokens,
        identifiers,
        normalizedQuery,
      );
      return { candidate, bm25, field };
    });

    // BM25 is unbounded, so normalise within the candidate set before mixing.
    const maxBm25 = Math.max(...scored.map((entry) => entry.bm25), 1e-9);

    const relevance: RankedChunk[] = scored.map(({ candidate, bm25, field }) => {
      const lexicalScore = bm25 / maxBm25;
      // Cosine over unit vectors is in [-1, 1]; clamp the negative half away.
      const vectorScore = Math.max(0, candidate.score);
      const rerankScore =
        WEIGHT_VECTOR * vectorScore +
        WEIGHT_BM25 * lexicalScore +
        WEIGHT_FIELD * field;

      return {
        chunk: candidate.chunk,
        vectorScore: round(vectorScore),
        lexicalScore: round(lexicalScore),
        fieldScore: round(field),
        rerankScore: round(rerankScore),
        finalScore: round(rerankScore),
      };
    });

    const eligible = relevance.filter((entry) => {
      if (entry.rerankScore < (options.minScore ?? 0)) return false;
      if (options.requireLexicalSignal) {
        return entry.lexicalScore > 0 || entry.fieldScore > 0;
      }
      return true;
    });

    return this.selectWithMmr(
      eligible,
      options.limit,
      options.lambda ?? DEFAULT_MMR_LAMBDA,
    );
  }

  /**
   * Maximal Marginal Relevance: greedily pick the candidate that maximises
   * relevance minus its similarity to what has already been selected.
   *
   * MMR decides which candidates are selected and in what order. The score
   * reported to callers stays the relevance score, because a diversity-adjusted
   * number would be meaningless as a "relevance" figure in the UI.
   */
  private selectWithMmr(
    candidates: readonly RankedChunk[],
    limit: number,
    lambda: number,
  ): RankedChunk[] {
    const pool = [...candidates].sort(
      (left, right) => right.rerankScore - left.rerankScore,
    );
    const selected: RankedChunk[] = [];
    const target = Math.min(limit, pool.length);

    while (selected.length < target && pool.length > 0) {
      let bestIndex = 0;
      let bestScore = Number.NEGATIVE_INFINITY;

      pool.forEach((candidate, index) => {
        const redundancy = selected.reduce(
          (highest, chosen) =>
            Math.max(highest, this.similarity(candidate.chunk, chosen.chunk)),
          0,
        );
        const mmr = lambda * candidate.rerankScore - (1 - lambda) * redundancy;
        if (mmr > bestScore) {
          bestScore = mmr;
          bestIndex = index;
        }
      });

      const [chosen] = pool.splice(bestIndex, 1);
      if (!chosen) break;
      selected.push({ ...chosen, finalScore: chosen.rerankScore });
    }

    return selected;
  }

  private bm25(chunk: IndexedChunk, queryTokens: readonly string[]): number {
    const frequencies = this.termFrequency.get(chunk.id);
    if (!frequencies || this.corpusSize === 0) return 0;

    const length = this.lengths.get(chunk.id) ?? 0;
    const lengthNorm =
      this.averageLength > 0
        ? 1 - BM25_B + BM25_B * (length / this.averageLength)
        : 1;

    return queryTokens.reduce((total, token) => {
      const frequency = frequencies.get(token) ?? 0;
      if (frequency === 0) return total;

      const containing = this.documentFrequency.get(token) ?? 0;
      const idf = Math.log(
        1 + (this.corpusSize - containing + 0.5) / (containing + 0.5),
      );
      const saturation =
        (frequency * (BM25_K1 + 1)) / (frequency + BM25_K1 * lengthNorm);
      return total + idf * saturation;
    }, 0);
  }

  private fieldScore(
    chunk: IndexedChunk,
    queryTokens: readonly string[],
    identifiers: readonly string[],
    normalizedQuery: string,
  ): number {
    let score = 0;

    // An explicit identifier in the query is the strongest possible signal.
    if (identifiers.length > 0) {
      const haystack = [
        chunk.id,
        chunk.documentId,
        String(chunk.metadata.vehicleId ?? ''),
        chunk.text,
      ]
        .join(' ')
        .toUpperCase();
      const hits = identifiers.filter((identifier) =>
        haystack.includes(identifier),
      ).length;
      score += (hits / identifiers.length) * 0.6;
    }

    const titleTokens = new Set(this.analyzer.tokenize(chunk.title));
    const sectionTokens = new Set(this.analyzer.tokenize(chunk.section));
    const unique = new Set(queryTokens);
    if (unique.size > 0) {
      let titleHits = 0;
      let sectionHits = 0;
      unique.forEach((token) => {
        if (titleTokens.has(token)) titleHits += 1;
        if (sectionTokens.has(token)) sectionHits += 1;
      });
      score += (titleHits / unique.size) * 0.25;
      score += (sectionHits / unique.size) * 0.1;
    }

    // Verbatim phrase presence, for quoted or copy-pasted queries.
    if (
      normalizedQuery.length >= 12 &&
      chunk.text.toLowerCase().includes(normalizedQuery)
    ) {
      score += 0.05;
    }

    return Math.min(1, score);
  }

  /** Jaccard overlap, plus a strong penalty for passages of the same document. */
  private similarity(left: IndexedChunk, right: IndexedChunk): number {
    if (left.id === right.id) return 1;

    const leftTokens = this.tokenSets.get(left.id);
    const rightTokens = this.tokenSets.get(right.id);
    let jaccard = 0;
    if (leftTokens && rightTokens && leftTokens.size > 0) {
      let intersection = 0;
      leftTokens.forEach((token) => {
        if (rightTokens.has(token)) intersection += 1;
      });
      const union = leftTokens.size + rightTokens.size - intersection;
      jaccard = union > 0 ? intersection / union : 0;
    }

    return left.documentId === right.documentId
      ? Math.max(jaccard, 0.65)
      : jaccard;
  }

  private searchableText(chunk: IndexedChunk): string {
    const metadata = Object.values(chunk.metadata)
      .map((value) => (Array.isArray(value) ? value.join(' ') : String(value)))
      .join(' ');
    return `${chunk.title} ${chunk.section} ${chunk.text} ${metadata}`;
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
