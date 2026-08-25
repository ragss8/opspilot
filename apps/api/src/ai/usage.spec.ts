import { buildUsage, computeCostUsd, countTokens, rateFor, sumUsage } from './usage';

describe('token and cost accounting', () => {
  it('counts tokens with a real tokenizer, not a character heuristic', () => {
    const tokens = countTokens('Brake overheat emergency procedure for VH-2047');

    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(20);
  });

  it('treats empty input as zero tokens', () => {
    expect(countTokens('')).toBe(0);
  });

  it('computes cost from the configured rate card', () => {
    const rate = rateFor('gpt-5-mini');
    const cost = computeCostUsd('gpt-5-mini', 1_000_000, 1_000_000);

    expect(cost).toBeCloseTo(rate.input + rate.output, 6);
  });

  it('normalizes a regional Bedrock model id onto its base rate', () => {
    expect(rateFor('us.amazon.nova-lite-v1:0')).toEqual(
      rateFor('amazon.nova-lite-v1:0'),
    );
  });

  it('allows a rate override from the environment', () => {
    process.env.OPSPILOT_PRICE_GPT_5_MINI = '1,2';
    try {
      expect(rateFor('gpt-5-mini')).toEqual({ input: 1, output: 2 });
    } finally {
      delete process.env.OPSPILOT_PRICE_GPT_5_MINI;
    }
  });

  it('charges nothing for the local engine, which calls no hosted model', () => {
    const usage = buildUsage({
      provider: 'local',
      model: 'opspilot-grounded-template-v1',
      inputTokens: 5_000,
      outputTokens: 5_000,
      estimated: true,
    });

    expect(usage.totalTokens).toBe(10_000);
    expect(usage.costUsd).toBe(0);
  });

  it('sums usage and stays estimated if any part was estimated', () => {
    const total = sumUsage([
      { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001, estimated: false },
      { inputTokens: 20, outputTokens: 5, totalTokens: 25, costUsd: 0.002, estimated: true },
    ]);

    expect(total).toEqual({
      inputTokens: 30,
      outputTokens: 10,
      totalTokens: 40,
      costUsd: 0.003,
      estimated: true,
    });
  });

  it('returns a zero rate for an unpriced model rather than guessing', () => {
    expect(rateFor('some-unknown-model')).toEqual({ input: 0, output: 0 });
  });
});
