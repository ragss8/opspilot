import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiProviderService } from './ai/ai-provider.service';
import { IndexBuilderService } from './ai/index-builder.service';
import { PROMPT_SET_VERSION } from './ai/prompts';
import { RetrievalService } from './ai/retrieval.service';
import { Public } from './common/public.decorator';
import { AiTelemetryService } from './telemetry/ai-telemetry.service';

@ApiTags('System')
@Controller('health')
export class HealthController {
  constructor(
    private readonly provider: AiProviderService,
    private readonly retrieval: RetrievalService,
    private readonly indexBuilder: IndexBuilderService,
    private readonly telemetry: AiTelemetryService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Check API, provider, and vector index readiness' })
  @ApiOkResponse({ description: 'Service health and active model configuration.' })
  getHealth() {
    const snapshot = this.telemetry.snapshot();
    const indexed = this.retrieval.indexSize > 0;

    return {
      status: indexed ? 'ok' : 'starting',
      service: 'opspilot-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      ai: {
        provider: this.provider.mode,
        embeddingModel: this.provider.embeddingModel,
        generationModel: this.provider.generationModel,
        promptVersion: PROMPT_SET_VERSION,
        index: {
          ready: indexed,
          chunks: this.retrieval.indexSize,
          model: this.retrieval.indexModel,
          dimensions: this.indexBuilder.result?.dimensions ?? 0,
          buildMs: this.indexBuilder.result?.durationMs ?? 0,
          lastIndexedAt: this.retrieval.lastIndexedAt,
        },
        runs: snapshot.totalRuns,
        averageLatencyMs: snapshot.averageLatencyMs,
        fallbackRate: snapshot.fallbackRate,
      },
    };
  }
}
