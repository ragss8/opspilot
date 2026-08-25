import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronRight,
  Clipboard,
  Clock3,
  Coins,
  Database,
  FileSearch,
  GitBranch,
  Lightbulb,
  LoaderCircle,
  PanelRightOpen,
  Route,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { AiBadge, Confidence, DataSourceBadge, PageHeader } from '../components/UI';
import { api } from '../lib/api';
import type { ChatMessage, ChatResponse, ToolCall } from '../types';

const suggestions = [
  {
    icon: ShieldCheck,
    title: 'Triage the incident queue',
    prompt: 'Summarize the active critical incidents and recommend the next actions in priority order.',
    accent: 'red',
  },
  {
    icon: Route,
    title: 'Review delay policy',
    prompt: 'What does the priority shipment delay procedure require from the control tower?',
    accent: 'amber',
  },
  {
    icon: FileSearch,
    title: 'Check a policy',
    prompt: 'What does the cold-chain playbook require for an active temperature excursion?',
    accent: 'cyan',
  },
];

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100_000)}`;
}

export function CopilotPage() {
  const location = useLocation();
  const state = location.state as { prompt?: string } | null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [latestResponse, setLatestResponse] = useState<ChatResponse | null>(null);
  const [source, setSource] = useState<'live' | 'demo'>('live');
  const [traceOpen, setTraceOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [liveTools, setLiveTools] = useState<ToolCall[]>([]);
  const [indexedChunks, setIndexedChunks] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const initialPromptSent = useRef(false);

  useEffect(() => {
    void api.health().then((health) => {
      if (health) setIndexedChunks(health.indexedChunks);
    });
  }, []);

  const sendMessage = useCallback(async (raw: string) => {
    const message = raw.trim();
    if (message.length < 2 || isLoading) return;
    const userMessage: ChatMessage = {
      id: createId('user'),
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
    };
    const pendingId = createId('assistant');
    setMessages((current) => [
      ...current,
      userMessage,
      { id: pendingId, role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true },
    ]);
    setInput('');
    setIsLoading(true);
    setLiveTools([]);

    // Tokens are appended as they arrive so the answer renders progressively.
    let streamed = '';
    const result = await api.streamChat(message, sessionId, (event) => {
      if (event.type === 'token') {
        streamed += event.text;
        setMessages((current) =>
          current.map((entry) =>
            entry.id === pendingId
              ? { ...entry, content: streamed, pending: false, streaming: true }
              : entry,
          ),
        );
      }
      if (event.type === 'tool') {
        setLiveTools((current) => [...current, event.call]);
      }
    });

    setSource(result.source);
    setLatestResponse(result.data);
    if (result.data.sessionId) setSessionId(result.data.sessionId);
    setMessages((current) =>
      current.map((entry) =>
        entry.id === pendingId
          ? {
              ...entry,
              content: result.data.answer,
              response: result.data,
              pending: false,
              streaming: false,
            }
          : entry,
      ),
    );
    setIsLoading(false);
  }, [isLoading, sessionId]);

  const startNewConversation = useCallback(() => {
    if (sessionId) void api.resetSession(sessionId);
    setSessionId(undefined);
    setMessages([]);
    setLatestResponse(null);
    setLiveTools([]);
  }, [sessionId]);

  useEffect(() => {
    if (state?.prompt && !initialPromptSent.current) {
      initialPromptSent.current = true;
      void sendMessage(state.prompt);
    }
  }, [sendMessage, state?.prompt]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  async function copyAnswer(message: ChatMessage) {
    if (navigator.clipboard) await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(null), 1_500);
  }

  return (
    <div className="page copilot-page">
      <PageHeader
        eyebrow="AI workspace / Grounded operations assistant"
        title="Ops Copilot"
        description="Investigate exceptions, retrieve policy, and turn fleet signals into a clear next action."
        actions={
          <>
            <DataSourceBadge source={source} />
            {messages.length > 0 ? (
              <button className="button button--secondary" type="button" onClick={startNewConversation}>
                <RefreshCw size={15} /> New conversation
              </button>
            ) : null}
            <button className="button button--secondary trace-toggle" type="button" onClick={() => setTraceOpen(true)}>
              <PanelRightOpen size={15} /> Retrieval trace
            </button>
          </>
        }
      />

      <div className="copilot-layout">
        <section className="copilot-chat panel" aria-label="Conversation with Ops Copilot">
          <div className="copilot-chat__status">
            <div>
              <span className="copilot-avatar"><Sparkles size={17} /></span>
              <div>
                <strong>OpsPilot AI</strong>
                <span>
                  <i />
                  {sessionId ? 'Conversation in progress' : 'Ready'} · Fleet context connected
                </span>
              </div>
            </div>
            <div className="copilot-context">
              <Database size={13} />
              {indexedChunks === null ? 'Indexing…' : `${indexedChunks} indexed chunks`}
            </div>
          </div>

          <div className={`chat-scroll ${messages.length === 0 ? 'chat-scroll--empty' : ''}`} aria-live="polite">
            {messages.length === 0 ? (
              <div className="copilot-welcome">
                <div className="copilot-welcome__orb"><BrainCircuit size={29} /></div>
                <AiBadge>Fleet context is ready</AiBadge>
                <h2>Where should we look first?</h2>
                <p>I can correlate live incidents with operating policy, explain the evidence, and recommend a safe next step.</p>
                <div className="suggestion-grid">
                  {suggestions.map(({ icon: Icon, title, prompt, accent }) => (
                    <button key={title} className={`suggestion-card suggestion-card--${accent}`} onClick={() => void sendMessage(prompt)}>
                      <span className="suggestion-card__icon"><Icon size={18} /></span>
                      <strong>{title}</strong>
                      <span>{prompt}</span>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="message-list">
                {messages.map((message) => (
                  <article className={`message message--${message.role}`} key={message.id}>
                    <div className="message__avatar">
                      {message.role === 'assistant' ? <Sparkles size={16} /> : <UserRound size={16} />}
                    </div>
                    <div className="message__body">
                      <div className="message__heading">
                        <strong>{message.role === 'assistant' ? 'OpsPilot AI' : 'You'}</strong>
                        <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                        {message.role === 'assistant' && !message.pending && !message.streaming ? (
                          <AiBadge>Grounded answer</AiBadge>
                        ) : null}
                        {message.streaming ? <AiBadge>Streaming…</AiBadge> : null}
                      </div>
                      {message.pending ? (
                        <div className="thinking-state" role="status">
                          <div className="thinking-dots"><span /><span /><span /></div>
                          <div><strong>Investigating your fleet context</strong><span>Retrieving incidents, policies, and telemetry…</span></div>
                        </div>
                      ) : (
                        <>
                          <div className="message__content">{message.content}</div>
                          {message.response ? (
                            <div className="answer-evidence">
                              <div className="answer-evidence__meta">
                                <Confidence value={message.response.confidence} />
                                <span><GitBranch size={12} /> {message.response.route}</span>
                                <span><Clock3 size={12} /> {message.response.latencyMs} ms</span>
                                {message.response.usage.totalTokens > 0 ? (
                                  <span title={message.response.usage.estimated ? 'Counted locally' : 'Reported by the provider'}>
                                    <Coins size={12} /> {message.response.usage.totalTokens} tok
                                    {message.response.usage.costUsd > 0
                                      ? ` · $${message.response.usage.costUsd.toFixed(5)}`
                                      : ''}
                                  </span>
                                ) : null}
                              </div>
                              {message.response.citations.length > 0 ? (
                                <div className="citation-list">
                                  {message.response.citations.map((citation, index) => (
                                    <button className="citation-card" key={`${message.id}-${citation.id}`} type="button" onClick={() => setTraceOpen(true)}>
                                      <span className="citation-card__number">{index + 1}</span>
                                      <span>
                                        <strong>{citation.title}</strong>
                                        <small>{citation.section || citation.excerpt || citation.source}</small>
                                      </span>
                                      {citation.score !== undefined ? <em>{Math.round(citation.score * 100)}%</em> : null}
                                      <ChevronRight size={14} />
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              <div className="message__actions">
                                <button type="button" onClick={() => void copyAnswer(message)}>
                                  {copiedId === message.id ? <Check size={13} /> : <Clipboard size={13} />}
                                  {copiedId === message.id ? 'Copied' : 'Copy'}
                                </button>
                                <button type="button" onClick={() => setTraceOpen(true)}><GitBranch size={13} /> View trace</button>
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </article>
                ))}

                {latestResponse?.followUps.length ? (
                  <div className="follow-ups">
                    <span><Lightbulb size={13} /> Continue the investigation</span>
                    <div>
                      {latestResponse.followUps.map((followUp) => (
                        <button type="button" key={followUp} onClick={() => void sendMessage(followUp)}>{followUp}<ArrowRight size={13} /></button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <div className="composer-wrap">
            <form className="composer" onSubmit={submit}>
              <label className="sr-only" htmlFor="copilot-message">Message OpsPilot</label>
              <textarea
                id="copilot-message"
                rows={2}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about an incident, route, asset, or operating policy…"
                disabled={isLoading}
              />
              <div className="composer__footer">
                <span><Sparkles size={13} /> RAG grounded · Citations on</span>
                <span className="composer__hint">↵ send · ⇧↵ new line</span>
                <button className="composer__send" type="submit" disabled={input.trim().length < 2 || isLoading} aria-label="Send message">
                  {isLoading ? <LoaderCircle size={18} className="spin" /> : <Send size={18} />}
                </button>
              </div>
            </form>
            <p className="composer-note">OpsPilot can make mistakes. Verify high-impact actions against cited source material.</p>
          </div>
        </section>

        <aside className={`trace-panel panel ${traceOpen ? 'trace-panel--open' : ''}`} aria-label="Retrieval trace">
          <div className="trace-panel__header">
            <div><span className="section-kicker section-kicker--ai"><span /> Explainability</span><h2>Retrieval trace</h2></div>
            <button className="icon-button trace-panel__close" onClick={() => setTraceOpen(false)} aria-label="Close retrieval trace"><X size={18} /></button>
          </div>
          {latestResponse ? (
            <>
              <div className="trace-route">
                <span><GitBranch size={15} /></span>
                <div><small>Selected route</small><strong>{latestResponse.route}</strong></div>
                <Confidence value={latestResponse.confidence} compact />
              </div>
              <ol className="trace-timeline">
                {latestResponse.trace.steps.length > 0 ? latestResponse.trace.steps.map((step, index) => (
                  <li key={`${step.label}-${index}`} className={`trace-step trace-step--${step.status ?? 'complete'}`}>
                    <span className="trace-timeline__marker">
                      {step.status === 'skipped' ? <X size={11} /> : <Check size={11} />}
                    </span>
                    <div>
                      <strong>{step.label}</strong>
                      <p>{step.detail}</p>
                      {step.status === 'fallback' ? <em className="trace-step__flag">fell back to the local engine</em> : null}
                    </div>
                    {step.durationMs !== undefined ? <time>{step.durationMs} ms</time> : null}
                  </li>
                )) : <li><span className="trace-timeline__marker"><Check size={11} /></span><div><strong>Response completed</strong><p>The provider did not return step-level trace data.</p></div></li>}
              </ol>
              {(liveTools.length > 0 || latestResponse.toolCalls.length > 0) ? (
                <div className="trace-tools">
                  <span className="section-kicker">Tool calls</span>
                  <h3>{(latestResponse.toolCalls.length || liveTools.length)} typed operation(s)</h3>
                  {(latestResponse.toolCalls.length ? latestResponse.toolCalls : liveTools).map((call, index) => (
                    <div className={`trace-tool ${call.error ? 'trace-tool--error' : ''}`} key={`${call.name}-${index}`}>
                      <span className="trace-tool__icon"><Wrench size={13} /></span>
                      <div>
                        <strong>{call.name}</strong>
                        <small>
                          {Object.keys(call.arguments).length > 0
                            ? JSON.stringify(call.arguments)
                            : 'no arguments'}
                        </small>
                        {call.error ? <em>{call.error}</em> : null}
                      </div>
                      <time>{call.durationMs} ms</time>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="trace-sources">
                <span className="section-kicker">Context window</span>
                <h3>{latestResponse.trace.chunksRetrieved || latestResponse.citations.length} chunks retrieved</h3>
                {latestResponse.trace.candidatesConsidered > 0 ? (
                  <p className="trace-sources__note">
                    Reranked from {latestResponse.trace.candidatesConsidered} vector candidates
                    {latestResponse.trace.turnsInContext > 0
                      ? ` · ${latestResponse.trace.turnsInContext} prior turn(s) in context`
                      : ''}
                  </p>
                ) : null}
                {latestResponse.citations.map((citation, index) => (
                  <div className="trace-source" key={citation.id}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{citation.title}</strong>
                      <small>
                        {citation.id}
                        {citation.section ? ` · ${citation.section}` : ''}
                      </small>
                    </div>
                    {citation.score !== undefined ? <em>{Math.round(citation.score * 100)}%</em> : null}
                  </div>
                ))}
              </div>
              <div className="model-card">
                <BrainCircuit size={16} />
                <div>
                  <small>{latestResponse.trace.embeddingModel} → generation</small>
                  <strong>{latestResponse.trace.generationModel}</strong>
                  <small>{latestResponse.trace.promptVersion}</small>
                </div>
                <span>{latestResponse.latencyMs} ms</span>
              </div>
            </>
          ) : (
            <div className="trace-empty">
              <div><GitBranch size={24} /></div>
              <h3>No trace yet</h3>
              <p>Ask a question to see how OpsPilot routes intent, retrieves context, ranks sources, and grounds its answer.</p>
              <div className="trace-empty__flow"><span>Intent</span><i /><span>Retrieve</span><i /><span>Answer</span></div>
            </div>
          )}
        </aside>
        {traceOpen ? <button className="drawer-backdrop" aria-label="Close retrieval trace" onClick={() => setTraceOpen(false)} /> : null}
      </div>
    </div>
  );
}
