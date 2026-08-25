import { Injectable } from '@nestjs/common';
import { BriefingService } from '../ai/briefing.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { IndexBuilderService } from '../ai/index-builder.service';
import { RetrievalService } from '../ai/retrieval.service';
import { PROMPT_SET_VERSION } from '../ai/prompts';
import { FleetService } from '../fleet/fleet.service';
import type { FleetOverview } from '../fleet/fleet.types';
import { AiTelemetryService } from '../telemetry/ai-telemetry.service';

/**
 * Composes the control-tower overview from the fleet layer and the AI layer.
 *
 * Every metric is aggregated from records, and every AI health figure comes
 * from telemetry recorded in this process. Nothing on this page is a literal.
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly fleet: FleetService,
    private readonly briefing: BriefingService,
    private readonly provider: AiProviderService,
    private readonly retrieval: RetrievalService,
    private readonly telemetry: AiTelemetryService,
    private readonly indexBuilder: IndexBuilderService,
  ) {}

  getOverview(): FleetOverview {
    const now = Date.now();
    const facts = this.fleet.getFacts(now);
    const brief = this.briefing.build(now);
    const snapshot = this.telemetry.snapshot();
    const configuredProvider = configuredProviderFrom(process.env.AI_PROVIDER);
    const activeProvider = this.provider.mode;

    return {
      generatedAt: new Date(now).toISOString(),
      metrics: {
        totalVehicles: facts.totalVehicles,
        activeVehicles: facts.activeVehicles,
        delayedVehicles: facts.delayedVehicles,
        fleetAvailability: facts.fleetAvailability,
        openIncidents: facts.openIncidents,
        criticalIncidents: facts.criticalIncidents,
        groundedAnswerRate: snapshot.groundedRate,
        distanceTodayKm: facts.distanceTodayKm,
      },
      dailyBrief: { ...brief, provider: activeProvider },
      fleetStatus: {
        active: facts.activeVehicles,
        idle: facts.idleVehicles,
        maintenance: facts.maintenanceVehicles,
        offline: facts.offlineVehicles,
      },
      timeSeries: this.fleet.getTimeSeries(),
      incidentFeed: this.fleet.listIncidents({ limit: 5 }),
      aiHealth: {
        // Degraded means hosted generation was configured but is falling back.
        status:
          activeProvider !== 'local' && snapshot.fallbackRate > 50
            ? 'degraded'
            : 'healthy',
        configuredProvider,
        activeProvider,
        indexedDocuments: this.indexBuilder.result?.documents ?? 0,
        indexedChunks: this.retrieval.indexSize,
        embeddingModel: this.retrieval.indexModel,
        generationModel: this.provider.generationModel,
        promptVersion: PROMPT_SET_VERSION,
        averageLatencyMs: snapshot.averageLatencyMs,
        totalRuns: snapshot.totalRuns,
        groundedRate: snapshot.groundedRate,
        totalCostUsd: snapshot.totalCostUsd,
        lastIndexedAt: this.retrieval.lastIndexedAt,
      },
    };
  }
}

function configuredProviderFrom(value: string | undefined): 'local' | 'openai' | 'aws' {
  const provider = value?.trim().toLowerCase();
  return provider === 'openai' || provider === 'aws' ? provider : 'local';
}
