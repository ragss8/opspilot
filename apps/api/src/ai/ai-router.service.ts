import { Injectable, Logger } from '@nestjs/common';
import type { AiRoute, SearchScope, TokenUsage } from './ai.types';
import { AiProviderService } from './ai-provider.service';
import { ROUTING_PROMPT } from './prompts';
import { EMPTY_USAGE } from './usage';

export interface RouteDecision {
  route: AiRoute;
  confidence: number;
  reason: string;
  scope: SearchScope;
  /** Which stage decided: deterministic rules, or the model fallback. */
  decidedBy: 'rules' | 'model';
  usage: TokenUsage;
}

const ROUTES: readonly AiRoute[] = [
  'KNOWLEDGE_QUERY',
  'INCIDENT_SEARCH',
  'SUMMARY',
  'DATABASE_QUERY',
  'GENERAL',
];

/**
 * Hybrid intent router.
 *
 * Deterministic rules run first: they are free, instant, and cover the phrasings
 * this domain actually sees. When the rules are not confident, and only then, a
 * hosted model classifies the intent with a few-shot prompt. That keeps the
 * common path at zero cost while still handling phrasings no rule anticipated.
 */
@Injectable()
export class AiRouterService {
  /** Below this rule confidence, ask the model instead. */
  static readonly MODEL_FALLBACK_THRESHOLD = 0.8;

  private readonly logger = new Logger(AiRouterService.name);

  constructor(private readonly provider?: AiProviderService) {}

  /** Deterministic rules only. Synchronous, free, and fully testable. */
  route(message: string): RouteDecision {
    const normalized = message.toLowerCase().trim();

    if (
      /\b(?:summarize|summary|show|find|list|which|recent|latest|open|active|unresolved|critical|high|medium|low|nearing)\b.*\b(?:incidents?|alerts?|cases?|sla)\b/.test(
        normalized,
      ) ||
      /\b(?:incidents?|alerts?|cases?|sla)\b.*\b(?:summarize|summary|critical|high|medium|low|open|active|unresolved|resolved|nearing|due|overdue|involving|about|for|on|with|vehicle)\b/.test(
        normalized,
      ) ||
      /INC-\d{4}\b/i.test(message)
    ) {
      return rules('INCIDENT_SEARCH', 0.95, 'Incident lookup, filtering, or SLA language detected', 'incidents');
    }

    if (
      /\b(summarize|summary|brief|overview|recap|top risks?|today'?s status|shift handover)\b/.test(
        normalized,
      )
    ) {
      return rules('SUMMARY', 0.95, 'Summary or briefing language detected', 'all');
    }

    if (
      /\b(how many|count|total|percentage|percent|proportion|share of|ratio|average|availability|utilization|utilisation|active vehicles?|offline vehicles?|fleet size)\b/.test(
        normalized,
      )
    ) {
      return rules(
        'DATABASE_QUERY',
        0.93,
        'Structured fleet metric requested',
        /incident|alert|case/.test(normalized) ? 'incidents' : 'all',
      );
    }

    if (/\b(?:incident|alert|case)\b/.test(normalized)) {
      return rules('INCIDENT_SEARCH', 0.86, 'Incident domain language detected', 'incidents');
    }

    if (
      /\b(policy|procedure|playbook|standard|guidance|guideline|sop|rule|what should|how (?:do|should|can)|do we need|are we (?:required|allowed)|is it ok|am i allowed|who (?:can|must|approves|signs)|supervisor|approval|required|requirement|steps?)\b/.test(
        normalized,
      )
    ) {
      return rules('KNOWLEDGE_QUERY', 0.9, 'Operational guidance requested', 'knowledge');
    }

    if (
      /\b(brake|reefer|cold.?chain|hours of service|driver hours|derate|tyre|tire|security|geofence|delivery delay)\b/.test(
        normalized,
      )
    ) {
      return rules('KNOWLEDGE_QUERY', 0.76, 'Fleet domain topic detected', 'all');
    }

    return rules('GENERAL', 0.72, 'No specialized operation matched', 'all');
  }

  /**
   * Rules first; model fallback only when the rules are unsure and a hosted
   * provider is configured.
   */
  async resolve(message: string): Promise<RouteDecision> {
    const ruled = this.route(message);
    if (
      ruled.confidence >= AiRouterService.MODEL_FALLBACK_THRESHOLD ||
      !this.provider?.isRemoteEnabled
    ) {
      return ruled;
    }

    try {
      const completion = await this.provider.complete(
        ROUTING_PROMPT,
        `MESSAGE:\n${message}`,
        JSON.stringify({
          route: ruled.route,
          confidence: ruled.confidence,
          reason: ruled.reason,
        }),
      );
      if (completion.provider === 'local') return ruled;

      const parsed = JSON.parse(
        completion.text
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, ''),
      ) as Record<string, unknown>;

      const route = ROUTES.find((value) => value === parsed.route);
      if (!route) return ruled;

      const confidence = Number(parsed.confidence);
      return {
        route,
        confidence: Number.isFinite(confidence)
          ? Math.max(0, Math.min(1, confidence))
          : 0.8,
        reason:
          typeof parsed.reason === 'string'
            ? parsed.reason
            : 'Model intent classification',
        scope: scopeFor(route),
        decidedBy: 'model',
        usage: completion.usage,
      };
    } catch (error) {
      this.logger.warn(
        `Model routing failed, keeping the rule decision: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return ruled;
    }
  }
}

function rules(
  route: AiRoute,
  confidence: number,
  reason: string,
  scope: SearchScope,
): RouteDecision {
  return { route, confidence, reason, scope, decidedBy: 'rules', usage: { ...EMPTY_USAGE } };
}

function scopeFor(route: AiRoute): SearchScope {
  if (route === 'INCIDENT_SEARCH') return 'incidents';
  if (route === 'KNOWLEDGE_QUERY') return 'knowledge';
  return 'all';
}
