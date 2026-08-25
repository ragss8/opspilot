import { Injectable } from '@nestjs/common';
import { FleetService } from '../fleet/fleet.service';
import type { FleetFacts } from '../fleet/fleet.types';
import { AiTelemetryService } from '../telemetry/ai-telemetry.service';
import { AiProviderService } from './ai-provider.service';
import { AiRouterService, type RouteDecision } from './ai-router.service';
import { BriefingService } from './briefing.service';
import type {
  AiRoute,
  ChatResponse,
  ChatStreamEvent,
  Citation,
  CompletionResult,
  IndexedChunk,
  RankedChunk,
  RetrievalRun,
  ToolCallRecord,
  TraceStep,
  VectorFilter,
} from './ai.types';
import { ConversationService } from './conversation.service';
import { buildAllowedNumbers, unsupportedNumbers } from './fact-guard';
import {
  buildGroundedPrompt,
  buildSummaryPrompt,
  OPSPILOT_SYSTEM_PROMPT,
  PROMPT_SET_VERSION,
  SUMMARY_PROMPT,
} from './prompts';
import { RetrievalService } from './retrieval.service';
import { FleetToolsService } from './tools/fleet-tools.service';
import { sumUsage } from './usage';

export interface ChatOptions {
  sessionId?: string;
  onEvent?: (event: ChatStreamEvent) => void;
}

const CITATION_PATTERN = /\[((?:KB|INC)-[A-Z0-9-]+(?:#\d+)?)\]/gi;

@Injectable()
export class AiService {
  constructor(
    private readonly router: AiRouterService,
    private readonly retrieval: RetrievalService,
    private readonly provider: AiProviderService,
    private readonly fleet: FleetService,
    private readonly tools: FleetToolsService,
    private readonly conversation: ConversationService,
    private readonly briefing: BriefingService,
    private readonly telemetry?: AiTelemetryService,
  ) {}

  async chat(message: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const startedAt = performance.now();
    const emit = options.onEvent ?? (() => undefined);

    const sessionId = this.conversation.resolveSession(options.sessionId);
    const history = this.conversation.history(sessionId);
    const trace: TraceStep[] = [];

    // ---- 1. Resolve a standalone query -------------------------------------
    const condenseStartedAt = performance.now();
    const needsCondensation = this.conversation.needsCondensation(
      message,
      history,
    );
    const searchQuery = needsCondensation
      ? this.conversation.condenseLocally(message, history)
      : message;
    trace.push({
      label: 'Query condensation',
      detail: needsCondensation
        ? `Follow-up rewritten for retrieval: "${truncate(searchQuery, 80)}"`
        : 'Message is already self-contained',
      durationMs: duration(condenseStartedAt),
      status: needsCondensation ? 'complete' : 'skipped',
    });

    // ---- 2. Route ----------------------------------------------------------
    const routeStartedAt = performance.now();
    const decision = await this.router.resolve(searchQuery);
    trace.push({
      label: 'Intent router',
      detail: `${decision.route} via ${decision.decidedBy}: ${decision.reason}`,
      durationMs: duration(routeStartedAt),
      status: 'complete',
    });
    emit({
      type: 'route',
      route: decision.route,
      confidence: decision.confidence,
      reason: decision.reason,
    });

    // ---- 3. Retrieve -------------------------------------------------------
    const retrievalRun = await this.retrieveForRoute(searchQuery, decision);
    trace.push({
      label: 'Vector recall',
      detail: retrievalRun
        ? `Compared 1 query vector against ${this.retrieval.indexSize} indexed chunks using ${retrievalRun.embeddingModel}; kept ${retrievalRun.candidatesConsidered} candidates`
        : 'No retrieval needed for this route',
      durationMs: retrievalRun?.vectorLatencyMs ?? 1,
      status: retrievalRun
        ? retrievalRun.usedFallback
          ? 'fallback'
          : 'complete'
        : 'skipped',
    });
    trace.push({
      label: 'BM25 + MMR rerank',
      detail: retrievalRun
        ? this.describeRerank(retrievalRun)
        : 'No candidates to rerank',
      durationMs: retrievalRun?.rerankLatencyMs ?? 1,
      status: retrievalRun ? 'complete' : 'skipped',
    });
    emit({
      type: 'retrieval',
      candidatesConsidered: retrievalRun?.candidatesConsidered ?? 0,
      chunksRetrieved: retrievalRun?.chunks.length ?? 0,
    });

    // ---- 4. Tools ----------------------------------------------------------
    const facts = this.fleet.getFacts();
    const toolStartedAt = performance.now();
    const wantsTools = this.routeUsesTools(decision.route);
    const localToolCalls =
      wantsTools && !this.provider.supportsNativeTools
        ? this.runLocalTools(searchQuery, emit)
        : [];
    if (wantsTools && !this.provider.supportsNativeTools) {
      trace.push({
        label: 'Tool execution',
        detail: localToolCalls.length
          ? `Rule-selected ${localToolCalls.length} typed operation(s): ${localToolCalls
              .map((call) => call.name)
              .join(', ')}`
          : 'No tool matched this question',
        durationMs: duration(toolStartedAt),
        status: 'complete',
      });
    }

    // ---- 5. Generate -------------------------------------------------------
    const localAnswer = this.buildLocalAnswer(
      message,
      decision.route,
      retrievalRun?.chunks ?? [],
      facts,
      localToolCalls,
    );

    const generationStartedAt = performance.now();
    const completion = await this.generate({
      route: decision.route,
      question: message,
      searchQuery,
      chunks: retrievalRun?.chunks ?? [],
      facts,
      localToolCalls,
      localAnswer,
      history,
      wantsTools,
      emit,
    });

    const validated = this.validateGroundedCompletion(
      completion,
      decision.route,
      retrievalRun?.chunks ?? [],
      localAnswer,
    );

    trace.push({
      label: 'Grounded generation',
      detail:
        validated.provider !== 'local'
          ? `Generated with ${validated.model} through the ${
              validated.provider === 'aws'
                ? 'AWS Bedrock Converse API'
                : 'OpenAI Responses API'
            }`
          : validated.usedFallback
            ? 'Hosted answer rejected by grounding checks; served the deterministic template'
            : 'Generated with deterministic local RAG templates',
      durationMs: duration(generationStartedAt),
      status: validated.usedFallback ? 'fallback' : 'complete',
    });

    // ---- 6. Assemble -------------------------------------------------------
    const toolCalls = [...localToolCalls, ...validated.toolCalls];
    const citations = this.selectCitations(
      retrievalRun?.ranked ?? [],
      decision.route,
      validated.text,
    );
    const topScore = citations[0]?.score ?? 0.5;
    const confidence = Number(
      Math.max(
        0.58,
        Math.min(0.98, decision.confidence * 0.86 + topScore * 0.14),
      ).toFixed(2),
    );

    const usage = sumUsage([decision.usage, validated.usage]);
    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));

    const response: ChatResponse = {
      sessionId,
      answer: validated.text,
      route: decision.route,
      confidence,
      provider: validated.provider,
      latencyMs,
      citations,
      toolCalls,
      usage,
      trace: {
        steps: trace,
        candidatesConsidered: retrievalRun?.candidatesConsidered ?? 0,
        chunksRetrieved: retrievalRun?.chunks.length ?? 0,
        embeddingModel:
          retrievalRun?.embeddingModel ?? this.provider.embeddingModel,
        generationModel: validated.model,
        promptVersion: PROMPT_SET_VERSION,
        turnsInContext: history.length,
      },
      followUps: this.followUps(decision.route),
    };

    this.conversation.append(sessionId, {
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
      route: decision.route,
    });
    this.conversation.append(sessionId, {
      role: 'assistant',
      content: validated.text,
      createdAt: new Date().toISOString(),
      route: decision.route,
    });

    this.telemetry?.record({
      at: new Date().toISOString(),
      operation: 'chat',
      route: decision.route,
      provider: validated.provider,
      model: validated.model,
      promptVersion: PROMPT_SET_VERSION,
      latencyMs,
      usage,
      grounded: citations.length > 0 || toolCalls.length > 0,
      usedFallback: validated.usedFallback,
    });

    emit({ type: 'done', response });
    return response;
  }

  // -------------------------------------------------------------- generation

  private async generate(input: {
    route: AiRoute;
    question: string;
    searchQuery: string;
    chunks: readonly IndexedChunk[];
    facts: FleetFacts;
    localToolCalls: readonly ToolCallRecord[];
    localAnswer: string;
    history: ReturnType<ConversationService['history']>;
    wantsTools: boolean;
    emit: (event: ChatStreamEvent) => void;
  }): Promise<CompletionResult> {
    const {
      route,
      question,
      chunks,
      facts,
      localToolCalls,
      localAnswer,
      history,
      wantsTools,
      emit,
    } = input;

    const onToken = (text: string): void => emit({ type: 'token', text });

    // Summaries use a dedicated prompt that receives computed facts only.
    if (route === 'SUMMARY') {
      return this.provider.complete(
        SUMMARY_PROMPT,
        buildSummaryPrompt(
          JSON.stringify(facts, null, 2),
          JSON.stringify(this.openIncidentSummaries(), null, 2),
        ),
        localAnswer,
        { onToken },
      );
    }

    const useNativeTools = wantsTools && this.provider.supportsNativeTools;

    return this.provider.complete(
      OPSPILOT_SYSTEM_PROMPT,
      buildGroundedPrompt({
        question,
        route,
        chunks,
        fleetState: JSON.stringify(facts),
        toolResults: localToolCalls.length
          ? JSON.stringify(
              localToolCalls.map((call) => ({
                tool: call.name,
                arguments: call.arguments,
                result: call.result,
              })),
              null,
              2,
            )
          : undefined,
        history,
      }),
      localAnswer,
      {
        onToken,
        ...(useNativeTools
          ? {
              tools: this.tools.definitions,
              executeTool: (name: string, args: unknown) => {
                const record = this.tools.execute(name, args);
                emit({ type: 'tool', call: record });
                return record;
              },
            }
          : {}),
      },
    );
  }

  private runLocalTools(
    query: string,
    emit: (event: ChatStreamEvent) => void,
  ): ToolCallRecord[] {
    return this.tools.selectLocally(query).map((planned) => {
      const record = this.tools.execute(planned.name, planned.arguments);
      emit({ type: 'tool', call: record });
      return record;
    });
  }

  private routeUsesTools(route: AiRoute): boolean {
    return (
      route === 'DATABASE_QUERY' ||
      route === 'SUMMARY' ||
      route === 'INCIDENT_SEARCH'
    );
  }

  // --------------------------------------------------------------- retrieval

  private async retrieveForRoute(
    query: string,
    decision: RouteDecision,
  ): Promise<RetrievalRun | null> {
    if (decision.route === 'GENERAL') return null;
    if (
      decision.route === 'DATABASE_QUERY' &&
      !/incident|alert|vehicle|VH-\d/i.test(query)
    ) {
      return null;
    }

    // Metadata filters are pushed into the vector store so only eligible chunks
    // are ranked, rather than ranking everything and discarding afterwards.
    const filter: Omit<VectorFilter, 'scope'> = {};
    if (decision.route === 'INCIDENT_SEARCH') {
      const severity = query
        .toLowerCase()
        .match(/\b(critical|high|medium|low)\b/)?.[1];
      if (severity) filter.severity = severity;
      const wantsResolved =
        /\bresolved\b/i.test(query) && !/\bunresolved\b/i.test(query);
      if (wantsResolved) filter.status = 'resolved';
    }

    const limit =
      decision.route === 'SUMMARY'
        ? 4
        : decision.route === 'INCIDENT_SEARCH'
          ? 6
          : 5;

    const run = await this.retrieval.retrieve(
      query,
      decision.scope,
      limit,
      filter,
    );

    return decision.route === 'INCIDENT_SEARCH'
      ? this.applyIncidentOrdering(query, run)
      : run;
  }

  /** Intent-specific ordering that relevance alone cannot express. */
  private applyIncidentOrdering(query: string, run: RetrievalRun): RetrievalRun {
    const normalized = query.toLowerCase();
    let ranked = [...run.ranked];

    if (/\b(?:sla|nearing|due|overdue)\b/.test(normalized)) {
      ranked = ranked
        .filter(
          (entry) => String(entry.chunk.metadata.status ?? '') !== 'resolved',
        )
        .sort(
          (left, right) =>
            this.slaDeadline(left.chunk) - this.slaDeadline(right.chunk),
        );
    } else if (/\b(?:highest|priority|prioriti|severity)\b/.test(normalized)) {
      const rank: Record<string, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      ranked = ranked.sort(
        (left, right) =>
          (rank[String(left.chunk.metadata.severity)] ?? 4) -
            (rank[String(right.chunk.metadata.severity)] ?? 4) ||
          right.finalScore - left.finalScore,
      );
    }

    if (/\b(?:active|open|unresolved)\b/.test(normalized)) {
      ranked = ranked.filter(
        (entry) => String(entry.chunk.metadata.status ?? '') !== 'resolved',
      );
    }

    return {
      ...run,
      ranked,
      chunks: ranked.map((entry) => entry.chunk),
      results: ranked.map((entry) => {
        const existing = run.results.find(
          (result) => result.id === entry.chunk.id,
        );
        return (
          existing ?? {
            id: entry.chunk.id,
            documentId: entry.chunk.documentId,
            title: entry.chunk.title,
            section: entry.chunk.section,
            excerpt: entry.chunk.text.slice(0, 240),
            score: entry.finalScore,
            type: entry.chunk.type,
            chunkIndex: entry.chunk.chunkIndex,
            chunkCount: entry.chunk.chunkCount,
            vectorScore: entry.vectorScore,
            lexicalScore: entry.lexicalScore,
            metadata: entry.chunk.metadata,
          }
        );
      }),
    };
  }

  private slaDeadline(chunk: IndexedChunk): number {
    const reportedAt = Date.parse(String(chunk.metadata.reportedAt ?? ''));
    const slaMinutes = Number(chunk.metadata.slaMinutes ?? 0);
    if (!Number.isFinite(reportedAt) || !Number.isFinite(slaMinutes)) {
      return Number.POSITIVE_INFINITY;
    }
    return reportedAt + slaMinutes * 60_000;
  }

  private describeRerank(run: RetrievalRun): string {
    if (run.ranked.length === 0) {
      return `No candidate cleared the ${RetrievalService.MIN_RELEVANCE_SCORE} relevance floor`;
    }
    const top = run.ranked[0] as RankedChunk;
    const documents = new Set(run.ranked.map((entry) => entry.chunk.documentId));
    return `Reranked ${run.candidatesConsidered} candidates to ${run.ranked.length} passages across ${documents.size} document(s); top vector ${top.vectorScore}, lexical ${top.lexicalScore}`;
  }

  // --------------------------------------------------------------- citations

  private selectCitations(
    ranked: readonly RankedChunk[],
    route: AiRoute,
    answer: string,
  ): Citation[] {
    if (ranked.length === 0) return [];

    // Prefer exactly what the answer cited; fall back to a relevance cut.
    const citedIds = new Set(
      [...answer.matchAll(CITATION_PATTERN)].map((match) =>
        (match[1] ?? '').toUpperCase(),
      ),
    );
    const cited = ranked.filter(
      (entry) =>
        citedIds.has(entry.chunk.id.toUpperCase()) ||
        citedIds.has(entry.chunk.documentId.toUpperCase()),
    );
    if (cited.length > 0) return cited.slice(0, 4).map(toCitation);

    const bestScore = ranked[0]?.finalScore ?? 0;
    const threshold =
      route === 'KNOWLEDGE_QUERY'
        ? Math.max(0.28, bestScore * 0.72)
        : route === 'INCIDENT_SEARCH'
          ? Math.max(0.16, bestScore * 0.5)
          : Math.max(0.2, bestScore * 0.6);

    return ranked
      .filter(
        (entry, index) =>
          route === 'INCIDENT_SEARCH' ||
          index === 0 ||
          entry.finalScore >= threshold,
      )
      .slice(0, 4)
      .map(toCitation);
  }

  /**
   * Rejects a hosted answer that cites a chunk outside the retrieved set, or
   * that states a fleet number the computed facts do not support. Either
   * failure returns the deterministic template instead.
   */
  private validateGroundedCompletion(
    completion: CompletionResult,
    route: AiRoute,
    chunks: readonly IndexedChunk[],
    localAnswer: string,
  ): CompletionResult {
    if (completion.provider === 'local') return completion;

    const reject = (): CompletionResult => ({
      text: localAnswer,
      provider: 'local',
      model: 'opspilot-grounded-template-v1',
      usedFallback: true,
      usage: completion.usage,
      toolCalls: completion.toolCalls,
    });

    // Citations must resolve to a retrieved chunk or its parent document.
    const allowedIds = new Set<string>();
    chunks.forEach((chunk) => {
      allowedIds.add(chunk.id.toUpperCase());
      allowedIds.add(chunk.documentId.toUpperCase());
    });
    const citedIds = [...completion.text.matchAll(CITATION_PATTERN)].map(
      (match) => (match[1] ?? '').toUpperCase(),
    );
    if (citedIds.some((id) => !allowedIds.has(id))) return reject();

    const requiresCitation =
      chunks.length > 0 &&
      (route === 'KNOWLEDGE_QUERY' || route === 'INCIDENT_SEARCH');
    if (requiresCitation && citedIds.length === 0) return reject();

    if (route === 'SUMMARY' && !this.numbersAreSupported(completion.text)) {
      return reject();
    }

    return completion;
  }

  /**
   * Fact-consistency check for generated summaries: every number in the text
   * must trace back to a computed fact. This is what stops a fluent briefing
   * from quietly inventing a vehicle count.
   */
  private numbersAreSupported(text: string): boolean {
    return unsupportedNumbers(text, buildAllowedNumbers(this.fleet)).length === 0;
  }

  // ------------------------------------------------------------ local answers

  private buildLocalAnswer(
    message: string,
    route: AiRoute,
    chunks: readonly IndexedChunk[],
    facts: FleetFacts,
    toolCalls: readonly ToolCallRecord[],
  ): string {
    switch (route) {
      case 'SUMMARY':
        return this.summaryAnswer();
      case 'DATABASE_QUERY':
        return this.databaseAnswer(facts, toolCalls);
      case 'INCIDENT_SEARCH':
        return this.incidentAnswer(message, chunks);
      case 'KNOWLEDGE_QUERY':
        return this.knowledgeAnswer(chunks);
      case 'GENERAL':
      default:
        return 'I can search incidents, explain approved fleet procedures, summarize the current operation, answer fleet metric questions, and classify new reports by category and severity. Try asking “What should we do about a brake overheat alert?” or “Summarize today’s top risks.”';
    }
  }

  /** Composed from computed facts and live incident records, never a fixed string. */
  private summaryAnswer(): string {
    return this.briefing.toText(this.briefing.build());
  }

  /** Renders the typed tool results. No hard-coded vehicle or metric strings. */
  private databaseAnswer(
    facts: FleetFacts,
    toolCalls: readonly ToolCallRecord[],
  ): string {
    const lines = toolCalls
      .filter((call) => !call.error)
      .map((call) => this.renderToolResult(call))
      .filter(Boolean);

    if (lines.length === 0) {
      return `Current fleet snapshot: ${facts.activeVehicles}/${facts.totalVehicles} vehicles active, ${facts.fleetAvailability}% availability, ${facts.openIncidents} unresolved incidents (${facts.criticalIncidents} critical), and ${facts.distanceTodayKm.toLocaleString('en-US')} km travelled today.`;
    }

    return `${lines.join('\n\n')}\n\nThese figures are computed directly from the vehicle and incident records.`;
  }

  private renderToolResult(call: ToolCallRecord): string {
    const result = call.result as Record<string, unknown>;

    if (call.name === 'get_fleet_metrics') {
      const facts = result as unknown as FleetFacts;
      return `Fleet: ${facts.activeVehicles} active, ${facts.idleVehicles} idle, ${facts.maintenanceVehicles} in maintenance, ${facts.offlineVehicles} offline, of ${facts.totalVehicles} total. Availability ${facts.fleetAvailability}%, utilization ${facts.utilizationRate}%. ${facts.openIncidents} unresolved incidents (${facts.criticalIncidents} critical, ${facts.highIncidents} high), ${facts.incidentsBreachingSla} past SLA. ${facts.delayedVehicles} vehicles delayed, ${facts.distanceTodayKm.toLocaleString('en-US')} km today.`;
    }

    if (call.name === 'count_vehicles') {
      const count = Number(result.count ?? 0);
      const total = Number(result.total ?? 0);
      const share = Number(result.percentageOfFleet ?? 0);
      return `${count} of ${total} vehicles match that filter (${share}% of the fleet).`;
    }

    if (call.name === 'list_incidents') {
      const incidents = Array.isArray(result.incidents) ? result.incidents : [];
      if (incidents.length === 0) return 'No incidents match that filter.';
      const rows = incidents
        .map((raw) => {
          const incident = raw as Record<string, unknown>;
          return `- [${String(incident.id)}] ${String(incident.title)} — ${String(incident.vehicleId)}, ${String(incident.severity)}, ${String(incident.status)}.`;
        })
        .join('\n');
      return `${incidents.length} matching incident(s):\n${rows}`;
    }

    if (call.name === 'get_vehicle') {
      if (result.found !== true) {
        const vehicleId =
          typeof result.vehicleId === 'string' ? result.vehicleId : 'that vehicle';
        return `No record exists for ${vehicleId}.`;
      }
      const vehicle = result.vehicle as Record<string, unknown>;
      const open = Array.isArray(result.openIncidents) ? result.openIncidents : [];
      return `${String(vehicle.id)} is ${String(vehicle.status)} at ${String(vehicle.depot)}, ${String(vehicle.distanceTodayKm)} km today, ${String(vehicle.delayMinutes)} minutes behind schedule. ${open.length} open incident(s).`;
    }

    if (call.name === 'get_sla_risk') {
      const breaching = Array.isArray(result.breaching) ? result.breaching : [];
      const dueSoon = Array.isArray(result.dueSoon) ? result.dueSoon : [];
      if (breaching.length === 0 && dueSoon.length === 0) {
        return 'No open incident is past or near its SLA target.';
      }
      const parts: string[] = [];
      if (breaching.length > 0) {
        parts.push(
          `Past SLA: ${breaching
            .map((raw) => {
              const entry = raw as Record<string, unknown>;
              return `[${String(entry.id)}] ${String(entry.vehicleId)} by ${String(entry.minutesOverdue)} min`;
            })
            .join('; ')}.`,
        );
      }
      if (dueSoon.length > 0) {
        parts.push(
          `Due soon: ${dueSoon
            .map((raw) => {
              const entry = raw as Record<string, unknown>;
              return `[${String(entry.id)}] ${String(entry.vehicleId)} in ${String(entry.minutesRemaining)} min`;
            })
            .join('; ')}.`,
        );
      }
      return parts.join(' ');
    }

    return '';
  }

  private incidentAnswer(
    message: string,
    chunks: readonly IndexedChunk[],
  ): string {
    const incidents = chunks
      .filter((chunk) => chunk.type === 'incident')
      .slice(0, 4);
    if (incidents.length === 0) {
      return 'I did not find a matching incident. Try a vehicle ID, incident ID, severity, location, or system such as brakes or reefer.';
    }

    const asksForSla = /\b(?:sla|nearing|due|overdue)\b/i.test(message);
    const asksForActions =
      /\b(?:recommend|next actions?|response plan|what should|priority order)\b/i.test(
        message,
      );

    const lines = incidents.map((incident) => {
      const vehicle = String(incident.metadata.vehicleId ?? 'vehicle unknown');
      const severity = String(incident.metadata.severity ?? 'unrated');
      const status = String(incident.metadata.status ?? 'unknown');
      const summary = `- [${incident.id}] ${incident.title} — ${vehicle}, ${severity}, ${status}`;
      if (asksForSla) return `${summary}; ${this.slaLabel(incident)}.`;
      if (!asksForActions) return `${summary}.`;
      const action = String(
        incident.metadata.recommendedAction ??
          'Review the cited incident and assign the accountable operator.',
      );
      return `${summary}.\n  Next action: ${action}`;
    });

    const heading =
      incidents.length === 1
        ? 'Here is the highest-ranked matching incident:'
        : `Here are the ${incidents.length} highest-ranked matching incidents:`;
    return `${heading}\n\n${lines.join('\n')}\n\nOpen the cited incident before taking action; telemetry and status may have changed.`;
  }

  private slaLabel(chunk: IndexedChunk): string {
    const deadline = this.slaDeadline(chunk);
    if (!Number.isFinite(deadline)) return 'SLA target unavailable';
    const differenceMinutes = Math.round((deadline - Date.now()) / 60_000);
    return differenceMinutes < 0
      ? `SLA overdue by ${Math.abs(differenceMinutes)} minutes`
      : `SLA due in ${differenceMinutes} minutes`;
  }

  private knowledgeAnswer(chunks: readonly IndexedChunk[]): string {
    const source =
      chunks.find((chunk) => chunk.type === 'knowledge') ?? chunks[0];
    if (!source) {
      return 'I could not find an approved procedure for that question. Escalate to the accountable operations team and do not infer a safety or compliance exception.';
    }
    const sentences = source.text.match(/[^.!?]+[.!?]+/g) ?? [source.text];
    const guidance = sentences.slice(0, 4).join(' ').trim();
    return `According to ${source.title}, ${source.section} [${source.id}]:\n\n${guidance}\n\nReview the cited procedure and current telemetry. Any critical safety or security decision still requires the designated supervisor or specialist.`;
  }

  private openIncidentSummaries(): Record<string, unknown>[] {
    return this.fleet.listIncidents({ unresolvedOnly: true }).map((incident) => ({
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      vehicleId: incident.vehicleId,
      recommendedAction: incident.recommendedAction,
    }));
  }

  private followUps(route: AiRoute): string[] {
    const prompts: Record<AiRoute, string[]> = {
      KNOWLEDGE_QUERY: [
        'Show related open incidents',
        'What requires supervisor approval?',
        'Summarize this as a driver checklist',
      ],
      INCIDENT_SEARCH: [
        'Summarize the highest-severity incident',
        'Show the relevant procedure',
        'Which incidents are nearing SLA?',
      ],
      SUMMARY: [
        'Show critical incidents',
        'Which incidents are past SLA?',
        'List today’s supervisor actions',
      ],
      DATABASE_QUERY: [
        'How many incidents are unresolved?',
        'What is fleet availability?',
        'Summarize the current fleet state',
      ],
      GENERAL: [
        'Summarize today’s operation',
        'Search brake-related incidents',
        'Classify a new report',
      ],
    };
    return prompts[route];
  }
}

function toCitation(entry: RankedChunk): Citation {
  return {
    id: entry.chunk.id,
    documentId: entry.chunk.documentId,
    title: entry.chunk.title,
    section: entry.chunk.section,
    excerpt: entry.chunk.text.slice(0, 240),
    score: entry.finalScore,
    type: entry.chunk.type,
  };
}

function duration(startedAt: number): number {
  return Math.max(1, Math.round(performance.now() - startedAt));
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
