import { LocalEmbeddingService } from './local-embedding.service';

describe('LocalEmbeddingService', () => {
  const service = new LocalEmbeddingService();

  it('produces unit-length vectors of the declared dimensionality', () => {
    const vector = service.embed('brake overheat emergency procedure');
    const magnitude = Math.sqrt(
      vector.reduce((total, value) => total + value * value, 0),
    );

    expect(vector).toHaveLength(service.dimensions);
    expect(magnitude).toBeCloseTo(1, 6);
  });

  it('is deterministic for identical input', () => {
    expect(service.embed('reefer temperature excursion')).toEqual(
      service.embed('reefer temperature excursion'),
    );
  });

  it('maps domain synonyms onto the same term', () => {
    expect(service.terms('tyre pressure').has('tire')).toBe(true);
    expect(service.terms('truck delayed').has('vehicle')).toBe(true);
    expect(service.terms('truck delayed').has('delay')).toBe(true);
  });

  it('throws instead of silently truncating a dimension mismatch', () => {
    // Comparing vectors from two different models yields a plausible-looking
    // but meaningless score, so this must fail loudly rather than return 0.9.
    expect(() => service.cosine([1, 0, 0], [1, 0])).toThrow(
      /not comparable/i,
    );
  });

  it('scores an identical vector as 1 and an orthogonal one as 0', () => {
    expect(service.cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(service.cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });
});
