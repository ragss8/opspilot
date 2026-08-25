import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

function mockJson(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(payload),
    }),
  );
}

/** Builds a fetch mock whose body streams the given SSE frames. */
function mockEventStream(frames: string[]) {
  const encoder = new TextEncoder();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          frames.forEach((frame) => controller.enqueue(encoder.encode(frame)));
          controller.close();
        },
      }),
    }),
  );
}

const chatPayload = {
  sessionId: '11111111-2222-4333-8444-555555555555',
  answer: 'Follow the brake overheat procedure [KB-SAF-001#0].',
  route: 'KNOWLEDGE_QUERY',
  confidence: 0.94,
  provider: 'local',
  latencyMs: 12,
  citations: [
    {
      id: 'KB-SAF-001#0',
      documentId: 'KB-SAF-001',
      title: 'Brake Overheat Emergency Procedure',
      section: 'Immediate response',
      excerpt: 'Stop at the nearest safe location.',
      score: 0.91,
      type: 'knowledge',
    },
  ],
  toolCalls: [
    { name: 'get_fleet_metrics', arguments: {}, result: { totalVehicles: 312 }, durationMs: 2 },
  ],
  usage: {
    inputTokens: 900,
    outputTokens: 120,
    totalTokens: 1020,
    costUsd: 0.000465,
    estimated: false,
  },
  trace: {
    steps: [
      { label: 'Intent router', detail: 'Knowledge query', durationMs: 1, status: 'complete' },
      { label: 'Query condensation', detail: 'Self-contained', durationMs: 1, status: 'skipped' },
    ],
    candidatesConsidered: 24,
    chunksRetrieved: 5,
    embeddingModel: 'opspilot-hash-embedding-v1',
    generationModel: 'opspilot-grounded-template-v1',
    promptVersion: 'opspilot-prompts@2.1.0',
    turnsInContext: 2,
  },
  followUps: ['Show related incidents'],
};

describe('API response normalization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps the Nest overview contract to dashboard cards', async () => {
    mockJson({
      generatedAt: '2026-08-25T08:05:00.000Z',
      metrics: {
        totalVehicles: 312,
        activeVehicles: 247,
        fleetAvailability: 94.6,
        openIncidents: 5,
        criticalIncidents: 1,
        groundedAnswerRate: 92.5,
        distanceTodayKm: 48672,
      },
      dailyBrief: {
        greeting: 'Good morning, control tower',
        headline: 'Fleet availability is stable.',
        summary: 'One safety event needs action.',
        priorities: ['Inspect VH-2047'],
      },
      fleetStatus: { active: 247, idle: 48, maintenance: 12, offline: 5 },
      incidentFeed: [],
      aiHealth: {
        status: 'healthy',
        activeProvider: 'local',
        indexedDocuments: 16,
        indexedChunks: 32,
        embeddingModel: 'opspilot-hash-embedding-v1',
        generationModel: 'opspilot-grounded-template-v1',
        promptVersion: 'opspilot-prompts@2.1.0',
        averageLatencyMs: 14,
        totalRuns: 8,
        groundedRate: 92.5,
        totalCostUsd: 0,
      },
    });

    const result = await api.overview();

    expect(result.source).toBe('live');
    expect(result.data.metrics[0]).toMatchObject({ label: 'Active fleet', value: '247' });
    expect(result.data.metrics[3]).toMatchObject({
      label: 'Grounded answers',
      value: '92.5%',
    });
    expect(result.data.dailyBrief.greeting).toBe('Good morning, control tower');
    expect(result.data.aiHealth.provider).toBe('local');
    expect(result.data.aiHealth.promptVersion).toBe('opspilot-prompts@2.1.0');
    expect(result.data.aiHealth.indexedChunks).toBe(32);
  });

  it('preserves trace, tool calls, and usage from chat responses', async () => {
    mockJson(chatPayload);

    const result = await api.chat('What should I do after a brake alert?');

    expect(result.data.sessionId).toBe('11111111-2222-4333-8444-555555555555');
    expect(result.data.trace.steps).toHaveLength(2);
    expect(result.data.trace.steps[1]?.status).toBe('skipped');
    expect(result.data.trace.candidatesConsidered).toBe(24);
    expect(result.data.trace.turnsInContext).toBe(2);
    expect(result.data.trace.promptVersion).toBe('opspilot-prompts@2.1.0');
    expect(result.data.citations[0]?.documentId).toBe('KB-SAF-001');
    expect(result.data.toolCalls[0]?.name).toBe('get_fleet_metrics');
    expect(result.data.usage).toMatchObject({ totalTokens: 1020, estimated: false });
  });

  it('sends the session id so the server can continue the conversation', async () => {
    mockJson(chatPayload);

    await api.chat('And who signs it off?', 'session-abc');

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      message: 'And who signs it off?',
      sessionId: 'session-abc',
    });
  });

  it('searches both stores and filters by category client-side', async () => {
    mockJson({ results: [] });

    await api.search('brake', 'Safety');

    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    // The API scope stays 'all'; 'Safety' is a category filter, not a store.
    expect(url).toContain('scope=all');
    expect(url).toContain('q=brake');
  });

  it('assembles a streamed answer from server-sent events', async () => {
    mockEventStream([
      `data: ${JSON.stringify({ type: 'route', route: 'KNOWLEDGE_QUERY', confidence: 0.9, reason: 'guidance' })}\n\n`,
      `data: ${JSON.stringify({ type: 'token', text: 'Follow the ' })}\n\n`,
      `data: ${JSON.stringify({ type: 'token', text: 'brake procedure.' })}\n\n`,
      `data: ${JSON.stringify({ type: 'done', response: chatPayload })}\n\n`,
    ]);

    const seen: string[] = [];
    let streamed = '';
    const result = await api.streamChat('What is the brake procedure?', undefined, (event) => {
      seen.push(event.type);
      if (event.type === 'token') streamed += event.text;
    });

    expect(seen).toEqual(['route', 'token', 'token', 'done']);
    expect(streamed).toBe('Follow the brake procedure.');
    expect(result.source).toBe('live');
    expect(result.data.answer).toContain('KB-SAF-001#0');
  });

  it('reassembles events split across chunk boundaries', async () => {
    const done = `data: ${JSON.stringify({ type: 'done', response: chatPayload })}\n\n`;
    mockEventStream([
      `data: ${JSON.stringify({ type: 'token', text: 'Hi' })}\n`,
      `\n${done.slice(0, 40)}`,
      done.slice(40),
    ]);

    const result = await api.streamChat('brake?', undefined, () => undefined);

    expect(result.source).toBe('live');
    expect(result.data.route).toBe('KNOWLEDGE_QUERY');
  });

  it('falls back to the buffered endpoint when streaming is unavailable', async () => {
    const streamFailure = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 });
    const buffered = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(chatPayload),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementationOnce(streamFailure).mockImplementation(buffered),
    );

    const result = await api.streamChat('brake?', undefined, () => undefined);

    expect(result.source).toBe('live');
    expect(result.data.answer).toContain('brake overheat procedure');
  });

  it('reports demo mode when the API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const result = await api.incidents();

    expect(result.source).toBe('demo');
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('falls back to preview data when both stream and buffered calls fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const result = await api.streamChat('brake?', undefined, () => undefined);

    expect(result.source).toBe('demo');
    expect(result.data.answer.length).toBeGreaterThan(0);
  });
});
