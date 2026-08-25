import type { AiRoute } from '../ai/ai.types';
import type { IncidentSeverity } from '../fleet/fleet.types';

/**
 * Bump when cases are added, removed, or relabelled. Results are only
 * comparable across runs of the same dataset version.
 */
export const DATASET_VERSION = 'golden@1.1.0';

export interface RoutingCase {
  message: string;
  expected: AiRoute;
}

export interface RetrievalCase {
  query: string;
  scope: 'all' | 'knowledge' | 'incidents';
  /** Document IDs that are correct answers; any one in the top-k counts. */
  relevant: string[];
}

export interface ClassificationCase {
  report: string;
  category: string;
  severity: IncidentSeverity | IncidentSeverity[];
  requiresSupervisor: boolean;
}

export interface GroundingCase {
  message: string;
  /** Route the answer must take for the grounding check to be meaningful. */
  expectedRoute: AiRoute;
}

export const ROUTING_CASES: readonly RoutingCase[] = [
  { message: 'What is the brake overheat procedure?', expected: 'KNOWLEDGE_QUERY' },
  { message: 'What does the cold-chain playbook require for a temperature excursion?', expected: 'KNOWLEDGE_QUERY' },
  { message: 'What should we do when a driver is near the hours-of-service limit?', expected: 'KNOWLEDGE_QUERY' },
  { message: 'What is the policy for unauthorized vehicle movement?', expected: 'KNOWLEDGE_QUERY' },
  { message: 'What are the steps for a tyre pressure inspection?', expected: 'KNOWLEDGE_QUERY' },
  { message: 'What is the escalation process after a tyre burst?', expected: 'KNOWLEDGE_QUERY' },

  { message: 'Show critical incidents', expected: 'INCIDENT_SEARCH' },
  { message: 'Find incidents similar to GPS signal loss', expected: 'INCIDENT_SEARCH' },
  { message: 'Which incidents are nearing SLA?', expected: 'INCIDENT_SEARCH' },
  { message: 'Show open incidents involving tyres', expected: 'INCIDENT_SEARCH' },
  { message: 'List unresolved alerts for VH-2047', expected: 'INCIDENT_SEARCH' },
  { message: 'Summarize critical incidents', expected: 'INCIDENT_SEARCH' },

  { message: "Summarize today's fleet operations", expected: 'SUMMARY' },
  { message: 'Give me a shift handover', expected: 'SUMMARY' },
  { message: "Give me a summary of today's risks", expected: 'SUMMARY' },
  { message: 'What is the overview of the operation right now?', expected: 'SUMMARY' },

  { message: 'How many vehicles are active?', expected: 'DATABASE_QUERY' },
  { message: 'How many vehicles are delayed right now?', expected: 'DATABASE_QUERY' },
  { message: 'What is fleet availability?', expected: 'DATABASE_QUERY' },
  { message: 'What percentage of the fleet is offline?', expected: 'DATABASE_QUERY' },

  { message: 'Hello, what can you do?', expected: 'GENERAL' },
  { message: 'Who built you?', expected: 'GENERAL' },

  // Harder cases: colloquial phrasing that shares little vocabulary with the
  // rule patterns, and near-miss pairs that separate adjacent routes.
  { message: 'brake', expected: 'KNOWLEDGE_QUERY' },
  { message: "What's the cold chain rule?", expected: 'KNOWLEDGE_QUERY' },
  { message: 'Do we need a supervisor before releasing a vehicle?', expected: 'KNOWLEDGE_QUERY' },
  { message: 'What proportion of the fleet is in maintenance?', expected: 'DATABASE_QUERY' },
  { message: 'Count the unresolved cases', expected: 'INCIDENT_SEARCH' },
  { message: 'Recap the shift for the incoming controller', expected: 'SUMMARY' },
];

export const RETRIEVAL_CASES: readonly RetrievalCase[] = [
  { query: 'What is the escalation process after a tyre burst?', scope: 'knowledge', relevant: ['KB-MNT-011', 'KB-SAF-001'] },
  { query: 'brake temperature above 200C what do we do', scope: 'knowledge', relevant: ['KB-SAF-001'] },
  { query: 'can we cool an overheated wheel end with water', scope: 'knowledge', relevant: ['KB-SAF-001'] },
  { query: 'who can approve disposition of a temperature excursed load', scope: 'knowledge', relevant: ['KB-OPS-014'] },
  { query: 'reefer set point restore and quality hold', scope: 'knowledge', relevant: ['KB-OPS-014'] },
  { query: 'driver drive time remaining below travel time to parking', scope: 'knowledge', relevant: ['KB-CMP-006'] },
  { query: 'engine derate beyond 60 percent torque', scope: 'knowledge', relevant: ['KB-MNT-021'] },
  { query: 'should I clear fault codes before the workshop visit', scope: 'knowledge', relevant: ['KB-MNT-021'] },
  { query: 'remote immobilization of a moving vehicle', scope: 'knowledge', relevant: ['KB-SEC-009'] },
  { query: 'tyre lost 9 PSI overnight can it be dispatched', scope: 'knowledge', relevant: ['KB-MNT-011'] },
  { query: 'priority shipment predicted 45 minutes late', scope: 'knowledge', relevant: ['KB-OPS-018'] },
  { query: 'does the copilot answer need supervisor confirmation', scope: 'knowledge', relevant: ['KB-DAT-003'] },

  { query: 'reefer cargo temperature excursion', scope: 'incidents', relevant: ['INC-1002'] },
  { query: 'brake temperature threshold exceeded on descent', scope: 'incidents', relevant: ['INC-1001'] },
  { query: 'vehicle moved outside its staging zone', scope: 'incidents', relevant: ['INC-1005'] },
  { query: 'proof of delivery did not sync', scope: 'incidents', relevant: ['INC-1008'] },
  { query: 'slow puncture losing pressure', scope: 'incidents', relevant: ['INC-1007'] },
  { query: 'driver running out of legal hours', scope: 'incidents', relevant: ['INC-1003'] },

  // Harder cases: colloquial paraphrases that share almost no vocabulary with
  // the source procedure, so a lexical-only match cannot carry them.
  { query: 'is it ok to pour water on a hot wheel', scope: 'knowledge', relevant: ['KB-SAF-001'] },
  { query: 'the load got too warm, who decides if we can still sell it', scope: 'knowledge', relevant: ['KB-OPS-014'] },
  { query: 'can dispatch tell a driver to keep going past their limit', scope: 'knowledge', relevant: ['KB-CMP-006'] },
  { query: 'we think someone took a trailer from the yard overnight', scope: 'knowledge', relevant: ['KB-SEC-009'] },
  { query: 'customer needs to know the truck will be late', scope: 'knowledge', relevant: ['KB-OPS-018'] },
];

export const CLASSIFICATION_CASES: readonly ClassificationCase[] = [
  { report: 'Driver reports smoke from the left rear wheel and brake temperature is 225 C.', category: 'Safety', severity: 'critical', requiresSupervisor: true },
  { report: 'The driver reported smoke from the engine bay after a steep climb.', category: 'Safety', severity: 'critical', requiresSupervisor: true },
  { report: 'Vehicle was involved in a collision with a stationary barrier at the depot gate.', category: 'Safety', severity: 'critical', requiresSupervisor: true },
  { report: 'Driver has only 20 minutes of legal drive time but parking is 40 minutes away.', category: 'Compliance', severity: ['high', 'critical'], requiresSupervisor: true },
  { report: 'Unauthorized vehicle movement detected outside the geofence with no driver session.', category: 'Security', severity: ['high', 'critical'], requiresSupervisor: true },
  { report: 'Trailer was found with a broken seal and the security tag is missing.', category: 'Security', severity: ['high', 'critical', 'medium'], requiresSupervisor: true },
  { report: 'Priority shipment ETA is late by 45 minutes because of traffic.', category: 'Operations', severity: 'medium', requiresSupervisor: false },
  { report: 'Reefer unit reported a temperature excursion above the pharmaceutical range.', category: 'Operations', severity: ['high', 'medium'], requiresSupervisor: false },
  { report: 'Engine entered a derate after repeated aftertreatment pressure warnings.', category: 'Maintenance', severity: 'medium', requiresSupervisor: false },
  { report: 'Left rear tyre lost 9 PSI over two hours after inflation.', category: 'Maintenance', severity: 'medium', requiresSupervisor: false },
  { report: 'The proof-of-delivery image has not synchronized from the driver app.', category: 'Operations', severity: ['medium', 'low'], requiresSupervisor: false },

  // Harder cases: reports that describe the hazard without naming it directly.
  { report: 'There is a burning smell and the rear of the trailer is glowing.', category: 'Safety', severity: 'critical', requiresSupervisor: true },
  { report: 'Someone drove the unit off the yard and we have no work order for it.', category: 'Security', severity: ['critical', 'high'], requiresSupervisor: true },
  { report: 'The logbook shows the driver has been at the wheel past the permitted window.', category: 'Compliance', severity: ['high', 'critical'], requiresSupervisor: true },
];

export const GROUNDING_CASES: readonly GroundingCase[] = [
  { message: 'What is the brake overheat procedure?', expectedRoute: 'KNOWLEDGE_QUERY' },
  { message: 'What does the cold-chain playbook require?', expectedRoute: 'KNOWLEDGE_QUERY' },
  { message: 'What is the policy for unauthorized vehicle movement?', expectedRoute: 'KNOWLEDGE_QUERY' },
  { message: 'Show critical incidents', expectedRoute: 'INCIDENT_SEARCH' },
  { message: 'Show open incidents involving tyres', expectedRoute: 'INCIDENT_SEARCH' },
];

export const SUMMARY_CASES: readonly string[] = [
  "Summarize today's fleet operations",
  'Give me a shift handover',
  "Give me a summary of today's risks",
];
