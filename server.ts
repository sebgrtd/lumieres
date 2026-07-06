import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
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

// Map of global universe -> { ip, artnetUniverse (local) }
interface UniverseRoute {
  ip: string;
  artnetUniverse: number; // the universe number to put in the ArtNet packet (after subtracting startUniverse)
}

const universeRouteMap: Map<number, UniverseRoute> = new Map();

function rebuildUniverseRouteMap() {
  universeRouteMap.clear();
  activeConfig.controllers.forEach((ctrl) => {
    const offset = ctrl.startUniverse ?? 0;
    ctrl.universes.forEach((univ) => {
      universeRouteMap.set(univ, {
        ip: ctrl.ip,
        artnetUniverse: univ < offset ? univ : univ - offset,
      });
    });
  });
  console.log(`Rebuilt universe route map with ${universeRouteMap.size} mappings.`);
  // Log per-controller breakdown
  activeConfig.controllers.forEach((ctrl) => {
    const offset = ctrl.startUniverse ?? 0;
    const getMapped = (u: number) => u < offset ? u : u - offset;
    const startU = ctrl.universes[0];
    const endU = ctrl.universes[ctrl.universes.length - 1];
    console.log(`  Controller ${ctrl.ip}: ${ctrl.universes.length} universes [${startU}..${endU}] -> ArtNet [${getMapped(startU)}..${getMapped(endU)}]`);
  });
}

// Per-IP packet stats for diagnostics
const packetCountPerIp: Map<string, number> = new Map();

// Initial build
rebuildUniverseRouteMap();

// Timeline state stored on backend
interface TimelineBlock {
  id: string;
  lane: 'wall' | 'lyres' | 'static';
  startTime: number;
  endTime: number;
  type: string;
  name: string;
}

// BPM Constants for COSMÓ - Tanzschein (130 BPM)
const BPM = 130;
const BEAT_DURATION = 60 / BPM; // ~0.4615s
const MEASURE_DURATION = BEAT_DURATION * 4; // ~1.846s
const AUDIO_OFFSET = 0.1; // adjust if audio start has delay

let timelineBlocks: TimelineBlock[] = [
  { id: '1', lane: 'wall', startTime: 0, endTime: 3.7, type: 'intro_ticks', name: 'Intro Ticks' },
  { id: '2', lane: 'lyres', startTime: 0, endTime: 3.7, type: 'lyre_intro', name: 'Intro Silver Sweep' },
  { id: '3', lane: 'static', startTime: 0, endTime: 3.7, type: 'static_off', name: 'Spotlight Off' },

  { id: '4', lane: 'wall', startTime: 3.7, endTime: 11.1, type: 'blue_star_burst', name: 'COSMÓ Blue Star Burst' },
  { id: '5', lane: 'lyres', startTime: 3.7, endTime: 11.1, type: 'lyre_kick_pulse', name: 'Lyres Kick Snap' },
  { id: '6', lane: 'static', startTime: 3.7, endTime: 11.1, type: 'static_measure_pulse', name: 'Spot Blue Measure Pulse' },

  { id: '7', lane: 'wall', startTime: 11.1, endTime: 18.5, type: 'quadrant_flashes', name: 'Quadrant Controller Flash' },
  { id: '8', lane: 'lyres', startTime: 11.1, endTime: 18.5, type: 'lyre_circle_color', name: 'Lyres Color Circular' },
  { id: '9', lane: 'static', startTime: 11.1, endTime: 18.5, type: 'static_snare_flash', name: 'Spot Magenta Snare Flash' },

  { id: '10', lane: 'wall', startTime: 18.5, endTime: 25.8, type: 'laser_sweeps', name: 'Tanzschein Laser Sweeps' },
  { id: '11', lane: 'lyres', startTime: 18.5, endTime: 25.8, type: 'lyre_buildup_strobe', name: 'Lyres Strobe Crescendo' },
  { id: '12', lane: 'static', startTime: 18.5, endTime: 25.8, type: 'static_dimmer_rise', name: 'Spot Dimmer Rise' },

  { id: '13', lane: 'wall', startTime: 25.8, endTime: 45.0, type: 'reactive_drop', name: 'Tanzschein Chorus Drop' },
  { id: '14', lane: 'lyres', startTime: 25.8, endTime: 45.0, type: 'lyre_drop_trap', name: 'Lyres Mirror Trap Chases' },
  { id: '15', lane: 'static', startTime: 25.8, endTime: 45.0, type: 'static_drop_strobe', name: 'Spot Strobe Drop' }
];

// Playback state
let isPlaying = false;
let playbackTime = 0;
let playbackStartRealTime = 0;
let routeInterval: NodeJS.Timeout | null = null;
let activeOverride: string | null = null;
let detectedBeats: number[] = [];

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

let activeTestPattern: { type: 'controller' | 'all'; controllerIdx?: number; color?: number[] } | null = null;

// 40Hz Main Loop Manager
function updateRouterState() {
  const needsLoop = isPlaying || activeOverride !== null || activeTestPattern !== null;

  if (needsLoop) {
    if (!routeInterval) {
      console.log('Starting ArtNet transmission loop (40Hz)...');
      routeInterval = setInterval(() => {
        // 1. Advance Playback Clock if show is playing (using real-world time to avoid interval lag)
        if (isPlaying) {
          const now = Date.now();
          playbackTime = (now - playbackStartRealTime) / 1000;
          if (playbackTime > 45) {
            playbackTime = 0; // Loop show at 45 seconds
            playbackStartRealTime = now;
          }
        }

        // Check if current playbackTime matches any client-analyzed beat (within 45ms window)
        let isAudioImpact = false;
        if (isPlaying && detectedBeats.length > 0) {
          isAudioImpact = detectedBeats.some(b => Math.abs(playbackTime - b) < 0.045);
        }

        // 2. Evaluate active blocks & generate DMX values
        if (activeTestPattern) {
          if (activeTestPattern.type === 'controller') {
            const ctrl = activeConfig.controllers[activeTestPattern.controllerIdx!];
            if (ctrl) {
              const [r, g, b] = activeTestPattern.color!;
              ctrl.universes.forEach((univ) => {
                const buf = getUniverseBuffer(univ);
                for (let ch = 0; ch < 510; ch += 3) {
                  buf[ch] = r; buf[ch + 1] = g; buf[ch + 2] = b;
                }
                dirtyUniverses.add(univ);
              });
            }
          } else if (activeTestPattern.type === 'all') {
            const colors = [[255,0,0],[0,255,0],[0,0,255],[255,255,0]];
            activeConfig.controllers.forEach((ctrl, idx) => {
              const [r, g, b] = colors[idx] || [128,128,128];
              ctrl.universes.forEach((univ) => {
                const buf = getUniverseBuffer(univ);
                for (let ch = 0; ch < 510; ch += 3) {
                  buf[ch] = r; buf[ch + 1] = g; buf[ch + 2] = b;
                }
                dirtyUniverses.add(univ);
              });
            });
          }
        } else if (isPlaying) {
          const activeBlocks = timelineBlocks.filter(b => playbackTime >= b.startTime && playbackTime <= b.endTime);
          
          // Evaluate wall block
          const wallBlock = activeBlocks.find(b => b.lane === 'wall');
          evaluateWallBlock(wallBlock ? wallBlock.type : 'black', playbackTime, isAudioImpact);

          // Evaluate DMX Lyres block
          const lyresBlock = activeBlocks.find(b => b.lane === 'lyres');
          evaluateLyresBlock(lyresBlock ? lyresBlock.type : 'black', playbackTime, isAudioImpact);

          // Evaluate Static Spotlight block
          const staticBlock = activeBlocks.find(b => b.lane === 'static');
          evaluateStaticBlock(staticBlock ? staticBlock.type : 'static_off', playbackTime, isAudioImpact);
        } else {
          // If the show is paused/stopped, output black background and let overrides apply on top
          evaluateWallBlock('black', playbackTime, isAudioImpact);
          evaluateLyresBlock('black', playbackTime, isAudioImpact);
          evaluateStaticBlock('static_off', playbackTime, isAudioImpact);
        }

        // Apply keyboard overrides if any (passing system timestamp so cycling overrides animate while paused)
        if (activeOverride && !activeTestPattern) {
          applyInteractiveOverrides(activeOverride, Date.now() / 1000);
        }

        // 3. Send dirty universes to controllers via ArtNet
        dirtyUniverses.forEach((univ) => {
          const route = universeRouteMap.get(univ);
          if (route) {
            const buf = universeBuffers.get(univ);
            if (buf) {
              artnetSender.send(route.artnetUniverse, buf, { ip: route.ip });
              stats.packetsSent++;
              stats.bytesSent += 18 + buf.length;
              packetCountPerIp.set(route.ip, (packetCountPerIp.get(route.ip) || 0) + 1);
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

function evaluateWallBlock(type: string, time: number, isAudioImpact: boolean = false) {
  const adjustedTime = time + AUDIO_OFFSET;
  const beatIdx = Math.floor(adjustedTime / BEAT_DURATION);
  const beatProgress = (adjustedTime % BEAT_DURATION) / BEAT_DURATION;
  const measureIdx = Math.floor(beatIdx / 4);
  const beatInMeasure = beatIdx % 4;

  for (let x = 0; x < 128; x++) {
    for (let y = 0; y < 128; y++) {
      const id = getEntityIdFromGrid(x, y);
      const target = activeConfig.entityMap[id];
      if (!target) continue;

      let r = 0, g = 0, b = 0;

      if (type === 'intro_ticks') {
        // 1. Concentric shrinking neon square tunnel (ticking clock feel)
        const dx = Math.abs(x - 64);
        const dy = Math.abs(y - 64);
        const maxDist = Math.max(dx, dy);
        
        // Concentric squares that shrink on beats 1 & 3 of each measure
        if (beatInMeasure === 0 || beatInMeasure === 2) {
          const size = Math.floor((1.0 - beatProgress) * 64);
          if (maxDist === size || maxDist === size - 1) {
            r = 0; g = 220; b = 255; // Electric Cyan
          }
        }
        
        // Center dot pulses on every beat
        const dist = Math.sqrt((x-64)*(x-64) + (y-64)*(y-64));
        if (dist < 4) {
          const intensity = Math.floor(255 * (1 - beatProgress));
          r = g = b = intensity;
        }

        // Smooth fade-out at the end of the intro block (from 3.4s to 3.7s)
        if (time > 3.4 && time <= 3.7) {
          const fade = (3.7 - time) / 0.3;
          r = Math.round(r * fade);
          g = Math.round(g * fade);
          b = Math.round(b * fade);
        }
      } else if (type === 'blue_star_burst') {
        // 2. The "Tanzschein" (Dance Licence) Card & Stamp + Gazelle Mask in the center
        const dx = Math.abs(x - 64);
        const dy = Math.abs(y - 64);
        
        // Layer Gazelle mask in the center
        const maskColor = drawCharacterMask('gazelle', x, y, time, beatProgress);
        
        if (maskColor.r > 0 || maskColor.g > 0 || maskColor.b > 0) {
          r = maskColor.r; g = maskColor.g; b = maskColor.b;
        } else {
          // Draw the licence card border (40 x 60 rectangle)
          const isBorder = (dx === 22 && dy <= 32) || (dy === 32 && dx <= 22);
          if (isBorder) {
            // Neon Magenta border
            r = 255; g = 0; b = 150;
          } else if (dx < 22 && dy < 32) {
            // Inside the card, draw a pulsing stamp circle in the center
            const dist = Math.sqrt((x-64)*(x-64) + (y-64)*(y-64));
            const stampRadius = 5 + 12 * beatProgress;
            if (Math.abs(dist - stampRadius) < 1.5) {
              // Pulsing Neon Gold stamp
              r = 235; g = 180; b = 45;
            }
            // Dim card background
            else {
              r = 10; g = 5; b = 20;
            }
          }
        }

        // Transition White Flash Impact at the drop entry (from 3.7s to 3.95s)
        if (time >= 3.7 && time < 3.95) {
          const flash = 1.0 - (time - 3.7) / 0.25;
          r = Math.round(r * (1.0 - flash) + 255 * flash);
          g = Math.round(g * (1.0 - flash) + 255 * flash);
          b = Math.round(b * (1.0 - flash) + 255 * flash);
        }
      } else if (type === 'quadrant_flashes') {
        // 3. Glowing neon gorilla mask in the center + flashing quadrants
        const maskColor = drawCharacterMask('gorilla', x, y, time, beatProgress);
        
        if (maskColor.r > 0 || maskColor.g > 0 || maskColor.b > 0) {
          r = maskColor.r; g = maskColor.g; b = maskColor.b;
        } else {
          // Quadrant controller flash (0: TL, 1: TR, 2: BL, 3: BR)
          let pixelQuad = 0;
          if (x < 64 && y >= 64) pixelQuad = 0;
          else if (x >= 64 && y >= 64) pixelQuad = 1;
          else if (x < 64 && y < 64) pixelQuad = 2;
          else pixelQuad = 3;

          if (pixelQuad === beatInMeasure) {
            const decay = 1 - beatProgress;
            r = Math.floor(255 * decay);
            g = 0;
            b = Math.floor(128 * decay); // Magenta flash
          } else {
            r = 0; g = 20; b = 30; // dim background
          }
        }
      } else if (type === 'laser_sweeps') {
        // 4. Rotating crossing laser tunnel + Lion Mask in the center (Pre-chorus)
        const maskColor = drawCharacterMask('lion', x, y, time, beatProgress);
        
        if (maskColor.r > 0 || maskColor.g > 0 || maskColor.b > 0) {
          r = maskColor.r; g = maskColor.g; b = maskColor.b;
        } else {
          const dx = x - 64;
          const dy = y - 64;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          const progress = Math.max(0, Math.min(1.0, (time - 18.5) / 7.3));
          const angle = time * (3.0 + progress * 5.0); // accelerates rotation
          
          // Draw two crossing laser lines
          const line1 = Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle)) < 1.8;
          const line2 = Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle)) < 1.8;
          
          if (line1 || line2) {
            // Alternating Cyan and Magenta lasers
            if (Math.sin(time * 5) > 0) {
              r = 0; g = 255; b = 255; // Cyan
            } else {
              r = 255; g = 0; b = 150; // Magenta
            }
          } else {
            // Shrinking square tunnel trails
            const maxDist = Math.max(Math.abs(dx), Math.abs(dy));
            const trailSize = Math.floor((time * 40) % 64);
            if (maxDist === trailSize) {
              r = 30; g = 0; b = 40; // Dim purple trails
            }
          }
          
          // White strobe frame on the borders (flashes faster at the end of the buildup)
          const isBorder = x < 4 || x > 123 || y < 4 || y > 123;
          const strobeOn = Math.floor(time * (10 + progress * 30)) % 2 === 0;
          if (isBorder && strobeOn) {
            r = 255; g = 255; b = 255;
          }
        }
      } else if (type === 'reactive_drop') {
        // 5. Singer COSMÓ Face + Equalizer + Expanding Gold Star
        const maskColor = drawCharacterMask('cosmo', x, y, time, beatProgress);
        
        if (maskColor.r > 0 || maskColor.g > 0 || maskColor.b > 0) {
          r = maskColor.r; g = maskColor.g; b = maskColor.b;
        } else {
          const dx = x - 64;
          const dy = y - 64;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          // A. Background strobe wash
          const strobeWashOn = beatIdx % 2 === 0;
          if (strobeWashOn) {
            r = 0; g = 20; b = 40; // Deep Cyan wash
          } else {
            r = 25; g = 0; b = 15; // Deep Magenta wash
          }

          // B. Equalizer bars (16 columns) reacting to the Kick
          const colIdx = Math.floor(x / 8);
          const bounce = Math.exp(-beatProgress * 4.0);
          const baseHeight = (Math.sin(colIdx * 0.7 + time * 12) * 0.3 + 0.7) * 45;
          const targetHeight = 15 + baseHeight * (0.4 + 0.6 * bounce);
          
          if (y < targetHeight) {
            if (y < 30) {
              r = 255; g = 0; b = 150; // Neon Pink
            } else if (y < 50) {
              r = 0; g = 255; b = 255; // Neon Cyan
            } else {
              r = 245; g = 245; b = 255; // Silver/White
            }
          }
          
          // C. Concentric Gold Star Burst (Eurovision star motif!)
          const burstProgress = beatProgress; // expands every beat
          const burstRadius = burstProgress * 85;
          const angle = Math.atan2(dy, dx);
          
          const starFactor = Math.abs(Math.sin(angle * 4));
          const starRadius = burstRadius * (0.7 + 0.3 * starFactor);
          
          if (Math.abs(dist - starRadius) < 3.0) {
            r = 235; g = 180; b = 45; // Neon Gold star outline
          }

          // D. Full-screen Clap Flash (first 50ms of beats 1 and 3 of the measure)
          if (beatProgress < 0.12 && (beatInMeasure === 1 || beatInMeasure === 3)) {
            r = 255; g = 255; b = 255;
          }
        }
      }

      // EXTRA: Draw expanding shockwave circles of white sparkles on analyzed audio beat hits
      if (isAudioImpact && type !== 'black') {
        const dx = x - 64;
        const dy = y - 64;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Rings of particles that flash on drums
        if (dist > 52 && dist < 58 && Math.random() > 0.35) {
          r = 255; g = 255; b = 255; // Sparkling white impact halo!
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

function evaluateLyresBlock(type: string, time: number, isAudioImpact: boolean = false) {
  const adjustedTime = time + AUDIO_OFFSET;
  const beatIdx = Math.floor(adjustedTime / BEAT_DURATION);
  const beatProgress = (adjustedTime % BEAT_DURATION) / BEAT_DURATION;
  const measureIdx = Math.floor(beatIdx / 4);
  const beatInMeasure = beatIdx % 4;

  for (let l = 0; l < 4; l++) {
    const baseId = 34000 + (l + 1) * 100;
    
    let pan = 127;
    let tilt = 127;
    let dimmer = 255;
    let strobe = 0;
    let colorCh = 0;

    if (type === 'lyre_intro') {
      // Slow panning sweeps, silver-white
      const phase = time * 0.5 + l;
      pan = Math.round(127 + 35 * Math.sin(phase));
      tilt = 180; // Pointing upwards
      dimmer = 80;
      colorCh = 15; // Silver/White
    } else if (type === 'lyre_kick_pulse') {
      // Snap to positions on beats 0 and 2
      const snapPos = Math.floor(beatIdx / 2) % 4;
      const positions = [50, 100, 150, 200];
      pan = positions[(snapPos + l) % 4];
      tilt = 120;
      // Pulse dimmer on every beat
      dimmer = Math.round(255 * Math.exp(-beatProgress * 3.0));
      colorCh = 100; // Blue/Cyan
    } else if (type === 'lyre_circle_color') {
      // Fast circular waltz
      const phase = time * 3.0 + l * (Math.PI / 2);
      pan = Math.round(127 + 50 * Math.sin(phase));
      tilt = Math.round(120 + 30 * Math.cos(phase));
      dimmer = 255;
      // Alternate colors on every beat
      const colors = [15, 100, 150, 180];
      colorCh = colors[beatIdx % colors.length];
    } else if (type === 'lyre_buildup_strobe') {
      // Raise beams to ceiling
      pan = 127;
      const progress = Math.max(0, Math.min(1.0, (time - 18.5) / 7.3));
      tilt = Math.round(120 + progress * 100);
      dimmer = 255;
      // Accelerate strobe
      strobe = Math.round(50 + progress * 200);
      colorCh = 15; // White
    } else if (type === 'lyre_drop_trap') {
      // Fast mirrored chases
      const sweepPhase = time * 6 + (l % 2 === 0 ? 0 : Math.PI);
      pan = Math.round(127 + 90 * Math.sin(sweepPhase));
      tilt = Math.round(140 + 40 * Math.cos(sweepPhase));
      dimmer = 255;
      strobe = 240; // Fast strobe
      // Alternate Magenta and Blue on beats
      colorCh = beatIdx % 2 === 0 ? 180 : 100;
    } else if (type === 'black') {
      dimmer = 0;
    }

    // Transition Flash at 3.7s (Drop entry)
    if (time >= 3.7 && time < 3.95) {
      dimmer = 255;
      strobe = 250; // violent strobe
      colorCh = 15; // White
    }

    // EXTRA: Audio impact accents (flash white + strobe) on drums
    if (isAudioImpact && type !== 'black') {
      dimmer = 255;
      strobe = Math.max(strobe, 245);
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

function evaluateStaticBlock(type: string, time: number, isAudioImpact: boolean = false) {
  const adjustedTime = time + AUDIO_OFFSET;
  const beatIdx = Math.floor(adjustedTime / BEAT_DURATION);
  const beatProgress = (adjustedTime % BEAT_DURATION) / BEAT_DURATION;
  const measureIdx = Math.floor(beatIdx / 4);
  const beatInMeasure = beatIdx % 4;

  let r = 0, g = 0, b = 0, w = 0;

  if (type === 'static_off') {
    r = g = b = w = 0;
  } else if (type === 'static_measure_pulse') {
    // Pulse Blue on beat 0 of every measure
    if (beatInMeasure === 0) {
      const intensity = Math.floor(255 * Math.exp(-beatProgress * 3.0));
      b = intensity;
    }
  } else if (type === 'static_snare_flash') {
    // Flash Magenta on beats 1 and 3 of every measure
    if (beatInMeasure === 1 || beatInMeasure === 3) {
      const intensity = Math.floor(255 * Math.exp(-beatProgress * 4.0));
      r = intensity;
      b = Math.floor(intensity * 0.5);
    }
  } else if (type === 'static_dimmer_rise') {
    // Rise white dimmer
    const progress = Math.max(0, Math.min(1.0, (time - 18.5) / 7.3));
    w = Math.floor(progress * 255);
  } else if (type === 'static_drop_strobe') {
    // Strobe flash
    const isStrobeOn = Math.floor(time * 30) % 2 === 0;
    if (isStrobeOn) {
      if (beatInMeasure === 0 || beatInMeasure === 2) {
        // Gold
        r = 235; g = 180; b = 45;
      } else {
        // White
        w = 255;
      }
    }
  }

  // Transition Flash at 3.7s (Drop entry)
  if (time >= 3.7 && time < 3.95) {
    w = 255;
    r = 255;
    g = 255;
    b = 255; // Blinding white static spotlight
  }

  // EXTRA: Spotlight absolute white flash accent on audio beat hits
  if (isAudioImpact && type !== 'static_off') {
    w = 255; // White blast!
  }

  // Write values to entity IDs 33001 to 33004
  const ids = [33001, 33002, 33003, 33004];
  const values = [r, g, b, w];
  
  ids.forEach((id, idx) => {
    const target = activeConfig.entityMap[id];
    if (target) {
      const buf = getUniverseBuffer(target.universe);
      buf[target.channel] = values[idx];
      dirtyUniverses.add(target.universe);
    }
  });
}

// Character Masks Pixel Art Rendering Engine (Eurovision 2026 "Tanzschein" inspired)
function drawCharacterMask(type: string, x: number, y: number, time: number, beatProgress: number) {
  let r = 0, g = 0, b = 0;
  
  const dx = x - 64;
  const dy = y - 64;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  
  const bounce = Math.exp(-beatProgress * 4.0);

  if (type === 'cosmo') {
    // Singer COSMÓ: Oval Face + Blue Star painted over his right eye
    const inFace = (dx * dx) / (25 * 25) + (dy * dy) / (34 * 34) < 1.0;
    const inHair = dy > 22 && Math.abs(dx) < 28 && Math.sin(x * 0.4) * 3 + 28 > dy;
    
    // Right Eye Star Paint (center: x=64+9, y=64+6)
    const starDx = dx - 9;
    const starDy = dy - 6;
    const starDist = Math.sqrt(starDx * starDx + starDy * starDy);
    const starAngle = Math.atan2(starDy, starDx);
    
    const starFactor = Math.abs(Math.sin(starAngle * 2.5)); // 5-pointed star
    const starRadius = (5 + 7 * bounce) * (0.65 + 0.35 * starFactor);
    const inStar = starDist < starRadius;

    // Left Eye (open slit)
    const inLeftEye = Math.sqrt((dx + 9)*(dx + 9) + (dy - 6)*(dy - 6)) < 2.5;

    // Mouth (smiling)
    const inMouth = Math.abs(dy + 15) < 1.5 && Math.abs(dx) < 8;

    if (inStar) {
      r = 0; g = 110; b = 255; // Electric Blue Star Eye Paint!
    } else if (inLeftEye) {
      r = 255; g = 255; b = 255; // White left eye
    } else if (inMouth) {
      r = 220; g = 20; b = 40; // Red mouth
    } else if (inHair) {
      r = 35; g = 25; b = 20; // Dark curly hair
    } else if (inFace) {
      r = 240; g = 190; b = 160; // Skin tone
    }
  } 
  else if (type === 'gazelle') {
    // Gazelle Mask: Elongated triangular metallic mask + long vertical horns
    const inFace = dy < 12 && dy > -30 && Math.abs(dx) < (14 - dy * 0.4);
    
    // Ears pointing outward
    const inLeftEar = dx < -12 && dx > -32 && dy > -4 && dy < 4 && Math.abs(dy - (dx + 12)*0.25) < 2.5;
    const inRightEar = dx > 12 && dx < 32 && dy > -4 && dy < 4 && Math.abs(dy - (-dx + 12)*0.25) < 2.5;

    // Curved long horns going up
    const leftHornX = -7 - (dy - 12) * 0.25 + Math.sin(dy * 0.12) * 2;
    const isLeftHorn = dy >= 12 && dy <= 52 && Math.abs(dx - leftHornX) < (2.5 - (dy - 12) * 0.04);

    const rightHornX = 7 + (dy - 12) * 0.25 - Math.sin(dy * 0.12) * 2;
    const isRightHorn = dy >= 12 && dy <= 52 && Math.abs(dx - rightHornX) < (2.5 - (dy - 12) * 0.04);

    if (isLeftHorn || isRightHorn) {
      r = 0; g = 240; b = 255; // Glowing Neon Cyan Horns
    } else if (inFace || inLeftEar || inRightEar) {
      r = 180; g = 185; b = 195; // Silver mask body
      
      // Cyan glowing slit eyes
      const eyeL = Math.sqrt((dx + 5)*(dx + 5) + (dy - 2)*(dy - 2)) < 2.0;
      const eyeR = Math.sqrt((dx - 5)*(dx - 5) + (dy - 2)*(dy - 2)) < 2.0;
      if (eyeL || eyeR) {
        r = 0; g = 255; b = 255;
      }
    }
  } 
  else if (type === 'gorilla') {
    // Gorilla Mask: Heavy square metallic head + glowing red details
    const inHead = Math.abs(dx) < 26 && dy < 26 && dy > -28;
    
    const isBrow = dy >= 8 && dy <= 14 && Math.abs(dx) < 22;
    const isMuzzle = dy <= -6 && dy >= -22 && Math.abs(dx) < 18;

    if (isBrow || isMuzzle) {
      // Glowing neon green highlights on brow & jaw
      const pulseColor = Math.floor(180 + 75 * bounce);
      r = 0; g = pulseColor; b = 110;
    } else if (inHead) {
      r = 135; g = 140; b = 150; // Dark Silver gorilla head
      
      // Glowing red eyes
      const eyeL = Math.sqrt((dx + 7)*(dx + 7) + (dy - 3)*(dy - 3)) < 3.0;
      const eyeR = Math.sqrt((dx - 7)*(dx - 7) + (dy - 3)*(dy - 3)) < 3.0;
      if (eyeL || eyeR) {
        r = 255; g = 0; b = 0; // Red eyes
      }
    }
  } 
  else if (type === 'lion') {
    // Lion Mask: Majestic glowing orange mane surrounding cat face shield
    const maneRadius = 36 + 6 * bounce;
    const isMane = dist < maneRadius && dist > 24 && Math.floor(angle * 10) % 2 === 0;
    const inFace = dist <= 24 && dy > -24;
    
    if (isMane) {
      r = 255; g = 130; b = 0; // Majestic Glowing Neon Gold/Orange Mane
    } else if (inFace) {
      r = 200; g = 200; b = 210; // Silver face plate
      
      // Eyes
      const eyeL = Math.abs(dy - 3) < 1.2 && dx < -4 && dx > -11;
      const eyeR = Math.abs(dy - 3) < 1.2 && dx > 4 && dx < 11;
      const inSnout = dy < -4 && dy > -14 && Math.abs(dx) < 7;

      if (eyeL || eyeR) {
        r = 255; g = 180; b = 0; // Glowing gold eyes
      } else if (inSnout) {
        r = 45; g = 45; b = 55; // Snout
      }
    }
  }

  return { r, g, b };
}

function applyInteractiveOverrides(key: string, time: number) {
  if (key === 'c' || key === 'g' || key === 'm' || key === 'n') {
    const maskType = key === 'c' ? 'cosmo' : key === 'g' ? 'gazelle' : key === 'm' ? 'gorilla' : 'lion';
    const adjustedTime = time + AUDIO_OFFSET;
    const beatProgress = (adjustedTime % BEAT_DURATION) / BEAT_DURATION;

    for (let x = 0; x < 128; x++) {
      for (let y = 0; y < 128; y++) {
        const id = getEntityIdFromGrid(x, y);
        const target = activeConfig.entityMap[id];
        if (!target) continue;

        const color = drawCharacterMask(maskType, x, y, time, beatProgress);
        // Layer the pixel art on top of background by keeping background pixels where mask is black
        if (color.r > 0 || color.g > 0 || color.b > 0) {
          const buf = getUniverseBuffer(target.universe);
          buf[target.channel] = color.r;
          buf[target.channel + 1] = color.g;
          buf[target.channel + 2] = color.b;
          dirtyUniverses.add(target.universe);
        }
      }
    }
    return;
  }

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

function sendBlackout() {
  console.log('Sending blackout frames to all controllers...');
  
  const sendFrame = () => {
    activeConfig.controllers.forEach((ctrl) => {
      const offset = ctrl.startUniverse ?? 0;
      ctrl.universes.forEach((univ) => {
        const buf = new Uint8Array(512); // all 0s
        const artnetUniverse = univ < offset ? univ : univ - offset;
        artnetSender.send(artnetUniverse, buf, { ip: ctrl.ip });
        
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
    // Convert per-IP packet counts to object
    const ipCounts: Record<string, number> = {};
    packetCountPerIp.forEach((count, ip) => { ipCounts[ip] = count; });

    currentTelemetry = {
      fps: Math.round(stats.framesProcessed / dt),
      packetsPerSec: Math.round(stats.packetsSent / dt),
      kbps: Math.round((stats.bytesSent * 8) / 1024 / dt),
      ehubPacketsPerSec: Math.round(stats.ehubPacketsReceived / dt),
      packetCountPerIp: ipCounts,
      activeOverride,
      isPlaying,
      loopRunning: routeInterval !== null,
      activeTestPattern: activeTestPattern ? { type: activeTestPattern.type, controllerIdx: activeTestPattern.controllerIdx } : null,
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
      playbackStartRealTime = Date.now() - playbackTime * 1000;
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

      if (msg.type === 'set-beats') {
        detectedBeats = msg.beats;
        console.log(`[Audio] Received ${detectedBeats.length} beat timestamps from client.`);
        broadcastToClients({ type: 'log', message: `Synchronized ${detectedBeats.length} beat triggers with server.` });
      } else if (msg.type === 'play') {
        activeTestPattern = null;
        isPlaying = true;
        playbackStartRealTime = Date.now() - playbackTime * 1000;
        updateRouterState();
      } else if (msg.type === 'stop') {
        activeTestPattern = null;
        isPlaying = false;
        playbackTime = 0;
        updateRouterState();
      } else if (msg.type === 'blackout') {
        activeTestPattern = null;
        isPlaying = false;
        playbackTime = 0;
        activeOverride = null;
        updateRouterState();
      } else if (msg.type === 'override') {
        activeTestPattern = null;
        activeOverride = msg.key;
        console.log(`[Override] ${msg.key ? 'ACTIVATED: ' + msg.key : 'RELEASED'} | isPlaying=${isPlaying} | loopRunning=${routeInterval !== null}`);
        updateRouterState();
        console.log(`[Override] After updateRouterState: loopRunning=${routeInterval !== null}`);
      } else if (msg.type === 'test-controller') {
        const { controllerIdx, color } = msg;
        if (activeTestPattern && activeTestPattern.type === 'controller' && activeTestPattern.controllerIdx === controllerIdx) {
          // Toggle off
          activeTestPattern = null;
          console.log('[Test] Toggle off test pattern for controller', controllerIdx);
          updateRouterState();
          broadcastToClients({ type: 'log', message: 'Test pattern deactivated.' });
        } else {
          // Toggle on
          activeTestPattern = { type: 'controller', controllerIdx, color };
          console.log('[Test] Toggle on streaming test pattern for controller', controllerIdx);
          updateRouterState();
          const ctrl = activeConfig.controllers[controllerIdx];
          broadcastToClients({ type: 'log', message: `Streaming test pattern to ${ctrl?.ip || 'unknown'}` });
        }
      } else if (msg.type === 'test-all') {
        if (activeTestPattern && activeTestPattern.type === 'all') {
          // Toggle off
          activeTestPattern = null;
          console.log('[Test] Toggle off test ALL');
          updateRouterState();
          broadcastToClients({ type: 'log', message: 'Test pattern deactivated.' });
        } else {
          // Toggle on
          activeTestPattern = { type: 'all' };
          console.log('[Test] Toggle on streaming test ALL');
          updateRouterState();
          broadcastToClients({ type: 'log', message: 'Streaming test pattern to ALL controllers (R/G/B/Y).' });
        }
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
    rebuildUniverseRouteMap();

    broadcastToClients({ type: 'config', data: activeConfig });
    res.json({ success: true, message: 'Configuration saved.' });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// Debug endpoint - shows diagnostics for troubleshooting
app.get('/api/debug', (req, res) => {
  // Count entities per controller IP
  const entitiesPerIp: Record<string, number> = {};
  const universesPerIp: Record<string, number[]> = {};
  Object.values(activeConfig.entityMap).forEach((target: any) => {
    entitiesPerIp[target.ip] = (entitiesPerIp[target.ip] || 0) + 1;
    if (!universesPerIp[target.ip]) universesPerIp[target.ip] = [];
    if (!universesPerIp[target.ip].includes(target.universe)) {
      universesPerIp[target.ip].push(target.universe);
    }
  });

  // Universe route map
  const routeMap: Record<number, UniverseRoute> = {};
  universeRouteMap.forEach((route, univ) => {
    routeMap[univ] = route;
  });

  // Per-IP packet counts
  const packetCounts: Record<string, number> = {};
  packetCountPerIp.forEach((count, ip) => {
    packetCounts[ip] = count;
  });

  res.json({
    totalEntities: Object.keys(activeConfig.entityMap).length,
    entitiesPerIp,
    universesPerIp: Object.fromEntries(Object.entries(universesPerIp).map(([ip, univs]) => [ip, { count: univs.length, range: `${Math.min(...univs)}-${Math.max(...univs)}` }])),
    routeMapSample: {
      universe_0: routeMap[0],
      universe_31: routeMap[31],
      universe_32: routeMap[32],
      universe_33: routeMap[33],
      universe_63: routeMap[63],
      universe_64: routeMap[64],
      universe_95: routeMap[95],
      universe_96: routeMap[96],
      universe_127: routeMap[127],
    },
    packetCountPerIp: packetCounts,
    controllers: activeConfig.controllers.map(c => ({
      ip: c.ip,
      startUniverse: c.startUniverse ?? 0,
      universeCount: c.universes.length,
    })),
    isPlaying,
    activeOverride,
    playbackTime,
    bufferCount: universeBuffers.size,
  });
});

// Test pattern endpoint - sends distinct color per controller quadrant
app.get('/api/test-pattern', (req, res) => {
  const colors = [
    [255, 0, 0],     // Controller .45 = RED
    [0, 255, 0],     // Controller .46 = GREEN
    [0, 0, 255],     // Controller .47 = BLUE
    [255, 255, 0],   // Controller .48 = YELLOW
  ];

  for (let x = 0; x < 128; x++) {
    for (let y = 0; y < 128; y++) {
      const id = getEntityIdFromGrid(x, y);
      const target = activeConfig.entityMap[id];
      if (!target) continue;

      const controllerIdx = Math.floor(Math.floor(x / 2) / 16);
      const [r, g, b] = colors[controllerIdx] || [128, 128, 128];

      const buf = getUniverseBuffer(target.universe);
      buf[target.channel] = r;
      buf[target.channel + 1] = g;
      buf[target.channel + 2] = b;
      dirtyUniverses.add(target.universe);
    }
  }

  // Immediately send to all controllers
  dirtyUniverses.forEach((univ) => {
    const route = universeRouteMap.get(univ);
    if (route) {
      const buf = universeBuffers.get(univ);
      if (buf) {
        artnetSender.send(route.artnetUniverse, buf, { ip: route.ip });
      }
    }
  });
  dirtyUniverses.clear();

  // Also send preview to web UI
  sendPreviewToClients();

  res.json({
    success: true,
    message: 'Test pattern sent: RED=.45, GREEN=.46, BLUE=.47, YELLOW=.48',
    routeInfo: activeConfig.controllers.map(c => ({
      ip: c.ip,
      startUniverse: c.startUniverse ?? 0,
      artnetRange: `${0}-${c.universes.length - 1}`,
    })),
  });
});

// Ping endpoint to test controller reachability
app.get('/api/ping', async (req, res) => {
  console.log('[Ping] Diagnosing controller reachability...');
  const pingResults = await Promise.all(
    activeConfig.controllers.map(async (ctrl) => {
      const ip = ctrl.ip;
      if (ip === '127.0.0.1' || ip === 'localhost') {
        return { ip, status: 'ONLINE', latency: '0ms (localhost)' };
      }

      return new Promise<{ ip: string; status: 'ONLINE' | 'OFFLINE'; latency: string }>((resolve) => {
        // Windows: -n 1 (1 ping packet), -w 800 (800ms timeout)
        exec(`ping -n 1 -w 800 ${ip}`, (error, stdout) => {
          if (error) {
            resolve({ ip, status: 'OFFLINE', latency: 'unreachable' });
          } else {
            let latency = 'unknown';
            const match = stdout.match(/(?:time|temps|average|moyen|minimum|maximum)[= ]+(\d+)\s*ms/i);
            if (match) {
              latency = `${match[1]}ms`;
            } else if (stdout.includes('TTL=') || stdout.includes('ttl=')) {
              latency = '<10ms';
            }
            resolve({ ip, status: 'ONLINE', latency });
          }
        });
      });
    })
  );

  console.log('[Ping] Results:', pingResults);
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    results: pingResults,
  });
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
