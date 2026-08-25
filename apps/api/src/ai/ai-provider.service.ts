import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
  type ContentBlock,
  type Message,
  type Tool,
  type ToolResultContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { Injectable, Logger } from '@nestjs/common';
import type {
  CompletionResult,
  EmbeddingBatch,
  ToolCallRecord,
} from './ai.types';
import { LocalEmbeddingService } from './local-embedding.service';
import type { ToolDefinition } from './tools/fleet-tools.service';
import { buildUsage, countTokens, EMPTY_USAGE, estimateUsage } from './usage';

interface OpenAiClient {
  responses: {
    create(body: Record<string, unknown>): Promise<unknown>;
  };
}

/**
 * The SDK models tool schemas and tool results as an open recursive JSON
 * document. Deriving the type from the SDK's own union keeps that detail here
 * rather than adding a direct dependency on @smithy/types.
 */
type BedrockDocument = Extract<ToolResultContentBlock, { json: unknown }>['json'];

type ProviderMode = 'local' | 'openai' | 'aws';
type TitanEmbeddingDimensions = 256 | 512 | 1024;

export type ToolExecutor = (
  name: string,
  args: unknown,
) => ToolCallRecord | Promise<ToolCallRecord>;

export interface CompleteOptions {
  tools?: readonly ToolDefinition[];
  executeTool?: ToolExecutor;
  onToken?: (text: string) => void;
  maxToolRounds?: number;
}

const DEFAULT_TITAN_EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
const DEFAULT_TITAN_EMBEDDING_DIMENSIONS = 1024;
const LOCAL_GENERATION_MODEL = 'opspilot-grounded-template-v1';
const MAX_TOOL_ROUNDS = 3;

/**
 * One boundary for all model I/O.
 *
 * OpenAI embeddings use LangChain's OpenAIEmbeddings adapter and generation
 * uses the Responses API with function tools. AWS generation uses Bedrock
 * Converse with its tool configuration, while embeddings use Titan Text
 * Embeddings V2 through InvokeModel. Provider failures fall back to the
 * deterministic local implementation when configuration allows it.
 *
 * SDK types stop here. Nothing above this class sees a provider type.
 */
@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);
  private openAiClient?: OpenAiClient;
  private bedrockClient?: BedrockRuntimeClient;

  constructor(private readonly localEmbeddings: LocalEmbeddingService) {}

  get mode(): ProviderMode {
    const requested = process.env.AI_PROVIDER?.trim().toLowerCase();
    if (requested === 'openai' && this.hasValue(process.env.OPENAI_API_KEY)) {
      return 'openai';
    }
    if (
      requested === 'aws' &&
      this.hasValue(process.env.AWS_REGION) &&
      this.hasValue(process.env.AWS_BEDROCK_MODEL_ID)
    ) {
      return 'aws';
    }
    return 'local';
  }

  get isRemoteEnabled(): boolean {
    return this.mode !== 'local';
  }

  /** Hosted providers run the tool loop themselves; local mode is rule-driven. */
  get supportsNativeTools(): boolean {
    return this.mode !== 'local';
  }

  get embeddingModel(): string {
    if (this.mode === 'aws') {
      return (
        process.env.AWS_BEDROCK_EMBEDDING_MODEL_ID?.trim() ||
        DEFAULT_TITAN_EMBEDDING_MODEL
      );
    }
    if (this.mode === 'openai') {
      return process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
    }
    return this.localEmbeddings.model;
  }

  get embeddingDimensions(): TitanEmbeddingDimensions {
    const configured = Number(process.env.AWS_BEDROCK_EMBEDDING_DIMENSIONS);
    return configured === 256 || configured === 512 || configured === 1024
      ? configured
      : DEFAULT_TITAN_EMBEDDING_DIMENSIONS;
  }

  get generationModel(): string {
    if (this.mode === 'aws') {
      return process.env.AWS_BEDROCK_MODEL_ID?.trim() || 'unconfigured';
    }
    if (this.mode === 'openai') {
      return (
        process.env.OPENAI_MODEL ??
        process.env.OPENAI_GENERATION_MODEL ??
        'gpt-5-mini'
      );
    }
    return LOCAL_GENERATION_MODEL;
  }

  // ---------------------------------------------------------------- embeddings

  async embedTexts(texts: readonly string[]): Promise<EmbeddingBatch> {
    const mode = this.mode;
    if (mode === 'local') return this.localEmbeddingBatch(texts, false);

    try {
      if (mode === 'openai') {
        // Genuine LangChain integration, lazily loaded only for this path.
        const { OpenAIEmbeddings } = await import('@langchain/openai');
        const model = this.embeddingModel;
        const embeddings = new OpenAIEmbeddings({
          apiKey: process.env.OPENAI_API_KEY,
          model,
          maxRetries: 1,
          timeout: 20_000,
        });
        const vectors = await embeddings.embedDocuments([...texts]);
        const inputTokens = texts.reduce(
          (total, text) => total + countTokens(text),
          0,
        );
        return {
          vectors,
          provider: 'openai',
          model,
          dimensions: vectors[0]?.length ?? 0,
          usedFallback: false,
          usage: buildUsage({
            provider: 'openai',
            model,
            inputTokens,
            outputTokens: 0,
            estimated: true,
          }),
        };
      }

      const model = this.embeddingModel;
      const dimensions = this.embeddingDimensions;
      const client = this.getBedrockClient();
      let inputTokens = 0;
      const vectors: number[][] = [];

      // Titan embeds one text per request; batching happens at the index layer.
      for (const inputText of texts) {
        const response = await client.send(
          new InvokeModelCommand({
            modelId: model,
            contentType: 'application/json',
            accept: 'application/json',
            body: new TextEncoder().encode(
              JSON.stringify({ inputText, dimensions, normalize: true }),
            ),
          }),
        );
        const parsed = this.parseTitanEmbedding(response.body, dimensions);
        vectors.push(parsed.embedding);
        inputTokens += parsed.inputTextTokenCount ?? countTokens(inputText);
      }

      return {
        vectors,
        provider: 'aws',
        model,
        dimensions,
        usedFallback: false,
        usage: buildUsage({
          provider: 'aws',
          model,
          inputTokens,
          outputTokens: 0,
          estimated: false,
        }),
      };
    } catch (error) {
      if (!this.fallbackAllowed) throw error;
      this.warnFallback('embedding', error);
      return this.localEmbeddingBatch(texts, true);
    }
  }

  // ---------------------------------------------------------------- generation

  async complete(
    instructions: string,
    input: string,
    localFallback: string,
    options: CompleteOptions = {},
  ): Promise<CompletionResult> {
    const mode = this.mode;
    if (mode === 'local') {
      options.onToken?.(localFallback);
      return {
        text: localFallback,
        provider: 'local',
        model: LOCAL_GENERATION_MODEL,
        usedFallback: false,
        usage: estimateUsage({
          provider: 'local',
          model: LOCAL_GENERATION_MODEL,
          inputText: `${instructions}\n${input}`,
          outputText: localFallback,
        }),
        toolCalls: [],
      };
    }

    try {
      const model = this.generationModel;
      const result =
        mode === 'aws'
          ? await this.completeWithBedrock(instructions, input, model, options)
          : await this.completeWithOpenAi(instructions, input, model, options);
      if (!result.text) throw new Error('Generation provider returned no text');
      return result;
    } catch (error) {
      if (!this.fallbackAllowed) throw error;
      this.warnFallback('generation', error);
      options.onToken?.(localFallback);
      return {
        text: localFallback,
        provider: 'local',
        model: LOCAL_GENERATION_MODEL,
        usedFallback: true,
        usage: estimateUsage({
          provider: 'local',
          model: LOCAL_GENERATION_MODEL,
          inputText: `${instructions}\n${input}`,
          outputText: localFallback,
        }),
        toolCalls: [],
      };
    }
  }

  // ------------------------------------------------------------------- bedrock

  /**
   * Bedrock Converse with an agentic tool loop. The model may request tools,
   * receive their results, and continue, up to a bounded number of rounds.
   */
  private async completeWithBedrock(
    instructions: string,
    input: string,
    model: string,
    options: CompleteOptions,
  ): Promise<CompletionResult> {
    const client = this.getBedrockClient();
    const messages: Message[] = [
      { role: 'user', content: [{ text: input }] },
    ];
    const toolCalls: ToolCallRecord[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    const toolConfig =
      options.tools?.length && options.executeTool
        ? {
            tools: options.tools.map(
              (tool): Tool => ({
                toolSpec: {
                  name: tool.name,
                  description: tool.description,
                  inputSchema: {
                    json: tool.parameters as unknown as BedrockDocument,
                  },
                },
              }),
            ),
          }
        : undefined;

    const maxRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;

    for (let round = 0; round <= maxRounds; round += 1) {
      const isFinalRound = round === maxRounds;
      // Streaming is only safe on a turn that cannot request another tool.
      const canStream = Boolean(options.onToken) && (!toolConfig || isFinalRound);

      if (canStream) {
        const streamed = await this.streamBedrock(
          client,
          model,
          instructions,
          messages,
          options.onToken as (text: string) => void,
        );
        inputTokens += streamed.inputTokens;
        outputTokens += streamed.outputTokens;
        return {
          text: streamed.text,
          provider: 'aws',
          model,
          usedFallback: false,
          usage: buildUsage({
            provider: 'aws',
            model,
            inputTokens,
            outputTokens,
            estimated: false,
          }),
          toolCalls,
        };
      }

      const response = await client.send(
        new ConverseCommand({
          modelId: model,
          system: [{ text: instructions }],
          messages,
          inferenceConfig: { maxTokens: 900, temperature: 0.1 },
          ...(toolConfig && !isFinalRound ? { toolConfig } : {}),
        }),
      );

      inputTokens += response.usage?.inputTokens ?? 0;
      outputTokens += response.usage?.outputTokens ?? 0;

      const content = response.output?.message?.content ?? [];
      const text = content
        .flatMap((block) =>
          typeof block.text === 'string' ? [block.text.trim()] : [],
        )
        .filter(Boolean)
        .join('\n')
        .trim();

      const requested = content.flatMap((block) =>
        block.toolUse ? [block.toolUse] : [],
      );

      if (response.stopReason !== 'tool_use' || requested.length === 0) {
        if (text) options.onToken?.(text);
        return {
          text,
          provider: 'aws',
          model,
          usedFallback: false,
          usage: buildUsage({
            provider: 'aws',
            model,
            inputTokens,
            outputTokens,
            estimated: false,
          }),
          toolCalls,
        };
      }

      messages.push({ role: 'assistant', content });

      const results: ContentBlock[] = [];
      for (const use of requested) {
        const record = await (options.executeTool as ToolExecutor)(
          use.name ?? '',
          use.input,
        );
        toolCalls.push(record);
        results.push({
          toolResult: {
            toolUseId: use.toolUseId ?? '',
            content: [{ json: record.result as BedrockDocument }],
            status: record.error ? 'error' : 'success',
          },
        });
      }
      messages.push({ role: 'user', content: results });
    }

    throw new Error('Bedrock tool loop exceeded the maximum number of rounds');
  }

  private async streamBedrock(
    client: BedrockRuntimeClient,
    model: string,
    instructions: string,
    messages: Message[],
    onToken: (text: string) => void,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const response = await client.send(
      new ConverseStreamCommand({
        modelId: model,
        system: [{ text: instructions }],
        messages,
        inferenceConfig: { maxTokens: 900, temperature: 0.1 },
      }),
    );

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of response.stream ?? []) {
      const delta = event.contentBlockDelta?.delta?.text;
      if (delta) {
        text += delta;
        onToken(delta);
      }
      if (event.metadata?.usage) {
        inputTokens = event.metadata.usage.inputTokens ?? 0;
        outputTokens = event.metadata.usage.outputTokens ?? 0;
      }
    }

    return { text: text.trim(), inputTokens, outputTokens };
  }

  // -------------------------------------------------------------------- openai

  /**
   * OpenAI Responses API with function tools. Tool outputs are appended to the
   * input list as `function_call_output` items and the conversation continues.
   */
  private async completeWithOpenAi(
    instructions: string,
    input: string,
    model: string,
    options: CompleteOptions,
  ): Promise<CompletionResult> {
    const client = await this.getOpenAiClient();
    const conversation: unknown[] = [{ role: 'user', content: input }];
    const toolCalls: ToolCallRecord[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    const tools =
      options.tools?.length && options.executeTool
        ? options.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: false,
          }))
        : undefined;

    const maxRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;

    for (let round = 0; round <= maxRounds; round += 1) {
      const isFinalRound = round === maxRounds;
      const canStream = Boolean(options.onToken) && (!tools || isFinalRound);

      const body: Record<string, unknown> = {
        model,
        instructions,
        input: conversation,
        store: false,
        ...(tools && !isFinalRound ? { tools } : {}),
        ...(canStream ? { stream: true } : {}),
      };

      const raw = await client.responses.create(body);

      if (canStream) {
        const streamed = await this.consumeOpenAiStream(
          raw,
          options.onToken as (text: string) => void,
        );
        inputTokens += streamed.inputTokens || countTokens(instructions + input);
        outputTokens += streamed.outputTokens || countTokens(streamed.text);
        return {
          text: streamed.text,
          provider: 'openai',
          model,
          usedFallback: false,
          usage: buildUsage({
            provider: 'openai',
            model,
            inputTokens,
            outputTokens,
            estimated: streamed.inputTokens === 0,
          }),
          toolCalls,
        };
      }

      const response = asRecord(raw);
      const usage = asRecord(response.usage);
      inputTokens += numberOr(usage.input_tokens, 0);
      outputTokens += numberOr(usage.output_tokens, 0);

      const output = Array.isArray(response.output) ? response.output : [];
      const functionCalls = output
        .map(asRecord)
        .filter((item) => item.type === 'function_call');

      if (functionCalls.length === 0) {
        const text =
          typeof response.output_text === 'string'
            ? response.output_text.trim()
            : collectOpenAiText(output);
        if (text) options.onToken?.(text);
        return {
          text,
          provider: 'openai',
          model,
          usedFallback: false,
          usage: buildUsage({
            provider: 'openai',
            model,
            inputTokens,
            outputTokens,
            estimated: false,
          }),
          toolCalls,
        };
      }

      for (const call of functionCalls) {
        // Echo the model's own call item back before its output, as the
        // Responses API requires for a continued conversation.
        conversation.push(call);
        const record = await (options.executeTool as ToolExecutor)(
          stringOr(call.name),
          safeParseJson(call.arguments),
        );
        toolCalls.push(record);
        conversation.push({
          type: 'function_call_output',
          call_id: stringOr(call.call_id),
          output: JSON.stringify(record.result),
        });
      }
    }

    throw new Error('OpenAI tool loop exceeded the maximum number of rounds');
  }

  private async consumeOpenAiStream(
    raw: unknown,
    onToken: (text: string) => void,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    if (!isAsyncIterable(raw)) {
      // The SDK returned a non-streaming response despite stream: true.
      const response = asRecord(raw);
      const text =
        typeof response.output_text === 'string' ? response.output_text.trim() : '';
      if (text) onToken(text);
      const usage = asRecord(response.usage);
      return {
        text,
        inputTokens: numberOr(usage.input_tokens, 0),
        outputTokens: numberOr(usage.output_tokens, 0),
      };
    }

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of raw) {
      const item = asRecord(event);
      if (item.type === 'response.output_text.delta') {
        const delta = typeof item.delta === 'string' ? item.delta : '';
        if (delta) {
          text += delta;
          onToken(delta);
        }
      }
      if (item.type === 'response.completed') {
        const usage = asRecord(asRecord(item.response).usage);
        inputTokens = numberOr(usage.input_tokens, 0);
        outputTokens = numberOr(usage.output_tokens, 0);
      }
    }

    return { text: text.trim(), inputTokens, outputTokens };
  }

  // --------------------------------------------------------------------- local

  private localEmbeddingBatch(
    texts: readonly string[],
    usedFallback: boolean,
  ): EmbeddingBatch {
    return {
      vectors: texts.map((text) => this.localEmbeddings.embed(text)),
      provider: 'local',
      model: this.localEmbeddings.model,
      dimensions: this.localEmbeddings.dimensions,
      usedFallback,
      usage: { ...EMPTY_USAGE },
    };
  }

  private async getOpenAiClient(): Promise<OpenAiClient> {
    if (this.openAiClient) return this.openAiClient;
    const sdk = await import('openai');
    this.openAiClient = new sdk.default({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 1,
      timeout: 30_000,
    });
    return this.openAiClient;
  }

  private getBedrockClient(): BedrockRuntimeClient {
    if (this.bedrockClient) return this.bedrockClient;
    const region = process.env.AWS_REGION?.trim();
    if (!region) throw new Error('AWS_REGION is required for AWS Bedrock');
    // Omitting credentials intentionally enables the standard AWS SDK chain.
    this.bedrockClient = new BedrockRuntimeClient({ region });
    return this.bedrockClient;
  }

  private parseTitanEmbedding(
    body: Uint8Array | undefined,
    expectedDimensions: number,
  ): { embedding: number[]; inputTextTokenCount?: number } {
    let payload: unknown;
    try {
      payload = JSON.parse(
        new TextDecoder().decode(body ?? new Uint8Array()),
      ) as unknown;
    } catch {
      throw new Error('AWS Bedrock returned invalid embedding JSON');
    }

    if (!isRecord(payload) || !Array.isArray(payload.embedding)) {
      throw new Error('AWS Bedrock returned no Titan embedding');
    }
    if (
      payload.embedding.length !== expectedDimensions ||
      !payload.embedding.every(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value),
      )
    ) {
      throw new Error('AWS Bedrock returned an invalid Titan embedding vector');
    }
    return {
      embedding: payload.embedding,
      inputTextTokenCount:
        typeof payload.inputTextTokenCount === 'number'
          ? payload.inputTextTokenCount
          : undefined,
    };
  }

  private hasValue(value: string | undefined): value is string {
    return Boolean(value?.trim());
  }

  private warnFallback(operation: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : 'unknown error';
    this.logger.warn(
      `Remote ${operation} failed; using local fallback: ${detail}`,
    );
  }

  private get fallbackAllowed(): boolean {
    return process.env.AI_ALLOW_FALLBACK?.toLowerCase() !== 'false';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in (value as Record<symbol, unknown>)
  );
}

function collectOpenAiText(output: readonly unknown[]): string {
  return output
    .map(asRecord)
    .flatMap((item): unknown[] => (Array.isArray(item.content) ? item.content : []))
    .map(asRecord)
    .flatMap((block) => (typeof block.text === 'string' ? [block.text] : []))
    .join('')
    .trim();
}

function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
