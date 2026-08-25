import { Injectable } from '@nestjs/common';
import { FleetService } from '../fleet/fleet.service';
import { HOS_WARNING_MINUTES } from '../fleet/fleet.data';
import type { FleetFacts } from '../fleet/fleet.types';

export interface DailyBrief {
  greeting: string;
  headline: string;
  summary: string;
  priorities: string[];
  generatedAt: string;
}

/**
 * Builds the shift briefing from computed facts and live incident records.
 *
 * Shared by the overview endpoint and the copilot's SUMMARY route so both
 * report the same numbers, and so neither can drift into a fixed string.
 */
@Injectable()
export class BriefingService {
  constructor(private readonly fleet: FleetService) {}

  build(now: number = Date.now()): DailyBrief {
    const facts = this.fleet.getFacts(now);
    const open = this.fleet.listIncidents({ unresolvedOnly: true });
    const critical = open.filter((incident) => incident.severity === 'critical');
    const sla = this.fleet.getSlaRisk(60, now);

    const headline =
      critical.length > 0
        ? `Fleet availability is ${facts.fleetAvailability}% with ${critical.length} critical incident${
            critical.length === 1 ? '' : 's'
          } needing action.`
        : `Fleet availability is ${facts.fleetAvailability}% with no critical incidents open.`;

    const summary =
      `${facts.activeVehicles} of ${facts.totalVehicles} vehicles are active and ` +
      `${facts.distanceTodayKm.toLocaleString('en-US')} km have been covered today. ` +
      `${facts.openIncidents} incidents are unresolved, ${facts.incidentsBreachingSla} past SLA. ` +
      `${facts.delayedVehicles} vehicles are behind schedule and ${facts.driversNearingHosLimit} drivers ` +
      `are within ${HOS_WARNING_MINUTES} minutes of their hours-of-service limit.`;

    return {
      greeting: greetingFor(now),
      headline,
      summary,
      priorities: this.priorities(open, sla),
      generatedAt: new Date(now).toISOString(),
    };
  }

  toText(brief: DailyBrief): string {
    return [
      brief.headline,
      '',
      brief.summary,
      '',
      'Priorities:',
      ...brief.priorities.map((priority) => `- ${priority}`),
      '',
      'This is decision support; verify current telemetry and obtain required specialist clearance before moving an affected vehicle.',
    ].join('\n');
  }

  private priorities(
    open: ReturnType<FleetService['listIncidents']>,
    sla: ReturnType<FleetService['getSlaRisk']>,
  ): string[] {
    const items: string[] = [];
    const seen = new Set<string>();

    const add = (id: string, text: string): void => {
      if (seen.has(id) || items.length >= 3) return;
      seen.add(id);
      items.push(text);
    };

    open
      .filter((incident) => incident.severity === 'critical')
      .forEach((incident) =>
        add(
          incident.id,
          `[${incident.id}] ${incident.vehicleId}: ${incident.recommendedAction}`,
        ),
      );

    sla.breaching.forEach((entry) =>
      add(
        entry.id,
        `[${entry.id}] ${entry.vehicleId} is ${entry.minutesOverdue} minutes past its SLA target.`,
      ),
    );

    open
      .filter((incident) => incident.severity === 'high')
      .forEach((incident) =>
        add(
          incident.id,
          `[${incident.id}] ${incident.vehicleId}: ${incident.recommendedAction}`,
        ),
      );

    return items.length > 0
      ? items
      : ['No unresolved incidents require escalation this shift.'];
  }

  facts(now?: number): FleetFacts {
    return this.fleet.getFacts(now);
  }
}

function greetingFor(now: number): string {
  const hour = new Date(now).getUTCHours();
  if (hour < 12) return 'Good morning, control tower';
  if (hour < 17) return 'Good afternoon, control tower';
  return 'Good evening, control tower';
}
