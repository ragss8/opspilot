import type { IndexedChunk } from './ai.types';
import { InMemoryVectorStore } from './vector-store';

function chunk(overrides: Partial<IndexedChunk> = {}): IndexedChunk {
  return {
    id: 'KB-TEST-001#0',
    documentId: 'KB-TEST-001',
    title: 'Test procedure',
    section: 'Scope',
    text: 'Some procedure text.',
    type: 'knowledge',
    chunkIndex: 0,
    chunkCount: 1,
    metadata: { category: 'Safety' },
    ...overrides,
  };
}

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    store.reset('test-model', 3);
  });

  it('rejects a vector whose dimensions do not match the index', () => {
    expect(() =>
      store.upsert([{ chunk: chunk(), vector: [1, 0] }]),
    ).toThrow(/dimension mismatch/i);
  });

  it('rejects a query vector of the wrong dimensionality', () => {
    store.upsert([{ chunk: chunk(), vector: [1, 0, 0] }]);

    expect(() => store.search([1, 0], 3)).toThrow(/dimension mismatch/i);
  });

  it('ranks by cosine similarity over normalized vectors', () => {
    store.upsert([
      { chunk: chunk({ id: 'a#0', documentId: 'a' }), vector: [1, 0, 0] },
      { chunk: chunk({ id: 'b#0', documentId: 'b' }), vector: [0, 1, 0] },
      // Same direction as `a` but a different magnitude: identical similarity.
      { chunk: chunk({ id: 'c#0', documentId: 'c' }), vector: [5, 0, 0] },
    ]);

    const matches = store.search([2, 0, 0], 3);

    expect(matches[0]?.score).toBeCloseTo(1, 5);
    expect(matches[1]?.score).toBeCloseTo(1, 5);
    expect(matches[2]?.chunk.id).toBe('b#0');
    expect(matches[2]?.score).toBeCloseTo(0, 5);
  });

  it('filters by scope and metadata before ranking', () => {
    store.upsert([
      {
        chunk: chunk({ id: 'k#0', documentId: 'k', type: 'knowledge' }),
        vector: [1, 0, 0],
      },
      {
        chunk: chunk({
          id: 'i#0',
          documentId: 'i',
          type: 'incident',
          metadata: { severity: 'critical', status: 'open' },
        }),
        vector: [1, 0, 0],
      },
    ]);

    expect(store.search([1, 0, 0], 5, { scope: 'incidents' })).toHaveLength(1);
    expect(
      store.search([1, 0, 0], 5, { scope: 'incidents' })[0]?.chunk.id,
    ).toBe('i#0');
    expect(
      store.search([1, 0, 0], 5, { severity: 'critical' }),
    ).toHaveLength(1);
    expect(store.search([1, 0, 0], 5, { severity: 'low' })).toHaveLength(0);
  });

  it('replaces a chunk in place on re-upsert rather than duplicating it', () => {
    store.upsert([{ chunk: chunk(), vector: [1, 0, 0] }]);
    store.upsert([
      { chunk: chunk({ title: 'Updated title' }), vector: [0, 1, 0] },
    ]);

    expect(store.size).toBe(1);
    expect(store.get('KB-TEST-001#0')?.title).toBe('Updated title');
  });

  it('refuses to initialize with an invalid dimension', () => {
    expect(() => store.reset('test-model', 0)).toThrow(/positive integer/i);
  });
});
