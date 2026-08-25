import {
  DELAY_THRESHOLD_MINUTES,
  HOS_WARNING_MINUTES,
} from '../fleet/fleet.data';
import type { FleetService } from '../fleet/fleet.service';

/**
 * Fact-consistency guard for generated text.
 *
 * A fluent summary is the easiest place for a model to invent a number, so
 * every figure it writes must trace back to a computed value. Shared by the
 * runtime validator and the evaluation harness so the two cannot drift.
 */

/** Numbers at or below this are narrative ("three actions"), not fleet facts. */
const NARRATIVE_CEILING = 3;

/** Identifiers carry digits that are names, not quantities. */
const IDENTIFIER_PATTERN = /\b(?:VH|KB|INC|DR)-[A-Z0-9-]+\b/gi;
const TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g;

export function buildAllowedNumbers(
  fleet: FleetService,
  now: number = Date.now(),
): Set<string> {
  const allowed = new Set<string>();

  const add = (value: number): void => {
    if (!Number.isFinite(value)) return;
    allowed.add(String(value));
    allowed.add(String(Math.round(value)));
    allowed.add(value.toLocaleString('en-US'));
  };

  Object.values(fleet.getFacts(now)).forEach((value) => {
    if (typeof value === 'number') add(value);
  });

  // Policy thresholds the briefing is allowed to quote.
  add(HOS_WARNING_MINUTES);
  add(DELAY_THRESHOLD_MINUTES);

  fleet.listIncidents({ unresolvedOnly: true }).forEach((incident) => {
    add(incident.slaMinutes);
  });

  // SLA arithmetic is computed, so its outputs are supported facts too.
  const risk = fleet.getSlaRisk(60, now);
  risk.breaching.forEach((entry) => add(entry.minutesOverdue));
  risk.dueSoon.forEach((entry) => add(entry.minutesRemaining));

  return allowed;
}

/** Returns the numbers in `text` that no computed fact supports. */
export function unsupportedNumbers(
  text: string,
  allowed: ReadonlySet<string>,
): string[] {
  const scrubbed = text
    .replace(IDENTIFIER_PATTERN, ' ')
    .replace(TIMESTAMP_PATTERN, ' ');

  return [...scrubbed.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)]
    .map((match) => match[0])
    .filter((raw) => {
      const normalized = raw.replace(/,/g, '');
      if (Number(normalized) <= NARRATIVE_CEILING) return false;
      return !allowed.has(raw) && !allowed.has(normalized);
    });
}
