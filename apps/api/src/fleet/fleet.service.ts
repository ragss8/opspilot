import { Injectable } from '@nestjs/common';
import {
  DELAY_THRESHOLD_MINUTES,
  FLEET_TIME_SERIES,
  HOS_WARNING_MINUTES,
  INCIDENTS,
  KNOWLEDGE_DOCUMENTS,
  VEHICLES,
} from './fleet.data';
import type {
  FleetFacts,
  FleetIncident,
  IncidentSeverity,
  IncidentStatus,
  Vehicle,
  VehicleStatus,
} from './fleet.types';

export interface VehicleFilter {
  status?: VehicleStatus;
  region?: string;
  depot?: string;
  delayedOnly?: boolean;
  minDelayMinutes?: number;
}

export interface IncidentFilter {
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  category?: string;
  vehicleId?: string;
  unresolvedOnly?: boolean;
  limit?: number;
}

/**
 * Typed, allow-listed operations over the fleet records.
 *
 * These are the only paths by which a model can reach operational data. There
 * is no free-form query surface: the tool layer can call these methods with
 * validated arguments, and nothing else.
 */
@Injectable()
export class FleetService {
  /** Every field is aggregated from records; none is a hard-coded constant. */
  getFacts(now: number = Date.now()): FleetFacts {
    const byStatus = (status: VehicleStatus): number =>
      VEHICLES.filter((vehicle) => vehicle.status === status).length;

    const total = VEHICLES.length;
    const maintenance = byStatus('maintenance');
    const offline = byStatus('offline');
    const delayed = VEHICLES.filter(
      (vehicle) => vehicle.delayMinutes >= DELAY_THRESHOLD_MINUTES,
    );
    const openIncidents = INCIDENTS.filter(
      (incident) => incident.status !== 'resolved',
    );

    return {
      totalVehicles: total,
      activeVehicles: byStatus('active'),
      idleVehicles: byStatus('idle'),
      maintenanceVehicles: maintenance,
      offlineVehicles: offline,
      delayedVehicles: delayed.length,
      // Availability counts everything not withdrawn from service.
      fleetAvailability: percentage(total - maintenance - offline, total),
      utilizationRate: percentage(byStatus('active'), total),
      openIncidents: openIncidents.length,
      criticalIncidents: openIncidents.filter(
        (incident) => incident.severity === 'critical',
      ).length,
      highIncidents: openIncidents.filter(
        (incident) => incident.severity === 'high',
      ).length,
      incidentsBreachingSla: openIncidents.filter(
        (incident) => this.slaDeadline(incident) < now,
      ).length,
      distanceTodayKm: VEHICLES.reduce(
        (total_, vehicle) => total_ + vehicle.distanceTodayKm,
        0,
      ),
      averageDelayMinutes:
        delayed.length === 0
          ? 0
          : Number(
              (
                delayed.reduce((sum, vehicle) => sum + vehicle.delayMinutes, 0) /
                delayed.length
              ).toFixed(1),
            ),
      driversNearingHosLimit: VEHICLES.filter(
        (vehicle) =>
          vehicle.driveTimeRemainingMinutes !== null &&
          vehicle.driveTimeRemainingMinutes <= HOS_WARNING_MINUTES,
      ).length,
    };
  }

  getVehicle(vehicleId: string): Vehicle | undefined {
    const normalized = vehicleId.trim().toUpperCase();
    return VEHICLES.find((vehicle) => vehicle.id === normalized);
  }

  countVehicles(filter: VehicleFilter = {}): {
    count: number;
    total: number;
    percentageOfFleet: number;
    breakdownByStatus: Record<VehicleStatus, number>;
  } {
    const matched = VEHICLES.filter((vehicle) => {
      if (filter.status && vehicle.status !== filter.status) return false;
      if (
        filter.region &&
        vehicle.region.toLowerCase() !== filter.region.toLowerCase()
      ) {
        return false;
      }
      if (
        filter.depot &&
        !vehicle.depot.toLowerCase().includes(filter.depot.toLowerCase())
      ) {
        return false;
      }
      const threshold = filter.minDelayMinutes ?? DELAY_THRESHOLD_MINUTES;
      if (filter.delayedOnly && vehicle.delayMinutes < threshold) return false;
      if (
        filter.minDelayMinutes !== undefined &&
        vehicle.delayMinutes < filter.minDelayMinutes
      ) {
        return false;
      }
      return true;
    });

    const breakdownByStatus: Record<VehicleStatus, number> = {
      active: 0,
      idle: 0,
      maintenance: 0,
      offline: 0,
    };
    matched.forEach((vehicle) => {
      breakdownByStatus[vehicle.status] += 1;
    });

    return {
      count: matched.length,
      total: VEHICLES.length,
      percentageOfFleet: percentage(matched.length, VEHICLES.length),
      breakdownByStatus,
    };
  }

  listIncidents(filter: IncidentFilter = {}): FleetIncident[] {
    const matched = INCIDENTS.filter((incident) => {
      if (filter.severity && incident.severity !== filter.severity) return false;
      if (filter.status && incident.status !== filter.status) return false;
      if (
        filter.category &&
        incident.category.toLowerCase() !== filter.category.toLowerCase()
      ) {
        return false;
      }
      if (
        filter.vehicleId &&
        incident.vehicleId.toUpperCase() !== filter.vehicleId.trim().toUpperCase()
      ) {
        return false;
      }
      if (filter.unresolvedOnly && incident.status === 'resolved') return false;
      return true;
    });

    const severityRank: Record<IncidentSeverity, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const ordered = [...matched].sort(
      (left, right) =>
        severityRank[left.severity] - severityRank[right.severity] ||
        Date.parse(right.reportedAt) - Date.parse(left.reportedAt),
    );

    return filter.limit ? ordered.slice(0, Math.max(1, filter.limit)) : ordered;
  }

  /** Open incidents ordered by how soon their SLA expires. */
  getSlaRisk(
    withinMinutes = 60,
    now: number = Date.now(),
  ): {
    breaching: { id: string; title: string; vehicleId: string; minutesOverdue: number }[];
    dueSoon: { id: string; title: string; vehicleId: string; minutesRemaining: number }[];
  } {
    const open = INCIDENTS.filter((incident) => incident.status !== 'resolved');
    const breaching: {
      id: string;
      title: string;
      vehicleId: string;
      minutesOverdue: number;
    }[] = [];
    const dueSoon: {
      id: string;
      title: string;
      vehicleId: string;
      minutesRemaining: number;
    }[] = [];

    open.forEach((incident) => {
      const remaining = Math.round((this.slaDeadline(incident) - now) / 60_000);
      if (remaining < 0) {
        breaching.push({
          id: incident.id,
          title: incident.title,
          vehicleId: incident.vehicleId,
          minutesOverdue: Math.abs(remaining),
        });
      } else if (remaining <= withinMinutes) {
        dueSoon.push({
          id: incident.id,
          title: incident.title,
          vehicleId: incident.vehicleId,
          minutesRemaining: remaining,
        });
      }
    });

    breaching.sort((left, right) => right.minutesOverdue - left.minutesOverdue);
    dueSoon.sort((left, right) => left.minutesRemaining - right.minutesRemaining);
    return { breaching, dueSoon };
  }

  slaDeadline(incident: FleetIncident): number {
    return Date.parse(incident.reportedAt) + incident.slaMinutes * 60_000;
  }

  getIncidents() {
    const items = [...INCIDENTS];
    return {
      items,
      total: items.length,
      unresolved: items.filter((incident) => incident.status !== 'resolved')
        .length,
      bySeverity: {
        critical: items.filter((incident) => incident.severity === 'critical')
          .length,
        high: items.filter((incident) => incident.severity === 'high').length,
        medium: items.filter((incident) => incident.severity === 'medium').length,
        low: items.filter((incident) => incident.severity === 'low').length,
      },
      lastUpdatedAt: items[0]?.reportedAt ?? null,
    };
  }

  getDocuments() {
    const items = [...KNOWLEDGE_DOCUMENTS];
    return {
      items,
      total: items.length,
      categories: [...new Set(items.map((document) => document.category))],
    };
  }

  getVehicles(): readonly Vehicle[] {
    return VEHICLES;
  }

  getTimeSeries() {
    return [...FLEET_TIME_SERIES];
  }
}

function percentage(part: number, total: number): number {
  return total === 0 ? 0 : Number(((part / total) * 100).toFixed(1));
}
