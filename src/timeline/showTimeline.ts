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
  { id: '1', lane: 'wall', startTime: 0, endTime: 2.2, type: 'guitar_intro', name: 'Guitar Intro' },
  { id: '2', lane: 'lyres', startTime: 0, endTime: 2.2, type: 'black', name: 'Lyres Off' },
  { id: '3', lane: 'static', startTime: 0, endTime: 2.2, type: 'static_off', name: 'Spotlight Off' },

  { id: '4', lane: 'wall', startTime: 2.2, endTime: 5.0, type: 'intro_ticks', name: 'Intro Claps' },
  { id: '5', lane: 'lyres', startTime: 2.2, endTime: 5.0, type: 'lyre_intro', name: 'Intro Silver Sweep' },
  { id: '6', lane: 'static', startTime: 2.2, endTime: 5.0, type: 'static_off', name: 'Spotlight Off' },

  { id: '7', lane: 'wall', startTime: 5.0, endTime: 5.9, type: 'black', name: 'Temps Mort' },
  { id: '8', lane: 'lyres', startTime: 5.0, endTime: 5.9, type: 'black', name: 'Temps Mort' },
  { id: '9', lane: 'static', startTime: 5.0, endTime: 5.9, type: 'static_off', name: 'Temps Mort' },

  { id: '10', lane: 'wall', startTime: 5.9, endTime: 13.3, type: 'blue_star_burst', name: 'COSMO Blue Star' },
  { id: '11', lane: 'lyres', startTime: 5.9, endTime: 13.3, type: 'lyre_kick_pulse', name: 'Lyres Kick Snap' },
  { id: '12', lane: 'static', startTime: 5.9, endTime: 13.3, type: 'static_measure_pulse', name: 'Spot Blue Pulse' },

  { id: '13', lane: 'wall', startTime: 13.3, endTime: 20.7, type: 'quadrant_flashes', name: 'Quadrant Flash' },
  { id: '14', lane: 'lyres', startTime: 13.3, endTime: 20.7, type: 'lyre_circle_color', name: 'Lyres Color Circle' },
  { id: '15', lane: 'static', startTime: 13.3, endTime: 20.7, type: 'static_snare_flash', name: 'Spot Magenta Snare' },

  { id: '16', lane: 'wall', startTime: 20.7, endTime: 28.0, type: 'laser_sweeps', name: 'Tanzschein Lasers' },
  { id: '17', lane: 'lyres', startTime: 20.7, endTime: 28.0, type: 'lyre_buildup_strobe', name: 'Lyres Buildup Strobe' },
  { id: '18', lane: 'static', startTime: 20.7, endTime: 28.0, type: 'static_dimmer_rise', name: 'Spot Dimmer Rise' },

  { id: '19', lane: 'wall', startTime: 28.0, endTime: SHOW_DURATION_SECONDS, type: 'reactive_drop', name: 'Tanzschein Drop' },
  { id: '20', lane: 'lyres', startTime: 28.0, endTime: SHOW_DURATION_SECONDS, type: 'lyre_drop_trap', name: 'Lyres Mirrored Chases' },
  { id: '21', lane: 'static', startTime: 28.0, endTime: SHOW_DURATION_SECONDS, type: 'static_drop_strobe', name: 'Spot Strobe Drop' },
];
