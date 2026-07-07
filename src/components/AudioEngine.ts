export class AudioEngine {
  private audio: HTMLAudioElement | null = null;
  private isPlaying = false;
  
  // Software offset in seconds to skip the silence at the beginning of the MP3.
  // Aligned with the beginning of the guitar intro at 5.0s, shifted 25s forward.
  private readonly AUDIO_START_OFFSET = 30.0;

  constructor() {
    // Create HTML5 Audio element referencing the public copied MP3
    this.audio = new Audio('/tanzschein.mp3');
  }

  public play(startTime: number, onUpdate: (time: number) => void): void {
    if (this.isPlaying || !this.audio) return;
    this.isPlaying = true;
    
    const targetTime = this.AUDIO_START_OFFSET + startTime;

    const startPlay = () => {
      if (!this.audio) return;
      this.audio.currentTime = targetTime;
      this.audio.play().catch(e => {
        console.error("Audio playback failed:", e);
      });
    };

    // HTML5 Audio requires metadata to be loaded before we can set currentTime.
    // If not loaded yet, wait for loadedmetadata event, otherwise play immediately.
    if (this.audio.readyState >= 1) { // HAVE_METADATA
      startPlay();
    } else {
      this.audio.addEventListener('loadedmetadata', startPlay, { once: true });
    }

    const tick = () => {
      if (!this.isPlaying || !this.audio) return;
      
      const playbackTime = this.getPlaybackTime();
      onUpdate(playbackTime);
      
      // Volume Fade In/Out (1.5 seconds)
      let volume = 1.0;
      if (playbackTime < 1.5) {
        volume = playbackTime / 1.5;
      } else if (playbackTime > 43.5) {
        volume = Math.max(0, (45.0 - playbackTime) / 1.5);
      }
      this.audio.volume = volume;

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  public pause(): void {
    if (!this.isPlaying || !this.audio) return;
    this.isPlaying = false;
    this.audio.pause();
  }

  public stop(): void {
    this.pause();
    if (this.audio) {
      this.audio.currentTime = this.AUDIO_START_OFFSET;
    }
  }

  public getPlaybackTime(): number {
    return this.audio ? Math.max(0, this.audio.currentTime - this.AUDIO_START_OFFSET) : 0;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public syncTime(serverTime: number): void {
    if (!this.isPlaying || !this.audio) return;
    const targetTime = this.AUDIO_START_OFFSET + serverTime;
    const diff = Math.abs(this.audio.currentTime - targetTime);
    
    // Only seek if the difference is more than 1.0s to avoid HTML5 audio stuttering
    // (Constant seeking triggers browser re-buffering and causes looping/repetition)
    if (diff > 1.0) {
      console.log(`[AudioEngine] Syncing audio drift: client=${this.audio.currentTime.toFixed(3)}s, target=${targetTime.toFixed(3)}s (diff=${(diff * 1000).toFixed(0)}ms)`);
      this.audio.currentTime = targetTime;
    }
  }
}

export const synthInstance = new AudioEngine();
