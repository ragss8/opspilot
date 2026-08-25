import type { IndexedChunk, VectorMatch } from './ai.types';
import { LocalEmbeddingService } from './local-embedding.service';
import { RerankerService } from './reranker.service';

function chunk(
  id: string,
  documentId: string,
  title: string,
  text: string,
): IndexedChunk {
  return {
    id,
    documentId,
    title,
    section: 'Scope',
    text,
    type: 'knowledge',
    chunkIndex: Number(id.split('#')[1] ?? 0),
    chunkCount: 3,
    metadata: { category: 'Safety' },
  };
}

describe('RerankerService', () => {
  const analyzer = new LocalEmbeddingService();
  let reranker: RerankerService;

  const corpus = [
    chunk('A#0', 'A', 'Brake Overheat Procedure', 'Brake temperature above 200C requires an immediate stop and a technician inspection of the wheel end.'),
    chunk('A#1', 'A', 'Brake Overheat Procedure', 'Brake lining thickness and drum cracking must be checked before the brake release is recorded.'),
    chunk('B#0', 'B', 'Tyre Pressure Standard', 'A tyre losing more than 5 PSI in 24 hours is removed from dispatch until inspected.'),
    chunk('C#0', 'C', 'Delivery Delay Communication', 'Notify the consignee with a revised ETA when a priority shipment runs more than 30 minutes late.'),
  ];

  beforeEach(() => {
    reranker = new RerankerService(analyzer);
    reranker.fit(corpus);
  });

  it('promotes a lexically matching passage the vector stage ranked lower', () => {
    // The vector stage puts the tyre passage first; BM25 should correct it.
    const candidates: VectorMatch[] = [
      { chunk: corpus[2]!, score: 0.62 },
      { chunk: corpus[0]!, score: 0.58 },
      { chunk: corpus[3]!, score: 0.5 },
    ];

    const ranked = reranker.rerank('brake overheat wheel end inspection', candidates, {
      limit: 3,
      lambda: 1,
    });

    expect(ranked[0]?.chunk.id).toBe('A#0');
    expect(ranked[0]?.lexicalScore).toBeGreaterThan(ranked[1]!.lexicalScore);
  });

  it('scores an exact identifier match as strong field evidence', () => {
    const withIdentifier = chunk(
      'D#0',
      'D',
      'Incident record',
      'Vehicle VH-2047 reported a brake temperature event on the North Ridge descent.',
    );
    reranker.fit([...corpus, withIdentifier]);

    const ranked = reranker.rerank(
      'What happened to VH-2047?',
      [
        { chunk: corpus[0]!, score: 0.7 },
        { chunk: withIdentifier, score: 0.4 },
      ],
      { limit: 2, lambda: 1 },
    );

    expect(ranked[0]?.chunk.id).toBe('D#0');
    expect(ranked[0]?.fieldScore).toBeGreaterThan(0.5);
  });

  it('uses MMR to avoid returning two passages of the same document', () => {
    const candidates: VectorMatch[] = [
      { chunk: corpus[0]!, score: 0.9 },
      { chunk: corpus[1]!, score: 0.88 },
      { chunk: corpus[2]!, score: 0.4 },
    ];

    const diverse = reranker.rerank('brake inspection', candidates, {
      limit: 2,
      lambda: 0.5,
    });
    const relevanceOnly = reranker.rerank('brake inspection', candidates, {
      limit: 2,
      lambda: 1,
    });

    expect(relevanceOnly.map((entry) => entry.chunk.documentId)).toEqual(['A', 'A']);
    expect(new Set(diverse.map((entry) => entry.chunk.documentId)).size).toBe(2);
  });

  it('reports relevance as the score, not the diversity-adjusted value', () => {
    const ranked = reranker.rerank(
      'brake inspection',
      [{ chunk: corpus[0]!, score: 0.9 }],
      { limit: 1, lambda: 0.5 },
    );

    expect(ranked[0]?.finalScore).toBe(ranked[0]?.rerankScore);
  });

  it('drops candidates below the minimum score', () => {
    const ranked = reranker.rerank(
      'brake inspection',
      [{ chunk: corpus[3]!, score: 0.05 }],
      { limit: 3, minScore: 0.5 },
    );

    expect(ranked).toEqual([]);
  });

  it('requires lexical evidence when asked to', () => {
    const ranked = reranker.rerank(
      'xylophone nebula origami',
      corpus.map((entry) => ({ chunk: entry, score: 0.4 })),
      { limit: 3, requireLexicalSignal: true },
    );

    expect(ranked).toEqual([]);
  });

  it('weights rare corpus terms above common ones', () => {
    // "brake" appears in two documents, "consignee" in one, so the rarer term
    // must carry more weight for the same single occurrence.
    const rare = reranker.rerank('consignee', [{ chunk: corpus[3]!, score: 0 }], {
      limit: 1,
      lambda: 1,
    });
    const common = reranker.rerank('brake', [{ chunk: corpus[0]!, score: 0 }], {
      limit: 1,
      lambda: 1,
    });

    expect(rare[0]?.lexicalScore).toBeGreaterThan(0);
    expect(common[0]?.lexicalScore).toBeGreaterThan(0);
  });
});
