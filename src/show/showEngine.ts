import type {
  BaseClip,
  Easing,
  ElementClip,
  ElementKeyframe,
  ElementState,
  FixtureClip,
  FixtureKeyframe,
  FixtureState,
  PatternClip,
  ProjectorClip,
  ProjectorKeyframe,
  ProjectorState,
  ShowClip,
  ShowDocument,
} from '../types/show.ts';
import { clampShowFrame } from '../types/show.ts';

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];
type ScreenClip = PatternClip | ElementClip;

export interface PreparedShowFrame {
  show: ShowDocument;
  frame: number;
  screenClips: ScreenClip[];
  fixtures: FixtureState[];
  projector: ProjectorState;
}

export interface RenderedShowFrame {
  frame: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  fixtures: FixtureState[];
  projector: ProjectorState;
}

const WALL_SIZE = 128;

const DEFAULT_ELEMENT: ElementState = {
  x: 64,
  y: 64,
  width: 40,
  height: 40,
  rotation: 0,
  opacity: 1,
  fill: '#f5f5f2',
};

export const DEFAULT_FIXTURE_STATE: FixtureState = {
  pan: 127,
  tilt: 127,
  dimmer: 0,
  strobe: 0,
  colorWheel: 0,
};

export const DEFAULT_PROJECTOR_STATE: ProjectorState = {
  red: 0,
  green: 0,
  blue: 0,
  white: 0,
  intensity: 0,
};

function clamp(value: number, min = 0, max = 255): number {
  return Math.max(min, Math.min(max, value));
}

function interpolate(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function applyEasing(amount: number, easing: Easing): number {
  const t = clamp(amount, 0, 1);
  if (easing === 'hold') return 0;
  if (easing === 'ease-in-out') return t * t * (3 - 2 * t);
  return t;
}

function parseHexColor(value: string): Rgb {
  const normalized = value.trim().replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized;
  const parsed = Number.parseInt(expanded, 16);
  if (!Number.isFinite(parsed) || expanded.length !== 6) return [255, 255, 255];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function interpolateColor(from: string, to: string, amount: number): string {
  const start = parseHexColor(from);
  const end = parseHexColor(to);
  const value = start.map((channel, index) => Math.round(interpolate(channel, end[index], amount)));
  return `#${value.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function findKeyframePair<T extends { frame: number; easing: Easing }>(keyframes: T[], frame: number): [T, T, number] | null {
  if (keyframes.length === 0) return null;
  const ordered = [...keyframes].sort((a, b) => a.frame - b.frame);
  if (frame <= ordered[0].frame) return [ordered[0], ordered[0], 0];
  if (frame >= ordered[ordered.length - 1].frame) {
    const last = ordered[ordered.length - 1];
    return [last, last, 0];
  }

  for (let index = 0; index < ordered.length - 1; index++) {
    const left = ordered[index];
    const right = ordered[index + 1];
    if (frame >= left.frame && frame <= right.frame) {
      const span = Math.max(1, right.frame - left.frame);
      return [left, right, applyEasing((frame - left.frame) / span, left.easing)];
    }
  }

  return null;
}

export function isClipActive(clip: ShowClip, frame: number): boolean {
  return frame >= clip.startFrame && frame <= clip.endFrame;
}

export function getClipLocalFrame(clip: BaseClip, showFrame: number): number {
  const localFrame = Math.max(0, showFrame - clip.startFrame);
  if (!clip.loop.enabled) return localFrame;
  return localFrame % Math.max(1, clip.loop.lengthFrames);
}

export function getElementStateAtFrame(clip: ElementClip, showFrame: number): ElementState {
  const pair = findKeyframePair(clip.keyframes, getClipLocalFrame(clip, showFrame));
  if (!pair) return { ...DEFAULT_ELEMENT };
  const [left, right, amount] = pair;

  return {
    x: interpolate(left.x, right.x, amount),
    y: interpolate(left.y, right.y, amount),
    width: interpolate(left.width, right.width, amount),
    height: interpolate(left.height, right.height, amount),
    rotation: interpolate(left.rotation, right.rotation, amount),
    opacity: interpolate(left.opacity, right.opacity, amount),
    fill: interpolateColor(left.fill, right.fill, amount),
  };
}

export function getFixtureStateAtFrame(
  clip: FixtureClip,
  show: ShowDocument,
  showFrame: number,
  fixtureIndex: number,
): FixtureState {
  const evaluationFrame = clip.timeMode === 'show' ? showFrame : getClipLocalFrame(clip, showFrame);
  const time = evaluationFrame / show.fps;

  if (clip.preset === 'lyre_waltz') {
    const phase = time * 1.5 + fixtureIndex * (Math.PI / 2);
    return {
      pan: Math.round(127 + 60 * Math.sin(phase)),
      tilt: Math.round(100 + 40 * Math.cos(phase)),
      dimmer: 255,
      strobe: 0,
      colorWheel: 135,
    };
  }

  if (clip.preset === 'lyre_rise') {
    return {
      pan: 127,
      tilt: Math.round(180 + 40 * Math.sin(time * 3)),
      dimmer: 255,
      strobe: 0,
      colorWheel: 15,
    };
  }

  if (clip.preset === 'lyre_trap') {
    const sweepPhase = time * 5 + (fixtureIndex % 2 === 0 ? 0 : Math.PI);
    const colors = [15, 135, 0, 15];
    return {
      pan: Math.round(127 + 100 * Math.sin(sweepPhase)),
      tilt: Math.round(127 + 60 * Math.cos(sweepPhase)),
      dimmer: 255,
      strobe: 240,
      colorWheel: colors[(fixtureIndex + Math.floor(time * 2)) % colors.length],
    };
  }

  if (clip.preset === 'black') return { ...DEFAULT_FIXTURE_STATE };

  if (clip.preset === 'lyre_buildup_strobe') {
    const progress = time < 3 ? time / 3 : Math.max(0, Math.min(1, (time - 32) / 8));
    return {
      pan: Math.round(127 + Math.sin(time * (4 + progress * 8) + fixtureIndex) * 95),
      tilt: Math.round(85 + progress * 90),
      dimmer: 255,
      strobe: Math.round(80 + progress * 175),
      colorWheel: fixtureIndex % 2 === 0 ? 135 : 15,
    };
  }

  if (clip.preset === 'lyre_drop_trap') {
    const phase = time * 7 + (fixtureIndex % 2 === 0 ? 0 : Math.PI);
    return {
      pan: Math.round(127 + Math.sin(phase) * 105),
      tilt: Math.round(125 + Math.cos(phase * 0.7) * 65),
      dimmer: 255,
      strobe: 205,
      colorWheel: [15, 135, 0, 15][(fixtureIndex + Math.floor(time * 2)) % 4],
    };
  }

  if (clip.preset === 'lyre_circle_color' || clip.preset === 'lyre_intro' || clip.preset === 'lyre_kick_pulse') {
    const phase = time * 2.4 + fixtureIndex * (Math.PI / 2);
    return {
      pan: Math.round(127 + Math.sin(phase) * 82),
      tilt: Math.round(127 + Math.cos(phase) * 60),
      dimmer: clip.preset === 'lyre_kick_pulse' ? Math.round(80 + Math.abs(Math.sin(time * 8)) * 175) : 255,
      strobe: 0,
      colorWheel: clip.preset === 'lyre_intro' ? 0 : [15, 135, 0, 15][fixtureIndex],
    };
  }

  const pair = findKeyframePair(clip.keyframes, evaluationFrame);
  if (!pair) return { ...DEFAULT_FIXTURE_STATE };
  const [left, right, amount] = pair;

  return {
    pan: Math.round(interpolate(left.pan, right.pan, amount)),
    tilt: Math.round(interpolate(left.tilt, right.tilt, amount)),
    dimmer: Math.round(interpolate(left.dimmer, right.dimmer, amount)),
    strobe: Math.round(interpolate(left.strobe, right.strobe, amount)),
    colorWheel: Math.round(interpolate(left.colorWheel, right.colorWheel, amount)),
  };
}

export function getProjectorStateAtFrame(clip: ProjectorClip, showFrame: number): ProjectorState {
  const time = showFrame / 40;
  if (clip.preset === 'static_off') return { ...DEFAULT_PROJECTOR_STATE };
  if (clip.preset === 'static_dimmer_rise') {
    const local = time < 3 ? time / 3 : Math.max(0, Math.min(1, (time - 32) / 8));
    return { red: 30, green: 100, blue: 255, white: 80, intensity: Math.round(local * 255) };
  }
  if (clip.preset === 'static_drop_strobe') {
    return { red: 255, green: 0, blue: 145, white: 40, intensity: Math.floor(time * 16) % 2 === 0 ? 255 : 35 };
  }
  if (clip.preset === 'static_snare_flash') {
    return { red: 255, green: 0, blue: 145, white: 0, intensity: Math.floor(time * 4) % 4 === 0 ? 255 : 25 };
  }
  if (clip.preset === 'static_measure_pulse') {
    return { red: 20, green: 100, blue: 255, white: 0, intensity: Math.round(Math.abs(Math.sin(time * 2)) * 255) };
  }
  const pair = findKeyframePair(clip.keyframes, getClipLocalFrame(clip, showFrame));
  if (!pair) return { ...DEFAULT_PROJECTOR_STATE };
  const [left, right, amount] = pair;

  return {
    red: Math.round(interpolate(left.red, right.red, amount)),
    green: Math.round(interpolate(left.green, right.green, amount)),
    blue: Math.round(interpolate(left.blue, right.blue, amount)),
    white: Math.round(interpolate(left.white, right.white, amount)),
    intensity: Math.round(interpolate(left.intensity, right.intensity, amount)),
  };
}

function targetFixtureIndexes(target: string): number[] {
  if (target === 'all-lyres') return [0, 1, 2, 3];
  const match = /^lyre-(\d)$/.exec(target);
  if (!match) return [];
  const index = Number(match[1]) - 1;
  return index >= 0 && index < 4 ? [index] : [];
}

export function prepareShowFrame(show: ShowDocument, requestedFrame: number): PreparedShowFrame {
  const frame = clampShowFrame(show, requestedFrame);
  const screenClips: ScreenClip[] = [];
  const fixtures = Array.from({ length: 4 }, () => ({ ...DEFAULT_FIXTURE_STATE }));
  let projector = { ...DEFAULT_PROJECTOR_STATE };

  show.tracks.forEach((track) => {
    if (track.muted) return;
    const activeClip = track.clips.find((clip) => isClipActive(clip, frame));
    if (!activeClip) return;

    if (track.kind === 'screen' && (activeClip.kind === 'pattern' || activeClip.kind === 'element')) {
      screenClips.push(activeClip);
      return;
    }

    if (track.kind === 'fixture' && activeClip.kind === 'fixture') {
      targetFixtureIndexes(track.target).forEach((fixtureIndex) => {
        fixtures[fixtureIndex] = getFixtureStateAtFrame(activeClip, show, frame, fixtureIndex);
      });
      return;
    }

    if (track.kind === 'projector' && activeClip.kind === 'projector') {
      projector = getProjectorStateAtFrame(activeClip, frame);
    }
  });

  return { show, frame, screenClips, fixtures, projector };
}

const customShaderCache = new Map<string, (x: number, y: number, t: number, d: number, a: number, f: number) => [number, number, number]>();

function getCompiledCustomShader(code: string): (x: number, y: number, t: number, d: number, a: number, f: number) => [number, number, number] {
  let fn = customShaderCache.get(code);
  if (!fn) {
    try {
      fn = new Function('x', 'y', 't', 'd', 'a', 'f', `
        let r = 0, g = 0, b = 0;
        try {
          ${code}
        } catch (e) {}
        return [r, g, b];
      `) as any;
    } catch (e) {
      fn = (_x, _y, t, _d, _a, _f) => {
        // Red flashing color indicating syntax/compile error
        return Math.floor(t * 8) % 2 === 0 ? [255, 0, 0] : [0, 0, 0];
      };
    }
    customShaderCache.set(code, fn!);
  }
  return fn!;
}

function evaluatePattern(clip: PatternClip, show: ShowDocument, frame: number, x: number, y: number): Rgba {
  const evaluationFrame = clip.timeMode === 'show' ? frame : getClipLocalFrame(clip, frame);
  const time = evaluationFrame / show.fps;

  const adjustedTime = time + AUDIO_OFFSET;
  const beatIdx = Math.floor(adjustedTime / BEAT_DURATION);
  const beatProgress = (adjustedTime % BEAT_DURATION) / BEAT_DURATION;
  const beatInMeasure = beatIdx % 4;
  const measureIdx = Math.floor(beatIdx / 4);

  const renderType = getWallRenderType(clip.pattern, time);

  let r = 0;
  let g = 0;
  let b = 0;

  let fadeScale = 1.0;
  if (time < 1.5) {
    fadeScale = time / 1.5;
  } else if (time > 43.5) {
    fadeScale = Math.max(0, (45.0 - time) / 1.5);
  }

  if (renderType === 'cosmo_singer_intro') {
    const color = drawCosmoSingerIntro(x, y, time, beatProgress, beatIdx);
    r = color.r; g = color.g; b = color.b;
  } else if (renderType === 'guitar_intro') {
    if (time < 0.6) {
      r = g = b = 0;
    } else {
      const pluckIntensity = Math.exp(-beatProgress * 4.0);
      const wave = Math.sin(x * 0.15 + time * 12) * 6 * pluckIntensity;
      const stringY = 64 + Math.round(wave);
      
      if (Math.abs(y - stringY) < 1.5) {
        r = 235; g = 160; b = 45;
      } else {
        const dist = Math.abs(y - stringY);
        const glow = Math.max(0, 1.0 - dist / 12) * pluckIntensity;
        r = Math.round(40 * glow);
        g = Math.round(25 * glow);
        b = Math.round(8 * glow);
      }
    }
  } else if (renderType === 'intro_ticks') {
    const dx = Math.abs(x - 64);
    const dy = Math.abs(y - 64);
    const maxDist = Math.max(dx, dy);
    
    if (beatInMeasure === 0 || beatInMeasure === 2) {
      const size = Math.floor((1.0 - beatProgress) * 64);
      if (maxDist === size || maxDist === size - 1) {
        r = 0; g = 220; b = 255;
      }
    }
    const dist = Math.sqrt((x-64)*(x-64) + (y-64)*(y-64));
    if (dist < 4) {
      const intensity = Math.floor(255 * (1 - beatProgress));
      r = g = b = intensity;
    }
    if (time > 4.7 && time <= 5.0) {
      const fade = (5.0 - time) / 0.3;
      r = Math.round(r * fade);
      g = Math.round(g * fade);
      b = Math.round(b * fade);
    }
  } else if (renderType === 'blue_star_burst') {
    const dx = Math.abs(x - 64);
    const dy = Math.abs(y - 64);
    const maskColor = drawCharacterMask('gazelle', x, y, time, beatProgress);
    
    if (maskColor.r > 0 || maskColor.g > 0 || maskColor.b > 0) {
      r = maskColor.r; g = maskColor.g; b = maskColor.b;
    } else {
      const isBorder = (dx === 22 && dy <= 32) || (dy === 32 && dx <= 22);
      if (isBorder) {
        r = 255; g = 0; b = 150;
      } else if (dx < 22 && dy < 32) {
        const dist = Math.sqrt((x-64)*(x-64) + (y-64)*(y-64));
        const stampRadius = 5 + 12 * beatProgress;
        if (Math.abs(dist - stampRadius) < 1.5) {
          r = 235; g = 180; b = 45;
        } else {
          r = 10; g = 5; b = 20;
        }
      }
    }
    if (time >= 20.0 && time <= 20.8) {
      const fade = (time - 20.0) / 0.8;
      r = Math.round(r * fade); g = Math.round(g * fade); b = Math.round(b * fade);
    } else if (time >= 25.2 && time <= 26.0) {
      const fade = (26.0 - time) / 0.8;
      r = Math.round(r * fade); g = Math.round(g * fade); b = Math.round(b * fade);
    }
  } else if (renderType === 'quadrant_flashes') {
    const maskColor = drawCharacterMask('gorilla', x, y, time, beatProgress);
    if (maskColor.r > 0 || maskColor.g > 0 || maskColor.b > 0) {
      r = maskColor.r; g = maskColor.g; b = maskColor.b;
    } else {
      let pixelQuad = 0;
      if (x < 64 && y >= 64) pixelQuad = 0;
      else if (x >= 64 && y >= 64) pixelQuad = 1;
      else if (x < 64 && y < 64) pixelQuad = 2;
      else pixelQuad = 3;

      if (pixelQuad === beatInMeasure) {
        const decay = 1 - beatProgress;
        r = Math.floor(255 * decay);
        g = 0;
        b = Math.floor(128 * decay);
      } else {
        r = 0; g = 20; b = 30;
      }
    }
  } else if (renderType === 'quadrant_flashes_no_mask') {
    let pixelQuad = 0;
    if (x < 64 && y >= 64) pixelQuad = 0;
    else if (x >= 64 && y >= 64) pixelQuad = 1;
    else if (x < 64 && y < 64) pixelQuad = 2;
    else pixelQuad = 3;

    if (pixelQuad === beatInMeasure) {
      const decay = 1 - beatProgress;
      const accent = getLyricAccentAtTime(time);
      r = Math.floor(accent[0] * decay);
      g = Math.floor(accent[1] * decay);
      b = Math.floor(accent[2] * decay);
    } else {
      r = 0; g = 20; b = 30;
    }
  } else if (renderType === 'laser_sweeps') {
    const maskColor = drawCharacterMask('lion', x, y, time, beatProgress);
    if (maskColor.r > 0 || maskColor.g > 0 || maskColor.b > 0) {
      r = maskColor.r; g = maskColor.g; b = maskColor.b;
    } else {
      const dx = x - 64;
      const dy = y - 64;
      let progress = 0;
      if (time < 3.0) {
        progress = Math.max(0, Math.min(1.0, (time + 4.3) / 7.3));
      } else {
        progress = Math.max(0, Math.min(1.0, (time - 32.0) / 8.0));
      }
      const angle = time * (3.0 + progress * 5.0);
      
      const line1 = Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle)) < 1.8;
      const line2 = Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle)) < 1.8;
      
      if (line1 || line2) {
        if (Math.sin(time * 5) > 0) {
          r = 0; g = 255; b = 255;
        } else {
          r = 255; g = 0; b = 150;
        }
      } else {
        const maxDist = Math.max(Math.abs(dx), Math.abs(dy));
        const trailSize = Math.floor((time * 40) % 64);
        if (maxDist === trailSize) {
          r = 30; g = 0; b = 40;
        }
      }
      const isBorder = x < 4 || x > 123 || y < 4 || y > 123;
      const strobeOn = Math.floor(time * (10 + progress * 30)) % 2 === 0;
      if (isBorder && strobeOn) {
        r = 255; g = 255; b = 255;
      }
    }
  } else if (renderType === 'reactive_drop') {
    const colIdx = Math.floor(x / 8);
    const bounce = Math.exp(-beatProgress * 4.0);
    const baseHeight = (Math.sin(colIdx * 0.7 + time * 12) * 0.3 + 0.7) * 35;
    const eqHeight = 10 + baseHeight * (0.4 + 0.6 * bounce);

    const inRibbon = y >= 24 && y < 104;
    if (inRibbon) {
      let inText = false;
      const scale = 3;
      const heyCue = getHeyCueAtTime(time);
      let heyOpacity = 1;

      if (heyCue) {
        const t1 = time - heyCue.startTime;
        const t2 = time - (heyCue.startTime + 0.7);
        heyOpacity = Math.max(0, Math.min(1, (heyCue.endTime - time) / 0.5));
        const inText1 = isPixelInText("HEY", x, y, 32, t1 < 0.25 ? Math.round(-80 + 112 * (t1 / 0.25)) : 32, scale, 7);
        let inText2 = false;
        if (t2 >= 0) {
          inText2 = isPixelInText("HEY!", x, y, 32, t2 < 0.25 ? Math.round(128 - 96 * (t2 / 0.25)) : 32, scale, 7);
        }
        inText = inText1 || inText2;
      }

      const invertActive = beatIdx % 2 === 0;
      const colors = [[0, 255, 255], [255, 0, 150], [235, 180, 45]];
      const themeCol = colors[measureIdx % colors.length] || [255, 255, 255];

      if (invertActive) {
        if (inText) {
          r = 0; g = 0; b = 0;
        } else {
          r = themeCol[0]; g = themeCol[1]; b = themeCol[2];
        }
      } else {
        if (inText) {
          r = themeCol[0]; g = themeCol[1]; b = themeCol[2];
        } else {
          r = 0; g = 0; b = 0;
        }
      }

      if (heyCue && heyOpacity < 1) {
        r = Math.round(r * heyOpacity); g = Math.round(g * heyOpacity); b = Math.round(b * heyOpacity);
      }
    } else {
      const isInsideEq = (y < eqHeight) || (y > 127 - eqHeight);
      if (isInsideEq) {
        if (y < 20 || y > 107) {
          r = 255; g = 0; b = 150;
        } else {
          r = 0; g = 255; b = 255;
        }
      } else {
        const strobeWashOn = beatIdx % 2 === 0;
        if (strobeWashOn) {
          r = 0; g = 20; b = 40;
        } else {
          r = 25; g = 0; b = 15;
        }
      }
    }

    const showSinger = (time >= 10.85 && time < 16.6) || (time >= 18.25 && time < 26.0);
    if (showSinger) {
      const singer = getSingerPixelColor(x, y, time, beatProgress, beatIdx, 22, 24);
      if (singer) {
        r = singer.r; g = singer.g; b = singer.b;
      }
    }
  } else if (renderType === 'radial_ripple') {
    const dx = x - 64;
    const dy = y - 64;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const value = Math.sin(distance * 0.15 - time * 6);
    if (value > 0.15) {
      [r, g, b] = [230, 20, 30];
    } else {
      [r, g, b] = [240, 240, 240];
    }
  } else if (renderType === 'gradient_sweep') {
    const sweepPosition = (x + y - time * 120) % 256;
    if (sweepPosition < 80) {
      [r, g, b] = [230, 20, 30];
    } else if (sweepPosition < 160) {
      [r, g, b] = [240, 240, 240];
    } else {
      [r, g, b] = [235, 180, 45];
    }
  } else if (renderType === 'strobe_flash') {
    const flashIndex = Math.floor(time * 12) % 3;
    if (flashIndex === 0) [r, g, b] = [230, 20, 30];
    if (flashIndex === 1) [r, g, b] = [240, 240, 240];
  } else if (renderType === 'equalizer') {
    const speedFactor = time * 5;
    const bandValue = Math.abs(Math.sin(x * 0.1 + speedFactor)) * 90
      + Math.cos(x * 0.05 - speedFactor) * 30;
    const limit = Math.max(0, Math.min(128, bandValue));
    if (y < limit) {
      if (y < 50) [r, g, b] = [230, 20, 30];
      else if (y < 95) [r, g, b] = [235, 180, 45];
      else [r, g, b] = [240, 240, 240];
    }
  } else if (renderType === 'solid') {
    const parsed = parseHexColor(clip.color ?? '#f5f5f2');
    r = parsed[0]; g = parsed[1]; b = parsed[2];
  } else if (renderType === 'custom') {
    const dx = x - 64;
    const dy = y - 64;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const shader = getCompiledCustomShader(clip.code ?? '');
    const shaderColor = shader(x, y, time, distance, angle, evaluationFrame);
    r = shaderColor[0]; g = shaderColor[1]; b = shaderColor[2];
  }

  // Apply effect params (intensity, strobe, color)
  if (clip.effectParams) {
    const strobe = clip.effectParams.strobe ?? 0;
    if (strobe > 0) {
      const flashesPerSecond = 3 + strobe * 27;
      if (Math.floor(time * flashesPerSecond) % 2 === 1) {
        r = g = b = 0;
      }
    }
    const intensity = clip.effectParams.intensity ?? 1.0;
    r = Math.round(r * intensity);
    g = Math.round(g * intensity);
    b = Math.round(b * intensity);
  }

  // Lyrics overlay and fade scale only apply to legacy redirectable patterns
  if (REDIRECTABLE_PATTERNS.has(clip.pattern)) {
    const lyricOverlay = getFinalLyricOverlayPixel(time, x, y, beatIdx);
    if (lyricOverlay) {
      r = lyricOverlay.r;
      g = lyricOverlay.g;
      b = lyricOverlay.b;
    }

    r = Math.round(r * fadeScale);
    g = Math.round(g * fadeScale);
    b = Math.round(b * fadeScale);
  }

  return [r, g, b, 255];
}

function evaluateElement(clip: ElementClip, frame: number, x: number, y: number): Rgba {
  const state = getElementStateAtFrame(clip, frame);
  const angle = (-state.rotation * Math.PI) / 180;
  const deltaX = x - state.x;
  const deltaY = y - state.y;
  const localX = deltaX * Math.cos(angle) - deltaY * Math.sin(angle);
  const localY = deltaX * Math.sin(angle) + deltaY * Math.cos(angle);
  const halfWidth = Math.max(0.5, state.width / 2);
  const halfHeight = Math.max(0.5, state.height / 2);

  const isInside = clip.shape === 'ellipse'
    ? (localX * localX) / (halfWidth * halfWidth) + (localY * localY) / (halfHeight * halfHeight) <= 1
    : Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfHeight;

  if (!isInside) return [0, 0, 0, 0];
  const [r, g, b] = parseHexColor(state.fill);
  return [r, g, b, Math.round(clamp(state.opacity, 0, 1) * 255)];
}

export function evaluateScreenPixel(prepared: PreparedShowFrame, x: number, y: number): Rgb {
  let output: Rgb = [0, 0, 0];

  prepared.screenClips.forEach((clip) => {
    const source = clip.kind === 'pattern'
      ? evaluatePattern(clip, prepared.show, prepared.frame, x, y)
      : evaluateElement(clip, prepared.frame, x, y);
    const alpha = source[3] / 255;
    output = [
      Math.round(source[0] * alpha + output[0] * (1 - alpha)),
      Math.round(source[1] * alpha + output[1] * (1 - alpha)),
      Math.round(source[2] * alpha + output[2] * (1 - alpha)),
    ];
  });

  return output;
}

export function renderShowFrame(
  show: ShowDocument,
  requestedFrame: number,
  width = WALL_SIZE,
  height = WALL_SIZE,
  flipY = false,
): RenderedShowFrame {
  const prepared = prepareShowFrame(show, requestedFrame);
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let outputY = 0; outputY < height; outputY++) {
    const sampledY = Math.min(WALL_SIZE - 1, Math.floor((outputY / height) * WALL_SIZE));
    const logicalY = flipY ? WALL_SIZE - 1 - sampledY : sampledY;
    for (let outputX = 0; outputX < width; outputX++) {
      const logicalX = Math.min(WALL_SIZE - 1, Math.floor((outputX / width) * WALL_SIZE));
      const [r, g, b] = evaluateScreenPixel(prepared, logicalX, logicalY);
      const offset = (outputY * width + outputX) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }

  return {
    frame: prepared.frame,
    width,
    height,
    pixels,
    fixtures: prepared.fixtures.map((fixture) => ({ ...fixture })),
    projector: { ...prepared.projector },
  };
}

export function createElementKeyframe(frame: number, state: ElementState, easing: Easing = 'linear'): ElementKeyframe {
  return { frame, easing, ...state };
}

export function createFixtureKeyframe(frame: number, state: FixtureState, easing: Easing = 'linear'): FixtureKeyframe {
  return { frame, easing, ...state };
}

export function createProjectorKeyframe(frame: number, state: ProjectorState, easing: Easing = 'linear'): ProjectorKeyframe {
  return { frame, easing, ...state };
}

// --- Procedural Character & Lyrics Rendering Helper Functions ---

interface LyricCue {
  startTime: number;
  endTime: number;
  lines: readonly string[];
  kind?: 'hey';
}

const BPM = 130;
const BEAT_DURATION = 60 / BPM;
const AUDIO_OFFSET = 0.1;
const FIRST_HEY_START = 9.2;
const REFRAIN_LYRICS_START = 23.35;
const REFRAIN_LYRICS_END = 39.1;
const SHOW_END = 45.0;

const LYRIC_CUES: readonly LyricCue[] = [
  { startTime: 9.2, endTime: 10.85, lines: ['HEY', 'HEY'], kind: 'hey' },
  { startTime: 16.6, endTime: 18.25, lines: ['HEY', 'HEY'], kind: 'hey' },
  { startTime: 23.35, endTime: 25.0, lines: ['TANZ', 'SCHEIN'] },
  { startTime: 25.0, endTime: 27.35, lines: ['STRENG', 'SEIN'] },
  { startTime: 27.35, endTime: 29.55, lines: ['TANZ', 'SCHEIN'] },
  { startTime: 29.55, endTime: 30.95, lines: ['NICHT', 'REIN'] },
  { startTime: 30.95, endTime: 33.15, lines: ['TANZ', 'SCHEIN'] },
  { startTime: 33.15, endTime: 34.75, lines: ['WITZ', 'SEIN'] },
  { startTime: 34.75, endTime: 37.05, lines: ['TANZ', 'SCHEIN'] },
  { startTime: 37.05, endTime: 39.1, lines: ['NICHT', 'REIN'] },
];

const font: Record<string, number[]> = {
  'A': [0x7e, 0x11, 0x11, 0x11, 0x7e],
  'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
  'C': [0x3e, 0x41, 0x41, 0x41, 0x22],
  'D': [0x7f, 0x41, 0x41, 0x22, 0x1c],
  'E': [0x7f, 0x49, 0x49, 0x49, 0x41],
  'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
  'G': [0x3e, 0x41, 0x49, 0x49, 0x7a],
  'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
  'I': [0x00, 0x41, 0x7f, 0x41, 0x00],
  'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
  'K': [0x7f, 0x08, 0x14, 0x22, 0x41],
  'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
  'M': [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  'N': [0x7f, 0x04, 0x08, 0x10, 0x7f],
  'O': [0x3e, 0x41, 0x41, 0x41, 0x3e],
  'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
  'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e],
  'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
  'S': [0x26, 0x49, 0x49, 0x49, 0x32],
  'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
  'U': [0x3f, 0x40, 0x40, 0x40, 0x3f],
  'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
  'W': [0x7f, 0x20, 0x18, 0x20, 0x7f],
  'X': [0x63, 0x14, 0x08, 0x14, 0x63],
  'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
  'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  '?': [0x2d, 0x26, 0x49, 0x09, 0x06],
  '!': [0x00, 0x00, 0x5f, 0x00, 0x00]
};

function getLyricCueAtTime(time: number): LyricCue | null {
  return LYRIC_CUES.find((cue) => time >= cue.startTime && time < cue.endTime) ?? null;
}

function getHeyCueAtTime(time: number): LyricCue | null {
  const cue = getLyricCueAtTime(time);
  return cue?.kind === 'hey' ? cue : null;
}

function getTextLyricCueAtTime(time: number): LyricCue | null {
  const cue = getLyricCueAtTime(time);
  return cue && cue.kind !== 'hey' ? cue : null;
}

function getLyricAccentAtTime(time: number): [number, number, number] {
  const palette: [number, number, number][] = [
    [0, 255, 255],   // cyan
    [255, 0, 150],   // magenta
    [235, 180, 45],  // gold
  ];
  const cue = getTextLyricCueAtTime(time);
  if (!cue) return [255, 255, 255];
  const cueIndex = LYRIC_CUES.filter((item) => item.kind !== 'hey').indexOf(cue);
  return palette[cueIndex % palette.length] || [255, 255, 255];
}

function getReadableScale(lines: readonly string[], preferredScale: number): number {
  const maxLen = Math.max(...lines.map((line) => line.length));
  if (maxLen <= 6) return preferredScale;
  if (maxLen <= 9) return Math.min(preferredScale, 2);
  return 1;
}

function isPixelInText(str: string, px: number, py: number, startX: number, startY: number, scale: number = 1, spacingWidth: number = 6): boolean {
  const dx = px - startX;
  const dy = startY - py;
  if (dx < 0 || dy < 0) return false;
  const charW = spacingWidth * scale;
  const charH = 7 * scale;
  const charIdx = Math.floor(dx / charW);
  if (charIdx < 0 || charIdx >= str.length) return false;
  if (dy >= charH) return false;
  const relX = Math.floor((dx % charW) / scale);
  if (relX >= 5) return false;
  const relY = Math.floor(dy / scale);
  const char = str[charIdx];
  const cols = font[char] || [0x00, 0x00, 0x00, 0x00, 0x00];
  const colByte = cols[relX];
  return (colByte & (1 << relY)) !== 0;
}

function isPixelInSequentialLyric(lines: readonly string[], x: number, y: number, preferredScale: number, elapsed: number): boolean {
  const scale = getReadableScale(lines, preferredScale);
  const spacingWidth = 7;
  const fontWidth = spacingWidth * scale;
  const ySlots = lines.length === 1
    ? [scale >= 3 ? 75 : scale === 2 ? 67 : 65]
    : scale >= 3
      ? [88, 62]
      : scale === 2
        ? [76, 58]
        : [72, 61];

  return lines.some((line, idx) => {
    const delay = idx * 0.32;
    const progress = Math.max(0, Math.min(1, (elapsed - delay) / 0.22));
    if (progress <= 0) return false;

    const startX = 64 - Math.round((line.length * fontWidth) / 2);
    const startY = (ySlots[idx] ?? ySlots[0]) - Math.round((1 - progress) * 5);
    const width = line.length * fontWidth;
    const dx = x - startX;
    if (dx < 0 || dx > width * progress) return false;

    if (!isPixelInText(line, x, y, startX, startY, scale, spacingWidth)) return false;

    if (progress < 0.95 && ((x * 11 + y * 7) % 17) / 17 > progress) {
      return false;
    }
    return true;
  });
}

function getFinalLyricOverlayPixel(time: number, x: number, y: number, beatIdx: number): { r: number; g: number; b: number } | null {
  const cue = getTextLyricCueAtTime(time);
  if (!cue) return null;

  const elapsed = time - cue.startTime;
  const bandTop = 36;
  const bandBottom = 95;
  if (y < bandTop || y > bandBottom) return null;

  const accent = getLyricAccentAtTime(time);
  const invertActive = beatIdx % 2 === 0;
  const inText = isPixelInSequentialLyric(cue.lines, x, y, 3, elapsed);

  const bandOn = elapsed > 0.04;
  if (!bandOn && !inText) return null;

  if (inText) {
    return invertActive
      ? { r: 4, g: 4, b: 10 }
      : { r: accent[0], g: accent[1], b: accent[2] };
  }

  const border = y === bandTop || y === bandBottom || y === bandTop + 1 || y === bandBottom - 1;
  const scan = Math.floor((x + time * 90) / 8) % 8 === 0;

  if (invertActive) {
    const boost = border || scan ? 1 : 0.55;
    return {
      r: Math.round(accent[0] * boost),
      g: Math.round(accent[1] * boost),
      b: Math.round(accent[2] * boost),
    };
  }

  if (border || scan) {
    return {
      r: Math.round(accent[0] * 0.7),
      g: Math.round(accent[1] * 0.7),
      b: Math.round(accent[2] * 0.7),
    };
  }
  return { r: 2, g: 3, b: 12 };
}

function getSingerPixelColor(
  x: number,
  y: number,
  time: number,
  _beatProgress: number,
  _beatIdx: number,
  shiftY: number = 6,
  cropMinY: number | null = null
): { r: number, g: number, b: number } | null {
  if (cropMinY !== null && y < cropMinY) {
    return null;
  }
  y = y + shiftY;
  const dx = x - 64;

  const bodyY = y - 30;
  const torsoWidth = 18 + (bodyY * 0.32);
  const inTorso = y >= 18 && y <= 67 && Math.abs(dx) < torsoWidth && bodyY >= 0;
  const inNeck = y >= 62 && y <= 76 && Math.abs(dx) < 7;
  const inLeftArm = x >= 18 && x <= 40 && y >= 18 && y <= 64 && Math.abs((x - 29) - (y - 18) * 0.18) < 8;
  const inRightArm = x >= 89 && x <= 111 && y >= 16 && y <= 62 && Math.abs((x - 100) + (y - 18) * 0.14) < 8;
  const inFace = ((dx * dx) / (17 * 17) + ((y - 85) * (y - 85)) / (22 * 22)) < 1;
  const hairCap = ((dx + 1) * (dx + 1)) / (25 * 25) + ((y - 106) * (y - 106)) / (16 * 16) < 1;
  const hairCrown = y >= 99 && y <= 124 && Math.abs(dx + 2 + Math.sin(x * 0.55) * 5) < (23 - Math.max(0, y - 113) * 0.7);
  const hairFringe = y >= 91 && y <= 105 && x >= 42 && x <= 70 && Math.sin((x - 42) * 0.7) * 5 + 98 > y;
  const sideBurns = (x >= 42 && x <= 49 && y >= 80 && y <= 99) || (x >= 78 && x <= 84 && y >= 82 && y <= 99);
  const inHair = hairCap || hairCrown || hairFringe || sideBurns;
  const curl = inHair && ((x * 7 + y * 5 + Math.floor(time * 6)) % 11 < 8);

  const starCx = 55;
  const starCy = 89;
  const sx = x - starCx;
  const sy = y - starCy;
  const starDist = Math.sqrt(sx * sx + sy * sy);
  const starAngle = Math.atan2(sy, sx);
  const starRadius = 7 + 5 * Math.max(0, Math.cos(starAngle * 5));
  const starCore = starDist < starRadius && starDist > 2;
  const starCenter = starDist <= 5;
  const starTail = x >= 42 && x <= 62 && y >= 78 && y <= 101 && Math.abs((y - 90) + (x - 53) * 0.48) < 3.8;
  const bluePaint = starCenter || starCore || starTail;

  const leftEye = y >= 88 && y <= 90 && x >= 55 && x <= 59;

  if (bluePaint) {
    return { r: 0, g: 110, b: 255 };
  }
  if (leftEye) {
    return { r: 255, g: 255, b: 255 };
  }
  if (inHair) {
    if (curl) return { r: 50, g: 40, b: 35 };
    return { r: 35, g: 25, b: 20 };
  }
  if (inFace) {
    const isMouth = y >= 71 && y <= 72 && Math.abs(dx) < 6;
    if (isMouth) return { r: 220, g: 20, b: 40 };
    return { r: 240, g: 190, b: 160 };
  }
  if (inNeck) {
    return { r: 215, g: 165, b: 135 };
  }
  if (inTorso) {
    const pattern = ((x + y) % 12 < 5) || (Math.floor(x / 4) % 2 === Math.floor(y / 4) % 2);
    if (pattern) return { r: 12, g: 145, b: 125 };
    return { r: 4, g: 70, b: 62 };
  }
  if (inLeftArm || inRightArm) {
    return { r: 240, g: 190, b: 160 };
  }
  return null;
}

function drawCharacterMask(type: string, x: number, y: number, _time: number, beatProgress: number): { r: number, g: number, b: number } {
  let r = 0, g = 0, b = 0;
  const dx = x - 64;
  const dy = y - 64;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  const bounce = Math.exp(-beatProgress * 4.0);

  if (type === 'cosmo') {
    const inFace = (dx * dx) / (25 * 25) + (dy * dy) / (34 * 34) < 1.0;
    const inHair = dy > 22 && Math.abs(dx) < 28 && Math.sin(x * 0.4) * 3 + 28 > dy;
    const starDx = dx - 9;
    const starDy = dy - 6;
    const starDist = Math.sqrt(starDx * starDx + starDy * starDy);
    const starAngle = Math.atan2(starDy, starDx);
    const starFactor = Math.abs(Math.sin(starAngle * 2.5));
    const starRadius = (5 + 7 * bounce) * (0.65 + 0.35 * starFactor);
    const inStar = starDist < starRadius;
    const inLeftEye = Math.sqrt((dx + 9)*(dx + 9) + (dy - 6)*(dy - 6)) < 2.5;
    const inMouth = Math.abs(dy + 15) < 1.5 && Math.abs(dx) < 8;

    if (inStar) {
      r = 0; g = 110; b = 255;
    } else if (inLeftEye) {
      r = 255; g = 255; b = 255;
    } else if (inMouth) {
      r = 220; g = 20; b = 40;
    } else if (inHair) {
      r = 35; g = 25; b = 20;
    } else if (inFace) {
      r = 240; g = 190; b = 160;
    }
  } 
  else if (type === 'gazelle') {
    const inFace = dy < 12 && dy > -30 && Math.abs(dx) < (14 - dy * 0.4);
    const inLeftEar = dx < -12 && dx > -32 && dy > -4 && dy < 4 && Math.abs(dy - (dx + 12)*0.25) < 2.5;
    const inRightEar = dx > 12 && dx < 32 && dy > -4 && dy < 4 && Math.abs(dy - (-dx + 12)*0.25) < 2.5;
    const leftHornX = -7 - (dy - 12) * 0.25 + Math.sin(dy * 0.12) * 2;
    const isLeftHorn = dy >= 12 && dy <= 52 && Math.abs(dx - leftHornX) < (2.5 - (dy - 12) * 0.04);
    const rightHornX = 7 + (dy - 12) * 0.25 - Math.sin(dy * 0.12) * 2;
    const isRightHorn = dy >= 12 && dy <= 52 && Math.abs(dx - rightHornX) < (2.5 - (dy - 12) * 0.04);

    if (isLeftHorn || isRightHorn) {
      r = 0; g = 240; b = 255;
    } else if (inFace || inLeftEar || inRightEar) {
      r = 180; g = 185; b = 195;
      const eyeL = Math.sqrt((dx + 5)*(dx + 5) + (dy - 2)*(dy - 2)) < 2.0;
      const eyeR = Math.sqrt((dx - 5)*(dx - 5) + (dy - 2)*(dy - 2)) < 2.0;
      if (eyeL || eyeR) {
        r = 0; g = 255; b = 255;
      }
    }
  }
  else if (type === 'gorilla') {
    const inFace = (dx * dx) / (28 * 28) + (dy * dy) / (26 * 26) < 1.0 && dy > -18;
    const browWidth = 24;
    const isBrow = dy >= 10 && dy <= 14 && Math.abs(dx) < browWidth;
    const noseWidth = 6;
    const isNose = dy >= -6 && dy <= 0 && Math.abs(dx) < noseWidth;

    if (isBrow) {
      r = 140; g = 145; b = 160;
    } else if (isNose) {
      r = 30; g = 30; b = 40;
    } else if (inFace) {
      r = 50; g = 50; b = 60;
      const eyeL = Math.sqrt((dx + 8)*(dx + 8) + (dy - 4)*(dy - 4)) < 2.5;
      const eyeR = Math.sqrt((dx - 8)*(dx - 8) + (dy - 4)*(dy - 4)) < 2.5;
      if (eyeL || eyeR) {
        r = 255; g = 0; b = 0;
      }
    }
  }
  else if (type === 'lion') {
    const maneRadius = 36 + 6 * bounce;
    const isMane = dist < maneRadius && dist > 24 && Math.floor(angle * 10) % 2 === 0;
    const inFace = dist <= 24 && dy > -24;

    if (isMane) {
      r = 255; g = 130; b = 0;
    } else if (inFace) {
      r = 200; g = 200; b = 210;
      const eyeL = Math.abs(dy - 3) < 1.2 && dx < -4 && dx > -11;
      const eyeR = Math.abs(dy - 3) < 1.2 && dx > 4 && dx < 11;
      const inSnout = dy < -4 && dy > -14 && Math.abs(dx) < 7;

      if (eyeL || eyeR) {
        r = 255; g = 180; b = 0;
      } else if (inSnout) {
        r = 45; g = 45; b = 55;
      }
    }
  }
  return { r, g, b };
}

function drawCosmoSingerIntro(x: number, y: number, time: number, beatProgress: number, beatIdx: number) {
  let r = 2, g = 13, b = 16;
  const dx = x - 64;
  const beatGlow = 1 - beatProgress;

  const bgWave = Math.sin((x - 64) * 0.09 + time * 3.2) + Math.cos((y - 64) * 0.08 - time * 2.7 + beatIdx * 0.35);
  if (bgWave > 1.25) {
    r = 0;
    g = 34 + Math.round(22 * beatGlow);
    b = 38 + Math.round(18 * beatGlow);
  }

  const ringDist = Math.sqrt(dx * dx + (y - 62) * (y - 62));
  const ring = Math.abs((ringDist + time * 18) % 28 - 14);
  if (ring < 1.2 && y < 98) {
    r = Math.max(r, 0);
    g = Math.max(g, Math.round(70 * beatGlow));
    b = Math.max(b, Math.round(90 * beatGlow));
  }

  const sparkle = ((x * 19 + y * 23 + Math.floor(time * 24)) % 97) === 0;
  if (sparkle) {
    r = 30;
    g = 180;
    b = 160;
  }

  const singer = getSingerPixelColor(x, y, time, beatProgress, beatIdx);
  if (singer) {
    return singer;
  }
  return { r, g, b };
}

const REDIRECTABLE_PATTERNS = new Set([
  'guitar_intro', 'intro_ticks', 'blue_star_burst',
  'quadrant_flashes', 'laser_sweeps', 'reactive_drop'
]);

function getWallRenderType(type: string, time: number): string {
  if (!REDIRECTABLE_PATTERNS.has(type)) return type;
  if (time < FIRST_HEY_START) return 'cosmo_singer_intro';
  if (time >= REFRAIN_LYRICS_START && time < REFRAIN_LYRICS_END) return 'quadrant_flashes_no_mask';
  if (time >= REFRAIN_LYRICS_END && time <= SHOW_END) return 'laser_sweeps';
  return type;
}
