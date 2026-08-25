import {
  ConverseCommand,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { AiProviderService } from './ai-provider.service';
import { LocalEmbeddingService } from './local-embedding.service';
import type { ToolDefinition } from './tools/fleet-tools.service';

const ENV_KEYS = [
  'AI_PROVIDER',
  'AI_ALLOW_FALLBACK',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_EMBEDDING_MODEL',
  'AWS_REGION',
  'AWS_BEDROCK_MODEL_ID',
  'AWS_BEDROCK_EMBEDDING_MODEL_ID',
  'AWS_BEDROCK_EMBEDDING_DIMENSIONS',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const;

describe('AiProviderService configuration', () => {
  let previousEnvironment: Map<string, string | undefined>;

  beforeEach(() => {
    previousEnvironment = new Map(
      ENV_KEYS.map((key) => [key, process.env[key]]),
    );
    ENV_KEYS.forEach((key) => delete process.env[key]);
  });

  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      const value = previousEnvironment.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  it('stays local when a hosted provider is absent or incomplete', () => {
    const provider = createProvider();
    expect(provider.mode).toBe('local');
    expect(provider.supportsNativeTools).toBe(false);

    process.env.AI_PROVIDER = 'aws';
    process.env.AWS_REGION = 'us-east-1';
    expect(provider.mode).toBe('local');
    expect(provider.embeddingModel).toBe('opspilot-hash-embedding-v1');
  });

  it('enables AWS through configuration without explicit static credentials', () => {
    process.env.AI_PROVIDER = 'aws';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_BEDROCK_MODEL_ID = 'amazon.nova-lite-v1:0';

    const provider = createProvider();
    expect(provider.mode).toBe('aws');
    expect(provider.supportsNativeTools).toBe(true);
    expect(provider.generationModel).toBe('amazon.nova-lite-v1:0');
    expect(provider.embeddingModel).toBe('amazon.titan-embed-text-v2:0');
    expect(provider.embeddingDimensions).toBe(1024);
  });

  it('uses supported Titan dimensions and rejects invalid configuration', () => {
    const provider = createProvider();
    process.env.AWS_BEDROCK_EMBEDDING_DIMENSIONS = '512';
    expect(provider.embeddingDimensions).toBe(512);

    process.env.AWS_BEDROCK_EMBEDDING_DIMENSIONS = '999';
    expect(provider.embeddingDimensions).toBe(1024);
  });

  it('reports zero cost and no tokens for the local engine', async () => {
    const provider = createProvider();
    const completion = await provider.complete('system', 'input', 'Local answer.');

    expect(completion.text).toBe('Local answer.');
    expect(completion.provider).toBe('local');
    expect(completion.usage.costUsd).toBe(0);
    expect(completion.usage.totalTokens).toBeGreaterThan(0);
  });

  it('sends Converse and Titan V2 requests and parses their typed responses', async () => {
    process.env.AI_PROVIDER = 'aws';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_BEDROCK_MODEL_ID = 'amazon.nova-lite-v1:0';
    process.env.AWS_BEDROCK_EMBEDDING_DIMENSIONS = '256';
    const provider = createProvider();
    const send = jest.fn((command: unknown) => {
      if (command instanceof InvokeModelCommand) {
        const request = JSON.parse(
          new TextDecoder().decode(command.input.body as Uint8Array),
        ) as Record<string, unknown>;
        expect(command.input.modelId).toBe('amazon.titan-embed-text-v2:0');
        expect(request).toEqual({
          inputText: 'brake inspection',
          dimensions: 256,
          normalize: true,
        });
        return Promise.resolve({
          body: new TextEncoder().encode(
            JSON.stringify({
              embedding: Array(256).fill(0.0625),
              inputTextTokenCount: 3,
            }),
          ),
        });
      }
      if (command instanceof ConverseCommand) {
        expect(command.input.modelId).toBe('amazon.nova-lite-v1:0');
        expect(command.input.system).toEqual([{ text: 'Stay grounded.' }]);
        expect(command.input.messages?.[0]?.content).toEqual([
          { text: 'Use the supplied fleet context.' },
        ]);
        // No tools were supplied, so no tool configuration is sent.
        expect(command.input.toolConfig).toBeUndefined();
        return Promise.resolve({
          stopReason: 'end_turn',
          output: {
            message: {
              role: 'assistant',
              content: [{ text: '  Grounded answer.  ' }],
            },
          },
          usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
        });
      }
      throw new Error('Unexpected command');
    });
    Object.assign(provider, { bedrockClient: { send } });

    const embeddings = await provider.embedTexts(['brake inspection']);
    expect(embeddings).toMatchObject({
      provider: 'aws',
      model: 'amazon.titan-embed-text-v2:0',
      dimensions: 256,
      usedFallback: false,
    });
    expect(embeddings.vectors[0]).toHaveLength(256);
    expect(embeddings.usage.inputTokens).toBe(3);
    expect(embeddings.usage.estimated).toBe(false);

    const completion = await provider.complete(
      'Stay grounded.',
      'Use the supplied fleet context.',
      'Local answer.',
    );
    expect(completion).toMatchObject({
      text: 'Grounded answer.',
      provider: 'aws',
      model: 'amazon.nova-lite-v1:0',
      usedFallback: false,
      toolCalls: [],
    });
    // Usage is provider-reported, so it is not flagged as an estimate.
    expect(completion.usage).toMatchObject({
      inputTokens: 120,
      outputTokens: 40,
      estimated: false,
    });
    expect(completion.usage.costUsd).toBeGreaterThan(0);
  });

  it('runs a Bedrock tool loop and feeds results back to the model', async () => {
    process.env.AI_PROVIDER = 'aws';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_BEDROCK_MODEL_ID = 'amazon.nova-lite-v1:0';
    const provider = createProvider();

    const tools: ToolDefinition[] = [
      {
        name: 'get_fleet_metrics',
        description: 'Aggregate fleet metrics computed from live records.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    ];

    let round = 0;
    const send = jest.fn((command: unknown) => {
      if (!(command instanceof ConverseCommand)) throw new Error('Unexpected');
      round += 1;

      if (round === 1) {
        expect(command.input.toolConfig?.tools?.[0]?.toolSpec?.name).toBe(
          'get_fleet_metrics',
        );
        return Promise.resolve({
          stopReason: 'tool_use',
          output: {
            message: {
              role: 'assistant',
              content: [
                {
                  toolUse: {
                    toolUseId: 'call-1',
                    name: 'get_fleet_metrics',
                    input: {},
                  },
                },
              ],
            },
          },
          usage: { inputTokens: 100, outputTokens: 20 },
        });
      }

      // The second call must carry the assistant turn plus the tool result.
      const messages = command.input.messages ?? [];
      expect(messages).toHaveLength(3);
      expect(messages[1]?.role).toBe('assistant');
      expect(messages[2]?.content?.[0]?.toolResult?.toolUseId).toBe('call-1');
      expect(messages[2]?.content?.[0]?.toolResult?.status).toBe('success');
      return Promise.resolve({
        stopReason: 'end_turn',
        output: {
          message: { role: 'assistant', content: [{ text: '312 vehicles.' }] },
        },
        usage: { inputTokens: 150, outputTokens: 10 },
      });
    });
    Object.assign(provider, { bedrockClient: { send } });

    const executeTool = jest.fn(() => ({
      name: 'get_fleet_metrics',
      arguments: {},
      result: { totalVehicles: 312 },
      durationMs: 1,
    }));

    const completion = await provider.complete('system', 'input', 'fallback', {
      tools,
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledWith('get_fleet_metrics', {});
    expect(completion.text).toBe('312 vehicles.');
    expect(completion.toolCalls).toHaveLength(1);
    // Usage accumulates across every round of the loop.
    expect(completion.usage.inputTokens).toBe(250);
    expect(completion.usage.outputTokens).toBe(30);
  });

  it('falls back to the local engine when a hosted call fails', async () => {
    process.env.AI_PROVIDER = 'aws';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_BEDROCK_MODEL_ID = 'amazon.nova-lite-v1:0';
    const provider = createProvider();
    Object.assign(provider, {
      bedrockClient: {
        send: jest.fn(() => Promise.reject(new Error('throttled'))),
      },
    });

    const completion = await provider.complete('system', 'input', 'Local answer.');

    expect(completion).toMatchObject({
      text: 'Local answer.',
      provider: 'local',
      usedFallback: true,
    });
  });

  it('propagates the failure when fallback is disabled', async () => {
    process.env.AI_PROVIDER = 'aws';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_BEDROCK_MODEL_ID = 'amazon.nova-lite-v1:0';
    process.env.AI_ALLOW_FALLBACK = 'false';
    const provider = createProvider();
    Object.assign(provider, {
      bedrockClient: {
        send: jest.fn(() => Promise.reject(new Error('throttled'))),
      },
    });

    await expect(
      provider.complete('system', 'input', 'Local answer.'),
    ).rejects.toThrow('throttled');
  });

  it('rejects a Titan vector whose dimensionality does not match the request', async () => {
    process.env.AI_PROVIDER = 'aws';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_BEDROCK_MODEL_ID = 'amazon.nova-lite-v1:0';
    process.env.AWS_BEDROCK_EMBEDDING_DIMENSIONS = '512';
    process.env.AI_ALLOW_FALLBACK = 'false';
    const provider = createProvider();
    Object.assign(provider, {
      bedrockClient: {
        send: jest.fn(() =>
          Promise.resolve({
            body: new TextEncoder().encode(
              JSON.stringify({ embedding: Array(256).fill(0.1) }),
            ),
          }),
        ),
      },
    });

    await expect(provider.embedTexts(['brake'])).rejects.toThrow(
      /invalid Titan embedding vector/i,
    );
  });
});

function createProvider(): AiProviderService {
  return new AiProviderService(new LocalEmbeddingService());
}
