export type AiRoute =
  | 'KNOWLEDGE_QUERY'
  | 'INCIDENT_SEARCH'
  | 'SUMMARY'
  | 'DATABASE_QUERY'
  | 'GENERAL';

export type SearchScope = 'all' | 'incidents' | 'knowledge';
export type RetrievalType = 'incident' | 'knowledge';
export type AiProviderName = 'local' | 'openai' | 'aws';

export type ChunkMetadataValue = string | number | boolean | string[];

/** A retrievable passage. Documents are split into several of these. */
export interface IndexedChunk {
  /** Stable composite id, for example `KB-SAF-001#2`. */
  id: string;
  /** Parent document id, for example `KB-SAF-001`. */
  documentId: string;
  title: string;
  section: string;
  text: string;
  type: RetrievalType;
  chunkIndex: number;
  chunkCount: number;
  metadata: Record<string, ChunkMetadataValue>;
}

export interface VectorRecord {
  chunk: IndexedChunk;
  vector: readonly number[];
}

export interface VectorFilter {
  scope?: SearchScope;
  category?: string;
  severity?: string;
  status?: string;
  documentId?: string;
}

export interface VectorMatch {
  chunk: IndexedChunk;
  /** Cosine similarity from the vector stage only. */
  score: number;
}

/** A candidate after the second-stage reranker has scored it. */
export interface RankedChunk {
  chunk: IndexedChunk;
  vectorScore: number;
  lexicalScore: number;
  fieldScore: number;
  rerankScore: number;
  /** Score after diversity selection; this is what the API reports. */
  finalScore: number;
}

export interface Citation {
  id: string;
  documentId: string;
  title: string;
  section: string;
  excerpt: string;
  score: number;
  type: RetrievalType;
}

export interface SearchResult extends Citation {
  chunkIndex: number;
  chunkCount: number;
  vectorScore: number;
  lexicalScore: number;
  metadata: Record<string, ChunkMetadataValue>;
}

export interface RetrievalResponse {
  query: string;
  results: SearchResult[];
  embeddingModel: string;
  candidatesConsidered: number;
  latencyMs: number;
}

export interface RetrievalRun extends RetrievalResponse {
  provider: AiProviderName;
  usedFallback: boolean;
  chunks: IndexedChunk[];
  ranked: RankedChunk[];
  vectorLatencyMs: number;
  rerankLatencyMs: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  /** True when counted with a local tokenizer instead of provider-reported. */
  estimated: boolean;
}

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  error?: string;
}

export interface TraceStep {
  label: string;
  detail: string;
  durationMs: number;
  status: 'complete' | 'fallback' | 'skipped';
}

export interface ChatResponse {
  sessionId: string;
  answer: string;
  route: AiRoute;
  confidence: number;
  provider: AiProviderName;
  latencyMs: number;
  citations: Citation[];
  toolCalls: ToolCallRecord[];
  usage: TokenUsage;
  trace: {
    steps: TraceStep[];
    candidatesConsidered: number;
    chunksRetrieved: number;
    embeddingModel: string;
    generationModel: string;
    promptVersion: string;
    turnsInContext: number;
  };
  followUps: string[];
}

export interface ClassificationResult {
  category: string;
  subcategory: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  requiresSupervisor: boolean;
  confidence: number;
  rationale: string;
  recommendedAction: string;
  provider: AiProviderName;
  promptVersion: string;
  usage: TokenUsage;
}

export interface EmbeddingBatch {
  vectors: number[][];
  provider: AiProviderName;
  model: string;
  dimensions: number;
  usedFallback: boolean;
  usage: TokenUsage;
}

export interface CompletionResult {
  text: string;
  provider: AiProviderName;
  model: string;
  usedFallback: boolean;
  usage: TokenUsage;
  toolCalls: ToolCallRecord[];
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  route?: AiRoute;
}

/** Streaming events emitted over server-sent events by `POST /api/ai/chat/stream`. */
export type ChatStreamEvent =
  | { type: 'route'; route: AiRoute; confidence: number; reason: string }
  | { type: 'retrieval'; candidatesConsidered: number; chunksRetrieved: number }
  | { type: 'tool'; call: ToolCallRecord }
  | { type: 'token'; text: string }
  | { type: 'done'; response: ChatResponse }
  | { type: 'error'; message: string };
