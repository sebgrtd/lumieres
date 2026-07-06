import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ArtNetSender } from './src/router/artnet.ts';
import { EHubReceiver } from './src/router/ehub.ts';
import { generateDefaultConfig, RouterConfig, getEntityIdFromGrid } from './src/router/mapping.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// Global Router State
const CONFIG_FILE = path.join(__dirname, 'config.json');
let activeConfig: RouterConfig = generateDefaultConfig();

if (fs.existsSync(CONFIG_FILE)) {
  try {
    activeConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    console.log('Loaded routing configuration from config.json');
  } catch (e) {
    console.error('Failed to load config.json, using defaults:', e);
  }
}

// ArtNet & Networking
const artnetSender = new ArtNetSender();

// Allocate universe DMX buffers: map of universe -> Uint8Array(512)
const universeBuffers: Map<number, Uint8Array> = new Map();
const dirtyUniverses: Set<number> = new Set();

function getUniverseBuffer(universe: number): Uint8Array {
  let buf = universeBuffers.get(universe);
  if (!buf) {
    buf = new Uint8Array(512);
    universeBuffers.set(universe, buf);
  }
  return buf;
}

// Map of universe -> controller IP
const universeToIpMap: Map<number, string> = new Map();

function rebuildUniverseToIpMap() {
  universeToIpMap.clear();
  activeConfig.controllers.forEach((ctrl) => {
    ctrl.universes.forEach((univ) => {
      universeToIpMap.set(univ, ctrl.ip);
    });
  });
  console.log(`Rebuilt universe-to-IP map with ${universeToIpMap.size} mappings.`);
}

// Initial build
rebuildUniverseToIpMap();

// Timeline state stored on backend
interface TimelineBlock {
  id: string;
  lane: 'wall' | 'lyres' | 'static';
  startTime: number;
  endTime: number;
  type: string;
  name: string;
}

let timelineBlocks: TimelineBlock[] = [
  { id: '1', lane: 'wall', startTime: 0, endTime: 12, type: 'radial_ripple', name: 'Waltz Ripples (Red/White)' },
  { id: '2', lane: 'lyres', startTime: 0, endTime: 12, type: 'lyre_waltz', name: 'Slow Gold Waltz Pan/Tilt' },
  { id: '3', lane: 'wall', startTime: 12, endTime: 15, type: 'gradient_sweep', name: 'Speed Up Flag Sweep' },
  { id: '4', lane: 'lyres', startTime: 12, endTime: 15, type: 'lyre_rise', name: 'Beams Rise' },
  { id: '5', lane: 'wall', startTime: 15, endTime: 35, type: 'strobe_flash', name: 'Austria Strobe Drops' },
  { id: '6', lane: 'wall', startTime: 20, endTime: 35, type: 'equalizer', name: 'Trap Audio Spectrum' },
  { id: '7', lane: 'lyres', startTime: 15, endTime: 35, type: 'lyre_trap', name: 'Fast Mirrored Cross Chases' },
];

// Playback state
let isPlaying = false;
let playbackTime = 0;
let routeInterval: NodeJS.Timeout | null = null;
let activeOverride: string | null = null;

// Telemetry Stats
let stats = {
  packetsSent: 0,
  bytesSent: 0,
  framesProcessed: 0,
  droppedFrames: 0,
  ehubPacketsReceived: 0,
};

let lastStatsTime = Date.now();
let currentTelemetry = {
  fps: 0,
  packetsPerSec: 0,
  kbps: 0,
  ehubPacketsPerSec: 0,
};

// 40Hz Main Loop Manager
function updateRouterState() {
  const needsLoop = isPlaying || activeOverride !== null;

  if (needsLoop) {
    if (!routeInterval) {
      console.log('Starting ArtNet transmission loop (40Hz)...');
      routeInterval = setInterval(() => {
        // 1. Advance Playback Clock if show is playing
        if (isPlaying) {
          playbackTime += 0.025;
          if (playbackTime > 35) {
            playbackTime = 0; // Loop show
          }
        }

        // 2. Evaluate active blocks & generate DMX values
        if (isPlaying) {
          const activeBlocks = timelineBlocks.filter(b => playbackTime >= b.startTime && playbackTime <= b.endTime);
          
          // Evaluate wall block
          const wallBlock = activeBlocks.find(b => b.lane === 'wall');
          evaluateWallBlock(wallBlock ? wallBlock.type : 'black', playbackTime);

          // Evaluate DMX Lyres block
          const lyresBlock = activeBlocks.find(b => b.lane === 'lyres');
          evaluateLyresBlock(lyresBlock ? lyresBlock.type : 'black', playbackTime);
        } else {
          // If the show is paused/stopped, output black background and let overrides apply on top
          evaluateWallBlock('black', playbackTime);
          evaluateLyresBlock('black', playbackTime);
        }

        // Apply keyboard overrides if any (passing system timestamp so cycling overrides animate while paused)
        if (activeOverride) {
          applyInteractiveOverrides(activeOverride, Date.now() / 1000);
        }

        // 3. Send dirty universes to controllers via ArtNet
        dirtyUniverses.forEach((univ) => {
          const ip = universeToIpMap.get(univ);
          if (ip) {
            const buf = universeBuffers.get(univ);
            if (buf) {
              artnetSender.send(univ, buf, { ip });
              stats.packetsSent++;
              stats.bytesSent += 18 + buf.length;
            }
          }
        });

        dirtyUniverses.clear();
        stats.framesProcessed++;

        // 4. Send downsampled frame previews to frontend (every 3 frames, ~13 FPS to conserve WS bandwidth)
        if (stats.framesProcessed % 3 === 0) {
          sendPreviewToClients();
        }
      }, 25); // 40 FPS
    }
  } else {
    if (routeInterval) {
      clearInterval(routeInterval);
      routeInterval = null;
      console.log('Stopped ArtNet transmission loop.');
      sendBlackout();
      broadcastToClients({ type: 'clear' });
    }
  }
}

// Visual generators running fully on backend

function evaluateWallBlock(type: string, time: number) {
  for (let x = 0; x < 128; x++) {
    for (let y = 0; y < 128; y++) {
      const id = getEntityIdFromGrid(x, y);
      const target = activeConfig.entityMap[id];
      if (!target) continue;

      let r = 0, g = 0, b = 0;

      if (type === 'radial_ripple') {
        const dx = x - 64;
        const dy = y - 64;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const val = Math.sin(dist * 0.15 - time * 6);
        if (val > 0.15) {
          r = 230; g = 20; b = 30; // Red
        } else {
          r = 240; g = 240; b = 240; // White
        }
      } else if (type === 'gradient_sweep') {
        const sweepPos = (x + y - time * 120) % 256;
        if (sweepPos < 80) {
          r = 230; g = 20; b = 30;
        } else if (sweepPos < 160) {
          r = 240; g = 240; b = 240;
        } else {
          r = 235; g = 180; b = 45; // Gold
        }
      } else if (type === 'strobe_flash') {
        const flashIdx = Math.floor(time * 12) % 3;
        if (flashIdx === 0) {
          r = 230; g = 20; b = 30;
        } else if (flashIdx === 1) {
          r = 240; g = 240; b = 240;
        }
      } else if (type === 'equalizer') {
        const speedFactor = time * 5;
        const bandValue = Math.abs(Math.sin(x * 0.1 + speedFactor)) * 90 + Math.cos(x * 0.05 - speedFactor) * 30;
        const limit = Math.max(0, Math.min(128, bandValue));
        if (y < limit) {
          if (y < 50) { r = 230; g = 20; b = 30; }
          else if (y < 95) { r = 235; g = 180; b = 45; }
          else { r = 240; g = 240; b = 240; }
        }
      }

      // Write directly to universe buffers
      const buf = getUniverseBuffer(target.universe);
      buf[target.channel] = r;
      buf[target.channel + 1] = g;
      buf[target.channel + 2] = b;
      dirtyUniverses.add(target.universe);
    }
  }
}

function evaluateLyresBlock(type: string, time: number) {
  for (let l = 0; l < 4; l++) {
    const baseId = 34000 + (l + 1) * 100;
    
    let pan = 127;
    let tilt = 127;
    let dimmer = 255;
    let strobe = 0;
    let colorCh = 0;

    if (type === 'lyre_waltz') {
      const phase = time * 1.5 + l * (Math.PI / 2);
      pan = Math.round(127 + 60 * Math.sin(phase));
      tilt = Math.round(100 + 40 * Math.cos(phase));
      colorCh = 135; // Gold
    } else if (type === 'lyre_rise') {
      tilt = Math.round(180 + 40 * Math.sin(time * 3));
      colorCh = 15; // Red
    } else if (type === 'lyre_trap') {
      const sweepPhase = time * 5 + (l % 2 === 0 ? 0 : Math.PI);
      pan = Math.round(127 + 100 * Math.sin(sweepPhase));
      tilt = Math.round(127 + 60 * Math.cos(sweepPhase));
      strobe = 240;
      const colors = [15, 135, 0, 15];
      colorCh = colors[(l + Math.floor(time * 2)) % colors.length];
    } else if (type === 'black') {
      dimmer = 0;
    }

    // Map channels to buffers
    const values = [pan, 0, tilt, 0, 0, dimmer, strobe, colorCh, 0, 0, 0, 0, 0];
    values.forEach((val, ch) => {
      const target = activeConfig.entityMap[baseId + ch];
      if (target) {
        const buf = getUniverseBuffer(target.universe);
        buf[target.channel] = val;
        dirtyUniverses.add(target.universe);
      }
    });
  }
}

function applyInteractiveOverrides(key: string, time: number) {
  if (key === 'space' || key === 'a') {
    for (let x = 0; x < 128; x++) {
      for (let y = 0; y < 128; y++) {
        const id = getEntityIdFromGrid(x, y);
        const target = activeConfig.entityMap[id];
        if (!target) continue;

        let r = 0, g = 0, b = 0;
        if (key === 'space') {
          const isCross = Math.abs(x - 64) < 12 || Math.abs(y - 64) < 12;
          if (isCross) {
            r = 240; g = 240; b = 240;
          } else {
            r = 230; g = 20; b = 30;
          }
        } else if (key === 'a') {
          if (Math.random() > 0.95) {
            r = 235; g = 180; b = 45; // Gold sparkles
          }
        }

        const buf = getUniverseBuffer(target.universe);
        buf[target.channel] = r;
        buf[target.channel + 1] = g;
        buf[target.channel + 2] = b;
        dirtyUniverses.add(target.universe);
      }
    }
  }

  if (key === 'l') {
    for (let l = 0; l < 4; l++) {
      const baseId = 34000 + (l + 1) * 100;
      const values = [127, 0, 255, 0, 0, 255, 255, (Math.floor(time * 10) * 40) % 256, 0, 0, 0, 0, 0];
      values.forEach((val, ch) => {
        const target = activeConfig.entityMap[baseId + ch];
        if (target) {
          const buf = getUniverseBuffer(target.universe);
          buf[target.channel] = val;
          dirtyUniverses.add(target.universe);
        }
      });
    }
  }
}

// Sends a downsampled preview map to frontend to avoid socket lag
function sendPreviewToClients() {
  const previewData: Record<number, number[]> = {};
  
  // Downsample grid to 32x32 for UI visualization preview (only 1 out of 16 pixels sent!)
  for (let x = 0; x < 128; x += 4) {
    for (let y = 0; y < 128; y += 4) {
      const id = getEntityIdFromGrid(x, y);
      const target = activeConfig.entityMap[id];
      if (target) {
        const buf = getUniverseBuffer(target.universe);
        const r = buf[target.channel];
        const g = buf[target.channel + 1];
        const b = buf[target.channel + 2];
        previewData[id] = [r, g, b, 0];
      }
    }
  }

  // Add 4 Lyres status explicitly
  for (let l = 0; l < 4; l++) {
    const baseId = 34000 + (l + 1) * 100;
    for (let ch = 0; ch < 13; ch++) {
      const target = activeConfig.entityMap[baseId + ch];
      if (target) {
        const buf = getUniverseBuffer(target.universe);
        previewData[baseId + ch] = [buf[target.channel]];
      }
    }
  }

  broadcastToClients({
    type: 'frame',
    time: playbackTime,
    data: previewData,
  });
}

// Send DMX blackout/reset frame 3 times to guarantee cleanup
function sendBlackout() {
  console.log('Sending blackout frames to all controllers...');
  
  const sendFrame = () => {
    activeConfig.controllers.forEach((ctrl) => {
      ctrl.universes.forEach((univ) => {
        const buf = new Uint8Array(512); // all 0s
        artnetSender.send(univ, buf, { ip: ctrl.ip });
        
        // Reset local cached buffers as well
        const cached = universeBuffers.get(univ);
        if (cached) cached.fill(0);
      });
    });
  };

  // Transmit 3 times spaced by 10ms to prevent packet drops in UDP switches
  sendFrame();
  setTimeout(sendFrame, 10);
  setTimeout(sendFrame, 20);
}

// Telemetry Calculator (runs every 1 second)
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastStatsTime) / 1000;
  if (dt > 0) {
    currentTelemetry = {
      fps: Math.round(stats.framesProcessed / dt),
      packetsPerSec: Math.round(stats.packetsSent / dt),
      kbps: Math.round((stats.bytesSent * 8) / 1024 / dt),
      ehubPacketsPerSec: Math.round(stats.ehubPacketsReceived / dt),
    };
    stats.framesProcessed = 0;
    stats.packetsSent = 0;
    stats.bytesSent = 0;
    stats.ehubPacketsReceived = 0;
    lastStatsTime = now;

    broadcastToClients({ type: 'telemetry', data: currentTelemetry });
  }
}, 1000);

function broadcastToClients(message: any) {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// eHub Receiver (Unity integration)
const ehubReceiver = new EHubReceiver(
  5000,
  (entities) => {
    stats.ehubPacketsReceived++;
    
    entities.forEach((ent) => {
      const target = activeConfig.entityMap[ent.id];
      if (!target) return;

      const buf = getUniverseBuffer(target.universe);

      if (target.type === 'r') {
        buf[target.channel] = ent.r;
        buf[target.channel + 1] = ent.g;
        buf[target.channel + 2] = ent.b;
        dirtyUniverses.add(target.universe);
      } else if (target.type === 'g') {
        buf[target.channel] = ent.g;
        dirtyUniverses.add(target.universe);
      } else if (target.type === 'b') {
        buf[target.channel] = ent.b;
        dirtyUniverses.add(target.universe);
      } else if (target.type === 'w') {
        buf[target.channel] = ent.w;
        dirtyUniverses.add(target.universe);
      } else if (target.type === 'dmx') {
        buf[target.channel] = ent.w;
        dirtyUniverses.add(target.universe);
      }
    });

    if (!isPlaying) {
      isPlaying = true;
      updateRouterState();
    }
  },
  (id) => !!activeConfig.entityMap[id] // validation function to auto-detect LE/BE
);

ehubReceiver.start();

// WebSocket Handler
wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket.');
  
  ws.send(JSON.stringify({ type: 'config', data: activeConfig }));
  ws.send(JSON.stringify({ type: 'telemetry', data: currentTelemetry }));

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());

      if (msg.type === 'play') {
        isPlaying = true;
        updateRouterState();
      } else if (msg.type === 'stop') {
        isPlaying = false;
        playbackTime = 0;
        updateRouterState();
      } else if (msg.type === 'blackout') {
        isPlaying = false;
        playbackTime = 0;
        activeOverride = null;
        updateRouterState();
      } else if (msg.type === 'override') {
        activeOverride = msg.key;
        updateRouterState();
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected from WebSocket.');
  });
});

// REST API Endpoints
app.get('/api/config', (req, res) => {
  res.json(activeConfig);
});

app.post('/api/config', (req, res) => {
  try {
    const newConfig = req.body as RouterConfig;
    activeConfig = newConfig;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf8');
    
    universeBuffers.clear();
    dirtyUniverses.clear();

    // Rebuild IP mapping
    rebuildUniverseToIpMap();

    broadcastToClients({ type: 'config', data: activeConfig });
    res.json({ success: true, message: 'Configuration saved.' });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// Clean shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  isPlaying = false;
  activeOverride = null;
  updateRouterState();
  ehubReceiver.stop();
  artnetSender.close();
  httpServer.close(() => {
    console.log('HTTP Server closed.');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`HTTP/WebSocket Server running on http://localhost:${PORT}`);
});
