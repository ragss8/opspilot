import { Injectable, Logger } from '@nestjs/common';
import { FleetService } from '../../fleet/fleet.service';
import type { IncidentSeverity, IncidentStatus, VehicleStatus } from '../../fleet/fleet.types';
import type { ToolCallRecord } from '../ai.types';

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

const SEVERITIES: readonly IncidentSeverity[] = ['critical', 'high', 'medium', 'low'];
const STATUSES: readonly IncidentStatus[] = ['open', 'investigating', 'monitoring', 'resolved'];
const VEHICLE_STATUSES: readonly VehicleStatus[] = ['active', 'idle', 'maintenance', 'offline'];
const REGIONS = ['north', 'south', 'east', 'west', 'central'] as const;

/**
 * The model's entire access to operational data.
 *
 * Each tool is an allow-listed, typed operation with a JSON Schema the model
 * must satisfy. Arguments are re-validated here before execution, because a
 * model can and will emit values outside the schema it was given. There is no
 * SQL surface and no way to widen a filter beyond these parameters.
 */
@Injectable()
export class FleetToolsService {
  private readonly logger = new Logger(FleetToolsService.name);

  constructor(private readonly fleet: FleetService) {}

  readonly definitions: readonly ToolDefinition[] = [
    {
      name: 'get_fleet_metrics',
      description:
        'Aggregate fleet metrics computed from live vehicle and incident records: totals by status, availability, utilization, delayed vehicles, open and critical incidents, SLA breaches, distance travelled today, and drivers nearing their hours-of-service limit. Use this for any question about overall fleet state.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'count_vehicles',
      description:
        'Count vehicles matching a filter. Use for questions like "how many vehicles are offline" or "how many are delayed in the west region".',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: [...VEHICLE_STATUSES],
            description: 'Operational status to filter by.',
          },
          region: {
            type: 'string',
            enum: [...REGIONS],
            description: 'Regional hub to filter by.',
          },
          delayedOnly: {
            type: 'boolean',
            description: 'When true, count only vehicles running behind schedule.',
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'list_incidents',
      description:
        'List incidents matching a filter, ordered by severity then recency. Use for questions about specific incidents, a specific vehicle, or a severity band.',
      parameters: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: [...SEVERITIES] },
          status: { type: 'string', enum: [...STATUSES] },
          category: {
            type: 'string',
            enum: ['Safety', 'Maintenance', 'Compliance', 'Operations', 'Security'],
          },
          vehicleId: {
            type: 'string',
            description: 'Vehicle identifier, for example VH-2047.',
          },
          unresolvedOnly: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'get_vehicle',
      description:
        'Fetch the current record for one vehicle: status, depot, region, odometer, distance today, delay, last telemetry time, and remaining legal drive time.',
      parameters: {
        type: 'object',
        properties: {
          vehicleId: {
            type: 'string',
            description: 'Vehicle identifier, for example VH-2047.',
          },
        },
        required: ['vehicleId'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_sla_risk',
      description:
        'List open incidents that have already breached their SLA target or will breach it within the given window.',
      parameters: {
        type: 'object',
        properties: {
          withinMinutes: {
            type: 'integer',
            minimum: 1,
            maximum: 1440,
            description: 'Look-ahead window in minutes. Defaults to 60.',
          },
        },
        additionalProperties: false,
      },
    },
  ];

  has(name: string): boolean {
    return this.definitions.some((tool) => tool.name === name);
  }

  execute(name: string, rawArguments: unknown): ToolCallRecord {
    const startedAt = performance.now();
    const args = isRecord(rawArguments) ? rawArguments : {};

    try {
      const result = this.run(name, args);
      return {
        name,
        arguments: args,
        result,
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool failed';
      this.logger.warn(`Tool ${name} failed: ${message}`);
      return {
        name,
        arguments: args,
        result: { error: message },
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        error: message,
      };
    }
  }

  private run(name: string, args: Record<string, unknown>): unknown {
    switch (name) {
      case 'get_fleet_metrics':
        return this.fleet.getFacts();

      case 'count_vehicles':
        return this.fleet.countVehicles({
          status: pickEnum(args.status, VEHICLE_STATUSES),
          region: pickEnum(args.region, REGIONS),
          delayedOnly: args.delayedOnly === true,
        });

      case 'list_incidents': {
        const incidents = this.fleet.listIncidents({
          severity: pickEnum(args.severity, SEVERITIES),
          status: pickEnum(args.status, STATUSES),
          category: typeof args.category === 'string' ? args.category : undefined,
          vehicleId:
            typeof args.vehicleId === 'string' ? args.vehicleId : undefined,
          unresolvedOnly: args.unresolvedOnly === true,
          limit: clampInteger(args.limit, 1, 20, 5),
        });
        return {
          count: incidents.length,
          incidents: incidents.map((incident) => ({
            id: incident.id,
            title: incident.title,
            severity: incident.severity,
            status: incident.status,
            vehicleId: incident.vehicleId,
            category: incident.category,
            reportedAt: incident.reportedAt,
            assignee: incident.assignee,
            recommendedAction: incident.recommendedAction,
          })),
        };
      }

      case 'get_vehicle': {
        const vehicleId =
          typeof args.vehicleId === 'string' ? args.vehicleId : '';
        if (!/^VH-\d{3,4}$/i.test(vehicleId.trim())) {
          throw new Error(
            `Invalid vehicleId "${vehicleId}". Expected the form VH-2047.`,
          );
        }
        const vehicle = this.fleet.getVehicle(vehicleId);
        if (!vehicle) {
          return { found: false, vehicleId: vehicleId.trim().toUpperCase() };
        }
        const incidents = this.fleet.listIncidents({ vehicleId, limit: 5 });
        return {
          found: true,
          vehicle,
          openIncidents: incidents
            .filter((incident) => incident.status !== 'resolved')
            .map((incident) => ({
              id: incident.id,
              title: incident.title,
              severity: incident.severity,
            })),
        };
      }

      case 'get_sla_risk':
        return this.fleet.getSlaRisk(clampInteger(args.withinMinutes, 1, 1440, 60));

      default:
        throw new Error(`Unknown tool "${name}"`);
    }
  }

  /**
   * Deterministic tool selection for the local engine.
   *
   * The hosted providers choose tools themselves. Local mode reproduces the
   * same tool contract with rules so the whole pipeline, including the tool
   * results that reach the prompt, is demoable without credentials.
   */
  selectLocally(message: string): { name: string; arguments: Record<string, unknown> }[] {
    const query = message.toLowerCase();
    const calls: { name: string; arguments: Record<string, unknown> }[] = [];

    const vehicleMatch = message.match(/\bVH-\d{3,4}\b/i);
    if (vehicleMatch) {
      calls.push({
        name: 'get_vehicle',
        arguments: { vehicleId: vehicleMatch[0].toUpperCase() },
      });
    }

    if (/\b(sla|overdue|breach|nearing|due)\b/.test(query)) {
      calls.push({ name: 'get_sla_risk', arguments: { withinMinutes: 60 } });
    }

    const severity = SEVERITIES.find((value) =>
      new RegExp(`\\b${value}\\b`).test(query),
    );
    if (/\b(incident|alert|case)s?\b/.test(query)) {
      calls.push({
        name: 'list_incidents',
        arguments: {
          ...(severity ? { severity } : {}),
          ...(/\b(open|unresolved|active)\b/.test(query)
            ? { unresolvedOnly: true }
            : {}),
          limit: 5,
        },
      });
    }

    const status = VEHICLE_STATUSES.find((value) =>
      new RegExp(`\\b${value}\\b`).test(query),
    );
    if (/\b(how many|count|number of)\b/.test(query) && /vehicle|truck|lorr/.test(query)) {
      calls.push({
        name: 'count_vehicles',
        arguments: {
          ...(status ? { status } : {}),
          ...(/\b(?:delay|delays|delayed|late|overdue|behind)\b/.test(query)
            ? { delayedOnly: true }
            : {}),
        },
      });
    }

    // Always ground numeric and summary questions in the computed aggregate.
    if (
      calls.length === 0 ||
      /\b(summar|brief|overview|recap|handover|availability|utilization|utilisation|fleet)\b/.test(
        query,
      )
    ) {
      calls.unshift({ name: 'get_fleet_metrics', arguments: {} });
    }

    // Cap the local plan so the prompt stays small and predictable.
    return calls.slice(0, 3);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}
