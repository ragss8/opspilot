import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Database,
  FileCheck2,
  FileText,
  Filter,
  Layers3,
  LoaderCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DataSourceBadge, PageHeader, PageSkeleton } from '../components/UI';
import { api } from '../lib/api';
import type { ApiResult, KnowledgeDocument } from '../types';

const fallbackScopes = ['Playbooks', 'Policies', 'Guides', 'Reference'];
const sampleQueries = [
  'Cold-chain temperature excursion response',
  'Brake overheat release criteria',
  'Driver hours-of-service intervention',
];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function KnowledgePage() {
  const [documentsResult, setDocumentsResult] = useState<ApiResult<KnowledgeDocument[]> | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [results, setResults] = useState<KnowledgeDocument[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTime, setSearchTime] = useState<number | null>(null);
  const [selected, setSelected] = useState<KnowledgeDocument | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void api.documents().then(setDocumentsResult);
  }, []);

  const categories = useMemo(() => {
    const docs = documentsResult?.data ?? [];
    const names = [...new Set(docs.map((document) => document.category))];
    return (names.length ? names : fallbackScopes).map((name) => ({ name, count: docs.filter((document) => document.category === name).length }));
  }, [documentsResult]);
  const scopeOptions = useMemo(() => ['all', ...categories.map((category) => category.name)], [categories]);

  async function runSearch(rawQuery: string = query, nextScope: string = scope) {
    const trimmed = rawQuery.trim();
    if (trimmed.length < 2) return;
    setQuery(trimmed);
    setIsSearching(true);
    const start = performance.now();
    const response = await api.search(trimmed, nextScope);
    setResults(response.data);
    setSearchTime(Math.max(1, Math.round(performance.now() - start)));
    setDocumentsResult((current) => current ? { ...current, source: response.source } : current);
    setIsSearching(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void runSearch();
  }

  if (!documentsResult) return <PageSkeleton cards={3} />;

  const visibleDocuments = results ?? documentsResult.data;
  const hasSearch = results !== null;

  return (
    <div className="page knowledge-page">
      <PageHeader
        eyebrow="Knowledge intelligence / Vector search"
        title="Operations knowledge"
        description="Search playbooks, policies, and guides by meaning—not just matching words."
        actions={
          <>
            <DataSourceBadge source={documentsResult.source} />
            <button className="button button--secondary" type="button" disabled title="Source ingestion is read-only in the synthetic demo"><Upload size={15} /> Add source</button>
          </>
        }
      />

      <section className="knowledge-search panel" aria-label="Semantic knowledge search">
        <div className="knowledge-search__glow"><Sparkles size={20} /></div>
        <div className="knowledge-search__intro">
          <span className="section-kicker section-kicker--ai"><span /> Semantic retrieval</span>
          <h2>What do you need to know?</h2>
          <p>OpsPilot searches the meaning of your question across every indexed source.</p>
        </div>
        <form className="semantic-search" onSubmit={submit}>
          <Search size={20} aria-hidden="true" />
          <label className="sr-only" htmlFor="knowledge-query">Search operations knowledge</label>
          <input
            id="knowledge-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try “What should I do when a reefer exceeds its temperature limit?”"
          />
          <button type="submit" disabled={query.trim().length < 2 || isSearching}>
            {isSearching ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={17} />}
            <span>{isSearching ? 'Searching' : 'Semantic search'}</span>
          </button>
        </form>
        <div className="sample-queries">
          <span>Try asking</span>
          {sampleQueries.map((sample) => <button type="button" onClick={() => void runSearch(sample)} key={sample}>{sample}<ArrowRight size={12} /></button>)}
        </div>
      </section>

      <div className="knowledge-layout">
        <section className="knowledge-results" aria-live="polite">
          <div className="result-toolbar">
            <div>
              <span className="section-kicker">{hasSearch ? 'Ranked by vector similarity' : 'Recently updated'}</span>
              <h2>{hasSearch ? `${visibleDocuments.length} relevant sources` : 'Knowledge library'}</h2>
            </div>
            <div className="result-toolbar__meta">
              {searchTime !== null && hasSearch ? <span>{searchTime} ms</span> : null}
              <button type="button" disabled title="Category tabs provide the available demo filters"><SlidersHorizontal size={14} /> Filters</button>
            </div>
          </div>

          <div className="scope-tabs" role="tablist" aria-label="Knowledge category">
            {scopeOptions.map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={scope === item}
                className={scope === item ? 'scope-tab--active' : ''}
                onClick={() => {
                  setScope(item);
                  if (query.trim()) void runSearch(query, item);
                }}
                key={item}
              >
                {item === 'all' ? 'All sources' : item}
              </button>
            ))}
          </div>

          {isSearching ? (
            <div className="search-loading" role="status">
              <div className="search-loading__orb"><Sparkles size={22} /></div>
              <div><strong>Searching by meaning</strong><span>Embedding your question and ranking the most relevant passages…</span></div>
              <div className="search-loading__bar"><span /></div>
            </div>
          ) : visibleDocuments.length > 0 ? (
            <div className="document-list">
              {visibleDocuments.map((document, index) => (
                <button className="document-card" key={document.id} type="button" onClick={() => setSelected(document)}>
                  <div className="document-card__rank">
                    {hasSearch ? <span>{String(index + 1).padStart(2, '0')}</span> : <FileText size={18} />}
                  </div>
                  <div className="document-card__body">
                    <div className="document-card__title">
                      <div><span className="document-type">{document.category}</span><h3>{document.title}</h3></div>
                      {document.score !== undefined ? (
                        <div className="match-score"><strong>{Math.round(document.score * 100)}%</strong><span>match</span></div>
                      ) : <span className="indexed-status"><Check size={12} /> Indexed</span>}
                    </div>
                    <p>{document.excerpt}</p>
                    <div className="document-card__meta">
                      <span><Database size={12} /> {document.source}</span>
                      <span><Layers3 size={12} /> {document.chunks} chunks</span>
                      <span>Updated {formatDate(document.updatedAt)}</span>
                    </div>
                    {hasSearch && document.score !== undefined ? <div className="similarity-line"><span style={{ width: `${document.score * 100}%` }} /></div> : null}
                  </div>
                  <ChevronRight className="document-card__arrow" size={18} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-results">
              <Search size={25} />
              <h3>No relevant sources found</h3>
              <p>Try broader wording or search across all source types.</p>
              <button className="button button--secondary" onClick={() => { setScope('all'); void runSearch(query, 'all'); }}>Search all sources</button>
            </div>
          )}
        </section>

        <aside className="knowledge-sidebar">
          <article className="panel index-card">
            <div className="index-card__top"><span><Database size={17} /></span><div><small>Vector index</small><strong>Healthy</strong></div><i /></div>
            <div className="index-card__stat"><span>Documents</span><strong>{documentsResult.data.length}</strong></div>
            <div className="index-card__stat"><span>Searchable sources</span><strong>16</strong></div>
            <div className="index-card__stat"><span>Embedding coverage</span><strong>100%</strong></div>
            <div className="coverage-meter"><span style={{ width: '100%' }} /></div>
            <div className="index-card__foot"><CircleDot size={12} /> Synced 2 minutes ago</div>
          </article>

          <article className="panel category-card">
            <div className="panel__header"><div><span className="section-kicker">Library</span><h2>Sources</h2></div><Filter size={16} /></div>
            {categories.map((category) => (
              <button key={category.name} type="button" onClick={() => { setScope(category.name); if (query) void runSearch(query, category.name); }}>
                <span className={`category-card__icon category-card__icon--${category.name.toLowerCase()}`}>
                  {category.name === 'Playbooks' ? <ShieldCheck size={15} /> : category.name === 'Policies' ? <FileCheck2 size={15} /> : category.name === 'Guides' ? <BookOpen size={15} /> : <FileText size={15} />}
                </span>
                <span>{category.name}</span><strong>{category.count}</strong><ChevronRight size={14} />
              </button>
            ))}
          </article>

          <article className="knowledge-tip">
            <Bot size={18} />
            <div><strong>Need an answer, not a document?</strong><p>Ask Copilot to synthesize sources with citations and an action plan.</p><button onClick={() => navigate('/copilot')} type="button">Open Copilot <ArrowRight size={13} /></button></div>
          </article>
        </aside>
      </div>

      <aside className={`detail-drawer knowledge-drawer ${selected ? 'detail-drawer--open' : ''}`} aria-label="Document details" aria-hidden={!selected}>
        {selected ? (
          <>
            <div className="detail-drawer__header">
              <div><span className="section-kicker">Knowledge source</span><h2>Document details</h2></div>
              <button className="icon-button" onClick={() => setSelected(null)} aria-label="Close document details"><X size={19} /></button>
            </div>
            <div className="document-detail__hero">
              <span><FileText size={23} /></span>
              <div><small>{selected.category}</small><h3>{selected.title}</h3><p>{selected.source}</p></div>
            </div>
            {selected.score !== undefined ? (
              <div className="document-detail__match">
                <Sparkles size={15} />
                <div>
                  <small>
                    {selected.vectorScore !== undefined && selected.lexicalScore !== undefined
                      ? `Vector ${Math.round(selected.vectorScore * 100)}% · BM25 ${Math.round(selected.lexicalScore * 100)}%`
                      : 'Semantic similarity'}
                  </small>
                  <strong>{Math.round(selected.score * 100)}% match</strong>
                </div>
                <div className="mini-ring">{Math.round(selected.score * 100)}</div>
              </div>
            ) : null}
            <div className="drawer-section"><span className="section-kicker">Summary</span><p>{selected.excerpt}</p></div>
            <div className="drawer-section"><span className="section-kicker">Index metadata</span>
              <dl className="detail-list">
                <div><dt>Status</dt><dd><span className="indexed-status"><Check size={11} /> {selected.status}</span></dd></div>
                <div><dt>Vector chunks</dt><dd>{selected.chunks}</dd></div>
                {selected.chunkIndex !== undefined && selected.chunkCount !== undefined ? (
                  <div><dt>Matched chunk</dt><dd>{selected.chunkIndex + 1} of {selected.chunkCount}</dd></div>
                ) : null}
                <div><dt>Last updated</dt><dd>{formatDate(selected.updatedAt)}</dd></div>
                {Object.entries(selected.metadata ?? {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
              </dl>
            </div>
            <button className="button button--primary button--wide" onClick={() => navigate('/copilot', { state: { prompt: `Summarize ${selected.title} and tell me when operators should use it.` } })}>
              <Sparkles size={15} /> Ask Copilot about this
            </button>
          </>
        ) : null}
      </aside>
      {selected ? <button className="drawer-backdrop drawer-backdrop--global" aria-label="Close document details" onClick={() => setSelected(null)} /> : null}
    </div>
  );
}
