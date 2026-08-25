import { Injectable } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type {
  FleetIncident,
  KnowledgeDocument,
} from '../fleet/fleet.types';
import type { IndexedChunk } from './ai.types';

/**
 * Splits source documents into retrievable passages.
 *
 * Procedures are long and multi-topic, so they are split with a recursive
 * character splitter that prefers paragraph boundaries and keeps an overlap so
 * a rule split across two chunks is still retrievable from either side.
 *
 * Incidents are deliberately NOT split. An incident is a short atomic record,
 * and splitting it would separate its severity and status metadata from its
 * description, which is exactly what the metadata filters need to stay together.
 */
@Injectable()
export class ChunkingService {
  static readonly CHUNK_SIZE = 900;
  static readonly CHUNK_OVERLAP = 150;

  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: ChunkingService.CHUNK_SIZE,
    chunkOverlap: ChunkingService.CHUNK_OVERLAP,
    separators: ['\n\n', '\n', '. ', ', ', ' ', ''],
  });

  async chunkDocument(
    document: KnowledgeDocument,
  ): Promise<IndexedChunk[]> {
    const passages = await this.splitter.splitText(document.content);
    const chunkCount = Math.max(1, passages.length);

    return passages.map((text, chunkIndex) => ({
      id: `${document.id}#${chunkIndex}`,
      documentId: document.id,
      title: document.title,
      section: this.sectionFor(document, text, chunkIndex),
      text: text.trim(),
      type: 'knowledge',
      chunkIndex,
      chunkCount,
      metadata: {
        category: document.category,
        owner: document.owner,
        updatedAt: document.updatedAt,
        version: document.version,
        keywords: document.keywords,
        chunkIndex,
        chunkCount,
        documentId: document.id,
      },
    }));
  }

  chunkIncident(incident: FleetIncident): IndexedChunk {
    return {
      id: `${incident.id}#0`,
      documentId: incident.id,
      title: incident.title,
      section: `${incident.category} / ${incident.subcategory}`,
      text: `${incident.description} Recommended action: ${incident.recommendedAction} Severity: ${incident.severity}. Status: ${incident.status}. SLA target: ${incident.slaMinutes} minutes. Vehicle: ${incident.vehicleId}. Location: ${incident.location}.`,
      type: 'incident',
      chunkIndex: 0,
      chunkCount: 1,
      metadata: {
        vehicleId: incident.vehicleId,
        severity: incident.severity,
        status: incident.status,
        category: incident.category,
        subcategory: incident.subcategory,
        location: incident.location,
        reportedAt: incident.reportedAt,
        assignee: incident.assignee,
        slaMinutes: incident.slaMinutes,
        recommendedAction: incident.recommendedAction,
        tags: incident.tags,
        documentId: incident.id,
      },
    };
  }

  /**
   * Derives a per-chunk heading from the leading sentence so citations point at
   * a passage a human can find, rather than repeating the document section.
   */
  private sectionFor(
    document: KnowledgeDocument,
    text: string,
    chunkIndex: number,
  ): string {
    const lead = text.trim().split(/(?<=\.)\s/)[0]?.trim() ?? '';
    const heading = lead.match(/^([A-Z][A-Za-z\s-]{2,40})\./)?.[1];
    if (heading) return heading;
    return chunkIndex === 0
      ? document.section
      : `${document.section} (part ${chunkIndex + 1})`;
  }
}
