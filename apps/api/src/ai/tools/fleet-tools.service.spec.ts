import { FleetService } from '../../fleet/fleet.service';
import { FleetToolsService } from './fleet-tools.service';

describe('FleetToolsService', () => {
  const fleet = new FleetService();
  const tools = new FleetToolsService(fleet);

  it('exposes a valid JSON Schema for every tool', () => {
    expect(tools.definitions.length).toBeGreaterThan(0);
    tools.definitions.forEach((tool) => {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.parameters.type).toBe('object');
      // Closed schemas stop a model inventing extra filter parameters.
      expect(tool.parameters.additionalProperties).toBe(false);
    });
  });

  it('returns computed metrics that match the fleet service', () => {
    const call = tools.execute('get_fleet_metrics', {});

    expect(call.error).toBeUndefined();
    expect(call.result).toEqual(expect.objectContaining({
      totalVehicles: fleet.getFacts().totalVehicles,
      activeVehicles: fleet.getFacts().activeVehicles,
    }));
  });

  it('ignores arguments outside the schema instead of trusting the model', () => {
    const call = tools.execute('count_vehicles', {
      status: 'not-a-real-status',
      region: 'atlantis',
      injected: 'DROP TABLE vehicles',
    });
    const result = call.result as { count: number; total: number };

    // Unrecognised values are dropped, so the filter widens to the full fleet
    // rather than failing open on attacker-controlled input.
    expect(call.error).toBeUndefined();
    expect(result.count).toBe(result.total);
  });

  it('applies a valid status filter', () => {
    const call = tools.execute('count_vehicles', { status: 'offline' });
    const result = call.result as { count: number };

    expect(result.count).toBe(fleet.getFacts().offlineVehicles);
  });

  it('rejects a malformed vehicle identifier', () => {
    const call = tools.execute('get_vehicle', { vehicleId: '../../etc/passwd' });

    expect(call.error).toMatch(/Invalid vehicleId/);
  });

  it('reports a well-formed but unknown vehicle as not found', () => {
    const call = tools.execute('get_vehicle', { vehicleId: 'VH-9999' });

    expect(call.error).toBeUndefined();
    expect(call.result).toEqual({ found: false, vehicleId: 'VH-9999' });
  });

  it('returns a known vehicle with its open incidents', () => {
    const call = tools.execute('get_vehicle', { vehicleId: 'vh-2047' });
    const result = call.result as {
      found: boolean;
      vehicle: { id: string };
      openIncidents: unknown[];
    };

    expect(result.found).toBe(true);
    expect(result.vehicle.id).toBe('VH-2047');
    expect(result.openIncidents.length).toBeGreaterThan(0);
  });

  it('clamps a limit outside the schema range', () => {
    const call = tools.execute('list_incidents', { limit: 9999 });
    const result = call.result as { count: number };

    expect(result.count).toBeLessThanOrEqual(20);
  });

  it('refuses an unknown tool name', () => {
    const call = tools.execute('drop_all_tables', {});

    expect(call.error).toMatch(/Unknown tool/);
  });

  it('selects a narrow count tool for a specific metric question', () => {
    const plan = tools.selectLocally('How many vehicles are offline right now?');

    expect(plan.map((entry) => entry.name)).toEqual(['count_vehicles']);
    expect(plan[0]?.arguments).toEqual({ status: 'offline' });
  });

  it('detects the delayed filter from inflected wording', () => {
    ['How many vehicles are delayed?', 'How many vehicles are running late?'].forEach(
      (query) => {
        const plan = tools.selectLocally(query);
        expect(
          plan.find((entry) => entry.name === 'count_vehicles')?.arguments,
        ).toMatchObject({ delayedOnly: true });
      },
    );
  });

  it('falls back to the aggregate when a fleet-wide question names no filter', () => {
    const plan = tools.selectLocally('What is fleet availability today?');

    expect(plan[0]?.name).toBe('get_fleet_metrics');
  });

  it('selects the vehicle tool when the question names a vehicle', () => {
    const plan = tools.selectLocally('What is the status of VH-2047?');

    expect(
      plan.find((entry) => entry.name === 'get_vehicle')?.arguments,
    ).toEqual({ vehicleId: 'VH-2047' });
  });

  it('selects the SLA tool for SLA language', () => {
    const plan = tools.selectLocally('Which incidents are nearing SLA?');

    expect(plan.map((entry) => entry.name)).toContain('get_sla_risk');
  });
});
