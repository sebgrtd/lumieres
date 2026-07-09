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
  { id: '16', lane: 'wall', startTime: 0, endTime: 3.0, type: 'laser_sweeps', name: 'Tanzschein Laser Sweeps' },
  { id: '17', lane: 'lyres', startTime: 0, endTime: 3.0, type: 'lyre_buildup_strobe', name: 'Lyres Strobe Crescendo' },
  { id: '18', lane: 'static', startTime: 0, endTime: 3.0, type: 'static_dimmer_rise', name: 'Spot Dimmer Rise' },

  { id: '19', lane: 'wall', startTime: 3.0, endTime: 26.0, type: 'reactive_drop', name: 'Tanzschein Chorus Drop' },
  { id: '20', lane: 'lyres', startTime: 3.0, endTime: 26.0, type: 'lyre_drop_trap', name: 'Lyres Mirror Trap Chases' },
  { id: '21', lane: 'static', startTime: 3.0, endTime: 26.0, type: 'static_drop_strobe', name: 'Spot Strobe Drop' },

  { id: '25', lane: 'wall', startTime: 26.0, endTime: 32.0, type: 'quadrant_flashes', name: 'Quadrant Controller Flash' },
  { id: '26', lane: 'lyres', startTime: 26.0, endTime: 32.0, type: 'lyre_circle_color', name: 'Lyres Color Circular' },
  { id: '27', lane: 'static', startTime: 26.0, endTime: 32.0, type: 'static_snare_flash', name: 'Spot Magenta Snare Flash' },

  { id: '28', lane: 'wall', startTime: 32.0, endTime: 40.0, type: 'laser_sweeps', name: 'Tanzschein Laser Sweeps 2' },
  { id: '29', lane: 'lyres', startTime: 32.0, endTime: 40.0, type: 'lyre_buildup_strobe', name: 'Lyres Strobe Crescendo 2' },
  { id: '30', lane: 'static', startTime: 32.0, endTime: 40.0, type: 'static_dimmer_rise', name: 'Spot Dimmer Rise 2' },

  { id: '31', lane: 'wall', startTime: 40.0, endTime: SHOW_DURATION_SECONDS, type: 'reactive_drop', name: 'Tanzschein Chorus Drop 2' },
  { id: '32', lane: 'lyres', startTime: 40.0, endTime: SHOW_DURATION_SECONDS, type: 'lyre_drop_trap', name: 'Lyres Mirror Trap Chases 2' },
  { id: '33', lane: 'static', startTime: 40.0, endTime: SHOW_DURATION_SECONDS, type: 'static_drop_strobe', name: 'Spot Strobe Drop 2' },
];
