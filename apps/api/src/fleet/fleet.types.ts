export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus =
  | 'open'
  | 'investigating'
  | 'monitoring'
  | 'resolved';

export type VehicleStatus = 'active' | 'idle' | 'maintenance' | 'offline';

export interface Vehicle {
  id: string;
  depot: string;
  region: string;
  status: VehicleStatus;
  odometerKm: number;
  distanceTodayKm: number;
  /** Minutes behind the planned schedule. Zero means on time. */
  delayMinutes: number;
  lastTelemetryAt: string;
  driverId: string | null;
  /** Legal drive time left for the assigned driver, null when unassigned. */
  driveTimeRemainingMinutes: number | null;
}

export interface FleetIncident {
  id: string;
  title: string;
  description: string;
  category: string;
  subcategory: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  vehicleId: string;
  location: string;
  reportedAt: string;
  assignee: string;
  slaMinutes: number;
  recommendedAction: string;
  tags: string[];
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  section: string;
  category: string;
  content: string;
  owner: string;
  updatedAt: string;
  version: string;
  readTimeMinutes: number;
  keywords: string[];
}

export interface TimeSeriesPoint {
  date: string;
  availability: number;
  utilization: number;
  incidents: number;
}

/** Every field here is aggregated from vehicle and incident records. */
export interface FleetFacts {
  totalVehicles: number;
  activeVehicles: number;
  idleVehicles: number;
  maintenanceVehicles: number;
  offlineVehicles: number;
  delayedVehicles: number;
  fleetAvailability: number;
  utilizationRate: number;
  openIncidents: number;
  criticalIncidents: number;
  highIncidents: number;
  incidentsBreachingSla: number;
  distanceTodayKm: number;
  averageDelayMinutes: number;
  driversNearingHosLimit: number;
}

export interface FleetOverview {
  generatedAt: string;
  metrics: {
    totalVehicles: number;
    activeVehicles: number;
    delayedVehicles: number;
    fleetAvailability: number;
    openIncidents: number;
    criticalIncidents: number;
    /** Share of AI runs in this process that were grounded in sources or tools. */
    groundedAnswerRate: number;
    distanceTodayKm: number;
  };
  dailyBrief: {
    greeting: string;
    headline: string;
    summary: string;
    priorities: string[];
    generatedAt: string;
    provider: 'local' | 'openai' | 'aws';
  };
  fleetStatus: {
    active: number;
    idle: number;
    maintenance: number;
    offline: number;
  };
  timeSeries: TimeSeriesPoint[];
  incidentFeed: FleetIncident[];
  aiHealth: {
    status: 'healthy' | 'degraded';
    configuredProvider: 'local' | 'openai' | 'aws';
    activeProvider: 'local' | 'openai' | 'aws';
    indexedDocuments: number;
    indexedChunks: number;
    embeddingModel: string;
    generationModel: string;
    promptVersion: string;
    averageLatencyMs: number;
    totalRuns: number;
    groundedRate: number;
    totalCostUsd: number;
    lastIndexedAt: string | null;
  };
}
