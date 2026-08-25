import { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Filter,
  Gauge,
  ListFilter,
  LoaderCircle,
  MapPin,
  MoreHorizontal,
  Search,
  ShieldAlert,
  Sparkles,
  Tag,
  Truck,
  UserRoundCheck,
  WandSparkles,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AiBadge, Confidence, DataSourceBadge, PageHeader, PageSkeleton, SeverityPill, StatusPill } from '../components/UI';
import { api } from '../lib/api';
import type { ApiResult, ClassificationResult, Incident, IncidentStatus, Severity } from '../types';

type QueueFilter = 'active' | 'all' | 'resolved';

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function IncidentsPage() {
  const [incidentsResult, setIncidentsResult] = useState<ApiResult<Incident[]> | null>(null);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('active');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    void api.incidents().then(setIncidentsResult);
  }, []);

  const visible = useMemo(() => {
    if (!incidentsResult) return [];
    return incidentsResult.data.filter((incident) => {
      const matchesQueue = queueFilter === 'all' || (queueFilter === 'resolved' ? incident.status === 'resolved' : incident.status !== 'resolved');
      const matchesSeverity = severityFilter === 'all' || incident.severity === severityFilter;
      const search = query.toLowerCase();
      const matchesSearch = !search || `${incident.id} ${incident.title} ${incident.assetId} ${incident.location} ${incident.category}`.toLowerCase().includes(search);
      return matchesQueue && matchesSeverity && matchesSearch;
    });
  }, [incidentsResult, query, queueFilter, severityFilter]);

  async function openIncident(incident: Incident) {
    setSelected(incident);
    setClassification(null);
    setClassifying(true);
    const result = await api.classify(`${incident.title}. ${incident.summary}`);
    setClassification(result.data);
    setIncidentsResult((current) => current ? { ...current, source: result.source === 'demo' ? 'demo' : current.source } : current);
    setClassifying(false);
  }

  function setIncidentStatus(status: IncidentStatus) {
    if (!selected) return;
    const updated = { ...selected, status };
    setSelected(updated);
    setIncidentsResult((current) => current ? { ...current, data: current.data.map((incident) => incident.id === selected.id ? updated : incident) } : current);
  }

  if (!incidentsResult) return <PageSkeleton />;

  const active = incidentsResult.data.filter((incident) => incident.status !== 'resolved');
  const critical = active.filter((incident) => incident.severity === 'critical').length;
  const high = active.filter((incident) => incident.severity === 'high').length;
  const assigned = active.filter((incident) => incident.assignee).length;

  return (
    <div className="page incidents-page">
      <PageHeader
        eyebrow="Exception management / AI triage"
        title="Incident queue"
        description="Review fleet exceptions ranked by severity, impact, and classification confidence."
        actions={
          <>
            <DataSourceBadge source={incidentsResult.source} />
            <button className="button button--primary" onClick={() => navigate('/copilot', { state: { prompt: 'Summarize the active incident queue and give me a prioritized response plan.' } })}>
              <Sparkles size={15} /> AI queue brief
            </button>
          </>
        }
      />

      <section className="incident-summary" aria-label="Incident summary">
        <div className="incident-summary__primary">
          <span className="incident-summary__icon"><ShieldAlert size={20} /></span>
          <div><small>Active exceptions</small><strong>{active.length}</strong></div>
          <p><b>{critical + high} priority incidents</b> require an operator decision. {assigned} of {active.length} active exceptions have an assigned owner.</p>
        </div>
        <div className="incident-summary__stat incident-summary__stat--critical"><span /> <div><strong>{critical}</strong><small>Critical</small></div></div>
        <div className="incident-summary__stat incident-summary__stat--high"><span /> <div><strong>{high}</strong><small>High</small></div></div>
        <div className="incident-summary__stat incident-summary__stat--sla"><Gauge size={18} /> <div><strong>{assigned}/{active.length}</strong><small>Assigned</small></div></div>
      </section>

      <section className="panel incident-table-panel">
        <div className="incident-toolbar">
          <div className="queue-tabs" role="tablist" aria-label="Incident status view">
            {(['active', 'all', 'resolved'] as QueueFilter[]).map((item) => (
              <button key={item} role="tab" aria-selected={queueFilter === item} className={queueFilter === item ? 'queue-tab--active' : ''} onClick={() => setQueueFilter(item)}>
                {item[0]?.toUpperCase()}{item.slice(1)}
                <span>{item === 'active' ? active.length : item === 'resolved' ? incidentsResult.data.length - active.length : incidentsResult.data.length}</span>
              </button>
            ))}
          </div>
          <div className="incident-toolbar__filters">
            <label className="table-search">
              <span className="sr-only">Search incidents</span><Search size={15} />
              <input type="search" placeholder="Search ID, asset, location…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label className="select-filter">
              <span className="sr-only">Filter by severity</span><ListFilter size={14} />
              <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as Severity | 'all')}>
                <option value="all">All severity</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <ChevronDown size={13} />
            </label>
            <button className="filter-button" type="button" aria-label="More filters" disabled title="Use the status, severity, and search filters"><Filter size={15} /></button>
          </div>
        </div>

        {visible.length > 0 ? (
          <>
            <div className="incident-table-wrap">
              <table className="incident-table">
                <thead><tr><th>Incident</th><th>Severity</th><th>Asset / location</th><th>AI classification</th><th>Status</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {visible.map((incident) => (
                    <tr key={incident.id} onClick={() => void openIncident(incident)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') void openIncident(incident); }}>
                      <td><div className="incident-cell"><span className={`incident-cell__marker incident-cell__marker--${incident.severity}`} /><div><small>{incident.id}</small><strong>{incident.title}</strong><span>{incident.summary}</span></div></div></td>
                      <td><SeverityPill severity={incident.severity} /></td>
                      <td><div className="asset-cell"><strong><Truck size={13} /> {incident.assetId}</strong><span><MapPin size={12} /> {incident.location}</span></div></td>
                      <td><div className="classification-cell"><span><WandSparkles size={12} />{incident.category}</span>{incident.confidence !== undefined ? <Confidence value={incident.confidence} compact /> : <small>Rule triage</small>}</div></td>
                      <td><StatusPill status={incident.status} /></td>
                      <td><span className="updated-cell"><Clock3 size={12} />{relativeTime(incident.updatedAt)}</span></td>
                      <td><button className="row-action" type="button" aria-label={`Open ${incident.id}`} onClick={(event) => { event.stopPropagation(); void openIncident(incident); }}><MoreHorizontal size={17} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="incident-cards">
              {visible.map((incident) => (
                <button type="button" className="incident-mobile-card" key={incident.id} onClick={() => void openIncident(incident)}>
                  <div><small>{incident.id}</small><SeverityPill severity={incident.severity} /></div>
                  <h3>{incident.title}</h3><p>{incident.summary}</p>
                  <div><span><Truck size={12} />{incident.assetId}</span><span><MapPin size={12} />{incident.location}</span></div>
                  <footer><span><WandSparkles size={12} />{incident.category}</span><StatusPill status={incident.status} /><ChevronRight size={15} /></footer>
                </button>
              ))}
            </div>

            <div className="table-footer"><span>Showing {visible.length} of {incidentsResult.data.length} incidents</span><div><button aria-label="Previous page" disabled><ChevronLeft size={15} /></button><button className="page-button page-button--active">1</button><button aria-label="Next page" disabled><ChevronRight size={15} /></button></div></div>
          </>
        ) : (
          <div className="empty-results"><Check size={25} /><h3>No incidents match this view</h3><p>Clear a filter or switch to the full queue.</p><button className="button button--secondary" onClick={() => { setQuery(''); setSeverityFilter('all'); setQueueFilter('all'); }}>Clear filters</button></div>
        )}
      </section>

      <aside className={`detail-drawer incident-drawer ${selected ? 'detail-drawer--open' : ''}`} aria-label="Incident classification detail" aria-hidden={!selected}>
        {selected ? (
          <>
            <div className="detail-drawer__header">
              <div><span className="section-kicker">{selected.id}</span><h2>Incident detail</h2></div>
              <button className="icon-button" onClick={() => setSelected(null)} aria-label="Close incident details"><X size={19} /></button>
            </div>
            <div className="incident-detail__title">
              <div className={`incident-detail__icon incident-detail__icon--${selected.severity}`}><AlertOctagon size={22} /></div>
              <div><h3>{selected.title}</h3><div><SeverityPill severity={selected.severity} /><StatusPill status={selected.status} /></div></div>
            </div>

            <div className="incident-detail__facts">
              <div><Truck size={14} /><span>Asset<strong>{selected.assetId}</strong></span></div>
              <div><MapPin size={14} /><span>Location<strong>{selected.location}</strong></span></div>
              <div><Clock3 size={14} /><span>Reported<strong>{relativeTime(selected.reportedAt)}</strong></span></div>
            </div>

            <section className="classification-card">
              <div className="classification-card__header"><AiBadge>AI classification</AiBadge>{classification ? <Confidence value={classification.confidence} /> : null}</div>
              {classifying ? (
                <div className="classification-loading" role="status"><LoaderCircle size={20} className="spin" /><div><strong>Classifying exception</strong><span>Analyzing urgency, intent, and operational category…</span></div></div>
              ) : classification ? (
                <>
                  <div className="classification-result">
                    <div><small>Category</small><strong>{classification.category}</strong></div>
                    <div><small>Severity</small><SeverityPill severity={classification.severity} /></div>
                    <div><small>Escalation</small><strong className="capitalize">{classification.requiresSupervisor ? 'Supervisor required' : 'Standard workflow'}</strong></div>
                  </div>
                  <div className="classification-tags"><Tag size={13} />{classification.suggestedTags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                  <div className="classification-provider"><BrainCircuit size={12} /> {classification.provider || 'OpsPilot AI classifier'}</div>
                </>
              ) : null}
            </section>

            <section className="drawer-section"><span className="section-kicker">Event summary</span><p>{classification?.summary || selected.summary}</p></section>

            <section className="recommended-action">
              <span><Sparkles size={15} /> Recommended next action</span>
              <p>{classification?.recommendedAction || selected.recommendedAction}</p>
              <div className="recommended-action__basis"><Check size={12} /> Grounded in incident signals and applicable operations policy</div>
            </section>

            <section className="drawer-section">
              <span className="section-kicker">Detected signals</span>
              <div className="signal-list">
                {selected.tags.map((tag) => <span key={tag}><CircleDot size={11} />{tag}</span>)}
              </div>
            </section>

            <div className="incident-drawer__actions">
              {selected.status === 'open' ? <button className="button button--primary" onClick={() => setIncidentStatus('investigating')}><UserRoundCheck size={15} /> Start investigation</button> : <button className="button button--secondary" onClick={() => setIncidentStatus('resolved')}><Check size={15} /> Mark resolved</button>}
              <button className="button button--secondary" onClick={() => navigate('/copilot', { state: { prompt: `Investigate ${selected.id}: ${selected.title}. Explain the risk and the recommended next action.` } })}><Sparkles size={15} /> Ask Copilot</button>
              <small>Demo status changes are session-only.</small>
            </div>
          </>
        ) : null}
      </aside>
      {selected ? <button className="drawer-backdrop drawer-backdrop--global" aria-label="Close incident details" onClick={() => setSelected(null)} /> : null}
    </div>
  );
}
