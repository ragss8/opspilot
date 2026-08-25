import { FleetService } from '../../fleet/fleet.service';
import { AiTelemetryService } from '../../telemetry/ai-telemetry.service';
import { AiProviderService } from '../ai-provider.service';
import { AiRouterService } from '../ai-router.service';
import { AiService } from '../ai.service';
import { BriefingService } from '../briefing.service';
import { ChunkingService } from '../chunking.service';
import { ConversationService } from '../conversation.service';
import { IndexBuilderService } from '../index-builder.service';
import { LocalEmbeddingService } from '../local-embedding.service';
import { RerankerService } from '../reranker.service';
import { RetrievalService } from '../retrieval.service';
import { FleetToolsService } from '../tools/fleet-tools.service';
import { InMemoryVectorStore } from '../vector-store';

export interface AiStack {
  embeddings: LocalEmbeddingService;
  provider: AiProviderService;
  store: InMemoryVectorStore;
  reranker: RerankerService;
  chunking: ChunkingService;
  telemetry: AiTelemetryService;
  indexBuilder: IndexBuilderService;
  retrieval: RetrievalService;
  fleet: FleetService;
  tools: FleetToolsService;
  conversation: ConversationService;
  briefing: BriefingService;
  ai: AiService;
}

/**
 * Wires the real AI pipeline for tests, with the deterministic local engine.
 * Test helper only; excluded from the production build.
 */
export async function buildAiStack(
  overrides: { provider?: AiProviderService } = {},
): Promise<AiStack> {
  const embeddings = new LocalEmbeddingService();
  const provider = overrides.provider ?? new AiProviderService(embeddings);
  const store = new InMemoryVectorStore();
  const reranker = new RerankerService(embeddings);
  const chunking = new ChunkingService();
  const telemetry = new AiTelemetryService();
  const indexBuilder = new IndexBuilderService(
    chunking,
    provider,
    reranker,
    telemetry,
    store,
  );
  const retrieval = new RetrievalService(provider, reranker, indexBuilder, store);
  const fleet = new FleetService();
  const tools = new FleetToolsService(fleet);
  const conversation = new ConversationService();
  const briefing = new BriefingService(fleet);
  const ai = new AiService(
    new AiRouterService(provider),
    retrieval,
    provider,
    fleet,
    tools,
    conversation,
    briefing,
    telemetry,
  );

  await indexBuilder.onModuleInit();

  return {
    embeddings,
    provider,
    store,
    reranker,
    chunking,
    telemetry,
    indexBuilder,
    retrieval,
    fleet,
    tools,
    conversation,
    briefing,
    ai,
  };
}

/** Sets AI_PROVIDER for a suite and restores the previous value afterwards. */
export function withProviderEnv(value: string): void {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = value;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previous;
  });
}
