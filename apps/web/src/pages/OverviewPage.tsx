import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Box,
  CheckCircle2,
  Clock3,
  FileText,
  Gauge,
  RefreshCw,
  Route,
  Send,
  Sparkles,
  Truck,
  Wifi,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { DataSourceBadge, PageHeader, PageSkeleton, SeverityPill } from '../components/UI';
import { api } from '../lib/api';
import type { ApiResult, OverviewData } from '../types';

const metricIcons = [Truck, AlertTriangle, Gauge, Clock3];

const attentionItems = [
  { id: 'INC-1001', title: 'Brake temperature threshold exceeded', meta: 'VH-2047 · North Ridge', severity: 'critical' as const, age: '1m' },
  { id: 'INC-1002', title: 'Reefer temperature excursion', meta: 'VH-1183 · Pune Hub', severity: 'high' as const, age: '1h' },
  { id: 'INC-1003', title: 'Driver hours approaching legal limit', meta: 'VH-3091 · Mumbai–Nashik', severity: 'high' as const, age: '2h' },
];

export function OverviewPage() {
  const [result, setResult] = useState<ApiResult<OverviewData> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [question, setQuestion] = useState('');
  const navigate = useNavigate();

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    const next = await api.overview();
    setResult(next);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!result) return <PageSkeleton />;
  const { data, source } = result;

  function askCopilot() {
    const trimmed = question.trim();
    navigate('/copilot', { state: trimmed ? { prompt: trimmed } : undefined });
  }

  return (
    <div className="page overview-page">
      <PageHeader
        eyebrow="Fleet command / Live overview"
        title={data.dailyBrief.greeting}
        description={data.dailyBrief.headline}
        actions={
          <>
            <DataSourceBadge source={source} />
            <button className="button button--secondary" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> Refresh
            </button>
          </>
        }
      />

      <section className="metric-grid" aria-label="Fleet performance metrics">
        {data.metrics.map((metric, index) => {
          const Icon = metricIcons[index % metricIcons.length]!;
          const trendUp = (metric.trend ?? 0) >= 0;
          return (
            <article className={`metric-card metric-card--${metric.tone}`} key={metric.label}>
              <div className="metric-card__top">
                <span className="metric-card__label">{metric.label}</span>
                <span className="metric-card__icon"><Icon size={18} /></span>
              </div>
              <div className="metric-card__value">{metric.value}</div>
              <div className="metric-card__footer">
                {metric.trend !== undefined ? (
                  <span className={`metric-trend ${trendUp ? 'metric-trend--up' : 'metric-trend--down'}`}>
                    {trendUp ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                    {Math.abs(metric.trend)}%
                  </span>
                ) : null}
                <span>{metric.detail}</span>
              </div>
            </article>
          );
        })}
      </section>

      <section className="overview-grid overview-grid--primary">
        <article className="panel fleet-panel">
          <div className="panel__header">
            <div>
              <span className="section-kicker">Network health</span>
              <h2>Fleet pulse</h2>
            </div>
            <div className="panel__legend"><span className="legend-dot legend-dot--healthy" />Online <span className="legend-dot legend-dot--alert" />Needs attention</div>
          </div>
          <div className="fleet-map" aria-label="Fleet status by region">
            <div className="fleet-map__texture" />
            <span className="map-route map-route--1" />
            <span className="map-route map-route--2" />
            <span className="map-route map-route--3" />
            {data.regions.map((region) => (
              <div
                className={`region-node ${region.incidents >= 5 ? 'region-node--alert' : ''}`}
                style={{ left: `${region.x}%`, top: `${region.y}%` }}
                key={region.id}
                aria-label={`${region.name}: ${region.vehicles} vehicles, ${region.online}% online, ${region.incidents} incidents`}
                role="group"
              >
                <span className="region-node__pulse" />
                <span className="region-node__dot"><Truck size={13} /></span>
                <span className="region-node__label"><strong>{region.name}</strong><small>{region.vehicles} assets · {region.online}% online</small></span>
              </div>
            ))}
            <div className="fleet-map__summary">
              <span><Wifi size={14} /> Reporting now</span>
              <strong>{data.fleetStatus.active.toLocaleString()} <small>/ {data.fleetStatus.total.toLocaleString()}</small></strong>
            </div>
          </div>
          <div className="region-strip fleet-state-strip">
            {Object.entries({ Active: data.fleetStatus.active, Idle: data.fleetStatus.idle, Maintenance: data.fleetStatus.maintenance, Offline: data.fleetStatus.offline }).map(([label, count]) => (
              <div key={label}><strong>{count.toLocaleString()}</strong><span>{label}</span><small>{Math.round((count / Math.max(1, data.fleetStatus.total)) * 100)}% of fleet</small></div>
            ))}
          </div>
        </article>

        <article className="panel ai-brief-panel">
          <div className="ai-brief-panel__halo"><Sparkles size={19} /></div>
          <div className="section-kicker section-kicker--ai"><span /> OpsPilot briefing</div>
          <h2>What needs your attention</h2>
          <p className="ai-brief-panel__summary">{data.aiSummary}</p>
          <div className="brief-priorities">
            {data.dailyBrief.priorities.slice(0, 3).map((priority, index) => (
              <div key={priority}><span>{String(index + 1).padStart(2, '0')}</span><p>{priority}</p></div>
            ))}
          </div>
          <form className="brief-ask" onSubmit={(event) => { event.preventDefault(); askCopilot(); }}>
            <label className="sr-only" htmlFor="global-command">Ask OpsPilot about fleet operations</label>
            <input id="global-command" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about this briefing…" />
            <button type="submit" aria-label="Ask copilot"><Send size={16} /></button>
          </form>
          <div className="ai-brief-panel__meta">
            <Bot size={13} /> {data.aiHealth.provider} · {data.aiHealth.generationModel} ·{' '}
            {data.aiHealth.indexedChunks.toLocaleString()} indexed chunks · {data.aiHealth.promptVersion}
          </div>
        </article>
      </section>

      <section className="overview-grid overview-grid--secondary">
        <article className="panel attention-panel">
          <div className="panel__header">
            <div><span className="section-kicker">Exception queue</span><h2>Needs attention</h2></div>
            <Link to="/incidents" className="text-link">View all <ArrowRight size={14} /></Link>
          </div>
          <div className="attention-list">
            {attentionItems.map((item) => (
              <Link to="/incidents" className="attention-row" key={item.id}>
                <div className={`attention-row__icon attention-row__icon--${item.severity}`}><AlertTriangle size={17} /></div>
                <div className="attention-row__copy"><strong>{item.title}</strong><span>{item.meta}</span></div>
                <SeverityPill severity={item.severity} />
                <time>{item.age}</time>
                <ChevronArrow />
              </Link>
            ))}
          </div>
        </article>

        <article className="panel activity-panel">
          <div className="panel__header"><div><span className="section-kicker">Operations feed</span><h2>Recent activity</h2></div><span className="activity-panel__live"><span /> Live</span></div>
          <div className="activity-list">
            {data.activity.map((activity) => {
              const ActivityIcon = activity.kind === 'incident' ? AlertTriangle : activity.kind === 'ai' ? Sparkles : activity.kind === 'document' ? FileText : CheckCircle2;
              return (
                <div className="activity-row" key={activity.id}>
                  <span className={`activity-row__icon activity-row__icon--${activity.kind}`}><ActivityIcon size={15} /></span>
                  <div><strong>{activity.title}</strong><span>{activity.detail}</span></div>
                  <time>{activity.time}</time>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className="quick-actions" aria-label="Quick actions">
        <Link to="/copilot"><span><Bot size={18} /></span><div><strong>Start an investigation</strong><small>Ask Copilot to correlate fleet signals</small></div><ArrowRight size={16} /></Link>
        <Link to="/knowledge"><span><Box size={18} /></span><div><strong>Search operations knowledge</strong><small>Explore policies, guides, and playbooks</small></div><ArrowRight size={16} /></Link>
        <Link to="/incidents"><span><Route size={18} /></span><div><strong>Review incident queue</strong><small>Triage AI-classified exceptions</small></div><ArrowRight size={16} /></Link>
      </section>
    </div>
  );
}

function ChevronArrow() {
  return <ArrowRight className="attention-row__arrow" size={16} />;
}
