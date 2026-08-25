import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AiRoute, ConversationTurn } from './ai.types';
import { countTokens } from './usage';

interface Session {
  id: string;
  turns: ConversationTurn[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Multi-turn conversation state.
 *
 * History is trimmed by both turn count and token budget, because a long
 * session otherwise grows the prompt without bound. Sessions live in process
 * and expire; a production deployment would persist them per user.
 */
@Injectable()
export class ConversationService {
  static readonly MAX_TURNS = 10;
  static readonly MAX_HISTORY_TOKENS = 1200;
  static readonly SESSION_TTL_MS = 60 * 60 * 1000;
  static readonly MAX_SESSIONS = 500;

  private readonly sessions = new Map<string, Session>();

  createSession(): string {
    return randomUUID();
  }

  /**
   * Returns the session id to use for this request, creating one when the
   * caller did not supply a valid existing id.
   */
  resolveSession(sessionId?: string): string {
    if (sessionId && this.sessions.has(sessionId)) return sessionId;
    return sessionId && isUuid(sessionId) ? sessionId : this.createSession();
  }

  history(sessionId: string): ConversationTurn[] {
    this.prune();
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    // Newest-first accumulation against the token budget, then restore order.
    const selected: ConversationTurn[] = [];
    let tokens = 0;
    for (const turn of [...session.turns].reverse()) {
      const cost = countTokens(turn.content);
      if (
        selected.length >= ConversationService.MAX_TURNS ||
        tokens + cost > ConversationService.MAX_HISTORY_TOKENS
      ) {
        break;
      }
      selected.push(turn);
      tokens += cost;
    }
    return selected.reverse();
  }

  append(sessionId: string, turn: ConversationTurn): void {
    const session = this.sessions.get(sessionId) ?? {
      id: sessionId,
      turns: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    session.turns.push(turn);
    session.updatedAt = Date.now();
    if (session.turns.length > ConversationService.MAX_TURNS * 2) {
      session.turns = session.turns.slice(-ConversationService.MAX_TURNS * 2);
    }
    this.sessions.set(sessionId, session);
    this.enforceCapacity();
  }

  reset(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  get size(): number {
    return this.sessions.size;
  }

  /**
   * A follow-up like "what about the other one?" carries no retrievable terms.
   * Detect that so the caller can rewrite it into a standalone query before
   * routing and retrieval, which is what makes multi-turn RAG work at all.
   */
  needsCondensation(message: string, history: readonly ConversationTurn[]): boolean {
    if (history.length === 0) return false;
    const normalized = message.toLowerCase().trim();
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;

    const anaphoric =
      /\b(it|its|that|this|those|these|they|them|their|the other|the first|the second|the last|same|there)\b/.test(
        normalized,
      );
    const elliptical =
      /^(what about|how about|and |but |why|why not|when|where|who|which one|the other)/.test(
        normalized,
      );

    return wordCount <= 8 || anaphoric || elliptical;
  }

  /**
   * Deterministic condensation: prefix the most recent operator question so the
   * follow-up inherits its subject. Used in local mode and as the fallback when
   * a hosted rewrite fails.
   */
  condenseLocally(
    message: string,
    history: readonly ConversationTurn[],
  ): string {
    const lastUserTurn = [...history]
      .reverse()
      .find((turn) => turn.role === 'user');
    if (!lastUserTurn) return message;
    return `${lastUserTurn.content} ${message}`.trim();
  }

  lastRoute(sessionId: string): AiRoute | undefined {
    const session = this.sessions.get(sessionId);
    return [...(session?.turns ?? [])]
      .reverse()
      .find((turn) => turn.route)?.route;
  }

  private prune(): void {
    const cutoff = Date.now() - ConversationService.SESSION_TTL_MS;
    this.sessions.forEach((session, id) => {
      if (session.updatedAt < cutoff) this.sessions.delete(id);
    });
  }

  private enforceCapacity(): void {
    if (this.sessions.size <= ConversationService.MAX_SESSIONS) return;
    const oldest = [...this.sessions.values()].sort(
      (left, right) => left.updatedAt - right.updatedAt,
    );
    oldest
      .slice(0, this.sessions.size - ConversationService.MAX_SESSIONS)
      .forEach((session) => this.sessions.delete(session.id));
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
