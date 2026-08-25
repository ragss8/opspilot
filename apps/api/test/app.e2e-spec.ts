import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import type { ChatResponse } from '../src/ai/ai.types';
import { FleetService } from '../src/fleet/fleet.service';

/** supertest types `body` as `any`; narrow it once at the call site. */
function body<T>(response: { body: unknown }): T {
  return response.body as T;
}

describe('OpsPilot API (e2e)', () => {
  let app: INestApplication;
  let fleet: FleetService;

  beforeAll(async () => {
    process.env.AI_PROVIDER = 'local';
    delete process.env.OPSPILOT_API_KEY;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    fleet = app.get(FleetService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health reports a built index', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'opspilot-api',
      ai: {
        provider: 'local',
        embeddingModel: 'opspilot-hash-embedding-v1',
        index: { ready: true, dimensions: 256 },
      },
    });
    // Documents are chunked, so there are more chunks than source documents.
    expect(response.body.ai.index.chunks).toBeGreaterThan(16);
    expect(response.body.ai.promptVersion).toMatch(/^opspilot-prompts@/);
  });

  it('GET /api/overview derives every metric from records', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/overview')
      .expect(200);
    const facts = fleet.getFacts();

    expect(response.body.metrics).toMatchObject({
      totalVehicles: facts.totalVehicles,
      activeVehicles: facts.activeVehicles,
      delayedVehicles: facts.delayedVehicles,
      distanceTodayKm: facts.distanceTodayKm,
    });
    expect(response.body.fleetStatus).toEqual({
      active: facts.activeVehicles,
      idle: facts.idleVehicles,
      maintenance: facts.maintenanceVehicles,
      offline: facts.offlineVehicles,
    });
    expect(response.body.timeSeries).toHaveLength(7);
    expect(response.body.incidentFeed.length).toBeGreaterThan(0);
    expect(response.body.dailyBrief.priorities.length).toBeGreaterThan(0);
    expect(response.body.aiHealth.promptVersion).toMatch(/^opspilot-prompts@/);
  });

  it('GET /api/ai/search returns chunk-level results with component scores', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/ai/search')
      .query({ q: 'cold chain temperature quarantine', scope: 'knowledge' })
      .expect(200);

    expect(response.body.results[0]).toMatchObject({
      documentId: 'KB-OPS-014',
      type: 'knowledge',
    });
    expect(response.body.results[0].id).toMatch(/^KB-OPS-014#\d+$/);
    expect(response.body.results[0].vectorScore).toBeGreaterThan(0);
    expect(response.body.results[0].chunkCount).toBeGreaterThan(1);
    expect(response.body.embeddingModel).toBe('opspilot-hash-embedding-v1');
    expect(response.body.candidatesConsidered).toBeGreaterThan(0);
  });

  it('GET /api/ai/search rejects an out-of-range limit', async () => {
    await request(app.getHttpServer())
      .get('/api/ai/search')
      .query({ q: 'brake', scope: 'knowledge', limit: 99 })
      .expect(400);
  });

  it('POST /api/ai/chat returns the complete grounded contract', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/ai/chat')
      .send({ message: 'What is the brake overheat procedure?' })
      .expect(201);

    expect(response.body).toMatchObject({
      route: 'KNOWLEDGE_QUERY',
      provider: 'local',
      trace: {
        embeddingModel: 'opspilot-hash-embedding-v1',
        generationModel: 'opspilot-grounded-template-v1',
      },
    });
    expect(response.body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.answer).toContain('KB-SAF-001');
    expect(response.body.citations[0].documentId).toBe('KB-SAF-001');
    expect(response.body.followUps).toHaveLength(3);
    expect(response.body.usage.totalTokens).toBeGreaterThan(0);
    expect(
      body<ChatResponse>(response).trace.steps.map((step) => step.label),
    ).toEqual(
      expect.arrayContaining(['Intent router', 'Vector recall', 'BM25 + MMR rerank']),
    );
  });

  it('answers a metric question through typed tools, not prose estimation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/ai/chat')
      .send({ message: 'How many vehicles are delayed?' })
      .expect(201);
    const facts = fleet.getFacts();

    expect(response.body.route).toBe('DATABASE_QUERY');
    expect(response.body.toolCalls.length).toBeGreaterThan(0);
    expect(response.body.answer).toContain(String(facts.delayedVehicles));
  });

  it('filters and orders incidents by severity and SLA', async () => {
    const critical = await request(app.getHttpServer())
      .post('/api/ai/chat')
      .send({ message: 'Show critical incidents' })
      .expect(201);

    expect(critical.body.route).toBe('INCIDENT_SEARCH');
    body<ChatResponse>(critical).citations.forEach((citation) => {
      const incident = fleet
        .listIncidents()
        .find((item) => item.id === citation.documentId);
      expect(incident?.severity).toBe('critical');
    });

    const sla = await request(app.getHttpServer())
      .post('/api/ai/chat')
      .send({ message: 'Which incidents are nearing SLA?' })
      .expect(201);

    expect(sla.body.route).toBe('INCIDENT_SEARCH');
    expect(sla.body.answer).toMatch(/SLA (?:due|overdue)/);
    expect(sla.body.citations.length).toBeGreaterThan(0);
  });

  it('continues a conversation across requests with the returned session id', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/ai/chat')
      .send({ message: 'What does the cold chain playbook require?' })
      .expect(201);
    const firstSession = body<ChatResponse>(first).sessionId;

    const second = await request(app.getHttpServer())
      .post('/api/ai/chat')
      .send({ message: 'Who signs it off?', sessionId: firstSession })
      .expect(201);

    expect(body<ChatResponse>(second).sessionId).toBe(firstSession);
    expect(second.body.trace.turnsInContext).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .delete(`/api/ai/session/${firstSession}`)
      .expect(200);

    const third = await request(app.getHttpServer())
      .post('/api/ai/chat')
      .send({ message: 'Who signs it off?', sessionId: firstSession })
      .expect(201);
    expect(body<ChatResponse>(third).trace.turnsInContext).toBe(0);
  });

  it('rejects a malformed session id', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/chat')
      .send({ message: 'Summarize today', sessionId: 'not-a-uuid' })
      .expect(400);
  });

  it('POST /api/ai/chat/stream emits events and a final response', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/ai/chat/stream')
      .send({ message: 'What is the brake overheat procedure?' })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);

    const events = response.text
      .split('\n\n')
      .filter((block) => block.startsWith('data: '))
      .map(
        (block) =>
          JSON.parse(block.slice(6)) as {
            type: string;
            response?: { answer: string };
          },
      );

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['route', 'retrieval', 'token', 'done']),
    );
    const done = events.find((event) => event.type === 'done');
    expect(done?.response?.answer).toContain('KB-SAF-001');
  });

  it('POST /api/ai/classify returns triage and rejects unknown fields', async () => {
    const classification = await request(app.getHttpServer())
      .post('/api/ai/classify')
      .send({ text: 'Smoke is coming from the brakes on vehicle VH-99.' })
      .expect(201);

    expect(classification.body).toMatchObject({
      category: 'Safety',
      severity: 'critical',
      requiresSupervisor: true,
    });
    expect(classification.body.promptVersion).toMatch(/^classify@/);

    await request(app.getHttpServer())
      .post('/api/ai/classify')
      .send({ text: 'A routine report', unexpected: true })
      .expect(400);
  });

  it('GET /api/ai/telemetry reports the runs this process served', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/ai/telemetry')
      .expect(200);

    expect(response.body.snapshot.totalRuns).toBeGreaterThan(0);
    expect(response.body.index.chunks).toBeGreaterThan(16);
    expect(response.body.recent.length).toBeGreaterThan(0);
  });
});

describe('OpsPilot API authentication', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.AI_PROVIDER = 'local';
    process.env.OPSPILOT_API_KEY = 'test-key';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    delete process.env.OPSPILOT_API_KEY;
    await app.close();
  });

  it('leaves health public so probes keep working', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });

  it('rejects an unauthenticated request when a key is configured', async () => {
    await request(app.getHttpServer()).get('/api/overview').expect(401);
  });

  it('accepts a request carrying the configured key', async () => {
    await request(app.getHttpServer())
      .get('/api/overview')
      .set('x-api-key', 'test-key')
      .expect(200);
  });
});
