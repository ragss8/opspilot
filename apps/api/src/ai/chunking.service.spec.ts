import { KNOWLEDGE_DOCUMENTS, INCIDENTS } from '../fleet/fleet.data';
import { ChunkingService } from './chunking.service';

describe('ChunkingService', () => {
  const service = new ChunkingService();

  it('splits a long procedure into several overlapping chunks', async () => {
    const document = KNOWLEDGE_DOCUMENTS.find((doc) => doc.id === 'KB-SAF-001');
    const chunks = await service.chunkDocument(document!);

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, index) => {
      expect(chunk.id).toBe(`KB-SAF-001#${index}`);
      expect(chunk.documentId).toBe('KB-SAF-001');
      expect(chunk.chunkIndex).toBe(index);
      expect(chunk.chunkCount).toBe(chunks.length);
      expect(chunk.text.length).toBeLessThanOrEqual(
        ChunkingService.CHUNK_SIZE + ChunkingService.CHUNK_OVERLAP,
      );
    });
  });

  it('carries document metadata onto every chunk', async () => {
    const document = KNOWLEDGE_DOCUMENTS[0]!;
    const chunks = await service.chunkDocument(document);

    chunks.forEach((chunk) => {
      expect(chunk.metadata.version).toBe(document.version);
      expect(chunk.metadata.category).toBe(document.category);
      expect(chunk.metadata.documentId).toBe(document.id);
    });
  });

  it('keeps an incident whole so its metadata stays with its description', () => {
    const incident = INCIDENTS[0]!;
    const chunk = service.chunkIncident(incident);

    expect(chunk.chunkCount).toBe(1);
    expect(chunk.id).toBe(`${incident.id}#0`);
    expect(chunk.metadata.severity).toBe(incident.severity);
    expect(chunk.metadata.status).toBe(incident.status);
    expect(chunk.text).toContain(incident.vehicleId);
  });

  it('derives a per-chunk heading from the passage itself', async () => {
    const document = KNOWLEDGE_DOCUMENTS.find((doc) => doc.id === 'KB-SAF-001');
    const chunks = await service.chunkDocument(document!);

    expect(chunks[0]?.section).toBe('Scope');
  });
});
