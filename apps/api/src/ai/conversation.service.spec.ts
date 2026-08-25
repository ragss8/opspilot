import { ConversationService } from './conversation.service';

describe('ConversationService', () => {
  let conversation: ConversationService;

  beforeEach(() => {
    conversation = new ConversationService();
  });

  it('creates a session id when none is supplied', () => {
    const sessionId = conversation.resolveSession();

    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('keeps turns within one session and isolates them from another', () => {
    const first = conversation.resolveSession();
    const second = conversation.resolveSession();

    conversation.append(first, {
      role: 'user',
      content: 'What is the brake procedure?',
      createdAt: new Date().toISOString(),
    });

    expect(conversation.history(first)).toHaveLength(1);
    expect(conversation.history(second)).toHaveLength(0);
  });

  it('trims history to the turn limit', () => {
    const sessionId = conversation.resolveSession();
    for (let index = 0; index < ConversationService.MAX_TURNS + 6; index += 1) {
      conversation.append(sessionId, {
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${index}`,
        createdAt: new Date().toISOString(),
      });
    }

    expect(conversation.history(sessionId).length).toBeLessThanOrEqual(
      ConversationService.MAX_TURNS,
    );
  });

  it('trims history to the token budget before the turn budget', () => {
    const sessionId = conversation.resolveSession();
    const long = 'brake inspection procedure '.repeat(120);
    for (let index = 0; index < 5; index += 1) {
      conversation.append(sessionId, {
        role: 'user',
        content: long,
        createdAt: new Date().toISOString(),
      });
    }

    const history = conversation.history(sessionId);
    expect(history.length).toBeLessThan(5);
  });

  it('keeps the most recent turns, in chronological order', () => {
    const sessionId = conversation.resolveSession();
    ['first', 'second', 'third'].forEach((content) =>
      conversation.append(sessionId, {
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      }),
    );

    expect(conversation.history(sessionId).map((turn) => turn.content)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('detects a follow-up that cannot be retrieved on its own', () => {
    const history = [
      {
        role: 'user' as const,
        content: 'What does the cold chain playbook require?',
        createdAt: new Date().toISOString(),
      },
    ];

    expect(conversation.needsCondensation('What about disposition?', history)).toBe(true);
    expect(conversation.needsCondensation('Who signs it off?', history)).toBe(true);
    expect(
      conversation.needsCondensation(
        'What is the full brake overheat emergency response procedure for a trailer axle?',
        history,
      ),
    ).toBe(false);
  });

  it('never condenses the first message of a session', () => {
    expect(conversation.needsCondensation('What about that?', [])).toBe(false);
  });

  it('rewrites a follow-up to inherit the previous subject', () => {
    const history = [
      {
        role: 'user' as const,
        content: 'What does the cold chain playbook require?',
        createdAt: new Date().toISOString(),
      },
      {
        role: 'assistant' as const,
        content: 'It requires quarantine and evidence preservation.',
        createdAt: new Date().toISOString(),
      },
    ];

    expect(conversation.condenseLocally('What about disposition?', history)).toBe(
      'What does the cold chain playbook require? What about disposition?',
    );
  });

  it('discards a session on reset', () => {
    const sessionId = conversation.resolveSession();
    conversation.append(sessionId, {
      role: 'user',
      content: 'hello',
      createdAt: new Date().toISOString(),
    });
    conversation.reset(sessionId);

    expect(conversation.history(sessionId)).toHaveLength(0);
  });
});
