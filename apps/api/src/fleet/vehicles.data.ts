import type { Vehicle, VehicleStatus } from './fleet.types';

/**
 * Synthetic fleet, generated deterministically so every KPI in the product is
 * a real aggregation over records rather than a hard-coded literal. The seed is
 * fixed, so the same 312 vehicles exist on every boot and in every test run.
 */

/** Captured once at load so telemetry ages relative to this run, not a frozen date. */
export const DATA_DATE = new Date().toISOString();

/** Minutes of remaining legal drive time that counts as "nearing the limit". */
export const HOS_WARNING_MINUTES = 45;

/** Minutes behind schedule before a vehicle counts as delayed. */
export const DELAY_THRESHOLD_MINUTES = 15;

const DEPOTS: readonly { depot: string; region: string }[] = [
  { depot: 'North Ridge', region: 'north' },
  { depot: 'Ahmedabad Logistics Park', region: 'west' },
  { depot: 'Pune Distribution Hub', region: 'west' },
  { depot: 'Bengaluru Whitefield', region: 'south' },
  { depot: 'Kochi Central', region: 'south' },
  { depot: 'Hyderabad East', region: 'east' },
  { depot: 'Chennai South Yard', region: 'east' },
  { depot: 'Nagpur Central', region: 'central' },
];

const STATUS_QUOTA: readonly { status: VehicleStatus; count: number }[] = [
  { status: 'active', count: 247 },
  { status: 'idle', count: 48 },
  { status: 'maintenance', count: 12 },
  { status: 'offline', count: 5 },
];

export const FLEET_SIZE = STATUS_QUOTA.reduce(
  (total, quota) => total + quota.count,
  0,
);

/**
 * Vehicles referenced by seeded incidents. Their attributes are pinned so the
 * incident narrative and the aggregate metrics agree with each other.
 */
const PINNED: readonly (Partial<Vehicle> & { id: string })[] = [
  { id: 'VH-2047', status: 'offline', depot: 'North Ridge', region: 'north', delayMinutes: 96, driveTimeRemainingMinutes: 210 },
  { id: 'VH-1183', status: 'active', depot: 'Pune Distribution Hub', region: 'west', delayMinutes: 41, driveTimeRemainingMinutes: 265 },
  { id: 'VH-3091', status: 'active', depot: 'Nagpur Central', region: 'central', delayMinutes: 0, driveTimeRemainingMinutes: 24 },
  { id: 'VH-0874', status: 'maintenance', depot: 'Bengaluru Whitefield', region: 'south', delayMinutes: 63, driveTimeRemainingMinutes: null },
  { id: 'VH-2210', status: 'idle', depot: 'Chennai South Yard', region: 'east', delayMinutes: 0, driveTimeRemainingMinutes: null },
  { id: 'VH-1546', status: 'active', depot: 'Hyderabad East', region: 'east', delayMinutes: 47, driveTimeRemainingMinutes: 188 },
  { id: 'VH-1732', status: 'idle', depot: 'Ahmedabad Logistics Park', region: 'west', delayMinutes: 0, driveTimeRemainingMinutes: null },
  { id: 'VH-2658', status: 'active', depot: 'Kochi Central', region: 'south', delayMinutes: 0, driveTimeRemainingMinutes: 312 },
];

/**
 * Cycles through a non-empty list. Written as a checked lookup rather than a
 * type assertion so both the compiler and the linter can see the invariant.
 */
function cycle<T>(items: readonly T[], index: number): T {
  const value = items[index % items.length];
  if (value === undefined) {
    throw new Error('cycle() requires a non-empty list');
  }
  return value;
}

/** Small, fast, deterministic PRNG. Same seed always yields the same fleet. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildFleet(): Vehicle[] {
  const random = mulberry32(20260825);
  const pinnedIds = new Set(PINNED.map((vehicle) => vehicle.id));

  // Stable ID pool: pinned vehicles first, then filler IDs that never collide.
  const ids: string[] = [...pinnedIds];
  for (let candidate = 1; ids.length < FLEET_SIZE; candidate += 1) {
    const id = `VH-${String(candidate).padStart(4, '0')}`;
    if (!pinnedIds.has(id)) ids.push(id);
  }

  // Pinned vehicles count against the quota rather than adding to it, so the
  // declared distribution is the distribution the fleet actually has.
  const remaining = new Map<VehicleStatus, number>(
    STATUS_QUOTA.map(({ status, count }) => [status, count]),
  );
  PINNED.forEach((vehicle) => {
    if (!vehicle.status) return;
    const left = (remaining.get(vehicle.status) ?? 0) - 1;
    if (left < 0) {
      throw new Error(
        `Pinned vehicles exceed the ${vehicle.status} quota; raise it in STATUS_QUOTA.`,
      );
    }
    remaining.set(vehicle.status, left);
  });

  const statuses: VehicleStatus[] = [];
  remaining.forEach((count, status) => {
    for (let index = 0; index < count; index += 1) statuses.push(status);
  });
  // Shuffle so status is not correlated with the ID sequence.
  for (let index = statuses.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const left = cycle(statuses, index);
    const right = cycle(statuses, swap);
    statuses[index] = right;
    statuses[swap] = left;
  }
  let nextStatus = 0;

  const baseTime = new Date(DATA_DATE).getTime();

  return ids.map((id, index) => {
    const pinned = PINNED.find((vehicle) => vehicle.id === id);
    const status = pinned?.status ?? cycle(statuses, nextStatus++);
    const location = cycle(DEPOTS, index);
    const depot = pinned?.depot ?? location.depot;
    const region = pinned?.region ?? location.region;

    const distanceTodayKm =
      status === 'active'
        ? Math.round(120 + random() * 500)
        : status === 'idle'
          ? Math.round(random() * 180)
          : status === 'maintenance'
            ? Math.round(random() * 40)
            : 0;

    // Only a minority of moving vehicles run behind schedule.
    const delayRoll = random();
    const delayMinutes =
      pinned?.delayMinutes ??
      (status === 'active' && delayRoll > 0.94
        ? Math.round(16 + random() * 70)
        : status === 'active' && delayRoll > 0.86
          ? Math.round(1 + random() * 13)
          : 0);

    const hasDriver = status === 'active' || (status === 'idle' && random() > 0.6);
    const driveTimeRemainingMinutes =
      pinned && 'driveTimeRemainingMinutes' in pinned
        ? (pinned.driveTimeRemainingMinutes ?? null)
        : hasDriver
          ? Math.round(20 + random() * 520)
          : null;

    const telemetryAgeMinutes =
      status === 'offline'
        ? Math.round(70 + random() * 600)
        : Math.round(random() * 12);

    return {
      id,
      depot,
      region,
      status,
      odometerKm: Math.round(40_000 + random() * 610_000),
      distanceTodayKm,
      delayMinutes,
      lastTelemetryAt: new Date(
        baseTime - telemetryAgeMinutes * 60_000,
      ).toISOString(),
      driverId: hasDriver ? `DR-${String(1000 + index).padStart(4, '0')}` : null,
      driveTimeRemainingMinutes,
    } satisfies Vehicle;
  });
}

export const VEHICLES: readonly Vehicle[] = buildFleet();
