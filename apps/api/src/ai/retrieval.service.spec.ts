import { buildAiStack, withProviderEnv, type AiStack } from './testing/ai-stack';
import { RetrievalService } from './retrieval.service';

describe('RetrievalService', () => {
  withProviderEnv('local');
  let stack: AiStack;

  beforeAll(async () => {
    stack = await buildAiStack();
  });

  it('builds the index once and embeds only the query per search', async () => {
    expect(stack.store.size).toBeGreaterThan(16);
    expect(stack.store.model).toBe('opspilot-hash-embedding-v1');
    expect(stack.store.dimensions).toBe(256);

    const embedSpy = jest.spyOn(stack.provider, 'embedTexts');
    await stack.retrieval.search('brake overheat procedure', 'knowledge');

    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(embedSpy.mock.calls[0]?.[0]).toHaveLength(1);
    embedSpy.mockRestore();
  });

  it('retrieves the brake procedure without external credentials', async () => {
    const response = await stack.retrieval.search(
      'What is the safe procedure for an overheating brake?',
      'knowledge',
    );

    expect(response.embeddingModel).toBe('opspilot-hash-embedding-v1');
    expect(response.results[0]?.documentId).toBe('KB-SAF-001');
    expect(response.results[0]?.type).toBe('knowledge');
    expect(response.latencyMs).toBeGreaterThan(0);
    expect(response.candidatesConsidered).toBeGreaterThan(0);
  });

  it('honors incident scope and ranks cold-chain events', async () => {
    const response = await stack.retrieval.search(
      'reefer cargo temperature excursion',
      'incidents',
    );

    expect(response.results[0]?.documentId).toBe('INC-1002');
    expect(response.results.every((result) => result.type === 'incident')).toBe(
      true,
    );
  });

  it('is deterministic across repeated local searches', async () => {
    const first = await stack.retrieval.search('driver legal hours limit', 'all');
    const second = await stack.retrieval.search('driver legal hours limit', 'all');

    expect(second.results.map((result) => result.id)).toEqual(
      first.results.map((result) => result.id),
    );
    expect(second.results.map((result) => result.score)).toEqual(
      first.results.map((result) => result.score),
    );
  });

  it('returns no results for an unrelated query below the relevance floor', async () => {
    const response = await stack.retrieval.search('xylophone nebula origami', 'all');

    expect(response.results).toEqual([]);
  });

  it('reports both component scores so ranking is auditable', async () => {
    const response = await stack.retrieval.search(
      'unauthorized vehicle movement geofence',
      'all',
    );
    const top = response.results[0];

    expect(top).toBeDefined();
    expect(top?.vectorScore).toBeGreaterThan(0);
    expect(top?.lexicalScore).toBeGreaterThan(0);
    expect(top?.score).toBeGreaterThanOrEqual(
      RetrievalService.MIN_RELEVANCE_SCORE,
    );
  });

  it('diversifies results across documents rather than one procedure', async () => {
    const response = await stack.retrieval.search(
      'temperature excursion cold chain quarantine disposition',
      'knowledge',
      5,
    );
    const documents = new Set(response.results.map((result) => result.documentId));

    expect(response.results.length).toBeGreaterThan(1);
    expect(documents.size).toBeGreaterThan(1);
  });
});
