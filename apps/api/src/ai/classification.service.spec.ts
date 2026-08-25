import { AiProviderService } from './ai-provider.service';
import { ClassificationService } from './classification.service';
import { LocalEmbeddingService } from './local-embedding.service';

describe('ClassificationService', () => {
  let classifier: ClassificationService;
  let previousProvider: string | undefined;

  beforeAll(() => {
    previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = 'local';
    const provider = new AiProviderService(new LocalEmbeddingService());
    classifier = new ClassificationService(provider);
  });

  afterAll(() => {
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
  });

  it('escalates a brake smoke report as critical safety', async () => {
    const result = await classifier.classify(
      'Driver reports smoke from the left rear wheel and brake temperature is 225 C.',
    );

    expect(result).toMatchObject({
      category: 'Safety',
      subcategory: 'Brake system',
      severity: 'critical',
      requiresSupervisor: true,
      provider: 'local',
    });
  });

  it('identifies hours-of-service compliance risk', async () => {
    const result = await classifier.classify(
      'Driver has only 20 minutes of legal drive time but parking is 40 minutes away.',
    );

    expect(result.category).toBe('Compliance');
    expect(result.subcategory).toBe('Hours of service');
    expect(['high', 'critical']).toContain(result.severity);
  });

  it('classifies routine delivery delay as operations', async () => {
    const result = await classifier.classify(
      'Priority shipment ETA is late by 45 minutes because of traffic.',
    );

    expect(result.category).toBe('Operations');
    expect(result.severity).toBe('medium');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('does not let a remote model bypass mandatory escalation', async () => {
    const provider = {
      complete: jest.fn().mockResolvedValue({
        text: JSON.stringify({
          category: 'Security',
          subcategory: 'Unauthorized movement',
          severity: 'high',
          requiresSupervisor: false,
          confidence: 0.9,
          rationale: 'Remote classification',
          recommendedAction: 'Verify the movement.',
        }),
        provider: 'aws',
        model: 'test-model',
        usedFallback: false,
      }),
    } as unknown as AiProviderService;
    const remoteClassifier = new ClassificationService(provider);

    const result = await remoteClassifier.classify(
      'Unauthorized vehicle movement outside the geofence.',
    );

    expect(result.requiresSupervisor).toBe(true);
    expect(result.provider).toBe('aws');
  });
});
