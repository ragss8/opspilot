import { Module } from '@nestjs/common';
import { FleetModule } from '../fleet/fleet.module';
import { AiController } from './ai.controller';
import { AiProviderService } from './ai-provider.service';
import { AiRouterService } from './ai-router.service';
import { AiService } from './ai.service';
import { BriefingService } from './briefing.service';
import { ChunkingService } from './chunking.service';
import { ClassificationService } from './classification.service';
import { ConversationService } from './conversation.service';
import { IndexBuilderService } from './index-builder.service';
import { LocalEmbeddingService } from './local-embedding.service';
import { RerankerService } from './reranker.service';
import { RetrievalService } from './retrieval.service';
import { FleetToolsService } from './tools/fleet-tools.service';
import { InMemoryVectorStore, VECTOR_REPOSITORY } from './vector-store';

@Module({
  imports: [FleetModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiRouterService,
    AiProviderService,
    BriefingService,
    ChunkingService,
    ClassificationService,
    ConversationService,
    FleetToolsService,
    IndexBuilderService,
    LocalEmbeddingService,
    RerankerService,
    RetrievalService,
    // Swap this binding for a pgvector or OpenSearch adapter; nothing else moves.
    { provide: VECTOR_REPOSITORY, useClass: InMemoryVectorStore },
  ],
  exports: [
    AiProviderService,
    BriefingService,
    IndexBuilderService,
    RetrievalService,
  ],
})
export class AiModule {}
