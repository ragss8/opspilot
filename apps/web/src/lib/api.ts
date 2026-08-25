import {
  seededChat,
  seededClassification,
  seededDocuments,
  seededIncidents,
  seededOverview,
  seededSearch,
} from '../data/seed';
import type {
  ApiResult,
  ChatResponse,
  ChatStreamEvent,
  ClassificationResult,
  Incident,
  KnowledgeDocument,
  OverviewData,
  RetrievalTraceStep,
  ToolCall,
} from '../types';

const API_BASE = '/api';
const TIMEOUT_MS = 7_500;

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function withFallback<T>(operation: () => Promise<T>, fallback: () => T): Promise<ApiResult<T>> {
  try {
    return { data: await operation(), source: 'live' };
  } catch {
    return { data: fallback(), source: 'demo' };
  }
}

function normalizeOverview(payload: unknown): OverviewData {
  const root = asRecord(payload);
  const candidate = asRecord(root.data ?? root.overview ?? root);
  const metricsValue = candidate.metrics ?? candidate.kpis;
  const rawMetrics = asArray(metricsValue);
  const metricObject = asRecord(metricsValue);
  const rawRegions = asArray(candidate.regions ?? candidate.fleetStatus);
  const rawActivity = asArray(candidate.activity ?? candidate.recentActivity ?? candidate.incidentFeed);
  const dailyBrief = asRecord(candidate.dailyBrief);
  const fleetStatus = asRecord(candidate.fleetStatus);
  const aiHealth = asRecord(candidate.aiHealth);
  const totalVehicles = numberOr(metricObject.totalVehicles, seededOverview.fleetStatus.total);
  const activeVehicles = numberOr(metricObject.activeVehicles, seededOverview.fleetStatus.active);
  const liveRegions = buildLiveRegions(totalVehicles);
  const liveMetricCards = Object.keys(metricObject).length > 0
    ? [
        {
          label: 'Active fleet',
          value: activeVehicles.toLocaleString(),
          detail: `of ${totalVehicles.toLocaleString()} vehicles active`,
          tone: 'indigo' as const,
        },
        {
          label: 'Open incidents',
          value: numberOr(metricObject.openIncidents, 0).toLocaleString(),
          detail: `${numberOr(metricObject.criticalIncidents, 0)} critical exceptions`,
          tone: 'red' as const,
        },
        {
          label: 'Fleet availability',
          value: `${numberOr(metricObject.fleetAvailability, 0).toFixed(1)}%`,
          detail: `${numberOr(metricObject.distanceTodayKm, 0).toLocaleString()} km traveled today`,
          trend: 0.2,
          tone: 'cyan' as const,
        },
        {
          label: 'Grounded answers',
          value: `${numberOr(metricObject.groundedAnswerRate ?? metricObject.aiDeflectionRate, 0).toFixed(1)}%`,
          detail: `${numberOr(aiHealth.totalRuns, 0)} AI runs · ${numberOr(aiHealth.averageLatencyMs, 0)} ms average`,
          tone: 'amber' as const,
        },
      ]
    : null;

  return {
    metrics:
      rawMetrics.length > 0
        ? rawMetrics.map((item, index) => {
            const metric = asRecord(item);
            const seeded = seededOverview.metrics[index % seededOverview.metrics.length]!;
            const rawTone = stringOr(metric.tone, seeded.tone);
            const tone = ['indigo', 'cyan', 'amber', 'red'].includes(rawTone) ? (rawTone as typeof seeded.tone) : seeded.tone;
            return {
              label: stringOr(metric.label ?? metric.name, seeded.label),
              value: stringOr(metric.value, seeded.value),
              detail: stringOr(metric.detail ?? metric.description, seeded.detail),
              trend: metric.trend === undefined ? seeded.trend : numberOr(metric.trend, 0),
              tone,
            };
          })
        : liveMetricCards ?? seededOverview.metrics,
    regions:
      rawRegions.length > 0
        ? rawRegions.map((item, index) => {
            const region = asRecord(item);
            const seeded = seededOverview.regions[index % seededOverview.regions.length]!;
            return {
              id: stringOr(region.id, seeded.id),
              name: stringOr(region.name, seeded.name),
              vehicles: numberOr(region.vehicles ?? region.total, seeded.vehicles),
              online: numberOr(region.online ?? region.onlinePercent, seeded.online),
              incidents: numberOr(region.incidents ?? region.alerts, seeded.incidents),
              x: numberOr(region.x, seeded.x),
              y: numberOr(region.y, seeded.y),
            };
          })
        : Object.keys(metricObject).length > 0 ? liveRegions : seededOverview.regions,
    activity:
      rawActivity.length > 0
        ? rawActivity.map((item, index) => {
            const activity = asRecord(item);
            const seeded = seededOverview.activity[index % seededOverview.activity.length]!;
            const kind = stringOr(activity.kind ?? activity.type, seeded.kind);
            return {
              id: stringOr(activity.id, seeded.id),
              title: stringOr(activity.title, seeded.title),
              detail: stringOr(activity.detail ?? activity.description, `${stringOr(activity.vehicleId, 'Fleet asset')} · ${stringOr(activity.location, 'Network')}`),
              time: relativeTimestamp(activity.time ?? activity.timestamp ?? activity.reportedAt, seeded.time),
              kind: activity.status === 'resolved' ? 'resolved' : ['incident', 'ai', 'document', 'resolved'].includes(kind) ? (kind as typeof seeded.kind) : 'incident',
            };
          })
        : seededOverview.activity,
    aiSummary: stringOr(candidate.aiSummary ?? candidate.summary ?? dailyBrief.summary, seededOverview.aiSummary),
    generatedAt: stringOr(candidate.generatedAt ?? candidate.updatedAt, new Date().toISOString()),
    dailyBrief: {
      greeting: stringOr(dailyBrief.greeting, seededOverview.dailyBrief.greeting),
      headline: stringOr(dailyBrief.headline, seededOverview.dailyBrief.headline),
      priorities: asArray(dailyBrief.priorities).length > 0 ? asArray(dailyBrief.priorities).map(String) : seededOverview.dailyBrief.priorities,
    },
    fleetStatus: {
      active: numberOr(fleetStatus.active, activeVehicles),
      idle: numberOr(fleetStatus.idle, seededOverview.fleetStatus.idle),
      maintenance: numberOr(fleetStatus.maintenance, seededOverview.fleetStatus.maintenance),
      offline: numberOr(fleetStatus.offline, seededOverview.fleetStatus.offline),
      total: totalVehicles,
    },
    aiHealth: {
      status: stringOr(aiHealth.status, seededOverview.aiHealth.status),
      provider: stringOr(aiHealth.activeProvider ?? aiHealth.configuredProvider, seededOverview.aiHealth.provider),
      indexedDocuments: numberOr(aiHealth.indexedDocuments, seededOverview.aiHealth.indexedDocuments),
      indexedChunks: numberOr(aiHealth.indexedChunks, seededOverview.aiHealth.indexedChunks),
      embeddingModel: stringOr(aiHealth.embeddingModel, seededOverview.aiHealth.embeddingModel),
      generationModel: stringOr(aiHealth.generationModel, seededOverview.aiHealth.generationModel),
      promptVersion: stringOr(aiHealth.promptVersion, seededOverview.aiHealth.promptVersion),
      averageLatencyMs: numberOr(aiHealth.averageLatencyMs, seededOverview.aiHealth.averageLatencyMs),
      totalRuns: numberOr(aiHealth.totalRuns, seededOverview.aiHealth.totalRuns),
      groundedRate: numberOr(aiHealth.groundedRate, seededOverview.aiHealth.groundedRate),
      totalCostUsd: numberOr(aiHealth.totalCostUsd, seededOverview.aiHealth.totalCostUsd),
    },
  };
}

function buildLiveRegions(total: number): OverviewData['regions'] {
  const templates = [
    { id: 'north', name: 'North Hub', share: 0.192, online: 98, incidents: 2, x: 51, y: 19 },
    { id: 'west', name: 'West Hub', share: 0.234, online: 96, incidents: 2, x: 19, y: 46 },
    { id: 'central', name: 'Central Hub', share: 0.218, online: 99, incidents: 1, x: 51, y: 49 },
    { id: 'east', name: 'East Hub', share: 0.183, online: 97, incidents: 2, x: 81, y: 42 },
    { id: 'south', name: 'South Hub', share: 0.173, online: 99, incidents: 1, x: 55, y: 79 },
  ];
  let assigned = 0;
  return templates.map((region, index) => {
    const vehicles = index === templates.length - 1 ? total - assigned : Math.round(total * region.share);
    assigned += vehicles;
    return { ...region, vehicles };
  });
}

function relativeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} hr ago` : `${Math.round(hours / 24)} d ago`;
}

function normalizeIncident(item: unknown, index: number): Incident {
  const incident = asRecord(item);
  const seeded = seededIncidents[index % seededIncidents.length]!;
  const rawSeverity = stringOr(incident.severity, seeded.severity).toLowerCase();
  const rawStatus = stringOr(incident.status, seeded.status).toLowerCase();
  return {
    id: stringOr(incident.id ?? incident.incidentId, seeded.id),
    title: stringOr(incident.title ?? incident.name, seeded.title),
    summary: stringOr(incident.summary ?? incident.description, seeded.summary),
    status: ['open', 'investigating', 'monitoring', 'resolved'].includes(rawStatus) ? (rawStatus as Incident['status']) : seeded.status,
    severity: ['critical', 'high', 'medium', 'low'].includes(rawSeverity) ? (rawSeverity as Incident['severity']) : seeded.severity,
    category: stringOr(incident.category ?? incident.classification, seeded.category),
    assetId: stringOr(incident.assetId ?? incident.vehicleId ?? incident.asset, seeded.assetId),
    location: stringOr(incident.location, seeded.location),
    reportedAt: stringOr(incident.reportedAt ?? incident.createdAt, seeded.reportedAt),
    updatedAt: stringOr(incident.updatedAt, stringOr(incident.reportedAt ?? incident.createdAt, seeded.reportedAt)),
    confidence: incident.confidence === undefined && incident.classificationConfidence === undefined
      ? undefined
      : numberOr(incident.confidence ?? incident.classificationConfidence, 0),
    sentiment: typeof incident.sentiment === 'string' ? incident.sentiment : undefined,
    assignee: typeof incident.assignee === 'string' ? incident.assignee : undefined,
    slaMinutes: incident.slaMinutes === undefined ? undefined : numberOr(incident.slaMinutes, 0),
    tags: asArray(incident.tags).length > 0 ? asArray(incident.tags).map(String) : seeded.tags,
    recommendedAction: stringOr(incident.recommendedAction ?? incident.action, seeded.recommendedAction),
  };
}

function normalizeDocument(item: unknown, index: number): KnowledgeDocument {
  const document = asRecord(item);
  const seeded = seededDocuments[index % seededDocuments.length]!;
  const metadata = asRecord(document.metadata);
  const status = stringOr(document.status, seeded.status);
  return {
    id: stringOr(document.id ?? document.documentId, seeded.id),
    title: stringOr(document.title ?? document.name, seeded.title),
    excerpt: stringOr(document.excerpt ?? document.content ?? document.summary, seeded.excerpt),
    category: stringOr(document.category ?? metadata.category ?? document.type, seeded.category),
    source: stringOr(document.source ?? document.owner ?? metadata.owner, seeded.source),
    updatedAt: stringOr(document.updatedAt ?? document.indexedAt ?? metadata.updatedAt, seeded.updatedAt),
    chunks: numberOr(document.chunks ?? document.chunkCount, document.content ? Math.max(1, Math.ceil(String(document.content).length / 900)) : 1),
    status: status === 'processing' ? 'processing' : 'indexed',
    documentId: typeof document.documentId === 'string' ? document.documentId : undefined,
    score: document.score === undefined ? undefined : numberOr(document.score, 0),
    vectorScore: document.vectorScore === undefined ? undefined : numberOr(document.vectorScore, 0),
    lexicalScore: document.lexicalScore === undefined ? undefined : numberOr(document.lexicalScore, 0),
    chunkIndex: document.chunkIndex === undefined ? undefined : numberOr(document.chunkIndex, 0),
    chunkCount: document.chunkCount === undefined ? undefined : numberOr(document.chunkCount, 0),
    metadata: Object.fromEntries(Object.entries({ ...metadata, owner: document.owner, version: document.version, section: document.section, readTime: document.readTimeMinutes ? `${document.readTimeMinutes} min` : undefined }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])),
  };
}

function normalizeChat(payload: unknown): ChatResponse {
  const root = asRecord(payload);
  const response = asRecord(root.data ?? root);
  const rawCitations = asArray(response.citations ?? response.sources);
  const traceValue = response.trace ?? response.retrievalTrace;
  const traceObject = asRecord(traceValue);
  const rawTrace = Array.isArray(traceValue) ? traceValue : asArray(traceObject.steps);
  const usage = asRecord(response.usage);
  return {
    sessionId: stringOr(response.sessionId, ''),
    answer: stringOr(response.answer ?? response.message, 'I found relevant context, but the response was empty. Please try again.'),
    route: stringOr(response.route, 'rag.fleet-operations'),
    confidence: numberOr(response.confidence, 0.85),
    provider: stringOr(response.provider ?? response.model, 'OpsPilot AI'),
    latencyMs: numberOr(response.latencyMs ?? response.latency, 0),
    citations: rawCitations.map((item, index) => {
      const citation = asRecord(item);
      return {
        id: stringOr(citation.id, `citation-${index + 1}`),
        documentId: stringOr(citation.documentId, stringOr(citation.id, '')),
        title: stringOr(citation.title ?? citation.name, `Source ${index + 1}`),
        excerpt: stringOr(citation.excerpt ?? citation.snippet, ''),
        score: citation.score === undefined ? undefined : numberOr(citation.score, 0),
        source: stringOr(citation.source ?? citation.type, ''),
        section: stringOr(citation.section, ''),
        type: stringOr(citation.type, ''),
      };
    }),
    trace: {
      steps: rawTrace.map((item, index): RetrievalTraceStep => {
        if (typeof item === 'string') return { label: `Step ${index + 1}`, detail: item, status: 'complete' };
        const step = asRecord(item);
        return {
          label: stringOr(step.label ?? step.name ?? step.step, `Step ${index + 1}`),
          detail: stringOr(step.detail ?? step.description, 'Completed'),
          durationMs: step.durationMs === undefined ? undefined : numberOr(step.durationMs, 0),
          status: ['active', 'fallback', 'skipped'].includes(String(step.status))
            ? (step.status as RetrievalTraceStep['status'])
            : 'complete',
        };
      }),
      candidatesConsidered: numberOr(traceObject.candidatesConsidered, 0),
      chunksRetrieved: numberOr(traceObject.chunksRetrieved ?? response.chunksRetrieved, rawCitations.length),
      embeddingModel: stringOr(traceObject.embeddingModel ?? response.embeddingModel, 'Embedding model'),
      generationModel: stringOr(traceObject.generationModel ?? response.generationModel ?? response.model, stringOr(response.provider, 'Generation model')),
      promptVersion: stringOr(traceObject.promptVersion, 'unversioned'),
      turnsInContext: numberOr(traceObject.turnsInContext, 0),
    },
    toolCalls: asArray(response.toolCalls).map((item): ToolCall => {
      const call = asRecord(item);
      return {
        name: stringOr(call.name, 'tool'),
        arguments: asRecord(call.arguments),
        result: call.result,
        durationMs: numberOr(call.durationMs, 0),
        error: typeof call.error === 'string' ? call.error : undefined,
      };
    }),
    usage: {
      inputTokens: numberOr(usage.inputTokens, 0),
      outputTokens: numberOr(usage.outputTokens, 0),
      totalTokens: numberOr(usage.totalTokens, 0),
      costUsd: numberOr(usage.costUsd, 0),
      estimated: usage.estimated !== false,
    },
    followUps: asArray(response.followUps ?? response.suggestedQuestions).map(String),
  };
}

export const api = {
  overview: () => withFallback(async () => normalizeOverview(await request('/overview')), () => seededOverview),

  incidents: () =>
    withFallback(
      async () => {
        const payload = await request('/incidents');
        const root = asRecord(payload);
        const items = asArray(root.data ?? root.items ?? root.incidents ?? payload);
        if (items.length === 0) throw new Error('No incidents returned');
        return items.map(normalizeIncident);
      },
      () => seededIncidents,
    ),

  documents: () =>
    withFallback(
      async () => {
        const payload = await request('/documents');
        const root = asRecord(payload);
        const items = asArray(root.data ?? root.items ?? root.documents ?? payload);
        if (items.length === 0) throw new Error('No documents returned');
        return items.map(normalizeDocument);
      },
      () => seededDocuments,
    ),

  health: async (): Promise<{ indexedChunks: number; provider: string } | null> => {
    try {
      const payload = asRecord(await request('/health'));
      const ai = asRecord(payload.ai);
      const index = asRecord(ai.index);
      return {
        indexedChunks: numberOr(index.chunks, 0),
        provider: stringOr(ai.provider, 'local'),
      };
    } catch {
      return null;
    }
  },

  chat: (message: string, sessionId?: string) =>
    withFallback(
      async () =>
        normalizeChat(
          await request('/ai/chat', {
            method: 'POST',
            body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
          }),
        ),
      () => seededChat(message),
    ),

  /**
   * Streams an answer over server-sent events. Falls back to the buffered
   * endpoint when streaming is unavailable, so the UI has one code path.
   */
  streamChat: async (
    message: string,
    sessionId: string | undefined,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<ApiResult<ChatResponse>> => {
    try {
      const response = await fetch(`${API_BASE}/ai/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
      });
      if (!response.ok || !response.body) throw new Error(`Stream returned ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let final: ChatResponse | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; keep any partial tail.
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
          if (!line) continue;
          let event: ChatStreamEvent;
          try {
            event = JSON.parse(line.slice(6)) as ChatStreamEvent;
          } catch {
            continue;
          }
          if (event.type === 'done') final = normalizeChat(event.response);
          else onEvent(event);
        }
      }

      if (!final) throw new Error('Stream ended without a final response');
      onEvent({ type: 'done', response: final });
      return { data: final, source: 'live' };
    } catch {
      // Buffered request first, seeded preview only if that fails too.
      return api.chat(message, sessionId);
    }
  },

  resetSession: async (sessionId: string): Promise<void> => {
    try {
      await request(`/ai/session/${sessionId}`, { method: 'DELETE' });
    } catch {
      // A failed reset is not worth surfacing; the next turn starts fresh anyway.
    }
  },

  search: (query: string, scope: string) =>
    withFallback(
      async () => {
        // 'all' searches both stores; anything else is a category filter applied
        // client-side, so the API scope stays 'all' rather than always 'knowledge'.
        const params = new URLSearchParams({ q: query, scope: 'all' });
        const payload = await request(`/ai/search?${params.toString()}`);
        const root = asRecord(payload);
        const items = asArray(root.data ?? root.results ?? root.documents ?? payload);
        if (items.length === 0) return [];
        const normalized = items.map(normalizeDocument);
        return scope === 'all' ? normalized : normalized.filter((document) => document.category.toLowerCase() === scope.toLowerCase());
      },
      () => seededSearch(query, scope),
    ),

  classify: (text: string) =>
    withFallback(
      async (): Promise<ClassificationResult> => {
        const payload = asRecord(await request('/ai/classify', { method: 'POST', body: JSON.stringify({ text }) }));
        const result = asRecord(payload.data ?? payload);
        const rawSeverity = stringOr(result.severity, 'medium').toLowerCase();
        return {
          category: stringOr(result.category ?? result.classification, 'Operations'),
          subcategory: stringOr(result.subcategory, ''),
          severity: ['critical', 'high', 'medium', 'low'].includes(rawSeverity)
            ? (rawSeverity as ClassificationResult['severity'])
            : 'medium',
          confidence: numberOr(result.confidence, 0.85),
          sentiment: stringOr(result.sentiment, result.requiresSupervisor ? 'supervisor review' : 'neutral'),
          summary: stringOr(result.summary ?? result.rationale, text),
          suggestedTags: asArray(result.suggestedTags ?? result.tags).length > 0
            ? asArray(result.suggestedTags ?? result.tags).map(String)
            : [stringOr(result.subcategory, stringOr(result.category, 'operations')).toLowerCase().replaceAll(' ', '-'), rawSeverity],
          recommendedAction: stringOr(result.recommendedAction ?? result.action, 'Review and assign to the appropriate operations queue.'),
          provider: stringOr(result.provider ?? result.model, 'OpsPilot AI'),
          requiresSupervisor: Boolean(result.requiresSupervisor),
        };
      },
      () => seededClassification(text),
    ),
};
