import type {
  ChatResponse,
  ClassificationResult,
  Incident,
  KnowledgeDocument,
  OverviewData,
  Severity,
} from '../types';

export const seededOverview: OverviewData = {
  metrics: [
    {
      label: 'Active fleet',
      value: '1,284',
      detail: '97.8% reporting normally',
      trend: 2.4,
      tone: 'indigo',
    },
    {
      label: 'Open incidents',
      value: '23',
      detail: '4 require attention',
      trend: -12,
      tone: 'red',
    },
    {
      label: 'SLA compliance',
      value: '96.4%',
      detail: '1.8% above target',
      trend: 1.8,
      tone: 'cyan',
    },
    {
      label: 'Avg. resolution',
      value: '18m',
      detail: 'Down from 24m last week',
      trend: -25,
      tone: 'amber',
    },
  ],
  regions: [
    { id: 'r1', name: 'North Hub', vehicles: 246, online: 98, incidents: 2, x: 51, y: 19 },
    { id: 'r2', name: 'West Hub', vehicles: 318, online: 96, incidents: 6, x: 19, y: 46 },
    { id: 'r3', name: 'Central Hub', vehicles: 287, online: 99, incidents: 3, x: 51, y: 49 },
    { id: 'r4', name: 'East Hub', vehicles: 229, online: 97, incidents: 4, x: 81, y: 42 },
    { id: 'r5', name: 'South Hub', vehicles: 204, online: 99, incidents: 1, x: 55, y: 79 },
  ],
  activity: [
    {
      id: 'a1',
      title: 'Temperature anomaly detected',
      detail: 'TRK-204 · West Hub · AI confidence 94%',
      time: '4 min ago',
      kind: 'incident',
    },
    {
      id: 'a2',
      title: 'Route risk brief generated',
      detail: '12 overnight routes analyzed against weather alerts',
      time: '11 min ago',
      kind: 'ai',
    },
    {
      id: 'a3',
      title: 'Brake inspection policy indexed',
      detail: 'Operations handbook · 36 new vector chunks',
      time: '27 min ago',
      kind: 'document',
    },
    {
      id: 'a4',
      title: 'Battery alert resolved',
      detail: 'VAN-442 · Remote diagnostic completed',
      time: '46 min ago',
      kind: 'resolved',
    },
  ],
  aiSummary:
    'West Hub needs the most attention: six open incidents, including a high-confidence refrigeration anomaly on TRK-204. No network-wide service impact is expected.',
  generatedAt: new Date().toISOString(),
  dailyBrief: {
    greeting: 'Good morning, Alex.',
    headline: 'Your network is stable. Four incidents need an operator decision.',
    priorities: [
      'Protect the cold-chain load — dispatch West Hub support within five minutes.',
      'Review driver risk — VAN-091 has nine hard-braking events today.',
      'Preserve customer SLA — approve alternate route E12-B before 10:30.',
    ],
  },
  fleetStatus: { active: 1_256, idle: 16, maintenance: 8, offline: 4, total: 1_284 },
  aiHealth: {
    status: 'healthy',
    provider: 'local',
    indexedDocuments: 16,
    indexedChunks: 32,
    embeddingModel: 'opspilot-hash-embedding-v1',
    generationModel: 'opspilot-grounded-template-v1',
    promptVersion: 'opspilot-prompts@2.1.0',
    averageLatencyMs: 14,
    totalRuns: 0,
    groundedRate: 0,
    totalCostUsd: 0,
  },
};

export const seededIncidents: Incident[] = [
  {
    id: 'INC-1048',
    title: 'Cargo temperature variance',
    summary: 'Reefer telemetry is 6.2°C above the target range for more than twelve minutes.',
    status: 'investigating',
    severity: 'critical',
    category: 'Cold chain',
    assetId: 'TRK-204',
    location: 'West Hub · Bay 14',
    reportedAt: '2026-08-25T08:18:00.000Z',
    updatedAt: '2026-08-25T08:31:00.000Z',
    confidence: 0.94,
    sentiment: 'urgent',
    tags: ['refrigeration', 'perishable', 'telemetry'],
    recommendedAction: 'Dispatch the bay technician and move the load to reefer R-18 if temperature remains elevated for five more minutes.',
  },
  {
    id: 'INC-1047',
    title: 'Repeated hard-braking pattern',
    summary: 'Nine hard-braking events detected on the same corridor during the current shift.',
    status: 'open',
    severity: 'high',
    category: 'Driver safety',
    assetId: 'VAN-091',
    location: 'Central · Route C7',
    reportedAt: '2026-08-25T07:42:00.000Z',
    updatedAt: '2026-08-25T08:10:00.000Z',
    confidence: 0.89,
    sentiment: 'concerning',
    tags: ['driver-behavior', 'safety', 'route-risk'],
    recommendedAction: 'Contact the driver at the next safe stop and review corridor traffic conditions before assigning the return route.',
  },
  {
    id: 'INC-1045',
    title: 'Low auxiliary battery voltage',
    summary: 'Voltage dropped below the service threshold twice in the last 24 hours.',
    status: 'monitoring',
    severity: 'medium',
    category: 'Maintenance',
    assetId: 'EV-442',
    location: 'North Hub',
    reportedAt: '2026-08-25T06:12:00.000Z',
    updatedAt: '2026-08-25T07:58:00.000Z',
    confidence: 0.82,
    sentiment: 'neutral',
    tags: ['battery', 'predictive-maintenance'],
    recommendedAction: 'Keep the asset in monitoring and schedule a battery health check before its next long-haul assignment.',
  },
  {
    id: 'INC-1043',
    title: 'Delivery window at risk',
    summary: 'Congestion and dwell time make the contracted delivery window unlikely without rerouting.',
    status: 'open',
    severity: 'medium',
    category: 'Delivery risk',
    assetId: 'TRK-618',
    location: 'East · Route E12',
    reportedAt: '2026-08-25T05:35:00.000Z',
    updatedAt: '2026-08-25T07:24:00.000Z',
    confidence: 0.91,
    sentiment: 'time-sensitive',
    tags: ['eta', 'customer-sla', 'traffic'],
    recommendedAction: 'Approve alternate route E12-B and proactively notify the consignee of a possible 18-minute variance.',
  },
  {
    id: 'INC-1039',
    title: 'Unplanned depot dwell',
    summary: 'Asset has remained stationary outside the assigned bay for 38 minutes.',
    status: 'resolved',
    severity: 'low',
    category: 'Utilization',
    assetId: 'VAN-326',
    location: 'South Hub',
    reportedAt: '2026-08-25T03:44:00.000Z',
    updatedAt: '2026-08-25T06:09:00.000Z',
    confidence: 0.76,
    sentiment: 'neutral',
    tags: ['dwell', 'utilization'],
    recommendedAction: 'No further action. Dwell was caused by a documented loading delay and the route plan has been updated.',
  },
  {
    id: 'INC-1036',
    title: 'Tire pressure deviation',
    summary: 'Rear-left tire is reading 11% below the axle baseline.',
    status: 'monitoring',
    severity: 'low',
    category: 'Maintenance',
    assetId: 'TRK-733',
    location: 'West · I-84',
    reportedAt: '2026-08-24T23:28:00.000Z',
    updatedAt: '2026-08-25T05:52:00.000Z',
    confidence: 0.87,
    sentiment: 'neutral',
    tags: ['tire', 'telemetry', 'maintenance'],
    recommendedAction: 'Inspect at the next planned stop; escalate immediately if pressure drops another 3%.',
  },
];

export const seededDocuments: KnowledgeDocument[] = [
  {
    id: 'doc-001',
    title: 'Cold Chain Exception Playbook',
    excerpt: 'Escalation thresholds, containment steps, and recovery procedures for refrigerated cargo temperature excursions.',
    category: 'Playbooks',
    source: 'Operations library',
    updatedAt: '2026-08-21T09:00:00.000Z',
    chunks: 48,
    status: 'indexed',
    metadata: { owner: 'Fleet Quality', version: '4.2' },
  },
  {
    id: 'doc-002',
    title: 'Vehicle Maintenance Standard',
    excerpt: 'Preventive maintenance intervals, inspection requirements, fault-code guidance, and return-to-service controls.',
    category: 'Policies',
    source: 'Engineering handbook',
    updatedAt: '2026-08-18T14:30:00.000Z',
    chunks: 126,
    status: 'indexed',
    metadata: { owner: 'Fleet Engineering', version: '8.1' },
  },
  {
    id: 'doc-003',
    title: 'Driver Safety & Coaching Guide',
    excerpt: 'Risk classification criteria for braking, acceleration, distraction, speeding, and post-event coaching.',
    category: 'Guides',
    source: 'Safety portal',
    updatedAt: '2026-08-16T12:00:00.000Z',
    chunks: 72,
    status: 'indexed',
    metadata: { owner: 'Safety Operations', version: '3.6' },
  },
  {
    id: 'doc-004',
    title: 'Customer SLA Matrix',
    excerpt: 'Service commitments, delivery-window tolerances, notification rules, and priority account escalation paths.',
    category: 'Reference',
    source: 'Commercial operations',
    updatedAt: '2026-08-12T10:20:00.000Z',
    chunks: 38,
    status: 'indexed',
    metadata: { owner: 'Customer Success', version: '2026.3' },
  },
  {
    id: 'doc-005',
    title: 'Severe Weather Routing Protocol',
    excerpt: 'Route-risk scoring and dispatcher actions for storms, flooding, high winds, extreme heat, and low visibility.',
    category: 'Playbooks',
    source: 'Operations library',
    updatedAt: '2026-08-09T16:45:00.000Z',
    chunks: 64,
    status: 'indexed',
    metadata: { owner: 'Network Control', version: '5.0' },
  },
];

export function seededSearch(query: string, scope: string): KnowledgeDocument[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scoped = scope === 'all' ? seededDocuments : seededDocuments.filter((document) => document.category.toLowerCase() === scope.toLowerCase());
  const ranked = scoped
    .map((document, index) => {
      const haystack = `${document.title} ${document.excerpt} ${document.category}`.toLowerCase();
      const matches = terms.filter((term) => haystack.includes(term)).length;
      const semanticBoost = /temperature|reefer|cold|cargo/.test(query.toLowerCase()) && document.id === 'doc-001' ? 0.22 : 0;
      const score = terms.length === 0 ? 0.92 - index * 0.04 : Math.min(0.98, 0.67 + matches * 0.09 + semanticBoost - index * 0.015);
      return { ...document, score: Math.max(0.61, score) };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return ranked.slice(0, 5);
}

function inferSeverity(text: string): Severity {
  const lower = text.toLowerCase();
  if (/fire|collision|unsafe|critical|spoiled|temperature/.test(lower)) return 'critical';
  if (/brake|delay|failure|warning|urgent/.test(lower)) return 'high';
  if (/battery|maintenance|risk|late/.test(lower)) return 'medium';
  return 'low';
}

export function seededClassification(text: string): ClassificationResult {
  const lower = text.toLowerCase();
  const severity = inferSeverity(text);
  const category = /temperature|reefer|cold/.test(lower)
    ? 'Cold chain'
    : /brake|driver|speed/.test(lower)
      ? 'Driver safety'
      : /late|eta|delivery/.test(lower)
        ? 'Delivery risk'
        : 'Maintenance';
  return {
    category,
    severity,
    confidence: 0.91,
    sentiment: severity === 'critical' || severity === 'high' ? 'urgent' : 'neutral',
    summary: text.length > 170 ? `${text.slice(0, 167)}…` : text,
    suggestedTags: [category.toLowerCase().replace(' ', '-'), 'ai-triaged', severity],
    recommendedAction:
      severity === 'critical'
        ? 'Escalate to the duty manager now, validate the sensor reading, and begin the relevant containment playbook.'
        : 'Assign to the relevant operations queue and validate the affected asset at its next safe stop.',
    provider: 'OpsPilot local classifier',
    requiresSupervisor: severity === 'critical',
  };
}

export function seededChat(message: string): ChatResponse {
  const lower = message.toLowerCase();
  const coldChain = /temperature|cold|reefer|cargo|trk-204/.test(lower);
  const critical = seededIncidents.filter((incident) => incident.severity === 'critical' || incident.severity === 'high');
  const answer = coldChain
    ? 'TRK-204 is the priority. Its reefer telemetry has remained 6.2°C above target for twelve minutes, crossing the Cold Chain Exception Playbook escalation threshold. Dispatch the West Hub bay technician now and prepare reefer R-18 for a load transfer if the reading stays elevated for five more minutes. This isolates the cargo risk without disrupting the wider route plan.'
    : `There are ${critical.length} high-priority incidents in the current queue. The most urgent is the TRK-204 cargo temperature variance at West Hub, followed by repeated hard braking on VAN-091. I would triage the cold-chain exception first, contact the VAN-091 driver at the next safe stop, then approve the E12-B reroute for TRK-618.`;
  return {
    sessionId: 'preview-session',
    answer,
    route: 'rag.fleet-operations',
    confidence: coldChain ? 0.94 : 0.91,
    provider: 'OpsPilot seeded RAG',
    latencyMs: 684,
    citations: coldChain
      ? [
          {
            id: 'doc-001',
            title: 'Cold Chain Exception Playbook',
            excerpt: 'Section 3.2 · Active excursion containment',
            score: 0.96,
            source: 'Operations library',
          },
          {
            id: 'INC-1048',
            title: 'INC-1048 · Cargo temperature variance',
            excerpt: 'Live incident record · updated 4 min ago',
            score: 0.93,
            source: 'Incident store',
          },
        ]
      : [
          {
            id: 'incidents',
            title: 'Active incident queue',
            excerpt: 'Fleet incidents · live operational snapshot',
            score: 0.94,
            source: 'Incident store',
          },
          {
            id: 'doc-004',
            title: 'Customer SLA Matrix',
            excerpt: 'Delivery variance and notification policy',
            score: 0.84,
            source: 'Commercial operations',
          },
        ],
    trace: {
      steps: [
        { label: 'Intent router', detail: 'Fleet operations · incident analysis', durationMs: 1, status: 'complete' },
        { label: 'Vector recall', detail: '1 query vector compared against 32 indexed chunks', durationMs: 6, status: 'complete' },
        { label: 'BM25 + MMR rerank', detail: '14 candidates reranked to 5 passages', durationMs: 2, status: 'complete' },
        { label: 'Grounded generation', detail: 'Policy-aware response with action sequence', durationMs: 9, status: 'complete' },
      ],
      candidatesConsidered: 14,
      chunksRetrieved: 5,
      embeddingModel: 'opspilot-hash-embedding-v1',
      generationModel: 'opspilot-grounded-template-v1',
      promptVersion: 'opspilot-prompts@2.1.0',
      turnsInContext: 0,
    },
    toolCalls: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      estimated: true,
    },
    followUps: coldChain
      ? ['Draft the technician dispatch note', 'Show the cold-chain escalation thresholds']
      : ['Summarize the critical incident', 'Which SLAs are currently at risk?'],
  };
}
