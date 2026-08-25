import { Injectable } from '@nestjs/common';

const DIMENSIONS = 256;

const SYNONYMS: Readonly<Record<string, string>> = {
  accident: 'collision',
  accidents: 'collision',
  crash: 'collision',
  crashes: 'collision',
  lorry: 'vehicle',
  lorries: 'vehicle',
  truck: 'vehicle',
  trucks: 'vehicle',
  tyre: 'tire',
  tyres: 'tire',
  refrigerated: 'reefer',
  refrigeration: 'reefer',
  hot: 'temperature',
  overheating: 'overheat',
  broke: 'failure',
  broken: 'failure',
  fix: 'repair',
  late: 'delay',
  delayed: 'delay',
  tardy: 'delay',
  rule: 'policy',
  rules: 'policy',
  process: 'procedure',
  steps: 'procedure',
  guide: 'procedure',
  guideline: 'procedure',
  docs: 'document',
  vehicles: 'vehicle',
  drivers: 'driver',
  incidents: 'incident',
};

@Injectable()
export class LocalEmbeddingService {
  readonly model = 'opspilot-hash-embedding-v1';
  readonly dimensions = DIMENSIONS;

  embed(text: string): number[] {
    const vector = Array<number>(DIMENSIONS).fill(0);
    const tokens = this.tokenize(text);

    tokens.forEach((token, position) => {
      this.addFeature(vector, token, 1.25);
      if (position < tokens.length - 1) {
        this.addFeature(vector, `${token}_${tokens[position + 1] ?? ''}`, 0.72);
      }

      if (token.length >= 5) {
        for (let index = 0; index <= token.length - 3; index += 1) {
          this.addFeature(vector, `#${token.slice(index, index + 3)}`, 0.12);
        }
      }
    });

    const magnitude = Math.sqrt(
      vector.reduce((sum, value) => sum + value * value, 0),
    );
    return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
  }

  /**
   * Throws on a dimension mismatch rather than silently truncating to the
   * shorter vector. A mismatch always means vectors from two different
   * embedding models are being compared, which yields a plausible-looking but
   * meaningless score, so failing loudly is the only safe behaviour.
   */
  cosine(left: readonly number[], right: readonly number[]): number {
    if (left.length !== right.length) {
      throw new Error(
        `Cannot compare a ${left.length}d vector with a ${right.length}d vector. ` +
          'Vectors from different embedding models are not comparable; reindex first.',
      );
    }

    let dot = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;

    for (let index = 0; index < left.length; index += 1) {
      const leftValue = left[index] ?? 0;
      const rightValue = right[index] ?? 0;
      dot += leftValue * rightValue;
      leftMagnitude += leftValue * leftValue;
      rightMagnitude += rightValue * rightValue;
    }

    if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
    return dot / Math.sqrt(leftMagnitude * rightMagnitude);
  }

  terms(text: string): Set<string> {
    return new Set(this.tokenize(text));
  }

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1)
      .map((token) => SYNONYMS[token] ?? token)
      .map((token) => {
        if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
        if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
        if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
        return token;
      });
  }

  private addFeature(vector: number[], feature: string, weight: number): void {
    const hash = this.fnv1a(feature);
    const index = hash % DIMENSIONS;
    const sign = (this.fnv1a(`sign:${feature}`) & 1) === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + weight * sign;
  }

  private fnv1a(value: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }
}
