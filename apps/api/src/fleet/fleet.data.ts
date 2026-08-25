import type { FleetIncident, TimeSeriesPoint } from './fleet.types';

/**
 * Incidents and trends are anchored to process start rather than frozen at a
 * fixed calendar date, so a clone of this repository always shows a live shift
 * with meaningful SLA countdowns instead of a backlog months past due.
 * The anchor is captured once, so every value stays stable for the process.
 */
const REFERENCE_TIME = Date.now();

function minutesAgo(minutes: number): string {
  return new Date(REFERENCE_TIME - minutes * 60_000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(REFERENCE_TIME - days * 86_400_000).toISOString().slice(0, 10);
}


export { KNOWLEDGE_DOCUMENTS } from './knowledge.data';
export {
  DATA_DATE,
  DELAY_THRESHOLD_MINUTES,
  FLEET_SIZE,
  HOS_WARNING_MINUTES,
  VEHICLES,
} from './vehicles.data';

export const INCIDENTS: readonly FleetIncident[] = [
  {
    id: 'INC-1001',
    title: 'Brake temperature threshold exceeded',
    description:
      'Trailer axle sensor reported 232°C during descent. The driver stopped at the North Ridge safe bay and completed the emergency checklist.',
    category: 'Safety',
    subcategory: 'Brake system',
    severity: 'critical',
    status: 'investigating',
    vehicleId: 'VH-2047',
    location: 'North Ridge, NH-44',
    reportedAt: minutesAgo(8),
    assignee: 'Maya Chen',
    slaMinutes: 15,
    recommendedAction:
      'Keep the unit immobilized, dispatch roadside maintenance, and inspect the full axle before release.',
    tags: ['brakes', 'temperature', 'roadside', 'safety'],
  },
  {
    id: 'INC-1002',
    title: 'Reefer temperature excursion',
    description:
      'Cargo compartment held at 7.8°C for 19 minutes against a 2–5°C pharmaceutical load requirement.',
    category: 'Operations',
    subcategory: 'Cold chain',
    severity: 'high',
    status: 'open',
    vehicleId: 'VH-1183',
    location: 'Pune Distribution Hub',
    reportedAt: minutesAgo(22),
    assignee: 'Arjun Rao',
    slaMinutes: 30,
    recommendedAction:
      'Quarantine the load, preserve the temperature log, and request shipper quality disposition.',
    tags: ['reefer', 'temperature', 'cold-chain', 'cargo'],
  },
  {
    id: 'INC-1003',
    title: 'Driver hours approaching legal limit',
    description:
      'Remaining drive time is 24 minutes while the planned safe stop is 38 minutes away under current traffic.',
    category: 'Compliance',
    subcategory: 'Hours of service',
    severity: 'high',
    status: 'monitoring',
    vehicleId: 'VH-3091',
    location: 'Mumbai–Nashik corridor',
    reportedAt: minutesAgo(41),
    assignee: 'Priya Singh',
    slaMinutes: 30,
    recommendedAction:
      'Route the driver to the nearest approved parking location and reassign the final delivery leg.',
    tags: ['hos', 'driver', 'compliance', 'route'],
  },
  {
    id: 'INC-1004',
    title: 'Unplanned engine derate',
    description:
      'Powertrain entered a 60% torque derate after repeated aftertreatment pressure alerts.',
    category: 'Maintenance',
    subcategory: 'Powertrain',
    severity: 'medium',
    status: 'investigating',
    vehicleId: 'VH-0874',
    location: 'Bengaluru Outer Ring Road',
    reportedAt: minutesAgo(95),
    assignee: 'Noah Williams',
    slaMinutes: 120,
    recommendedAction:
      'Complete remote diagnostics, avoid high-load operation, and route to the Whitefield service partner.',
    tags: ['engine', 'derate', 'maintenance', 'diagnostics'],
  },
  {
    id: 'INC-1005',
    title: 'Unauthorized yard movement detected',
    description:
      'Vehicle moved 430 metres outside its assigned staging zone while no driver session was active.',
    category: 'Security',
    subcategory: 'Unauthorized movement',
    severity: 'critical',
    status: 'resolved',
    vehicleId: 'VH-2210',
    location: 'Chennai South Yard',
    reportedAt: minutesAgo(320),
    assignee: 'Fatima Khan',
    slaMinutes: 15,
    recommendedAction:
      'Retain access logs and camera footage; security has verified the maintenance vendor movement.',
    tags: ['security', 'geofence', 'yard', 'access'],
  },
  {
    id: 'INC-1006',
    title: 'Late arrival risk on priority shipment',
    description:
      'Weather and congestion increased ETA by 47 minutes for a priority retail replenishment load.',
    category: 'Operations',
    subcategory: 'Delivery risk',
    severity: 'medium',
    status: 'open',
    vehicleId: 'VH-1546',
    location: 'Hyderabad East',
    reportedAt: minutesAgo(205),
    assignee: 'Liam Patel',
    slaMinutes: 180,
    recommendedAction:
      'Notify the consignee with the revised ETA and evaluate the eastern bypass at the next route decision point.',
    tags: ['eta', 'weather', 'shipment', 'routing'],
  },
  {
    id: 'INC-1007',
    title: 'Repeated tyre pressure loss',
    description:
      'Left rear tyre lost 9 PSI across two hours after inflation, indicating a probable slow puncture.',
    category: 'Maintenance',
    subcategory: 'Tyres',
    severity: 'medium',
    status: 'monitoring',
    vehicleId: 'VH-1732',
    location: 'Ahmedabad Logistics Park',
    reportedAt: minutesAgo(140),
    assignee: 'Maya Chen',
    slaMinutes: 120,
    recommendedAction:
      'Replace or repair the tyre before the next dispatch and inspect the paired tyre for abnormal wear.',
    tags: ['tyre', 'pressure', 'maintenance', 'inspection'],
  },
  {
    id: 'INC-1008',
    title: 'Electronic proof of delivery missing',
    description:
      'The delivery is geofence-confirmed, but the signed proof-of-delivery image has not synchronized.',
    category: 'Operations',
    subcategory: 'Delivery documentation',
    severity: 'low',
    status: 'open',
    vehicleId: 'VH-2658',
    location: 'Kochi Central',
    reportedAt: minutesAgo(260),
    assignee: 'Arjun Rao',
    slaMinutes: 480,
    recommendedAction:
      'Ask the driver to retry synchronization on a stable connection and retain the paper receipt.',
    tags: ['pod', 'document', 'sync', 'delivery'],
  },
];

export const FLEET_TIME_SERIES: readonly TimeSeriesPoint[] = [
  { date: daysAgo(6), availability: 93.6, utilization: 78.1, incidents: 11 },
  { date: daysAgo(5), availability: 94.1, utilization: 79.4, incidents: 9 },
  { date: daysAgo(4), availability: 94.5, utilization: 81.2, incidents: 7 },
  { date: daysAgo(3), availability: 93.9, utilization: 80.7, incidents: 10 },
  { date: daysAgo(2), availability: 95.2, utilization: 76.8, incidents: 6 },
  { date: daysAgo(1), availability: 94.6, utilization: 82.3, incidents: 8 },
  { date: daysAgo(0), availability: 94.8, utilization: 83.1, incidents: 8 },
];
