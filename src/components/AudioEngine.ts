export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private isPlaying = false;
  private startTime = 0;
  private pauseTime = 0;
  private playTimeout: NodeJS.Timeout | null = null;
  private scheduleInterval: NodeJS.Timeout | null = null;
  private tempo = 120; // BPM
  private beatDuration = 60 / this.tempo; // seconds per beat
  private lastScheduledBeat = -1;

  public onBeatCallback: (beatCount: number, time: number) => void = () => {};

  constructor() {}

  public getAudioContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public getPlaybackTime(): number {
    if (!this.isPlaying) return this.pauseTime;
    if (!this.ctx) return 0;
    return this.ctx.currentTime - this.startTime;
  }

  public play(onUpdate: (time: number) => void): void {
    if (this.isPlaying) return;
    
    const audioCtx = this.getAudioContext();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    this.isPlaying = true;
    this.startTime = audioCtx.currentTime - this.pauseTime;
    this.lastScheduledBeat = Math.floor(this.pauseTime / this.beatDuration) - 1;

    // Start playback tracker loop
    const tick = () => {
      if (!this.isPlaying) return;
      onUpdate(this.getPlaybackTime());
      this.playTimeout = setTimeout(tick, 30);
    };
    tick();

    // Start audio scheduling loop (synthesizes audio notes on the fly)
    this.startScheduler();
  }

  public pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.pauseTime = this.getPlaybackTime();
    
    if (this.playTimeout) {
      clearTimeout(this.playTimeout);
      this.playTimeout = null;
    }
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
      this.scheduleInterval = null;
    }
  }

  public stop(): void {
    this.pause();
    this.pauseTime = 0;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  private startScheduler(): void {
    const audioCtx = this.getAudioContext();
    const scheduleLookahead = 0.15; // Schedule 150ms in advance
    
    const schedule = () => {
      const now = audioCtx.currentTime;
      const playTime = now - this.startTime;
      const currentBeat = Math.floor(playTime / this.beatDuration);

      if (currentBeat > this.lastScheduledBeat) {
        const beatTime = this.startTime + (currentBeat + 1) * this.beatDuration;
        
        // Only schedule if the beat is within our lookahead window
        if (beatTime < now + scheduleLookahead) {
          this.lastScheduledBeat = currentBeat + 1;
          this.synthesizeBeat(this.lastScheduledBeat, beatTime);
          this.onBeatCallback(this.lastScheduledBeat, beatTime - this.startTime);
        }
      }
    };

    schedule();
    this.scheduleInterval = setInterval(schedule, 40);
  }

  /**
   * Procedural Audio Synthesizer: Austria Neo-Classical Theme
   * Synthesizes notes on the fly according to the beat number.
   * Intro (beat 0-24): Waltz classical pad (C minor waltz)
   * Drop (beat 24-70): Heavy drum beats + aggressive bass + lead melody (Mozart Lacrimosa motif)
   */
  private synthesizeBeat(beat: number, time: number): void {
    const ctx = this.getAudioContext();
    if (!this.analyser) return;

    // Check show duration limit (~35 seconds -> ~70 beats at 120BPM)
    if (beat > 72) {
      this.stop();
      return;
    }

    const isDrop = beat >= 24; // drop starts at beat 24 (~12 seconds)

    // --- SYNTHESIZE DRUMS ---
    if (isDrop) {
      // Kick drum on beat 1 and 3 (in 4/4)
      if (beat % 2 === 0) {
        this.playKick(time);
      }
      // Snare / Clap on beat 2 and 4
      if (beat % 4 === 2) {
        this.playSnare(time);
      }
      // Hi-hats on off-beats
      this.playHiHat(time + this.beatDuration / 2);
    } else {
      // Waltz Beat (3/4 time)
      // Kick on 1, chord stabs on 2 and 3
      const waltzBeat = beat % 3;
      if (waltzBeat === 0) {
        this.playKick(time);
      } else {
        this.playWaltzStab(time, beat);
      }
    }

    // --- SYNTHESIZE BASS & MELODY ---
    if (isDrop) {
      // Trap Bassline (C minor progression: C, Eb, G, Ab)
      const bassRoots = [32.70, 38.89, 48.99, 51.91]; // C1, Eb1, G1, Ab1
      const rootIndex = Math.floor(beat / 8) % bassRoots.length;
      this.playBassNode(time, bassRoots[rootIndex], this.beatDuration * 0.8);

      // Lead melody: Mozart's Lacrimosa motif
      // Notes: D, Eb, D, C, B, C, D...
      const melody = [
        74, 75, 74, 72, 71, 72, 74, 72, // Part 1
        75, 77, 75, 74, 73, 74, 75, 74  // Part 2
      ];
      const note = melody[beat % melody.length];
      const freq = 440 * Math.pow(2, (note - 69) / 12);
      this.playLeadNote(time, freq, this.beatDuration * 0.9);
    } else {
      // Slow imperial string pad intro
      const chordRoots = [130.81, 155.56, 196.00, 207.65]; // C3, Eb3, G3, Ab3
      const rootIndex = Math.floor(beat / 6) % chordRoots.length;
      this.playStringPad(time, chordRoots[rootIndex], this.beatDuration * 2);
    }
  }

  // --- AUDIO SYNTHESIS INSTRUMENTS ---

  private playKick(time: number): void {
    if (!ctx || !this.analyser) return;
    const ctx = this.getAudioContext();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(this.analyser);

    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.3);

    gain.gain.setValueAtTime(1.0, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);

    osc.start(time);
    osc.stop(time + 0.32);
  }

  private playSnare(time: number): void {
    const ctx = this.getAudioContext();
    if (!this.analyser) return;

    // Snare noise buffer
    const bufferSize = ctx.sampleRate * 0.2; // 0.2s duration
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1000, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

    noise.connect(noiseFilter);
    noiseFilter.connect(gain);
    gain.connect(this.analyser);

    // Add a snap tone oscillator
    const snap = ctx.createOscillator();
    snap.type = 'triangle';
    snap.frequency.setValueAtTime(180, time);
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.5, time);
    snapGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
    
    snap.connect(snapGain);
    snapGain.connect(this.analyser);

    noise.start(time);
    noise.stop(time + 0.21);
    
    snap.start(time);
    snap.stop(time + 0.11);
  }

  private playHiHat(time: number): void {
    const ctx = this.getAudioContext();
    if (!this.analyser) return;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(10000, time);

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7000, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.analyser);

    osc.start(time);
    osc.stop(time + 0.06);
  }

  private playBassNode(time: number, freq: number, duration: number): void {
    const ctx = this.getAudioContext();
    if (!this.analyser) return;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    // Low-pass filter for fat 808-style bass
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(150, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.analyser);

    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  private playLeadNote(time: number, freq: number, duration: number): void {
    const ctx = this.getAudioContext();
    if (!this.analyser) return;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + duration);

    // Chorus/detune effect oscillator
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(freq + 4, time);
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.15, time);
    gain2.gain.exponentialRampToValueAtTime(0.01, time + duration);

    osc.connect(gain);
    gain.connect(this.analyser);

    osc2.connect(gain2);
    gain2.connect(this.analyser);

    osc.start(time);
    osc.stop(time + duration + 0.05);

    osc2.start(time);
    osc2.stop(time + duration + 0.05);
  }

  private playWaltzStab(time: number, beat: number): void {
    const ctx = this.getAudioContext();
    if (!this.analyser) return;

    // Play a classical chord (C minor or similar depending on progression)
    const chords = [
      [261.63, 311.13, 392.00], // C minor (C4, Eb4, G4)
      [261.63, 311.13, 415.30], // Ab major (C4, Eb4, Ab4)
      [293.66, 349.23, 440.00], // D dim / F minor variation
      [246.94, 293.66, 392.00]  // G major (B3, D4, G4)
    ];

    const chordIndex = Math.floor(beat / 6) % chords.length;
    const notes = chords[chordIndex];

    notes.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);

      osc.connect(gain);
      gain.connect(this.analyser);

      osc.start(time);
      osc.stop(time + 0.45);
    });
  }

  private playStringPad(time: number, freq: number, duration: number): void {
    const ctx = this.getAudioContext();
    if (!this.analyser) return;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.linearRampToValueAtTime(0.3, time + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.01, time + duration);

    osc.connect(gain);
    gain.connect(this.analyser);

    osc.start(time);
    osc.stop(time + duration + 0.05);
  }
}
export const synthInstance = new AudioEngine();
