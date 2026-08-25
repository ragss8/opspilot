import type { ReactNode } from 'react';
import { Database, LoaderCircle, Radio, Sparkles } from 'lucide-react';
import type { IncidentStatus, Severity } from '../types';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function DataSourceBadge({ source }: { source: 'live' | 'demo' }) {
  return source === 'live' ? (
    <span className="data-source data-source--live"><Radio size={12} /> Live API</span>
  ) : (
    <span className="data-source"><Database size={12} /> Preview data</span>
  );
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={`pill severity severity--${severity}`}><span />{severity}</span>;
}

export function StatusPill({ status }: { status: IncidentStatus }) {
  return <span className={`pill incident-status incident-status--${status}`}>{status}</span>;
}

export function AiBadge({ children = 'AI generated' }: { children?: ReactNode }) {
  return <span className="ai-badge"><Sparkles size={11} />{children}</span>;
}

export function InlineLoader({ label = 'Loading' }: { label?: string }) {
  return <span className="inline-loader" role="status"><LoaderCircle size={16} className="spin" />{label}</span>;
}

export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="page-skeleton" aria-label="Loading page" role="status">
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--subtitle" />
      <div className="skeleton-grid">
        {Array.from({ length: cards }).map((_, index) => <div className="skeleton skeleton--card" key={index} />)}
      </div>
    </div>
  );
}

export function Confidence({ value, compact = false }: { value: number; compact?: boolean }) {
  const percent = Math.round((value > 1 ? value / 100 : value) * 100);
  return (
    <span className={`confidence ${compact ? 'confidence--compact' : ''}`} title={`${percent}% confidence`}>
      <span className="confidence__meter"><span style={{ width: `${percent}%` }} /></span>
      <span>{percent}%</span>
    </span>
  );
}
