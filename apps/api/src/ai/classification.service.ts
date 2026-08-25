import { Injectable } from '@nestjs/common';
import { AiTelemetryService } from '../telemetry/ai-telemetry.service';
import { AiProviderService } from './ai-provider.service';
import type { ClassificationResult, TokenUsage } from './ai.types';
import { CLASSIFICATION_PROMPT, CLASSIFICATION_PROMPT_VERSION } from './prompts';
import { EMPTY_USAGE } from './usage';

type LocalClassification = Omit<
  ClassificationResult,
  'promptVersion' | 'usage'
>;

type Category =
  | 'Safety'
  | 'Maintenance'
  | 'Compliance'
  | 'Operations'
  | 'Security'
  | 'Other';

@Injectable()
export class ClassificationService {
  constructor(
    private readonly provider: AiProviderService,
    private readonly telemetry?: AiTelemetryService,
  ) {}

  async classify(text: string): Promise<ClassificationResult> {
    const startedAt = performance.now();
    const local = this.classifyLocally(text);
    const localPayload = {
      category: local.category,
      subcategory: local.subcategory,
      severity: local.severity,
      requiresSupervisor: local.requiresSupervisor,
      confidence: local.confidence,
      rationale: local.rationale,
      recommendedAction: local.recommendedAction,
    };
    const completion = await this.provider.complete(
      CLASSIFICATION_PROMPT,
      `REPORT:\n${text}`,
      JSON.stringify(localPayload),
    );

    const finish = (result: ClassificationResult): ClassificationResult => {
      this.telemetry?.record({
        at: new Date().toISOString(),
        operation: 'classify',
        route: null,
        provider: result.provider,
        model: completion.model,
        promptVersion: CLASSIFICATION_PROMPT_VERSION,
        latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        usage: result.usage,
        // Classification is grounded in rules or a schema-validated model reply.
        grounded: true,
        usedFallback: completion.usedFallback,
      });
      return result;
    };

    if (completion.provider === 'local') {
      return finish(this.withMetadata(local, completion.usage));
    }

    try {
      const cleaned = completion.text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      const candidate = JSON.parse(cleaned) as Partial<ClassificationResult>;
      return finish(
        this.validateRemote(
          candidate,
          local,
          completion.provider,
          completion.usage,
        ),
      );
    } catch {
      // A malformed model reply falls back to the deterministic classification
      // rather than degrading an escalation decision.
      return finish(this.withMetadata(local, completion.usage));
    }
  }

  private withMetadata(
    local: LocalClassification,
    usage: TokenUsage,
  ): ClassificationResult {
    return {
      ...local,
      promptVersion: CLASSIFICATION_PROMPT_VERSION,
      usage: usage ?? { ...EMPTY_USAGE },
    };
  }

  private classifyLocally(text: string): LocalClassification {
    const value = text.toLowerCase();
    const category = this.detectCategory(value);
    const severity = this.detectSeverity(value, category);
    const subcategory = this.detectSubcategory(value, category);
    const requiresSupervisor =
      severity === 'critical' ||
      category === 'Security' ||
      (category === 'Compliance' && severity === 'high');

    const matchedSignals = [
      /fire|smoke|flame/.test(value),
      /collision|crash|injur|fatal/.test(value),
      /brake|wheel.?end/.test(value),
      /temperature|overheat|reefer|cold.?chain/.test(value),
      /hours.of.service|drive time|logbook/.test(value),
      /theft|unauthori[sz]ed|geofence|tamper/.test(value),
      /engine|derate|oil pressure|tyre|tire/.test(value),
    ].filter(Boolean).length;
    const confidence = Math.min(0.97, 0.72 + matchedSignals * 0.06);

    return {
      category,
      subcategory,
      severity,
      requiresSupervisor,
      confidence: Number(confidence.toFixed(2)),
      rationale: this.rationale(category, severity, subcategory),
      recommendedAction: this.recommendedAction(category, severity),
      provider: 'local',
    };
  }

  private detectCategory(value: string): Category {
    if (
      /fire|smoke|flame|burning|glow(?:ing)?|smoulder|smolder|scorch|charred|collision|crash|injur|fatal|brake|rollover|hazard|unsafe/.test(
        value,
      )
    ) {
      return 'Safety';
    }
    if (
      /theft|stolen|unauthori[sz]ed|geofence|tamper|security|no work order|without (?:a )?work order|broken seal|missing seal/.test(
        value,
      )
    ) {
      return 'Security';
    }
    if (
      /hours.of.service|drive time|logbook|permitted window|permit|license|regulat|at the wheel past/.test(
        value,
      )
    ) {
      return 'Compliance';
    }
    if (
      /engine|derate|fault code|oil pressure|coolant|tyre|tire|battery|repair|service/.test(
        value,
      )
    ) {
      return 'Maintenance';
    }
    if (
      /delivery|shipment|cargo|reefer|cold.?chain|temperature|route|eta|late|proof of delivery|pod/.test(
        value,
      )
    ) {
      return 'Operations';
    }
    return 'Other';
  }

  private detectSeverity(
    value: string,
    category: Category,
  ): 'critical' | 'high' | 'medium' | 'low' {
    if (
      /fatal|serious injur|fire|flame|smoke|burning|glow(?:ing)?|smoulder|smolder|rollover|brake failure|no brakes|collision/.test(
        value,
      ) ||
      /(?:2\d\d|[3-9]\d\d)\s*°?\s*c\b/.test(value)
    ) {
      return 'critical';
    }
    if (
      /injur|stolen|theft|unauthori[sz]ed|no work order|broken seal|missing seal|legal limit|legal drive time|hours.of.service|drive time.*(?:remaining|left|only)|past the (?:permitted|legal)|exceeded the (?:permitted|legal)|at the wheel past|temperature excursion|oil pressure|stop.engine/.test(
        value,
      )
    ) {
      return 'high';
    }
    if (
      /derate|warning|repeated|pressure loss|late|delay|fault|overheat/.test(value)
    ) {
      return 'medium';
    }
    return category === 'Other' ? 'low' : 'medium';
  }

  private detectSubcategory(value: string, category: Category): string {
    if (/brake|wheel.?end/.test(value)) return 'Brake system';
    if (/fire|smoke|flame|burning|glow(?:ing)?|smoulder|smolder/.test(value)) {
      return 'Fire or smoke';
    }
    if (/collision|crash|rollover/.test(value)) return 'Vehicle collision';
    if (/reefer|cold.?chain|temperature excursion/.test(value)) return 'Cold chain';
    if (/hours.of.service|drive time|logbook/.test(value)) return 'Hours of service';
    if (/theft|stolen|unauthori[sz]ed|geofence|no work order|broken seal/.test(value)) {
      return 'Unauthorized movement';
    }
    if (/engine|derate|oil pressure|coolant/.test(value)) return 'Powertrain';
    if (/tyre|tire|puncture|pressure loss/.test(value)) return 'Tyres';
    if (/delivery|eta|late|delay/.test(value)) return 'Delivery risk';
    return `${category} report`;
  }

  private rationale(
    category: Category,
    severity: ClassificationResult['severity'],
    subcategory: string,
  ): string {
    return `The report contains signals consistent with ${subcategory.toLowerCase()}, which maps to ${category.toLowerCase()} operations and warrants ${severity} handling.`;
  }

  private recommendedAction(
    category: Category,
    severity: ClassificationResult['severity'],
  ): string {
    if (severity === 'critical') {
      return 'Move to a safe state, notify dispatch immediately, preserve evidence, and obtain supervisor or specialist clearance before resuming operation.';
    }
    const actions: Record<Category, string> = {
      Safety:
        'Stop in a safe location, follow the relevant safety checklist, and notify fleet safety.',
      Maintenance:
        'Capture diagnostics, assess whether movement is safe, and route the vehicle to an approved technician.',
      Compliance:
        'Prevent a regulatory breach, document dispatch instructions, and escalate to transport compliance.',
      Operations:
        'Protect the load and service commitment, update the incident record, and notify affected stakeholders.',
      Security:
        'Verify the alert through registered channels, preserve logs, and activate the security escalation.',
      Other:
        'Collect the missing operational details and route the report to the control-tower queue for review.',
    };
    return actions[category];
  }

  private validateRemote(
    candidate: Partial<ClassificationResult>,
    fallback: LocalClassification,
    provider: ClassificationResult['provider'],
    usage: TokenUsage,
  ): ClassificationResult {
    const categories = [
      'Safety',
      'Maintenance',
      'Compliance',
      'Operations',
      'Security',
      'Other',
    ];
    const severities = ['critical', 'high', 'medium', 'low'];
    const category = categories.includes(candidate.category ?? '')
      ? (candidate.category as string)
      : fallback.category;
    const severity = severities.includes(candidate.severity ?? '')
      ? (candidate.severity as ClassificationResult['severity'])
      : fallback.severity;
    const confidence =
      typeof candidate.confidence === 'number'
        ? Math.max(0, Math.min(1, candidate.confidence))
        : fallback.confidence;
    const safetyRequiresSupervisor =
      severity === 'critical' ||
      category === 'Security' ||
      (category === 'Compliance' && severity === 'high');

    return {
      category,
      subcategory:
        typeof candidate.subcategory === 'string'
          ? candidate.subcategory
          : fallback.subcategory,
      severity,
      requiresSupervisor:
        safetyRequiresSupervisor || candidate.requiresSupervisor === true,
      confidence: Number(confidence.toFixed(2)),
      rationale:
        typeof candidate.rationale === 'string'
          ? candidate.rationale
          : fallback.rationale,
      recommendedAction:
        typeof candidate.recommendedAction === 'string'
          ? candidate.recommendedAction
          : fallback.recommendedAction,
      provider,
      promptVersion: CLASSIFICATION_PROMPT_VERSION,
      usage,
    };
  }
}
