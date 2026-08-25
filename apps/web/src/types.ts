export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type IncidentStatus = 'open' | 'investigating' | 'monitoring' | 'resolved';

export interface FleetMetric {
  label: string;
  value: string;
  detail: string;
  trend?: number;
  tone: 'indigo' | 'cyan' | 'amber' | 'red';
}

export interface RegionStatus {
  id: string;
  name: string;
  vehicles: number;
  online: number;
  incidents: number;
  x: number;
  y: number;
}

export interface ActivityItem {
  id: string;
  title: string;
  detail: string;
  time: string;
  kind: 'incident' | 'ai' | 'document' | 'resolved';
}

export interface OverviewData {
  metrics: FleetMetric[];
  regions: RegionStatus[];
  activity: ActivityItem[];
  aiSummary: string;
  generatedAt: string;
  dailyBrief: {
    greeting: string;
    headline: string;
    priorities: string[];
  };
  fleetStatus: {
    active: number;
    idle: number;
    maintenance: number;
    offline: number;
    total: number;
  };
  aiHealth: {
    status: string;
    provider: string;
    indexedDocuments: number;
    indexedChunks: number;
    embeddingModel: string;
    generationModel: string;
    promptVersion: string;
    averageLatencyMs: number;
    totalRuns: number;
    groundedRate: number;
    totalCostUsd: number;
  };
}

/** Events emitted by POST /api/ai/chat/stream. */
export type ChatStreamEvent =
  | { type: 'route'; route: string; confidence: number; reason: string }
  | { type: 'retrieval'; candidatesConsidered: number; chunksRetrieved: number }
  | { type: 'tool'; call: ToolCall }
  | { type: 'token'; text: string }
  | { type: 'done'; response: ChatResponse }
  | { type: 'error'; message: string };

export interface Incident {
  id: string;
  title: string;
  summary: string;
  status: IncidentStatus;
  severity: Severity;
  category: string;
  assetId: string;
  location: string;
  reportedAt: string;
  updatedAt: string;
  confidence?: number;
  sentiment?: string;
  assignee?: string;
  slaMinutes?: number;
  tags: string[];
  recommendedAction: string;
}

export interface KnowledgeDocument {
  id: string;
  documentId?: string;
  title: string;
  excerpt: string;
  category: string;
  source: string;
  updatedAt: string;
  chunks: number;
  status: 'indexed' | 'processing';
  score?: number;
  /** Dense similarity component of the score. */
  vectorScore?: number;
  /** BM25 component of the score. */
  lexicalScore?: number;
  chunkIndex?: number;
  chunkCount?: number;
  metadata?: Record<string, string>;
}

export interface Citation {
  id: string;
  /** Parent document; several chunks can cite the same one. */
  documentId?: string;
  title: string;
  excerpt?: string;
  score?: number;
  source?: string;
  section?: string;
  type?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  estimated: boolean;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  error?: string;
}

export interface RetrievalTraceStep {
  label: string;
  detail: string;
  durationMs?: number;
  status?: 'complete' | 'active' | 'fallback' | 'skipped';
}

export interface RetrievalTrace {
  steps: RetrievalTraceStep[];
  /** Candidates the vector stage returned before reranking. */
  candidatesConsidered: number;
  chunksRetrieved: number;
  embeddingModel: string;
  generationModel: string;
  promptVersion: string;
  turnsInContext: number;
}

export interface ChatResponse {
  sessionId: string;
  answer: string;
  route: string;
  confidence: number;
  provider: string;
  latencyMs: number;
  citations: Citation[];
  toolCalls: ToolCall[];
  usage: TokenUsage;
  trace: RetrievalTrace;
  followUps: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  response?: ChatResponse;
  pending?: boolean;
  /** True while server-sent tokens are still arriving for this message. */
  streaming?: boolean;
}

export interface ClassificationResult {
  category: string;
  subcategory?: string;
  severity: Severity;
  confidence: number;
  sentiment: string;
  summary: string;
  suggestedTags: string[];
  recommendedAction: string;
  provider?: string;
  requiresSupervisor?: boolean;
}

export interface ApiResult<T> {
  data: T;
  source: 'live' | 'demo';
}
