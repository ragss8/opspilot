import { AiRouterService } from './ai-router.service';

describe('AiRouterService', () => {
  const router = new AiRouterService();

  it.each([
    ['Give me a summary of today’s risks', 'SUMMARY'],
    ['Summarize critical incidents', 'INCIDENT_SEARCH'],
    ['Which incidents are nearing SLA?', 'INCIDENT_SEARCH'],
    ['Show critical incidents', 'INCIDENT_SEARCH'],
    ['How many vehicles are active?', 'DATABASE_QUERY'],
    ['Show open incidents involving tyres', 'INCIDENT_SEARCH'],
    ['What is the brake overheat procedure?', 'KNOWLEDGE_QUERY'],
    ['Hello, what can you do?', 'GENERAL'],
  ] as const)('routes %s to %s', (message, expected) => {
    expect(router.route(message).route).toBe(expected);
  });

  it('restricts incident searches to incident chunks', () => {
    expect(router.route('Find recent brake incidents').scope).toBe('incidents');
  });
});
