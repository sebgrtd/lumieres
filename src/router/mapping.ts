export interface PhysicalTarget {
  ip: string;
  universe: number;
  channel: number; // 0-indexed offset in DMX buffer (0-511)
  type: 'r' | 'g' | 'b' | 'w' | 'dmx';
  fixtureId?: string;
}

export interface ControllerConfig {
  ip: string;
  universes: number[];
  startUniverse: number; // ArtNet universe offset: the first universe number this controller expects
}

export interface LedWallConfig {
  visibleWidth: number;
  visibleHeight: number;
  strips: number;
  ledsPerStrip: number;
  hiddenStartLeds: number;
  hiddenBetweenRunsLeds: number;
  hiddenEndLeds: number;
  firstEntityId: number;
  controllerEntityStride: number;
  stripEntityStride: number;
  stripsPerController: number;
}

export interface StaticFixtureConfig {
  enabled: boolean;
  fixtureId: string;
  ip: string;
  universe: number;
  startChannel: number;
}

export interface MovingHeadGroupConfig {
  enabled: boolean;
  ip: string;
  universe: number;
  count: number;
  startChannels: number[];
  channelsPerFixture: number;
  firstEntityId: number;
  entityStride: number;
}

export interface FixtureConfig {
  staticProjector: StaticFixtureConfig;
  movingHeads: MovingHeadGroupConfig;
}

export interface RouterConfig {
  controllers: ControllerConfig[];
  ledWall: LedWallConfig;
  fixtures: FixtureConfig;
  // Mapping from entityId to physical target
  entityMap: Record<number, PhysicalTarget>;
}

export type ConfigHealthLevel = 'error' | 'warning' | 'ok';

export interface ConfigHealthItem {
  level: ConfigHealthLevel;
  message: string;
  detail?: string;
}

export const DEFAULT_LED_WALL_CONFIG: LedWallConfig = {
  visibleWidth: 128,
  visibleHeight: 128,
  strips: 64,
  ledsPerStrip: 259,
  hiddenStartLeds: 1,
  hiddenBetweenRunsLeds: 1,
  hiddenEndLeds: 1,
  firstEntityId: 100,
  controllerEntityStride: 5000,
  stripEntityStride: 300,
  stripsPerController: 16,
};

export const DEFAULT_FIXTURE_CONFIG: FixtureConfig = {
  staticProjector: {
    enabled: true,
    fixtureId: 'static_1',
    ip: '192.168.1.48',
    universe: 33,
    startChannel: 0,
  },
  movingHeads: {
    enabled: true,
    ip: '192.168.1.48',
    universe: 33,
    count: 4,
    startChannels: [9, 29, 49, 69],
    channelsPerFixture: 13,
    firstEntityId: 34100,
    entityStride: 100,
  },
};

const DMX_CHANNELS_PER_UNIVERSE = 512;
const RGB_CHANNELS_PER_LED = 3;

function isValidIpv4(ip: unknown): ip is string {
  if (typeof ip !== 'string') return false;
  const parts = ip.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255 && String(value) === part;
  });
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function sanitizePositiveInteger(value: unknown, fallback: number, min = 1): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function normalizeLedWallConfig(input?: Partial<LedWallConfig>): LedWallConfig {
  const merged = { ...DEFAULT_LED_WALL_CONFIG, ...(input || {}) };
  const visibleWidth = sanitizePositiveInteger(merged.visibleWidth, DEFAULT_LED_WALL_CONFIG.visibleWidth);
  const visibleHeight = sanitizePositiveInteger(merged.visibleHeight, DEFAULT_LED_WALL_CONFIG.visibleHeight);

  return {
    ...merged,
    visibleWidth,
    visibleHeight,
    strips: sanitizePositiveInteger(merged.strips, Math.ceil(visibleWidth / 2)),
    ledsPerStrip: sanitizePositiveInteger(
      merged.ledsPerStrip,
      visibleHeight * 2 + merged.hiddenStartLeds + merged.hiddenBetweenRunsLeds + merged.hiddenEndLeds,
    ),
    hiddenStartLeds: sanitizePositiveInteger(merged.hiddenStartLeds, DEFAULT_LED_WALL_CONFIG.hiddenStartLeds, 0),
    hiddenBetweenRunsLeds: sanitizePositiveInteger(merged.hiddenBetweenRunsLeds, DEFAULT_LED_WALL_CONFIG.hiddenBetweenRunsLeds, 0),
    hiddenEndLeds: sanitizePositiveInteger(merged.hiddenEndLeds, DEFAULT_LED_WALL_CONFIG.hiddenEndLeds, 0),
    firstEntityId: sanitizePositiveInteger(merged.firstEntityId, DEFAULT_LED_WALL_CONFIG.firstEntityId, 0),
    controllerEntityStride: sanitizePositiveInteger(merged.controllerEntityStride, DEFAULT_LED_WALL_CONFIG.controllerEntityStride),
    stripEntityStride: sanitizePositiveInteger(merged.stripEntityStride, DEFAULT_LED_WALL_CONFIG.stripEntityStride),
    stripsPerController: sanitizePositiveInteger(merged.stripsPerController, DEFAULT_LED_WALL_CONFIG.stripsPerController),
  };
}

function normalizeFixtureConfig(input?: Partial<FixtureConfig>): FixtureConfig {
  const movingHeads = {
    ...DEFAULT_FIXTURE_CONFIG.movingHeads,
    ...(input?.movingHeads || {}),
  };

  return {
    staticProjector: {
      ...DEFAULT_FIXTURE_CONFIG.staticProjector,
      ...(input?.staticProjector || {}),
    },
    movingHeads: {
      ...movingHeads,
      count: sanitizePositiveInteger(movingHeads.count, DEFAULT_FIXTURE_CONFIG.movingHeads.count, 0),
      channelsPerFixture: sanitizePositiveInteger(movingHeads.channelsPerFixture, DEFAULT_FIXTURE_CONFIG.movingHeads.channelsPerFixture),
      firstEntityId: sanitizePositiveInteger(movingHeads.firstEntityId, DEFAULT_FIXTURE_CONFIG.movingHeads.firstEntityId, 0),
      entityStride: sanitizePositiveInteger(movingHeads.entityStride, DEFAULT_FIXTURE_CONFIG.movingHeads.entityStride),
      startChannels: Array.isArray(movingHeads.startChannels) ? movingHeads.startChannels.map((channel) => sanitizePositiveInteger(channel, 0, 0)) : [],
    },
  };
}

export function normalizeRouterConfig(config: RouterConfig): RouterConfig {
  return {
    ...config,
    ledWall: normalizeLedWallConfig(config.ledWall),
    fixtures: normalizeFixtureConfig(config.fixtures),
    controllers: Array.isArray(config.controllers) ? config.controllers : [],
    entityMap: config.entityMap || {},
  };
}

export function validateRouterConfig(input: RouterConfig): ConfigHealthItem[] {
  const config = normalizeRouterConfig(input);
  const items: ConfigHealthItem[] = [];
  const controllers = config.controllers || [];
  const ledWall = config.ledWall;
  const entityMap = config.entityMap || {};

  if (controllers.length === 0) {
    items.push({ level: 'error', message: 'No physical controllers configured.' });
  }

  const controllerIps = new Map<string, number>();
  controllers.forEach((controller, index) => {
    const label = `Controller ${index + 1}`;
    if (!isValidIpv4(controller.ip)) {
      items.push({ level: 'error', message: `${label} has an invalid IPv4 address.`, detail: String(controller.ip || 'empty') });
    } else {
      controllerIps.set(controller.ip, (controllerIps.get(controller.ip) || 0) + 1);
    }

    if (!Array.isArray(controller.universes) || controller.universes.length === 0) {
      items.push({ level: 'warning', message: `${label} has no universe assigned.`, detail: controller.ip });
    } else {
      const seenUniverses = new Set<number>();
      controller.universes.forEach((universe) => {
        if (!isNonNegativeInteger(universe)) {
          items.push({ level: 'error', message: `${label} has an invalid universe.`, detail: String(universe) });
          return;
        }
        if (seenUniverses.has(universe)) {
          items.push({ level: 'warning', message: `${label} repeats universe ${universe}.`, detail: controller.ip });
        }
        seenUniverses.add(universe);
      });
    }

    if (!isNonNegativeInteger(controller.startUniverse)) {
      items.push({ level: 'error', message: `${label} has an invalid ArtNet offset.`, detail: String(controller.startUniverse) });
    }
  });

  controllerIps.forEach((count, ip) => {
    if (count > 1) {
      items.push({ level: 'error', message: `Controller IP ${ip} is duplicated.`, detail: `${count} controllers use the same IP.` });
    }
  });

  const positiveLedWallFields: Array<keyof Pick<LedWallConfig, 'visibleWidth' | 'visibleHeight' | 'strips' | 'ledsPerStrip' | 'stripsPerController'>> = [
    'visibleWidth',
    'visibleHeight',
    'strips',
    'ledsPerStrip',
    'stripsPerController',
  ];
  positiveLedWallFields.forEach((field) => {
    if (!Number.isInteger(ledWall[field]) || ledWall[field] <= 0) {
      items.push({ level: 'error', message: `LED wall ${field} must be a positive integer.`, detail: String(ledWall[field]) });
    }
  });

  const expectedStrips = Math.ceil(ledWall.visibleWidth / 2);
  if (Number.isFinite(expectedStrips) && ledWall.strips !== expectedStrips) {
    items.push({
      level: 'warning',
      message: 'LED strip count does not match the visible width.',
      detail: `Expected ${expectedStrips} strips for ${ledWall.visibleWidth}px width, got ${ledWall.strips}.`,
    });
  }

  const expectedLedsPerStrip = ledWall.visibleHeight * 2 + ledWall.hiddenStartLeds + ledWall.hiddenBetweenRunsLeds + ledWall.hiddenEndLeds;
  if (Number.isFinite(expectedLedsPerStrip) && ledWall.ledsPerStrip !== expectedLedsPerStrip) {
    items.push({
      level: 'warning',
      message: 'LEDs per strip do not match the wall height and hidden LEDs.',
      detail: `Expected ${expectedLedsPerStrip}, got ${ledWall.ledsPerStrip}.`,
    });
  }

  const universesNeeded = Math.ceil((ledWall.strips * ledWall.ledsPerStrip * RGB_CHANNELS_PER_LED) / DMX_CHANNELS_PER_UNIVERSE);
  const configuredUniverses = controllers.reduce((sum, controller) => sum + (Array.isArray(controller.universes) ? controller.universes.length : 0), 0);
  if (configuredUniverses < universesNeeded) {
    items.push({
      level: 'warning',
      message: 'Configured universes may not cover the LED wall.',
      detail: `${configuredUniverses} configured, ${universesNeeded} estimated from wall geometry.`,
    });
  }

  const targetKeys = new Map<string, string>();
  let invalidTargets = 0;
  let duplicateTargets = 0;
  Object.entries(entityMap).forEach(([entityId, target]) => {
    if (!target || !isValidIpv4(target.ip) || !isNonNegativeInteger(target.universe) || !Number.isInteger(target.channel) || target.channel < 0 || target.channel >= DMX_CHANNELS_PER_UNIVERSE) {
      invalidTargets += 1;
      return;
    }

    const key = `${target.ip}:${target.universe}:${target.channel}`;
    const previousEntity = targetKeys.get(key);
    if (previousEntity && previousEntity !== entityId) {
      duplicateTargets += 1;
      return;
    }
    targetKeys.set(key, entityId);
  });

  if (invalidTargets > 0) {
    items.push({ level: 'error', message: 'Entity map contains invalid physical targets.', detail: `${invalidTargets} target(s) have invalid IP, universe or DMX channel.` });
  }
  if (duplicateTargets > 0) {
    items.push({ level: 'warning', message: 'Entity map contains duplicate physical channel targets.', detail: `${duplicateTargets} duplicate target(s) detected.` });
  }

  const projector = config.fixtures.staticProjector;
  if (projector.enabled && (!isValidIpv4(projector.ip) || !isNonNegativeInteger(projector.universe) || projector.startChannel < 0 || projector.startChannel + 3 >= DMX_CHANNELS_PER_UNIVERSE)) {
    items.push({ level: 'error', message: 'Static projector DMX address is outside a valid universe.', detail: `${projector.ip}:${projector.universe}:${projector.startChannel}` });
  }

  const movingHeads = config.fixtures.movingHeads;
  if (movingHeads.enabled) {
    if (!isValidIpv4(movingHeads.ip) || !isNonNegativeInteger(movingHeads.universe)) {
      items.push({ level: 'error', message: 'Moving heads use an invalid IP or universe.', detail: `${movingHeads.ip}:${movingHeads.universe}` });
    }
    if (movingHeads.startChannels.length < movingHeads.count) {
      items.push({ level: 'warning', message: 'Moving heads have fewer start channels than fixtures.', detail: `${movingHeads.startChannels.length} channels for ${movingHeads.count} fixtures.` });
    }
    movingHeads.startChannels.slice(0, movingHeads.count).forEach((channel, index) => {
      if (!Number.isInteger(channel) || channel < 0 || channel + movingHeads.channelsPerFixture - 1 >= DMX_CHANNELS_PER_UNIVERSE) {
        items.push({ level: 'error', message: `Moving head ${index + 1} exceeds DMX universe bounds.`, detail: `Start ${channel}, width ${movingHeads.channelsPerFixture}.` });
      }
    });
  }

  if (items.length === 0) {
    items.push({ level: 'ok', message: 'Configuration is valid for the current physical setup.' });
  }

  return items;
}

export function buildConfigFromHardware(
  ledWallInput: Partial<LedWallConfig> = DEFAULT_LED_WALL_CONFIG,
  fixtureInput: Partial<FixtureConfig> = DEFAULT_FIXTURE_CONFIG,
  controllerIps = ['192.168.1.45', '192.168.1.46', '192.168.1.47', '192.168.1.48'],
): RouterConfig {
  const ledWall = normalizeLedWallConfig(ledWallInput);
  const fixtures = normalizeFixtureConfig(fixtureInput);
  const universesPerStrip = Math.ceil((ledWall.ledsPerStrip * RGB_CHANNELS_PER_LED) / DMX_CHANNELS_PER_UNIVERSE);
  const controllerCount = Math.max(1, Math.ceil(ledWall.strips / ledWall.stripsPerController));
  const controllers: ControllerConfig[] = [];

  for (let c = 0; c < controllerCount; c++) {
    const startStrip = c * ledWall.stripsPerController;
    const stripCount = Math.min(ledWall.stripsPerController, ledWall.strips - startStrip);
    const startUniverse = startStrip * universesPerStrip;
    controllers.push({
      ip: controllerIps[c] || `192.168.1.${45 + c}`,
      universes: Array.from({ length: stripCount * universesPerStrip }, (_, i) => startUniverse + i),
      startUniverse,
    });
  }

  const config: RouterConfig = {
    controllers,
    ledWall,
    fixtures,
    entityMap: {},
  };

  for (let strip = 0; strip < ledWall.strips; strip++) {
    const controllerIndex = Math.floor(strip / ledWall.stripsPerController);
    const ctrl = config.controllers[controllerIndex];
    if (!ctrl) continue;

    const stripOffset = strip % ledWall.stripsPerController;
    const firstUniverse = strip * universesPerStrip;

    for (let led = 0; led < ledWall.ledsPerStrip; led++) {
      const channelOffset = led * RGB_CHANNELS_PER_LED;
      const universeOffset = Math.floor(channelOffset / DMX_CHANNELS_PER_UNIVERSE);
      const channel = channelOffset % DMX_CHANNELS_PER_UNIVERSE;
      const entityId = ledWall.firstEntityId
        + controllerIndex * ledWall.controllerEntityStride
        + stripOffset * ledWall.stripEntityStride
        + led;

      config.entityMap[entityId] = {
        ip: ctrl.ip,
        universe: firstUniverse + universeOffset,
        channel,
        type: 'r',
      };
    }
  }

  if (fixtures.staticProjector.enabled) {
    const fixture = fixtures.staticProjector;
    config.entityMap[33001] = { ip: fixture.ip, universe: fixture.universe, channel: fixture.startChannel, type: 'r', fixtureId: fixture.fixtureId };
    config.entityMap[33002] = { ip: fixture.ip, universe: fixture.universe, channel: fixture.startChannel + 1, type: 'g', fixtureId: fixture.fixtureId };
    config.entityMap[33003] = { ip: fixture.ip, universe: fixture.universe, channel: fixture.startChannel + 2, type: 'b', fixtureId: fixture.fixtureId };
    config.entityMap[33004] = { ip: fixture.ip, universe: fixture.universe, channel: fixture.startChannel + 3, type: 'w', fixtureId: fixture.fixtureId };
  }

  if (fixtures.movingHeads.enabled) {
    const movingHeads = fixtures.movingHeads;
    for (let l = 0; l < movingHeads.count; l++) {
      const fixtureId = `lyre_${l + 1}`;
      const startCh = movingHeads.startChannels[l] ?? movingHeads.startChannels[0] + l * movingHeads.channelsPerFixture;
      const baseEntityId = movingHeads.firstEntityId + l * movingHeads.entityStride;
      for (let ch = 0; ch < movingHeads.channelsPerFixture; ch++) {
        config.entityMap[baseEntityId + ch] = {
          ip: movingHeads.ip,
          universe: movingHeads.universe,
          channel: startCh + ch,
          type: 'dmx',
          fixtureId,
        };
      }
    }
  }

  const deviceUniversesByIp = new Map<string, Set<number>>();
  Object.values(config.entityMap).forEach((target) => {
    if (!deviceUniversesByIp.has(target.ip)) {
      deviceUniversesByIp.set(target.ip, new Set());
    }
    deviceUniversesByIp.get(target.ip)!.add(target.universe);
  });

  config.controllers.forEach((ctrl) => {
    const mappedUniverses = deviceUniversesByIp.get(ctrl.ip);
    if (!mappedUniverses) return;
    ctrl.universes = Array.from(new Set([...ctrl.universes, ...mappedUniverses])).sort((a, b) => a - b);
  });

  return config;
}

/**
 * Procedurally generates the default configuration for the Austrian LED wall and DMX fixtures.
 */
export function generateDefaultConfig(): RouterConfig {
  return buildConfigFromHardware();
}

/**
 * Maps a grid coordinate (x,y) from the 128x128 visible area to the corresponding logical entityId.
 * x: 0..127, y: 0..127 (0 is bottom, 127 is top)
 */
export function getEntityIdFromGrid(x: number, y: number): number {
  return getEntityIdFromGridWithConfig(x, y, DEFAULT_LED_WALL_CONFIG);
}

export function getEntityIdFromGridWithConfig(x: number, y: number, ledWall: LedWallConfig): number {
  // 64 strips total.
  // Each strip s (0..63) is folded.
  // s = Math.floor(x / 2)
  const s = Math.floor(x / 2);
  const isDownColumn = x % 2 !== 0;

  // Find controller index (0..3) and strip offset (0..15)
  const controllerIndex = Math.floor(s / ledWall.stripsPerController);
  const stripOffset = s % ledWall.stripsPerController;

  // ledIndex in the strip:
  // Base hidden: led 0
  // Going UP: ledIndex = y + 1 (led 1..128)
  // Top hidden: led 129
  // Going DOWN: ledIndex = 257 - y (led 130..257)
  // Base hidden: led 258
  const ledIndex = !isDownColumn
    ? y + ledWall.hiddenStartLeds
    : ledWall.hiddenStartLeds + ledWall.visibleHeight + ledWall.hiddenBetweenRunsLeds + (ledWall.visibleHeight - 1 - y);

  return ledWall.firstEntityId + controllerIndex * ledWall.controllerEntityStride + stripOffset * ledWall.stripEntityStride + ledIndex;
}
