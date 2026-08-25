import { FleetService } from './fleet.service';
import { DELAY_THRESHOLD_MINUTES, FLEET_SIZE, VEHICLES } from './fleet.data';

describe('FleetService derived metrics', () => {
  const fleet = new FleetService();

  it('aggregates every metric from vehicle records', () => {
    const facts = fleet.getFacts();
    const statusCount = (status: string): number =>
      VEHICLES.filter((vehicle) => vehicle.status === status).length;

    expect(facts.totalVehicles).toBe(VEHICLES.length);
    expect(facts.activeVehicles).toBe(statusCount('active'));
    expect(facts.idleVehicles).toBe(statusCount('idle'));
    expect(facts.maintenanceVehicles).toBe(statusCount('maintenance'));
    expect(facts.offlineVehicles).toBe(statusCount('offline'));
    expect(
      facts.activeVehicles +
        facts.idleVehicles +
        facts.maintenanceVehicles +
        facts.offlineVehicles,
    ).toBe(facts.totalVehicles);
  });

  it('matches the declared status distribution exactly', () => {
    // Pinned vehicles must count against the quota, not add to it, or the
    // documented fleet composition silently stops being the real one.
    const facts = fleet.getFacts();

    expect(facts.totalVehicles).toBe(FLEET_SIZE);
    expect(facts.activeVehicles).toBe(247);
    expect(facts.idleVehicles).toBe(48);
    expect(facts.maintenanceVehicles).toBe(12);
    expect(facts.offlineVehicles).toBe(5);
    expect(new Set(VEHICLES.map((vehicle) => vehicle.id)).size).toBe(FLEET_SIZE);
  });

  it('computes availability as the share not withdrawn from service', () => {
    const facts = fleet.getFacts();
    const expected =
      ((facts.totalVehicles - facts.maintenanceVehicles - facts.offlineVehicles) /
        facts.totalVehicles) *
      100;

    expect(facts.fleetAvailability).toBeCloseTo(expected, 1);
  });

  it('sums distance from the records rather than reporting a literal', () => {
    const facts = fleet.getFacts();
    const expected = VEHICLES.reduce(
      (total, vehicle) => total + vehicle.distanceTodayKm,
      0,
    );

    expect(facts.distanceTodayKm).toBe(expected);
  });

  it('counts delayed vehicles against the documented threshold', () => {
    const facts = fleet.getFacts();
    const expected = VEHICLES.filter(
      (vehicle) => vehicle.delayMinutes >= DELAY_THRESHOLD_MINUTES,
    ).length;

    expect(facts.delayedVehicles).toBe(expected);
  });

  it('generates the same fleet on every run', () => {
    expect(new FleetService().getFacts()).toEqual(fleet.getFacts());
  });

  it('keeps every incident vehicle present in the fleet', () => {
    fleet.getIncidents().items.forEach((incident) => {
      expect(fleet.getVehicle(incident.vehicleId)).toBeDefined();
    });
  });

  it('orders incidents by severity then recency', () => {
    const incidents = fleet.listIncidents();
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;

    incidents.slice(1).forEach((incident, index) => {
      expect(rank[incident.severity]).toBeGreaterThanOrEqual(
        rank[incidents[index]!.severity],
      );
    });
  });

  it('filters incidents by vehicle case-insensitively', () => {
    expect(fleet.listIncidents({ vehicleId: 'vh-2047' })).toHaveLength(
      fleet.listIncidents({ vehicleId: 'VH-2047' }).length,
    );
    expect(fleet.listIncidents({ vehicleId: 'VH-2047' }).length).toBeGreaterThan(0);
  });

  it('anchors incidents to this run so SLA countdowns stay meaningful', () => {
    // Frozen calendar dates would read as months overdue on any later day.
    const now = Date.now();
    fleet.getIncidents().items.forEach((incident) => {
      const age = now - Date.parse(incident.reportedAt);
      expect(age).toBeGreaterThan(0);
      expect(age).toBeLessThan(24 * 60 * 60 * 1000);
    });
  });

  it('splits SLA risk into breaching and due-soon', () => {
    const risk = fleet.getSlaRisk(60);

    risk.breaching.forEach((entry) => expect(entry.minutesOverdue).toBeGreaterThan(0));
    risk.dueSoon.forEach((entry) => {
      expect(entry.minutesRemaining).toBeGreaterThanOrEqual(0);
      expect(entry.minutesRemaining).toBeLessThanOrEqual(60);
    });
    // The seeded shift is tuned to show both states, not only one.
    expect(risk.breaching.length).toBeGreaterThan(0);
    expect(risk.dueSoon.length).toBeGreaterThan(0);
  });

  it('excludes resolved incidents from SLA risk', () => {
    const now = Date.now();
    const risk = fleet.getSlaRisk(1440, now);
    const resolvedIds = fleet
      .listIncidents({ status: 'resolved' })
      .map((incident) => incident.id);

    [...risk.breaching, ...risk.dueSoon].forEach((entry) => {
      expect(resolvedIds).not.toContain(entry.id);
    });
  });
});
