import { FleetService } from '../fleet/fleet.service';
import { AiProviderService } from './ai-provider.service';
import { AiRouterService } from './ai-router.service';
import { AiService } from './ai.service';
import { BriefingService } from './briefing.service';
import { ConversationService } from './conversation.service';
import { RetrievalService } from './retrieval.service';
import { FleetToolsService } from './tools/fleet-tools.service';
import { buildAiStack, withProviderEnv, type AiStack } from './testing/ai-stack';
import type { CompletionResult, IndexedChunk, RankedChunk, RetrievalRun } from './ai.types';
import { EMPTY_USAGE } from './usage';

describe('AiService grounding validation', () => {
  const chunk: IndexedChunk = {
    id: 'KB-SAF-001#0',
    documentId: 'KB-SAF-001',
    title: 'Brake Overheat Emergency Procedure',
    section: 'Immediate response',
    text: 'Stop at a safe location. A qualified technician must inspect the wheel end.',
    type: 'knowledge',
    chunkIndex: 0,
    chunkCount: 3,
    metadata: { category: 'Safety', documentId: 'KB-SAF-001' },
  };
  const ranked: RankedChunk = {
    chunk,
    vectorScore: 0.9,
    lexicalScore: 0.8,
    fieldScore: 0.3,
    rerankScore: 0.92,
    finalScore: 0.92,
  };
  const run: RetrievalRun = {
    query: 'What is the brake overheat procedure?',
    results: [
      {
        id: chunk.id,
        documentId: chunk.documentId,
        title: chunk.title,
        section: chunk.section,
        excerpt: chunk.text,
        score: 0.92,
        type: 'knowledge',
        chunkIndex: 0,
        chunkCount: 3,
        vectorScore: 0.9,
        lexicalScore: 0.8,
        metadata: chunk.metadata,
      },
    ],
    embeddingModel: 'test-embedding',
    candidatesConsidered: 6,
    latencyMs: 1,
    provider: 'aws',
    usedFallback: false,
    chunks: [chunk],
    ranked: [ranked],
    vectorLatencyMs: 1,
    rerankLatencyMs: 1,
  };

  it('rejects a hosted answer that cites a source outside retrieval', async () => {
    const service = createService('Stop the vehicle immediately [KB-NOT-RETRIEVED].');

    const response = await service.chat('What is the brake overheat procedure?');

    expect(response.provider).toBe('local');
    expect(response.answer).toContain('[KB-SAF-001#0]');
    expect(response.answer).not.toContain('KB-NOT-RETRIEVED');
    expect(
      response.trace.steps.find((step) => step.label === 'Grounded generation')
        ?.status,
    ).toBe('fallback');
  });

  it('keeps a hosted answer when every citation is retrieved', async () => {
    const service = createService('Use the approved stop procedure [KB-SAF-001#0].');

    const response = await service.chat('What is the brake overheat procedure?');

    expect(response.provider).toBe('aws');
    expect(response.answer).toBe('Use the approved stop procedure [KB-SAF-001#0].');
  });

  it('accepts a citation of the parent document id', async () => {
    const service = createService('Follow the procedure [KB-SAF-001].');

    const response = await service.chat('What is the brake overheat procedure?');

    expect(response.provider).toBe('aws');
    expect(response.citations[0]?.documentId).toBe('KB-SAF-001');
  });

  it('rejects a hosted answer with no citation when sources were retrieved', async () => {
    const service = createService('Just stop the vehicle and call someone.');

    const response = await service.chat('What is the brake overheat procedure?');

    expect(response.provider).toBe('local');
  });

  function createService(answer: string): AiService {
    const retrieval = {
      retrieve: jest.fn().mockResolvedValue(run),
      indexSize: 40,
    } as unknown as RetrievalService;
    const completion: CompletionResult = {
      text: answer,
      provider: 'aws',
      model: 'test-model',
      usedFallback: false,
      usage: { ...EMPTY_USAGE },
      toolCalls: [],
    };
    const provider = {
      complete: jest.fn().mockResolvedValue(completion),
      embeddingModel: 'test-embedding',
      supportsNativeTools: false,
      isRemoteEnabled: true,
    } as unknown as AiProviderService;
    const fleet = new FleetService();

    return new AiService(
      new AiRouterService(),
      retrieval,
      provider,
      fleet,
      new FleetToolsService(fleet),
      new ConversationService(),
      new BriefingService(fleet),
    );
  }
});

describe('AiService end to end on the local engine', () => {
  withProviderEnv('local');
  let stack: AiStack;

  beforeAll(async () => {
    stack = await buildAiStack();
  });

  it('answers a metric question from typed tool results, not prose guesses', async () => {
    const response = await stack.ai.chat('How many vehicles are offline?');
    const facts = stack.fleet.getFacts();

    expect(response.route).toBe('DATABASE_QUERY');
    expect(response.toolCalls.length).toBeGreaterThan(0);
    expect(response.answer).toContain(String(facts.offlineVehicles));
  });

  it('grounds a procedure question in a retrieved chunk', async () => {
    const response = await stack.ai.chat(
      'What is the brake overheat procedure?',
    );

    expect(response.route).toBe('KNOWLEDGE_QUERY');
    expect(response.citations[0]?.documentId).toBe('KB-SAF-001');
    expect(response.answer).toContain('[KB-SAF-001#');
  });

  it('builds a summary whose numbers all come from computed facts', async () => {
    const response = await stack.ai.chat("Summarize today's operation");
    const facts = stack.fleet.getFacts();

    expect(response.route).toBe('SUMMARY');
    expect(response.answer).toContain(String(facts.totalVehicles));
    expect(response.answer).toContain(String(facts.activeVehicles));
    expect(response.answer).not.toContain('undefined');
  });

  it('carries conversation context across turns in one session', async () => {
    const first = await stack.ai.chat('Tell me about the cold chain playbook');
    const second = await stack.ai.chat('What about disposition?', {
      sessionId: first.sessionId,
    });

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.trace.turnsInContext).toBeGreaterThan(0);
    expect(
      second.trace.steps.find((step) => step.label === 'Query condensation')
        ?.status,
    ).toBe('complete');
  });

  it('starts an independent session when no id is supplied', async () => {
    const first = await stack.ai.chat('Summarize today');
    const second = await stack.ai.chat('Summarize today');

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.trace.turnsInContext).toBe(0);
  });

  it('reports token usage and a prompt version on every run', async () => {
    const response = await stack.ai.chat('What can you help with?');

    expect(response.trace.promptVersion).toMatch(/^opspilot-prompts@/);
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    // The local engine calls no hosted model, so it can never accrue cost.
    expect(response.usage.costUsd).toBe(0);
  });
});
