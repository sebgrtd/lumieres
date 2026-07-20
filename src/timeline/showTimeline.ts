export interface EffectParams {
  intensity: number;
  color: string;
  speed: number;
  strobe: number;
}

export interface TimelineBlock {
  id: string;
  lane: 'wall' | 'lyres' | 'static';
  startTime: number;
  endTime: number;
  type: string;
  name: string;
  params?: EffectParams;
}

export const SHOW_DURATION_SECONDS = 45;

export const SHOW_TIMELINE: TimelineBlock[] = [
  { id: '16', lane: 'wall', startTime: 0, endTime: 9.175, type: 'cosmo_singer_intro', name: 'Plan 01 — Portrait COSMÓ' },
  { id: '17', lane: 'lyres', startTime: 0, endTime: 3.0, type: 'lyre_buildup_strobe', name: 'Lyres Strobe Crescendo' },
  { id: '18', lane: 'static', startTime: 0, endTime: 3.0, type: 'static_dimmer_rise', name: 'Spot Dimmer Rise' },

  { id: '19', lane: 'wall', startTime: 9.2, endTime: 10.825, type: 'reactive_drop_text', name: 'Plan 02A — HEY / HEY!' },
  { id: '19-character-1', lane: 'wall', startTime: 10.85, endTime: 16.575, type: 'reactive_drop_character', name: 'Plan 02B — Personnage COSMÓ' },
  { id: '19-text-2', lane: 'wall', startTime: 16.6, endTime: 18.225, type: 'reactive_drop_text', name: 'Plan 02C — HEY / HEY!' },
  { id: '19-character-2', lane: 'wall', startTime: 18.25, endTime: 23.325, type: 'reactive_drop_character', name: 'Plan 02D — Personnage COSMÓ' },
  { id: '20', lane: 'lyres', startTime: 3.0, endTime: 26.0, type: 'lyre_drop_trap', name: 'Lyres Mirror Trap Chases' },
  { id: '21', lane: 'static', startTime: 3.0, endTime: 26.0, type: 'static_drop_strobe', name: 'Spot Strobe Drop' },

  { id: '25', lane: 'wall', startTime: 23.35, endTime: 24.975, type: 'quadrant_flashes_no_mask', name: 'Plan 03A — TANZ / SCHEIN' },
  { id: '25-2', lane: 'wall', startTime: 25, endTime: 27.325, type: 'quadrant_flashes_no_mask', name: 'Plan 03B — STRENG / SEIN' },
  { id: '25-3', lane: 'wall', startTime: 27.35, endTime: 29.525, type: 'quadrant_flashes_no_mask', name: 'Plan 03C — TANZ / SCHEIN' },
  { id: '25-4', lane: 'wall', startTime: 29.55, endTime: 30.925, type: 'quadrant_flashes_no_mask', name: 'Plan 03D — NICHT / REIN' },
  { id: '25-5', lane: 'wall', startTime: 30.95, endTime: 33.125, type: 'quadrant_flashes_no_mask', name: 'Plan 03E — TANZ / SCHEIN' },
  { id: '25-6', lane: 'wall', startTime: 33.15, endTime: 34.725, type: 'quadrant_flashes_no_mask', name: 'Plan 03F — WITZ / SEIN' },
  { id: '25-7', lane: 'wall', startTime: 34.75, endTime: 37.025, type: 'quadrant_flashes_no_mask', name: 'Plan 03G — TANZ / SCHEIN' },
  { id: '25-8', lane: 'wall', startTime: 37.05, endTime: 39.075, type: 'quadrant_flashes_no_mask', name: 'Plan 03H — NICHT / REIN' },
  { id: '26', lane: 'lyres', startTime: 26.0, endTime: 32.0, type: 'lyre_circle_color', name: 'Lyres Color Circular' },
  { id: '27', lane: 'static', startTime: 26.0, endTime: 32.0, type: 'static_snare_flash', name: 'Spot Magenta Snare Flash' },

  { id: '28', lane: 'wall', startTime: 39.1, endTime: 45.0, type: 'laser_sweeps', name: 'Plan 04 — Final lasers' },
  { id: '29', lane: 'lyres', startTime: 32.0, endTime: 40.0, type: 'lyre_buildup_strobe', name: 'Lyres Strobe Crescendo 2' },
  { id: '30', lane: 'static', startTime: 32.0, endTime: 40.0, type: 'static_dimmer_rise', name: 'Spot Dimmer Rise 2' },

  { id: '32', lane: 'lyres', startTime: 40.0, endTime: SHOW_DURATION_SECONDS, type: 'lyre_drop_trap', name: 'Lyres Mirror Trap Chases 2' },
  { id: '33', lane: 'static', startTime: 40.0, endTime: SHOW_DURATION_SECONDS, type: 'static_drop_strobe', name: 'Spot Strobe Drop 2' },
];
