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

export interface RouterConfig {
  controllers: ControllerConfig[];
  // Mapping from entityId to physical target
  entityMap: Record<number, PhysicalTarget>;
}

/**
 * Procedurally generates the default configuration for the Austrian LED wall and DMX fixtures.
 */
export function generateDefaultConfig(): RouterConfig {
  const config: RouterConfig = {
    controllers: [
      { ip: '192.168.1.45', universes: Array.from({ length: 32 }, (_, i) => i), startUniverse: 0 },
      { ip: '192.168.1.46', universes: Array.from({ length: 32 }, (_, i) => i + 32), startUniverse: 32 },
      { ip: '192.168.1.47', universes: Array.from({ length: 32 }, (_, i) => i + 64), startUniverse: 64 },
      { ip: '192.168.1.48', universes: [...Array.from({ length: 32 }, (_, i) => i + 96), 33], startUniverse: 96 }, // includes universe 33
    ],
    entityMap: {},
  };

  // Generate 128x128 LED Wall mapping
  // 4 controllers (0..3)
  // Each controller has 16 strips (0..15) -> 64 strips total
  // Each strip has 259 LEDs.
  // Each strip uses 2 universes.
  for (let c = 0; c < 4; c++) {
    const ip = `192.168.1.4${5 + c}`;
    const startUniverse = c * 32;

    for (let s = 0; s < 16; s++) {
      const u0 = startUniverse + s * 2;
      const u1 = u0 + 1;

      for (let led = 0; led < 259; led++) {
        // Calculate logical entityId
        const entityId = 100 + c * 5000 + s * 300 + led;

        // DMX mapping:
        // First 170 LEDs go to u0 (channels 0..509)
        // Next 89 LEDs go to u1 (channels 0..266)
        let universe = u0;
        let ledOffset = led;
        if (led >= 170) {
          universe = u1;
          ledOffset = led - 170;
        }

        const startChannel = ledOffset * 3; // RGB uses 3 channels

        // Map Red, Green, Blue
        config.entityMap[entityId] = {
          ip,
          universe,
          channel: startChannel,
          type: 'r',
        };
      }
    }
  }

  // Generate Static Projector (Universe 33, channels 1-4: R, G, B, W)
  // We'll map them to entity IDs 33001 to 33004
  const staticIP = '192.168.1.48';
  config.entityMap[33001] = { ip: staticIP, universe: 33, channel: 0, type: 'r', fixtureId: 'static_1' };
  config.entityMap[33002] = { ip: staticIP, universe: 33, channel: 1, type: 'g', fixtureId: 'static_1' };
  config.entityMap[33003] = { ip: staticIP, universe: 33, channel: 2, type: 'b', fixtureId: 'static_1' };
  config.entityMap[33004] = { ip: staticIP, universe: 33, channel: 3, type: 'w', fixtureId: 'static_1' };

  // Generate 4 Lyres (Moving Heads) in Universe 33
  // Lyre 1: channels 10-22 (13 channels)
  // Lyre 2: channels 30-42
  // Lyre 3: channels 50-62
  // Lyre 4: channels 70-82
  const lyreOffsets = [10 - 1, 30 - 1, 50 - 1, 70 - 1]; // convert to 0-indexed
  for (let l = 0; l < 4; l++) {
    const fixtureId = `lyre_${l + 1}`;
    const startCh = lyreOffsets[l];
    for (let ch = 0; ch < 13; ch++) {
      const entityId = 34000 + (l + 1) * 100 + ch;
      config.entityMap[entityId] = {
        ip: staticIP,
        universe: 33,
        channel: startCh + ch,
        type: 'dmx',
        fixtureId,
      };
    }
  }

  return config;
}

/**
 * Maps a grid coordinate (x,y) from the 128x128 visible area to the corresponding logical entityId.
 * x: 0..127, y: 0..127 (0 is bottom, 127 is top)
 */
export function getEntityIdFromGrid(x: number, y: number): number {
  // 64 strips total.
  // Each strip s (0..63) is folded.
  // s = Math.floor(x / 2)
  const s = Math.floor(x / 2);
  const isDownColumn = x % 2 !== 0;

  // Find controller index (0..3) and strip offset (0..15)
  const controllerIndex = Math.floor(s / 16);
  const stripOffset = s % 16;

  // ledIndex in the strip:
  // Base hidden: led 0
  // Going UP: ledIndex = y + 1 (led 1..128)
  // Top hidden: led 129
  // Going DOWN: ledIndex = 257 - y (led 130..257)
  // Base hidden: led 258
  const ledIndex = !isDownColumn ? (y + 1) : (257 - y);

  return 100 + controllerIndex * 5000 + stripOffset * 300 + ledIndex;
}
