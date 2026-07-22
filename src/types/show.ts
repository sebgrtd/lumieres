export const SHOW_FORMAT_VERSION = 1;

export type TrackKind = 'screen' | 'fixture' | 'projector';
export type TrackTarget = 'wall' | 'all-lyres' | 'lyre-1' | 'lyre-2' | 'lyre-3' | 'lyre-4' | 'static-1';
export type Easing = 'linear' | 'ease-in-out' | 'hold';
export type PatternName =
  | 'radial_ripple' | 'gradient_sweep' | 'strobe_flash' | 'equalizer' | 'solid'
  | 'black' | 'guitar_intro' | 'intro_ticks' | 'blue_star_burst'
  | 'cosmo_singer_intro' | 'quadrant_flashes' | 'quadrant_flashes_no_mask'
  | 'laser_sweeps' | 'reactive_drop' | 'reactive_drop_text' | 'reactive_drop_character'
  | 'custom';
export type FixturePreset =
  | 'lyre_waltz' | 'lyre_rise' | 'lyre_trap'
  | 'black' | 'lyre_intro' | 'lyre_kick_pulse' | 'lyre_circle_color'
  | 'lyre_buildup_strobe' | 'lyre_drop_trap';
export type StaticPreset =
  | 'static_off' | 'static_measure_pulse' | 'static_snare_flash'
  | 'static_dimmer_rise' | 'static_drop_strobe';

export interface EffectParams {
  intensity: number;
  color: string;
  speed: number;
  strobe: number;
}

export interface ClipLoop {
  enabled: boolean;
  lengthFrames: number;
}

export type ShowAudio =
  | {
      label: string;
      source: 'none';
      preset: null;
      bpm: number;
    }
  | {
      label: string;
      source: 'procedural';
      preset: 'austrian-lacrimosa';
      bpm: number;
    }
  | {
      label: string;
      source: 'file';
      preset: null;
      path: string;
      bpm: number;
      durationFrames?: number;
    };

export interface ShowAudioClip {
  id: string;
  trackId?: string;
  label: string;
  path: string;
  startFrame: number;
  endFrame: number;
  sourceOffsetFrames: number;
  bpm: number;
}

export interface BaseClip {
  id: string;
  name: string;
  startFrame: number;
  endFrame: number;
  timeMode: 'show' | 'clip';
  loop: ClipLoop;
  effectParams?: EffectParams;
}

export interface PatternClip extends BaseClip {
  kind: 'pattern';
  pattern: PatternName;
  color?: string;
  code?: string;
  lyrics?: {
    lines: [string, string];
    cueStartTime: number;
    accent: string;
  };
}

export interface ElementState {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fill: string;
}

export interface ElementKeyframe extends ElementState {
  frame: number;
  easing: Easing;
}

export interface ElementClip extends BaseClip {
  kind: 'element';
  shape: 'rectangle' | 'ellipse';
  keyframes: ElementKeyframe[];
}

export interface FixtureState {
  pan: number;
  tilt: number;
  dimmer: number;
  strobe: number;
  colorWheel: number;
}

export interface FixtureKeyframe extends FixtureState {
  frame: number;
  easing: Easing;
}

export interface FixtureClip extends BaseClip {
  kind: 'fixture';
  preset?: FixturePreset;
  keyframes: FixtureKeyframe[];
}

export interface ProjectorState {
  red: number;
  green: number;
  blue: number;
  white: number;
  intensity: number;
}

export interface ProjectorKeyframe extends ProjectorState {
  frame: number;
  easing: Easing;
}

export interface ProjectorClip extends BaseClip {
  kind: 'projector';
  preset?: StaticPreset;
  keyframes: ProjectorKeyframe[];
}

export type ShowClip = PatternClip | ElementClip | FixtureClip | ProjectorClip;

export interface ShowTrack {
  id: string;
  name: string;
  kind: TrackKind;
  target: TrackTarget;
  color: string;
  muted: boolean;
  locked: boolean;
  clips: ShowClip[];
}

export interface ShowDocument {
  formatVersion: typeof SHOW_FORMAT_VERSION;
  id: string;
  name: string;
  fps: number;
  durationFrames: number;
  audio: ShowAudio;
  /** Additional editable music clips. Optional for existing v1 show files. */
  audioClips?: ShowAudioClip[];
  tracks: ShowTrack[];
}

export function createBlankShow(options: {
  id?: string;
  name?: string;
  fps?: number;
  durationFrames?: number;
} = {}): ShowDocument {
  const fps = Math.max(1, Math.min(240, Math.round(options.fps ?? 40)));
  const durationFrames = Math.max(1, Math.round(options.durationFrames ?? fps * 20));

  return {
    formatVersion: SHOW_FORMAT_VERSION,
    id: options.id ?? 'nouveau-show',
    name: options.name?.trim() || 'Nouveau show',
    fps,
    durationFrames,
    audio: {
      label: 'Aucun audio',
      source: 'none',
      preset: null,
      bpm: 120,
    },
    tracks: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasNumericProperties(value: Record<string, unknown>, properties: string[]): boolean {
  return properties.every((property) => isFiniteNumber(value[property]));
}

function isEasing(value: unknown): value is Easing {
  return value === 'linear' || value === 'ease-in-out' || value === 'hold';
}

function hasValidBaseClip(clip: Record<string, unknown>, durationFrames: number): boolean {
  if (typeof clip.id !== 'string' || typeof clip.name !== 'string') return false;
  if (!Number.isInteger(clip.startFrame) || !Number.isInteger(clip.endFrame)) return false;
  if (Number(clip.startFrame) < 0 || Number(clip.endFrame) < Number(clip.startFrame)) return false;
  if (Number(clip.endFrame) > durationFrames) return false;
  if (clip.timeMode !== 'show' && clip.timeMode !== 'clip') return false;
  if (!isRecord(clip.loop)) return false;
  if (typeof clip.loop.enabled !== 'boolean') return false;
  return Number.isInteger(clip.loop.lengthFrames) && Number(clip.loop.lengthFrames) > 0;
}

function isValidKeyframe(value: unknown, numericProperties: string[], includesFill = false): boolean {
  if (!isRecord(value) || !isFiniteNumber(value.frame) || value.frame < 0 || !isEasing(value.easing)) return false;
  if (!hasNumericProperties(value, numericProperties)) return false;
  return !includesFill || typeof value.fill === 'string';
}

export function isShowDocument(value: unknown): value is ShowDocument {
  if (!isRecord(value)) return false;
  if (value.formatVersion !== SHOW_FORMAT_VERSION) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (!Number.isInteger(value.fps) || Number(value.fps) <= 0 || Number(value.fps) > 240) return false;
  if (!Number.isInteger(value.durationFrames) || Number(value.durationFrames) <= 0) return false;
  if (!isRecord(value.audio)) return false;
  if (typeof value.audio.label !== 'string' || !isFiniteNumber(value.audio.bpm) || value.audio.bpm <= 0) return false;
  if (value.audio.source === 'none') {
    if (value.audio.preset !== null) return false;
  } else if (value.audio.source === 'procedural') {
    if (value.audio.preset !== 'austrian-lacrimosa') return false;
  } else if (value.audio.source === 'file') {
    if (value.audio.preset !== null || typeof value.audio.path !== 'string') return false;
    if (value.audio.durationFrames !== undefined && (!Number.isInteger(value.audio.durationFrames) || Number(value.audio.durationFrames) <= 0)) return false;
  } else {
    return false;
  }
  if (!Array.isArray(value.tracks)) return false;
  if (value.audioClips !== undefined) {
    if (!Array.isArray(value.audioClips)) return false;
    if (!value.audioClips.every((clip) => isRecord(clip)
      && typeof clip.id === 'string'
      && (clip.trackId === undefined || typeof clip.trackId === 'string')
      && typeof clip.label === 'string'
      && typeof clip.path === 'string'
      && Number.isInteger(clip.startFrame) && Number(clip.startFrame) >= 0
      && Number.isInteger(clip.endFrame) && Number(clip.endFrame) > Number(clip.startFrame)
      && Number.isInteger(clip.sourceOffsetFrames) && Number(clip.sourceOffsetFrames) >= 0
      && isFiniteNumber(clip.bpm) && Number(clip.bpm) > 0)) return false;
  }

  const durationFrames = Number(value.durationFrames);
  const trackKinds: TrackKind[] = ['screen', 'fixture', 'projector'];
  const trackTargets: TrackTarget[] = ['wall', 'all-lyres', 'lyre-1', 'lyre-2', 'lyre-3', 'lyre-4', 'static-1'];
  const patterns: PatternName[] = [
    'radial_ripple', 'gradient_sweep', 'strobe_flash', 'equalizer', 'solid',
    'black', 'guitar_intro', 'intro_ticks', 'blue_star_burst',
    'cosmo_singer_intro', 'quadrant_flashes', 'quadrant_flashes_no_mask',
    'laser_sweeps', 'reactive_drop', 'reactive_drop_text', 'reactive_drop_character',
    'custom',
  ];
  const fixturePresets: FixturePreset[] = [
    'lyre_waltz', 'lyre_rise', 'lyre_trap', 'black', 'lyre_intro',
    'lyre_kick_pulse', 'lyre_circle_color', 'lyre_buildup_strobe', 'lyre_drop_trap',
  ];
  const staticPresets: StaticPreset[] = [
    'static_off', 'static_measure_pulse', 'static_snare_flash',
    'static_dimmer_rise', 'static_drop_strobe',
  ];

  return value.tracks.every((track) => {
    if (!isRecord(track) || !Array.isArray(track.clips)) return false;
    if (typeof track.id !== 'string' || typeof track.name !== 'string') return false;
    if (!trackKinds.includes(track.kind as TrackKind) || !trackTargets.includes(track.target as TrackTarget)) return false;
    if (typeof track.color !== 'string' || typeof track.muted !== 'boolean' || typeof track.locked !== 'boolean') return false;

    return track.clips.every((clip) => {
      if (!isRecord(clip) || !hasValidBaseClip(clip, durationFrames)) return false;
      if (clip.effectParams !== undefined) {
        if (!isRecord(clip.effectParams)) return false;
        if (!hasNumericProperties(clip.effectParams, ['intensity', 'speed', 'strobe'])) return false;
        if (typeof clip.effectParams.color !== 'string') return false;
      }

      if (clip.kind === 'pattern') {
        if (track.kind !== 'screen' || !patterns.includes(clip.pattern as PatternName)) return false;
        if (clip.color !== undefined && typeof clip.color !== 'string') return false;
        if (clip.code !== undefined && typeof clip.code !== 'string') return false;
        if (clip.lyrics !== undefined) {
          if (!isRecord(clip.lyrics) || !Array.isArray(clip.lyrics.lines) || clip.lyrics.lines.length !== 2) return false;
          if (!clip.lyrics.lines.every((line) => typeof line === 'string')) return false;
          if (!isFiniteNumber(clip.lyrics.cueStartTime) || typeof clip.lyrics.accent !== 'string') return false;
        }
        return true;
      }

      if (clip.kind === 'element') {
        if (track.kind !== 'screen' || (clip.shape !== 'rectangle' && clip.shape !== 'ellipse')) return false;
        if (!Array.isArray(clip.keyframes)) return false;
        return clip.keyframes.every((keyframe) => isValidKeyframe(
          keyframe,
          ['x', 'y', 'width', 'height', 'rotation', 'opacity'],
          true,
        ));
      }

      if (clip.kind === 'fixture') {
        if (track.kind !== 'fixture' || !Array.isArray(clip.keyframes)) return false;
        if (clip.preset !== undefined && !fixturePresets.includes(clip.preset as FixturePreset)) return false;
        return clip.keyframes.every((keyframe) => isValidKeyframe(
          keyframe,
          ['pan', 'tilt', 'dimmer', 'strobe', 'colorWheel'],
        ));
      }

      if (clip.kind === 'projector') {
        if (track.kind !== 'projector' || !Array.isArray(clip.keyframes)) return false;
        if (clip.preset !== undefined && !staticPresets.includes(clip.preset as StaticPreset)) return false;
        return clip.keyframes.every((keyframe) => isValidKeyframe(
          keyframe,
          ['red', 'green', 'blue', 'white', 'intensity'],
        ));
      }

      return false;
    });
  });
}

export function cloneShow(show: ShowDocument): ShowDocument {
  return structuredClone(show);
}

export function clampShowFrame(show: ShowDocument, frame: number): number {
  return Math.max(0, Math.min(show.durationFrames, Math.round(frame)));
}
