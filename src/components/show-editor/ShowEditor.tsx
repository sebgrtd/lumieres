import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Circle,
  Copy,
  Diamond,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  Lightbulb,
  Lock,
  Monitor,
  Move,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Save,
  SkipBack,
  Sparkles,
  Square,
  Trash2,
  Unlock,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  createElementKeyframe,
  createFixtureKeyframe,
  createProjectorKeyframe,
  getClipLocalFrame,
  getElementStateAtFrame,
  getFixtureStateAtFrame,
  getProjectorStateAtFrame,
  prepareShowFrame,
  renderShowFrame,
} from '../../show/showEngine.ts';
import {
  clampShowFrame,
  cloneShow,
  createBlankShow,
  isShowDocument,
  type ElementClip,
  type ElementKeyframe,
  type ElementState,
  type FixtureClip,
  type FixtureKeyframe,
  type FixtureState,
  type PatternClip,
  type ProjectorClip,
  type ProjectorKeyframe,
  type ProjectorState,
  type ShowClip,
  type ShowDocument,
  type ShowTrack,
  type TrackKind,
  type TrackTarget,
} from '../../types/show.ts';
import './ShowEditor.css';

interface ShowEditorProps {
  show: ShowDocument;
  dirty: boolean;
  connected: boolean;
  serverPlaying: boolean;
  serverTime: number;
  onChange: (show: ShowDocument) => void;
  onSave: (show: ShowDocument) => Promise<boolean>;
  onGoLive: (show: ShowDocument, frame: number) => Promise<void>;
  onStopLive: () => void;
  onLog: (message: string) => void;
}

interface Selection {
  track: ShowTrack;
  clip: ShowClip;
}

interface DragState {
  clipId: string;
  mode: 'move' | 'trim-start' | 'trim-end';
  pointerX: number;
  startFrame: number;
  endFrame: number;
}

interface NewProjectDraft {
  name: string;
  fps: number;
  durationSeconds: number;
}

interface NumberFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}

const TRACK_LABELS: Record<TrackKind, string> = {
  screen: 'Écran',
  fixture: 'Lyres',
  projector: 'Projecteur',
};

const PATTERN_LABELS: Record<PatternClip['pattern'], string> = {
  radial_ripple: 'Ondes radiales',
  gradient_sweep: 'Balayage drapeau',
  strobe_flash: 'Strobe autrichien',
  equalizer: 'Spectre audio',
  solid: 'Aplat de couleur',
  black: 'Écran noir',
  guitar_intro: 'Intro guitare COSMÓ',
  intro_ticks: 'Ticks intro COSMÓ',
  blue_star_burst: 'Étoile COSMÓ',
  quadrant_flashes: 'Flash quadrants',
  laser_sweeps: 'Lasers Tanzschein',
  reactive_drop: 'Drop Tanzschein',
  custom: 'Motif personnalisé (JS)',
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function findSelection(show: ShowDocument, clipId: string | null): Selection | null {
  if (!clipId) return null;
  for (const track of show.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function formatTimecode(frame: number, fps: number): string {
  const safeFrame = Math.max(0, Math.round(frame));
  const totalSeconds = Math.floor(safeFrame / fps);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const frames = safeFrame % fps;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

function getClipKeyframes(clip: ShowClip): Array<{ frame: number }> {
  if (clip.kind === 'pattern') return [];
  return clip.keyframes;
}

function fixtureColor(colorWheel: number): string {
  if (colorWheel >= 120) return '#f0b429';
  if (colorWheel >= 75) return '#52d3ff';
  if (colorWheel >= 35) return '#f6f3e8';
  if (colorWheel > 0) return '#ef3340';
  return '#f7f5ee';
}

function NumberField({ label, value, min, max, step = 1, suffix, onChange }: NumberFieldProps) {
  return (
    <label className="se-number-field">
      <span>{label}</span>
      <span className="se-number-input-wrap">
        <input
          type="number"
          value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

function upsertKeyframe<T extends { frame: number }>(keyframes: T[], keyframe: T): T[] {
  const existingIndex = keyframes.findIndex((candidate) => candidate.frame === keyframe.frame);
  const next = [...keyframes];
  if (existingIndex >= 0) next[existingIndex] = keyframe;
  else next.push(keyframe);
  return next.sort((a, b) => a.frame - b.frame);
}

function ensureTrack(
  show: ShowDocument,
  options: { id?: string; name: string; kind: TrackKind; target: TrackTarget; color: string; alwaysCreate?: boolean },
): ShowTrack {
  if (!options.alwaysCreate) {
    const existing = show.tracks.find((track) => track.kind === options.kind && track.target === options.target && track.id === options.id);
    if (existing) return existing;
  }

  const track: ShowTrack = {
    id: options.id ?? createId(`${options.kind}-track`),
    name: options.name,
    kind: options.kind,
    target: options.target,
    color: options.color,
    muted: false,
    locked: false,
    clips: [],
  };
  show.tracks.push(track);
  return track;
}
const audioBufferCache = new Map<string, AudioBuffer>();

function useAudioWaveform(audioPath: string | undefined, durationFrames: number, fps: number, zoom: number) {
  const [waveform, setWaveform] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!audioPath || audioPath === 'none' || audioPath === '') {
      setWaveform([]);
      return;
    }

    let active = true;

    const loadWaveform = async () => {
      setLoading(true);
      try {
        let audioBuffer = audioBufferCache.get(audioPath);
        
        if (!audioBuffer) {
          const response = await fetch(audioPath);
          if (!response.ok) throw new Error("Audio file not found");
          const arrayBuffer = await response.arrayBuffer();
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          audioBufferCache.set(audioPath, audioBuffer);
        }

        if (!active) return;

        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const AUDIO_START_OFFSET = audioPath.includes('tanzschein') ? 30.0 : 0.0;
        
        const startSample = Math.floor(AUDIO_START_OFFSET * sampleRate);
        const durationSamples = Math.floor((durationFrames / fps) * sampleRate);
        const endSample = Math.min(channelData.length, startSample + durationSamples);
        const totalSamples = Math.max(1, endSample - startSample);

        const totalWidth = durationFrames * zoom;
        const numBars = Math.max(50, Math.floor(totalWidth / 6));
        
        const blockSize = Math.max(1, Math.floor(totalSamples / numBars));
        const peaks: number[] = [];
        
        for (let i = 0; i < numBars; i++) {
          const start = startSample + i * blockSize;
          const end = Math.min(endSample, start + blockSize);
          let maxVal = 0;
          for (let j = start; j < end; j++) {
            const val = Math.abs(channelData[j]);
            if (val > maxVal) maxVal = val;
          }
          peaks.push(maxVal);
        }
        
        const maxPeak = Math.max(...peaks, 0.01);
        const normalized = peaks.map(p => Math.max(12, Math.round((p / maxPeak) * 85)));
        
        if (active) {
          setWaveform(normalized);
        }
      } catch (err) {
        console.error("Failed to decode audio waveform:", err);
        const totalWidth = durationFrames * zoom;
        const numBars = Math.max(50, Math.floor(totalWidth / 6));
        const fallback: number[] = [];
        for (let i = 0; i < numBars; i++) {
          const val = Math.sin(i * 0.1) * 0.4 + Math.sin(i * 0.03) * 0.3 + 0.3;
          fallback.push(Math.max(12, Math.round(val * 80)));
        }
        if (active) {
          setWaveform(fallback);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadWaveform();

    return () => {
      active = false;
    };
  }, [audioPath, durationFrames, fps, zoom]);

  return { waveform, loading };
}

export function ShowEditor({
  show,
  dirty,
  connected,
  serverPlaying,
  serverTime,
  onChange,
  onSave,
  onGoLive,
  onStopLive,
  onLog,
}: ShowEditorProps) {
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(() => show.tracks[0]?.clips[0]?.id ?? null);
  const [zoom, setZoom] = useState(0.9);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectDraft, setNewProjectDraft] = useState<NewProjectDraft>({
    name: 'Mon animation écran',
    fps: 40,
    durationSeconds: 20,
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const showRef = useRef(show);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    showRef.current = show;
    setPlayheadFrame((frame) => clampShowFrame(show, frame));
  }, [show]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!serverPlaying) return;
    setPreviewPlaying(false);
    setPlayheadFrame(clampShowFrame(show, serverTime * show.fps));
  }, [serverPlaying, serverTime, show]);

  useEffect(() => {
    if (!previewPlaying) return;
    const originFrame = playheadFrame;
    const originTime = performance.now();
    let animationFrame = 0;

    const tick = (now: number) => {
      const elapsedFrames = Math.floor(((now - originTime) / 1000) * show.fps);
      const nextFrame = (originFrame + elapsedFrames) % (show.durationFrames + 1);
      setPlayheadFrame(nextFrame);
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [previewPlaying, show.durationFrames, show.fps]);

  const selection = useMemo(() => findSelection(show, selectedClipId), [show, selectedClipId]);
  const preparedFrame = useMemo(() => prepareShowFrame(show, playheadFrame), [show, playheadFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const rendered = renderShowFrame(show, playheadFrame, 64, 64, true);
    const imageData = context.createImageData(rendered.width, rendered.height);
    imageData.data.set(rendered.pixels);
    context.imageSmoothingEnabled = false;
    context.putImageData(imageData, 0, 0);
  }, [show, playheadFrame]);

  const applyMutation = (mutate: (next: ShowDocument) => void) => {
    const next = cloneShow(showRef.current);
    mutate(next);
    showRef.current = next;
    onChange(next);
  };

  const updateSelectedClip = (mutate: (clip: ShowClip, track: ShowTrack) => void) => {
    if (!selectedClipId) return;
    applyMutation((next) => {
      const selected = findSelection(next, selectedClipId);
      if (selected) mutate(selected.clip, selected.track);
    });
  };

  const removeSelectedClip = () => {
    if (!selectedClipId) return;
    applyMutation((next) => {
      next.tracks.forEach((track) => {
        track.clips = track.clips.filter((clip) => clip.id !== selectedClipId);
      });
    });
    setSelectedClipId(null);
    onLog('Clip supprimé de la timeline.');
  };

  const duplicateSelectedClip = () => {
    if (!selection) return;
    const sourceId = selection.clip.id;
    let duplicatedId: string | null = null;
    applyMutation((next) => {
      const selected = findSelection(next, sourceId);
      if (!selected) return;
      const duplicate = structuredClone(selected.clip);
      const duration = duplicate.endFrame - duplicate.startFrame;
      duplicate.id = createId(`${duplicate.kind}-clip`);
      duplicate.name = `${duplicate.name} — copie`;
      duplicate.startFrame = Math.min(next.durationFrames, duplicate.startFrame + next.fps);
      duplicate.endFrame = Math.min(next.durationFrames, duplicate.startFrame + duration);
      selected.track.clips.push(duplicate);
      duplicatedId = duplicate.id;
    });
    if (duplicatedId) setSelectedClipId(duplicatedId);
  };

  const setTrackProperty = (trackId: string, property: 'muted' | 'locked', value: boolean) => {
    applyMutation((next) => {
      const track = next.tracks.find((candidate) => candidate.id === trackId);
      if (track) track[property] = value;
    });
  };

  const createNewProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fps = Math.max(1, Math.min(240, Math.round(newProjectDraft.fps)));
    const durationSeconds = Math.max(1, Math.min(600, newProjectDraft.durationSeconds));
    const next = createBlankShow({
      id: `show-${Date.now().toString(36)}`,
      name: newProjectDraft.name,
      fps,
      durationFrames: Math.round(fps * durationSeconds),
    });

    showRef.current = next;
    onChange(next);
    setSelectedClipId(null);
    setPlayheadFrame(0);
    setPreviewPlaying(false);
    setNewProjectOpen(false);
    onLog(`Projet vide créé : ${next.name} · ${durationSeconds} s · ${fps} FPS.`);
  };

  const clipWindow = (seconds: number) => {
    const startFrame = Math.min(playheadFrame, Math.max(0, show.durationFrames - 1));
    const endFrame = Math.min(show.durationFrames, startFrame + Math.max(1, Math.round(seconds * show.fps)));
    return { startFrame, endFrame };
  };

  const addElement = (preset: 'rectangle' | 'ellipse' | 'slide' | 'pulse' | 'orbit') => {
    const { startFrame, endFrame } = clipWindow(preset === 'rectangle' || preset === 'ellipse' ? 4 : 8);
    const loopFrames = Math.max(1, Math.min(endFrame - startFrame, show.fps * 2));
    const base: ElementState = {
      x: 64,
      y: 64,
      width: preset === 'ellipse' ? 38 : 52,
      height: preset === 'ellipse' ? 38 : 24,
      rotation: 0,
      opacity: 1,
      fill: '#f7f5ee',
    };
    let keyframes: ElementKeyframe[] = [createElementKeyframe(0, base, 'linear')];
    let name = preset === 'ellipse' ? 'Cercle écran' : 'Rectangle écran';

    if (preset === 'slide') {
      name = 'Bandeau ping-pong';
      keyframes = [
        createElementKeyframe(0, { ...base, x: -30, width: 44, fill: '#ef3340' }, 'ease-in-out'),
        createElementKeyframe(loopFrames / 2, { ...base, x: 158, width: 44, fill: '#ef3340' }, 'ease-in-out'),
        createElementKeyframe(loopFrames, { ...base, x: -30, width: 44, fill: '#ef3340' }, 'ease-in-out'),
      ];
    } else if (preset === 'pulse') {
      name = 'Pulse impérial';
      keyframes = [
        createElementKeyframe(0, { ...base, width: 18, height: 18, opacity: 0.35, fill: '#f0b429' }, 'ease-in-out'),
        createElementKeyframe(loopFrames / 2, { ...base, width: 92, height: 92, opacity: 1, fill: '#f0b429' }, 'ease-in-out'),
        createElementKeyframe(loopFrames, { ...base, width: 18, height: 18, opacity: 0.35, fill: '#f0b429' }, 'ease-in-out'),
      ];
    } else if (preset === 'orbit') {
      name = 'Orbite écran';
      keyframes = [
        createElementKeyframe(0, { ...base, x: 64, y: 20, width: 18, height: 18, fill: '#28c2ff' }, 'linear'),
        createElementKeyframe(loopFrames / 4, { ...base, x: 108, y: 64, width: 18, height: 18, fill: '#28c2ff' }, 'linear'),
        createElementKeyframe(loopFrames / 2, { ...base, x: 64, y: 108, width: 18, height: 18, fill: '#28c2ff' }, 'linear'),
        createElementKeyframe((loopFrames * 3) / 4, { ...base, x: 20, y: 64, width: 18, height: 18, fill: '#28c2ff' }, 'linear'),
        createElementKeyframe(loopFrames, { ...base, x: 64, y: 20, width: 18, height: 18, fill: '#28c2ff' }, 'linear'),
      ];
    }

    const clip: ElementClip = {
      id: createId('element'),
      name,
      kind: 'element',
      shape: preset === 'ellipse' || preset === 'pulse' || preset === 'orbit' ? 'ellipse' : 'rectangle',
      startFrame,
      endFrame,
      timeMode: 'clip',
      loop: { enabled: ['slide', 'pulse', 'orbit'].includes(preset), lengthFrames: loopFrames },
      keyframes,
    };

    applyMutation((next) => {
      const track = ensureTrack(next, {
        id: 'wall-elements',
        name: 'Éléments écran',
        kind: 'screen',
        target: 'wall',
        color: '#28c2ff',
      });
      track.clips.push(clip);
    });
    setSelectedClipId(clip.id);
    onLog(`${name} ajouté à la frame ${startFrame}.`);
  };

  const addBlankScreenAnimation = () => {
    const { startFrame, endFrame } = clipWindow(4);
    const clip: ElementClip = {
      id: createId('element'),
      name: 'Animation écran vide',
      kind: 'element',
      shape: 'rectangle',
      startFrame,
      endFrame,
      timeMode: 'clip',
      loop: { enabled: false, lengthFrames: Math.max(1, endFrame - startFrame) },
      keyframes: [
        createElementKeyframe(0, {
          x: 64,
          y: 64,
          width: 42,
          height: 24,
          rotation: 0,
          opacity: 1,
          fill: '#f7f5ee',
        }, 'ease-in-out'),
      ],
    };

    applyMutation((next) => {
      const track = ensureTrack(next, {
        id: 'wall-elements',
        name: 'Éléments écran',
        kind: 'screen',
        target: 'wall',
        color: '#28c2ff',
      });
      track.clips.push(clip);
    });
    setSelectedClipId(clip.id);
    onLog(`Animation écran vide ajoutée à la frame ${startFrame}. Pose tes keyframes dans l'inspecteur.`);
  };

  const addSolid = () => {
    const { startFrame, endFrame } = clipWindow(4);
    const clip: PatternClip = {
      id: createId('solid'),
      name: 'Aplat écran',
      kind: 'pattern',
      pattern: 'solid',
      color: '#ef3340',
      startFrame,
      endFrame,
      timeMode: 'clip',
      loop: { enabled: false, lengthFrames: Math.max(1, endFrame - startFrame) },
    };
    applyMutation((next) => {
      const track = ensureTrack(next, {
        name: 'Fond écran — création',
        kind: 'screen',
        target: 'wall',
        color: '#ef3340',
        alwaysCreate: true,
      });
      track.clips.push(clip);
      const currentIndex = next.tracks.indexOf(track);
      const elementTrackIndex = next.tracks.findIndex((candidate) => candidate.id === 'wall-elements');
      if (elementTrackIndex >= 0 && currentIndex > elementTrackIndex) {
        next.tracks.splice(currentIndex, 1);
        next.tracks.splice(elementTrackIndex, 0, track);
      }
    });
    setSelectedClipId(clip.id);
  };

  const addFixtureAnimation = (preset: 'sweep' | 'circle' | 'pulse') => {
    const { startFrame, endFrame } = clipWindow(8);
    const loopFrames = Math.max(1, Math.min(endFrame - startFrame, show.fps * 2));
    const base: FixtureState = { pan: 127, tilt: 127, dimmer: 255, strobe: 0, colorWheel: 135 };
    let keyframes: FixtureKeyframe[];
    let name: string;

    if (preset === 'circle') {
      name = 'Cercle lyres';
      keyframes = [
        createFixtureKeyframe(0, { ...base, pan: 127, tilt: 50 }, 'linear'),
        createFixtureKeyframe(loopFrames / 4, { ...base, pan: 210, tilt: 127 }, 'linear'),
        createFixtureKeyframe(loopFrames / 2, { ...base, pan: 127, tilt: 205 }, 'linear'),
        createFixtureKeyframe((loopFrames * 3) / 4, { ...base, pan: 45, tilt: 127 }, 'linear'),
        createFixtureKeyframe(loopFrames, { ...base, pan: 127, tilt: 50 }, 'linear'),
      ];
    } else if (preset === 'pulse') {
      name = 'Pulse lyres';
      keyframes = [
        createFixtureKeyframe(0, { ...base, dimmer: 15, strobe: 0 }, 'hold'),
        createFixtureKeyframe(loopFrames / 2, { ...base, dimmer: 255, strobe: 220 }, 'hold'),
        createFixtureKeyframe(loopFrames, { ...base, dimmer: 15, strobe: 0 }, 'hold'),
      ];
    } else {
      name = 'Balayage lyres';
      keyframes = [
        createFixtureKeyframe(0, { ...base, pan: 25, tilt: 95, colorWheel: 15 }, 'ease-in-out'),
        createFixtureKeyframe(loopFrames / 2, { ...base, pan: 230, tilt: 180, colorWheel: 135 }, 'ease-in-out'),
        createFixtureKeyframe(loopFrames, { ...base, pan: 25, tilt: 95, colorWheel: 15 }, 'ease-in-out'),
      ];
    }

    const clip: FixtureClip = {
      id: createId('fixture'),
      name,
      kind: 'fixture',
      startFrame,
      endFrame,
      timeMode: 'clip',
      loop: { enabled: true, lengthFrames: loopFrames },
      keyframes,
    };
    applyMutation((next) => {
      const track = ensureTrack(next, {
        name: 'Lyres — création',
        kind: 'fixture',
        target: 'all-lyres',
        color: '#f0b429',
        alwaysCreate: true,
      });
      track.clips.push(clip);
    });
    setSelectedClipId(clip.id);
    onLog(`${name} ajouté avec une boucle de ${loopFrames} frames.`);
  };

  const addBlankFixtureAnimation = () => {
    const { startFrame, endFrame } = clipWindow(4);
    const clip: FixtureClip = {
      id: createId('fixture'),
      name: 'Animation lyres vide',
      kind: 'fixture',
      startFrame,
      endFrame,
      timeMode: 'clip',
      loop: { enabled: false, lengthFrames: Math.max(1, endFrame - startFrame) },
      keyframes: [
        createFixtureKeyframe(0, { pan: 127, tilt: 127, dimmer: 255, strobe: 0, colorWheel: 135 }, 'ease-in-out'),
      ],
    };

    applyMutation((next) => {
      const track = ensureTrack(next, {
        name: 'Lyres — création libre',
        kind: 'fixture',
        target: 'all-lyres',
        color: '#f0b429',
        alwaysCreate: true,
      });
      track.clips.push(clip);
    });
    setSelectedClipId(clip.id);
    onLog(`Animation lyres vide ajoutée à la frame ${startFrame}.`);
  };

  const addProjectorAnimation = () => {
    const { startFrame, endFrame } = clipWindow(6);
    const loopFrames = Math.max(1, Math.min(endFrame - startFrame, show.fps * 2));
    const keyframes: ProjectorKeyframe[] = [
      createProjectorKeyframe(0, { red: 255, green: 15, blue: 20, white: 0, intensity: 30 }, 'ease-in-out'),
      createProjectorKeyframe(loopFrames / 2, { red: 255, green: 185, blue: 45, white: 100, intensity: 255 }, 'ease-in-out'),
      createProjectorKeyframe(loopFrames, { red: 255, green: 15, blue: 20, white: 0, intensity: 30 }, 'ease-in-out'),
    ];
    const clip: ProjectorClip = {
      id: createId('projector'),
      name: 'Fondu projecteur',
      kind: 'projector',
      startFrame,
      endFrame,
      timeMode: 'clip',
      loop: { enabled: true, lengthFrames: loopFrames },
      keyframes,
    };
    applyMutation((next) => {
      const track = ensureTrack(next, {
        name: 'Projecteur — création',
        kind: 'projector',
        target: 'static-1',
        color: '#f7f5ee',
        alwaysCreate: true,
      });
      track.clips.push(clip);
    });
    setSelectedClipId(clip.id);
  };

  const updateElement = (patch: Partial<ElementState>) => {
    if (!selection || selection.clip.kind !== 'element') return;
    const current = getElementStateAtFrame(selection.clip, playheadFrame);
    const localFrame = getClipLocalFrame(selection.clip, playheadFrame);
    updateSelectedClip((clip) => {
      if (clip.kind !== 'element') return;
      clip.keyframes = upsertKeyframe(
        clip.keyframes,
        createElementKeyframe(localFrame, { ...current, ...patch }, 'ease-in-out'),
      );
    });
  };

  const updateFixture = (patch: Partial<FixtureState>) => {
    if (!selection || selection.clip.kind !== 'fixture') return;
    const current = getFixtureStateAtFrame(selection.clip, show, playheadFrame, 0);
    const localFrame = getClipLocalFrame(selection.clip, playheadFrame);
    updateSelectedClip((clip) => {
      if (clip.kind !== 'fixture') return;
      clip.preset = undefined;
      clip.timeMode = 'clip';
      clip.keyframes = upsertKeyframe(
        clip.keyframes,
        createFixtureKeyframe(localFrame, { ...current, ...patch }, 'ease-in-out'),
      );
    });
  };

  const updateProjector = (patch: Partial<ProjectorState>) => {
    if (!selection || selection.clip.kind !== 'projector') return;
    const current = getProjectorStateAtFrame(selection.clip, playheadFrame);
    const localFrame = getClipLocalFrame(selection.clip, playheadFrame);
    updateSelectedClip((clip) => {
      if (clip.kind !== 'projector') return;
      clip.keyframes = upsertKeyframe(
        clip.keyframes,
        createProjectorKeyframe(localFrame, { ...current, ...patch }, 'ease-in-out'),
      );
    });
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const candidate: unknown = JSON.parse(await file.text());
      if (!isShowDocument(candidate)) throw new Error('Format de show non reconnu.');
      onChange(cloneShow(candidate));
      setSelectedClipId(candidate.tracks[0]?.clips[0]?.id ?? null);
      setPlayheadFrame(0);
      onLog(`Show importé : ${candidate.name}.`);
    } catch (error) {
      onLog(`Import impossible : ${(error as Error).message}`);
    } finally {
      event.target.value = '';
    }
  };

  const exportShow = () => {
    const blob = new Blob([JSON.stringify(show, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${show.id || 'show'}.lumieres.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    onLog('Show exporté dans un fichier importable.');
  };

  const startDrag = (event: ReactPointerEvent, clip: ShowClip, track: ShowTrack, mode: DragState['mode']) => {
    if (track.locked) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedClipId(clip.id);
    setDragState({
      clipId: clip.id,
      mode,
      pointerX: event.clientX,
      startFrame: clip.startFrame,
      endFrame: clip.endFrame,
    });
  };

  useEffect(() => {
    if (!dragState) return;
    const move = (event: PointerEvent) => {
      const delta = Math.round((event.clientX - dragState.pointerX) / zoom);
      let startFrame = dragState.startFrame;
      let endFrame = dragState.endFrame;

      if (dragState.mode === 'move') {
        const duration = dragState.endFrame - dragState.startFrame;
        startFrame = Math.max(0, Math.min(showRef.current.durationFrames - duration, dragState.startFrame + delta));
        endFrame = startFrame + duration;
      } else if (dragState.mode === 'trim-start') {
        startFrame = Math.max(0, Math.min(dragState.endFrame - 1, dragState.startFrame + delta));
      } else {
        endFrame = Math.min(showRef.current.durationFrames, Math.max(dragState.startFrame + 1, dragState.endFrame + delta));
      }

      const next = cloneShow(showRef.current);
      const selected = findSelection(next, dragState.clipId);
      if (!selected) return;
      selected.clip.startFrame = startFrame;
      selected.clip.endFrame = endFrame;
      showRef.current = next;
      onChangeRef.current(next);
    };
    const stop = () => setDragState(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
  }, [dragState, zoom]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, select, textarea')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        setPreviewPlaying((playing) => !playing);
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        setPreviewPlaying(false);
        setPlayheadFrame((frame) => clampShowFrame(showRef.current, frame - 1));
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        setPreviewPlaying(false);
        setPlayheadFrame((frame) => clampShowFrame(showRef.current, frame + 1));
      } else if ((event.code === 'Delete' || event.code === 'Backspace') && selectedClipId) {
        event.preventDefault();
        removeSelectedClip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const timelineWidth = Math.max(1100, show.durationFrames * zoom);
  const rulerSeconds = Array.from(
    { length: Math.floor(show.durationFrames / show.fps) + 1 },
    (_, second) => second,
  );
  const { waveform: audioBars, loading: audioLoading } = useAudioWaveform(
    show.audio.source === 'file' ? show.audio.path : undefined,
    show.durationFrames,
    show.fps,
    zoom
  );
  const playheadLeft = playheadFrame * zoom;
  const selectedElementState = selection?.clip.kind === 'element'
    ? getElementStateAtFrame(selection.clip, playheadFrame)
    : null;
  const selectedFixtureState = selection?.clip.kind === 'fixture'
    ? getFixtureStateAtFrame(selection.clip, show, playheadFrame, 0)
    : null;
  const selectedProjectorState = selection?.clip.kind === 'projector'
    ? getProjectorStateAtFrame(selection.clip, playheadFrame)
    : null;
  const selectedClipFrame = selection ? getClipLocalFrame(selection.clip, playheadFrame) : 0;

  return (
    <section className="show-editor" data-testid="timeline-editor">
      <header className="se-project-bar">
        <div className="se-project-identity">
          <span className="se-kicker">SHOW / 01</span>
          <input
            className="se-project-name"
            value={show.name}
            aria-label="Nom du show"
            onChange={(event) => applyMutation((next) => { next.name = event.target.value; })}
          />
          <span className="se-project-meta">{show.fps} FPS · {show.durationFrames} frames · {(show.durationFrames / show.fps).toFixed(1)} s</span>
        </div>

        <div className="se-project-actions">
          <span className={`se-save-state ${dirty ? 'is-dirty' : ''}`}>
            <i /> {dirty ? 'Modifications locales' : 'Fichier synchronisé'}
          </span>
          <button className="se-button ghost" data-testid="new-project" onClick={() => setNewProjectOpen(true)}>
            <FilePlus2 size={15} /> Nouveau
          </button>
          <input
            ref={importInputRef}
            data-testid="show-import"
            type="file"
            accept=".json,.lumieres"
            hidden
            onChange={handleImport}
          />
          <button className="se-button ghost" onClick={() => importInputRef.current?.click()}>
            <Upload size={15} /> Importer
          </button>
          <button className="se-button ghost" onClick={exportShow}>
            <Download size={15} /> Exporter
          </button>
          <button className="se-button primary" data-testid="show-save" onClick={() => void onSave(show)}>
            <Save size={15} /> Enregistrer
          </button>
        </div>
      </header>

      {newProjectOpen && (
        <div className="se-dialog-backdrop" role="presentation" onPointerDown={() => setNewProjectOpen(false)}>
          <form
            className="se-new-project-dialog"
            data-testid="new-project-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
            onSubmit={createNewProject}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="se-dialog-heading">
              <div>
                <span>PROJET / VIDE</span>
                <h2 id="new-project-title">Créer depuis zéro</h2>
              </div>
              <button type="button" aria-label="Fermer" onClick={() => setNewProjectOpen(false)}><X size={18} /></button>
            </div>
            <p>Une timeline noire, sans piste, sans clip et sans audio. Les éléments seront ajoutés uniquement depuis l’éditeur.</p>
            <label className="se-dialog-field">
              <span>Nom du projet</span>
              <input
                data-testid="new-project-name"
                value={newProjectDraft.name}
                autoFocus
                onChange={(event) => setNewProjectDraft((draft) => ({ ...draft, name: event.target.value }))}
              />
            </label>
            <div className="se-dialog-grid">
              <label className="se-dialog-field">
                <span>Images par seconde</span>
                <input
                  data-testid="new-project-fps"
                  type="number"
                  min={1}
                  max={240}
                  value={newProjectDraft.fps}
                  onChange={(event) => setNewProjectDraft((draft) => ({ ...draft, fps: Number(event.target.value) }))}
                />
              </label>
              <label className="se-dialog-field">
                <span>Durée</span>
                <span className="se-dialog-number">
                  <input
                    data-testid="new-project-duration"
                    type="number"
                    min={1}
                    max={600}
                    step={0.5}
                    value={newProjectDraft.durationSeconds}
                    onChange={(event) => setNewProjectDraft((draft) => ({ ...draft, durationSeconds: Number(event.target.value) }))}
                  />
                  <em>secondes</em>
                </span>
              </label>
            </div>
            <div className="se-dialog-summary">
              <i /> {Math.max(1, Math.round(newProjectDraft.fps * newProjectDraft.durationSeconds))} frames · fond noir
            </div>
            <div className="se-dialog-actions">
              <button type="button" className="se-button ghost" onClick={() => setNewProjectOpen(false)}>Annuler</button>
              <button type="submit" className="se-button primary" data-testid="create-empty-project">
                <FilePlus2 size={15} /> Créer le projet vide
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="se-workspace">
        <aside className="se-library" aria-label="Bibliothèque d’éléments">
          <div className="se-panel-heading">
            <div>
              <span>Bibliothèque</span>
              <strong>Créer</strong>
            </div>
            <Sparkles size={17} />
          </div>

          <div className="se-library-section">
            <span className="se-section-label">Écran</span>
            <div className="se-asset-grid">
              <button data-testid="add-rectangle" onClick={() => addElement('rectangle')}>
                <Square size={19} /> <span>Rectangle</span>
              </button>
              <button onClick={() => addElement('ellipse')}>
                <Circle size={19} /> <span>Cercle</span>
              </button>
              <button onClick={addSolid}>
                <Monitor size={19} /> <span>Fond uni</span>
              </button>
            </div>
          </div>

          <div className="se-library-section">
            <span className="se-section-label">Animations écran</span>
            <button className="se-preset is-freeform" data-testid="add-blank-screen-animation" onClick={addBlankScreenAnimation}>
              <span className="se-preset-icon cyan"><Diamond size={16} /></span>
              <span><strong>Animation vide</strong><small>Keyframes libres</small></span>
            </button>
            <span className="se-section-label subtle">Modèles rapides</span>
            <button className="se-preset" onClick={() => addElement('slide')}>
              <span className="se-preset-icon red"><Move size={16} /></span>
              <span><strong>Ping-pong</strong><small>Bandeau · boucle 2 s</small></span>
            </button>
            <button className="se-preset" onClick={() => addElement('pulse')}>
              <span className="se-preset-icon gold"><Radio size={16} /></span>
              <span><strong>Pulse impérial</strong><small>Échelle + opacité</small></span>
            </button>
            <button className="se-preset" onClick={() => addElement('orbit')}>
              <span className="se-preset-icon cyan"><RotateCcw size={16} /></span>
              <span><strong>Orbite</strong><small>Position · boucle 2 s</small></span>
            </button>
          </div>

          <div className="se-library-section">
            <span className="se-section-label">Éclairage</span>
            <button className="se-preset is-freeform" data-testid="add-blank-fixture-animation" onClick={addBlankFixtureAnimation}>
              <span className="se-preset-icon gold"><Diamond size={16} /></span>
              <span><strong>Animation lyres vide</strong><small>Pan / tilt / DMX libres</small></span>
            </button>
            <span className="se-section-label subtle">Modèles rapides</span>
            <button className="se-preset" data-testid="add-fixture" onClick={() => addFixtureAnimation('sweep')}>
              <span className="se-preset-icon gold"><Lightbulb size={16} /></span>
              <span><strong>Balayage lyres</strong><small>Pan / tilt / couleur</small></span>
            </button>
            <button className="se-preset" onClick={() => addFixtureAnimation('circle')}>
              <span className="se-preset-icon cyan"><RotateCcw size={16} /></span>
              <span><strong>Cercle lyres</strong><small>Mouvement continu</small></span>
            </button>
            <button className="se-preset" onClick={() => addFixtureAnimation('pulse')}>
              <span className="se-preset-icon red"><Sparkles size={16} /></span>
              <span><strong>Pulse lyres</strong><small>Dimmer + strobe</small></span>
            </button>
            <button className="se-preset" onClick={addProjectorAnimation}>
              <span className="se-preset-icon white"><Monitor size={16} /></span>
              <span><strong>Fondu projecteur</strong><small>RGBW + intensité</small></span>
            </button>
          </div>
        </aside>

        <main className="se-stage-panel">
          <div className="se-stage-toolbar">
            <span><i className={previewPlaying || serverPlaying ? 'is-live' : ''} /> Aperçu composite</span>
            <div>
              <span>128 × 128</span>
              <span>FRAME {playheadFrame.toString().padStart(4, '0')}</span>
            </div>
          </div>

          <div className="se-stage" data-testid="stage-preview">
            <div className="se-projector-glow" style={{
              opacity: preparedFrame.projector.intensity / 255,
              background: `radial-gradient(circle, rgba(${preparedFrame.projector.red}, ${preparedFrame.projector.green}, ${preparedFrame.projector.blue}, .48), transparent 68%)`,
            }} />
            <div className="se-led-frame">
              <canvas ref={canvasRef} data-testid="stage-canvas" width={64} height={64} />
              <div className="se-pixel-grid" />
              <span className="se-screen-tag">LED WALL / PROGRAM</span>
            </div>

            <div className="se-fixture-rig" aria-label="Aperçu des quatre lyres">
              {preparedFrame.fixtures.map((fixture, index) => {
                const angle = ((fixture.pan - 127) / 127) * 42;
                const beamHeight = 42 + (fixture.tilt / 255) * 42;
                const color = fixtureColor(fixture.colorWheel);
                return (
                  <div className="se-fixture" key={index}>
                    <div
                      className={`se-beam ${fixture.strobe > 180 ? 'is-strobing' : ''}`}
                      style={{
                        height: `${beamHeight}px`,
                        opacity: fixture.dimmer / 255,
                        transform: `translateX(-50%) rotate(${angle}deg)`,
                        background: `linear-gradient(to top, ${color}99, ${color}00)`,
                      }}
                    />
                    <div className="se-fixture-head" style={{ transform: `rotate(${angle * 0.25}deg)`, boxShadow: `0 -5px 18px ${color}88` }} />
                    <span>L{index + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="se-transport">
            <div className="se-transport-left">
              <button title="Retour au début" onClick={() => { setPreviewPlaying(false); setPlayheadFrame(0); }}>
                <SkipBack size={17} />
              </button>
              <button title="Frame précédente" onClick={() => { setPreviewPlaying(false); setPlayheadFrame((frame) => clampShowFrame(show, frame - 1)); }}>
                <span>−1</span>
              </button>
              <button className="se-play" title="Lecture locale" onClick={() => setPreviewPlaying((playing) => !playing)}>
                {previewPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button title="Frame suivante" onClick={() => { setPreviewPlaying(false); setPlayheadFrame((frame) => clampShowFrame(show, frame + 1)); }}>
                <span>+1</span>
              </button>
            </div>
            <div className="se-timecode" data-testid="playhead-timecode">
              <strong>{formatTimecode(playheadFrame, show.fps)}</strong>
              <span>/ {formatTimecode(show.durationFrames, show.fps)}</span>
            </div>
            <div className="se-live-controls">
              {serverPlaying ? (
                <button className="se-button live-stop" onClick={onStopLive}>Arrêter le live</button>
              ) : (
                <button
                  className="se-button live"
                  disabled={!connected}
                  title={connected ? 'Sauvegarder puis jouer sur le matériel' : 'Serveur hors ligne'}
                  onClick={() => void onGoLive(show, playheadFrame)}
                >
                  <Radio size={15} /> Envoyer en live
                </button>
              )}
            </div>
          </div>
        </main>

        <aside className="se-inspector" data-testid="inspector">
          <div className="se-panel-heading">
            <div>
              <span>Propriétés</span>
              <strong>{selection ? selection.clip.name : 'Aucune sélection'}</strong>
            </div>
            <Diamond size={16} />
          </div>

          {!selection && (
            <div className="se-empty-inspector">
              <Square size={26} />
              <strong>Sélectionne un clip</strong>
              <p>Le montage se règle ici, frame par frame.</p>
            </div>
          )}

          {selection && (
            <div className="se-inspector-scroll">
              <div className="se-inspector-section">
                <span className="se-section-label">Clip</span>
                <label className="se-text-field">
                  <span>Nom</span>
                  <input
                    value={selection.clip.name}
                    onChange={(event) => updateSelectedClip((clip) => { clip.name = event.target.value; })}
                  />
                </label>
                <div className="se-field-grid two">
                  <NumberField
                    label="Début"
                    value={selection.clip.startFrame}
                    min={0}
                    max={selection.clip.endFrame}
                    suffix="fr"
                    onChange={(value) => updateSelectedClip((clip) => {
                      clip.startFrame = Math.max(0, Math.min(clip.endFrame, Math.round(value)));
                    })}
                  />
                  <NumberField
                    label="Fin"
                    value={selection.clip.endFrame}
                    min={selection.clip.startFrame}
                    max={show.durationFrames}
                    suffix="fr"
                    onChange={(value) => updateSelectedClip((clip) => {
                      clip.endFrame = Math.min(show.durationFrames, Math.max(clip.startFrame, Math.round(value)));
                    })}
                  />
                </div>
                <label className="se-toggle-row">
                  <span><RotateCcw size={14} /> Boucler le clip</span>
                  <input
                    type="checkbox"
                    checked={selection.clip.loop.enabled}
                    onChange={(event) => updateSelectedClip((clip) => { clip.loop.enabled = event.target.checked; })}
                  />
                </label>
                {selection.clip.loop.enabled && (
                  <NumberField
                    label="Longueur de boucle"
                    value={selection.clip.loop.lengthFrames}
                    min={1}
                    max={show.durationFrames}
                    suffix="fr"
                    onChange={(value) => updateSelectedClip((clip) => { clip.loop.lengthFrames = Math.max(1, Math.round(value)); })}
                  />
                )}
              </div>

              {selection.clip.kind === 'pattern' && (
                <div className="se-inspector-section">
                  <span className="se-section-label">Motif écran</span>
                  <label className="se-text-field">
                    <span>Générateur</span>
                    <select
                      value={selection.clip.pattern}
                      onChange={(event) => updateSelectedClip((clip) => {
                        if (clip.kind === 'pattern') {
                          clip.pattern = event.target.value as PatternClip['pattern'];
                          if (clip.pattern === 'custom' && !clip.code) {
                            clip.code = `// Variables : x, y (0-127), t (secondes), d (distance), a (angle), f (frame)\n// Définissez r, g, b (0-255)\n\nr = Math.sin(x * 0.1 + t * 5) * 127 + 128;\ng = Math.cos(y * 0.1 - t * 5) * 127 + 128;\nb = 127 + 128 * Math.sin(d * 0.05 - t * 10);`;
                          }
                        }
                      })}
                    >
                      {Object.entries(PATTERN_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  {selection.clip.pattern === 'solid' && (
                    <label className="se-color-field">
                      <span>Couleur</span>
                      <input
                        type="color"
                        value={selection.clip.color ?? '#ef3340'}
                        onChange={(event) => updateSelectedClip((clip) => {
                          if (clip.kind === 'pattern') clip.color = event.target.value;
                        })}
                      />
                      <code>{selection.clip.color ?? '#ef3340'}</code>
                    </label>
                  )}
                  {selection.clip.pattern === 'custom' && (
                    <label className="se-textarea-field" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span>Code JS (évalué par pixel)</span>
                      <textarea
                        data-testid="custom-pattern-code"
                        value={(selection.clip as PatternClip).code ?? ''}
                        onChange={(event) => updateSelectedClip((clip) => {
                          if (clip.kind === 'pattern') clip.code = event.target.value;
                        })}
                        placeholder="// Écrivez votre motif ici..."
                        rows={10}
                        style={{
                          fontFamily: 'Consolas, Monaco, monospace',
                          fontSize: '11px',
                          backgroundColor: '#1a1a1a',
                          color: '#e0e0e0',
                          border: '1px solid #333',
                          borderRadius: '4px',
                          padding: '8px',
                          width: '100%',
                          resize: 'vertical',
                          lineHeight: '1.4',
                        }}
                      />
                    </label>
                  )}
                  <div className="se-legacy-note">
                    <Radio size={14} /> Ce générateur est évalué à chaque frame, sans rendu vidéo pré-calculé.
                  </div>
                </div>
              )}

              {selection.clip.kind === 'element' && selectedElementState && (
                <div className="se-inspector-section">
                  <div className="se-section-row">
                    <span className="se-section-label">Frame show {playheadFrame} · clip {selectedClipFrame}</span>
                    <button className="se-keyframe-button" data-testid="add-element-keyframe" onClick={() => updateElement({})}><Diamond size={13} /> Keyframe</button>
                  </div>
                  <label className="se-text-field">
                    <span>Forme</span>
                    <select
                      value={selection.clip.shape}
                      onChange={(event) => updateSelectedClip((clip) => {
                        if (clip.kind === 'element') clip.shape = event.target.value as ElementClip['shape'];
                      })}
                    >
                      <option value="rectangle">Rectangle</option>
                      <option value="ellipse">Ellipse</option>
                    </select>
                  </label>
                  <label className="se-color-field">
                    <span>Remplissage</span>
                    <input type="color" value={selectedElementState.fill} onChange={(event) => updateElement({ fill: event.target.value })} />
                    <code>{selectedElementState.fill}</code>
                  </label>
                  <div className="se-field-grid two">
                    <NumberField label="X" value={selectedElementState.x} min={-128} max={256} onChange={(value) => updateElement({ x: value })} />
                    <NumberField label="Y" value={selectedElementState.y} min={-128} max={256} onChange={(value) => updateElement({ y: value })} />
                    <NumberField label="Largeur" value={selectedElementState.width} min={1} max={256} onChange={(value) => updateElement({ width: value })} />
                    <NumberField label="Hauteur" value={selectedElementState.height} min={1} max={256} onChange={(value) => updateElement({ height: value })} />
                    <NumberField label="Rotation" value={selectedElementState.rotation} min={-360} max={360} suffix="°" onChange={(value) => updateElement({ rotation: value })} />
                    <NumberField label="Opacité" value={selectedElementState.opacity} min={0} max={1} step={0.05} onChange={(value) => updateElement({ opacity: value })} />
                  </div>
                  <div className="se-keyframe-count"><Diamond size={11} /> {selection.clip.keyframes.length} keyframe(s) · interpolation entre les frames</div>
                </div>
              )}

              {selection.clip.kind === 'fixture' && selectedFixtureState && (
                <div className="se-inspector-section">
                  <div className="se-section-row">
                    <span className="se-section-label">Lyres · show {playheadFrame} · clip {selectedClipFrame}</span>
                    <button className="se-keyframe-button" data-testid="add-fixture-keyframe" onClick={() => updateFixture({})}><Diamond size={13} /> Keyframe</button>
                  </div>
                  <label className="se-text-field">
                    <span>Cible</span>
                    <select
                      value={selection.track.target}
                      onChange={(event) => updateSelectedClip((_clip, track) => { track.target = event.target.value as TrackTarget; })}
                    >
                      <option value="all-lyres">Toutes les lyres</option>
                      <option value="lyre-1">Lyre 1</option>
                      <option value="lyre-2">Lyre 2</option>
                      <option value="lyre-3">Lyre 3</option>
                      <option value="lyre-4">Lyre 4</option>
                    </select>
                  </label>
                  <label className="se-text-field">
                    <span>Mode</span>
                    <select
                      value={selection.clip.preset ?? 'keyframes'}
                      onChange={(event) => updateSelectedClip((clip) => {
                        if (clip.kind !== 'fixture') return;
                        clip.preset = event.target.value === 'keyframes'
                          ? undefined
                          : event.target.value as FixtureClip['preset'];
                      })}
                    >
                      <option value="keyframes">Keyframes personnalisées</option>
                      <option value="lyre_waltz">Waltz historique</option>
                      <option value="lyre_rise">Rise historique</option>
                      <option value="lyre_trap">Trap historique</option>
                      <option value="black">Lyres éteintes · dev</option>
                      <option value="lyre_intro">Intro argentée · dev</option>
                      <option value="lyre_kick_pulse">Kick pulse · dev</option>
                      <option value="lyre_circle_color">Cercle couleur · dev</option>
                      <option value="lyre_buildup_strobe">Strobe crescendo · dev</option>
                      <option value="lyre_drop_trap">Chasses miroir · dev</option>
                    </select>
                  </label>
                  <div className="se-field-grid two">
                    <NumberField label="Pan" value={selectedFixtureState.pan} min={0} max={255} onChange={(value) => updateFixture({ pan: value })} />
                    <NumberField label="Tilt" value={selectedFixtureState.tilt} min={0} max={255} onChange={(value) => updateFixture({ tilt: value })} />
                    <NumberField label="Dimmer" value={selectedFixtureState.dimmer} min={0} max={255} onChange={(value) => updateFixture({ dimmer: value })} />
                    <NumberField label="Strobe" value={selectedFixtureState.strobe} min={0} max={255} onChange={(value) => updateFixture({ strobe: value })} />
                    <NumberField label="Roue couleur" value={selectedFixtureState.colorWheel} min={0} max={255} onChange={(value) => updateFixture({ colorWheel: value })} />
                  </div>
                  <div className="se-keyframe-count"><Diamond size={11} /> {selection.clip.keyframes.length} keyframe(s) · valeurs DMX 0–255</div>
                </div>
              )}

              {selection.clip.kind === 'projector' && selectedProjectorState && (
                <div className="se-inspector-section">
                  <div className="se-section-row">
                    <span className="se-section-label">Projecteur · show {playheadFrame} · clip {selectedClipFrame}</span>
                    <button className="se-keyframe-button" data-testid="add-projector-keyframe" onClick={() => updateProjector({})}><Diamond size={13} /> Keyframe</button>
                  </div>
                  <label className="se-text-field">
                    <span>Mode</span>
                    <select
                      value={selection.clip.preset ?? 'keyframes'}
                      onChange={(event) => updateSelectedClip((clip) => {
                        if (clip.kind !== 'projector') return;
                        clip.preset = event.target.value === 'keyframes'
                          ? undefined
                          : event.target.value as ProjectorClip['preset'];
                      })}
                    >
                      <option value="keyframes">Keyframes RGBW personnalisées</option>
                      <option value="static_off">Spot éteint · dev</option>
                      <option value="static_measure_pulse">Pulse bleu · dev</option>
                      <option value="static_snare_flash">Flash magenta · dev</option>
                      <option value="static_dimmer_rise">Montée dimmer · dev</option>
                      <option value="static_drop_strobe">Strobe drop · dev</option>
                    </select>
                  </label>
                  <div className="se-field-grid two">
                    <NumberField label="Rouge" value={selectedProjectorState.red} min={0} max={255} onChange={(value) => updateProjector({ red: value })} />
                    <NumberField label="Vert" value={selectedProjectorState.green} min={0} max={255} onChange={(value) => updateProjector({ green: value })} />
                    <NumberField label="Bleu" value={selectedProjectorState.blue} min={0} max={255} onChange={(value) => updateProjector({ blue: value })} />
                    <NumberField label="Blanc" value={selectedProjectorState.white} min={0} max={255} onChange={(value) => updateProjector({ white: value })} />
                    <NumberField label="Intensité" value={selectedProjectorState.intensity} min={0} max={255} onChange={(value) => updateProjector({ intensity: value })} />
                  </div>
                  <div className="se-keyframe-count"><Diamond size={11} /> {selection.clip.keyframes.length} keyframe(s) · sortie RGBW</div>
                </div>
              )}

              <div className="se-clip-actions">
                <button onClick={duplicateSelectedClip}><Copy size={14} /> Dupliquer</button>
                <button className="danger" onClick={removeSelectedClip}><Trash2 size={14} /> Supprimer</button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <section className="se-timeline-shell">
        <div className="se-timeline-toolbar">
          <div>
            <strong>Timeline</strong>
            <span>{show.tracks.length + (show.audio.source === 'none' ? 0 : 1)} pistes · snap à 1 frame</span>
          </div>
          <div className="se-zoom-control">
            <ZoomIn size={14} />
            <input
              data-testid="timeline-zoom"
              type="range"
              min={0.45}
              max={2.5}
              step={0.05}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <span>{Math.round(zoom * 100)}%</span>
          </div>
        </div>

        <div className="se-timeline-scroll">
          <div className="se-timeline-content" style={{ width: `${timelineWidth + 190}px` }}>
            <div className="se-ruler-row">
              <div className="se-ruler-corner">PISTES</div>
              <div
                className="se-ruler"
                style={{ width: `${timelineWidth}px` }}
                onPointerDown={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setPreviewPlaying(false);
                  setPlayheadFrame(clampShowFrame(show, (event.clientX - bounds.left) / zoom));
                }}
              >
                {rulerSeconds.map((second) => (
                  <span
                    className={`se-ruler-tick ${second % 5 === 0 ? 'major' : ''}`}
                    key={second}
                    style={{ left: `${second * show.fps * zoom}px` }}
                  >
                    <i />
                    {(zoom >= 0.75 || second % 5 === 0) && <em>{formatTimecode(second * show.fps, show.fps).slice(0, 5)}</em>}
                  </span>
                ))}
                <div className="se-playhead ruler-head" style={{ left: `${playheadLeft}px` }}><b /></div>
              </div>
            </div>

            {show.audio.source !== 'none' && (
              <div className="se-track-row audio-row">
                <div className="se-track-label is-sticky">
                  <span className="se-track-icon audio"><Radio size={14} /></span>
                  <div><strong>Audio master</strong><small>{show.audio.label}</small></div>
                  <Lock size={13} />
                </div>
                <div className="se-track-lane" style={{ width: `${timelineWidth}px` }}>
                  <div className="se-audio-clip" style={{ width: `${show.durationFrames * zoom}px` }}>
                    <div className="se-waveform" style={{ opacity: audioLoading ? 0.35 : 0.65, transition: 'opacity 0.2s' }}>
                      {audioBars.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
                    </div>
                    <span>{show.audio.label}</span>
                  </div>
                  <div className="se-playhead" style={{ left: `${playheadLeft}px` }} />
                </div>
              </div>
            )}

            {show.audio.source === 'none' && show.tracks.length === 0 && (
              <div className="se-empty-timeline-row" data-testid="empty-timeline">
                <div className="se-track-label is-sticky">
                  <span className="se-track-icon empty"><FilePlus2 size={14} /></span>
                  <div><strong>0 piste</strong><small>Projet réellement vide</small></div>
                </div>
                <div className="se-empty-timeline-lane" style={{ width: `${timelineWidth}px` }}>
                  <Diamond size={15} />
                  <span>Ajoute un rectangle à gauche pour poser la première keyframe.</span>
                  <div className="se-playhead" style={{ left: `${playheadLeft}px` }} />
                </div>
              </div>
            )}

            {show.tracks.map((track) => (
              <div className="se-track-row" key={track.id} data-testid={`timeline-track-${track.id}`}>
                <div className="se-track-label is-sticky">
                  <span className={`se-track-icon ${track.kind}`}>
                    {track.kind === 'screen' ? <Monitor size={14} /> : track.kind === 'fixture' ? <Lightbulb size={14} /> : <Radio size={14} />}
                  </span>
                  <div><strong>{track.name}</strong><small>{TRACK_LABELS[track.kind]} · {track.target}</small></div>
                  <button title={track.muted ? 'Afficher la piste' : 'Masquer la piste'} onClick={() => setTrackProperty(track.id, 'muted', !track.muted)}>
                    {track.muted ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button title={track.locked ? 'Déverrouiller' : 'Verrouiller'} onClick={() => setTrackProperty(track.id, 'locked', !track.locked)}>
                    {track.locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                </div>
                <div
                  className={`se-track-lane ${track.muted ? 'is-muted' : ''}`}
                  style={{ width: `${timelineWidth}px` }}
                  onPointerDown={(event) => {
                    if ((event.target as HTMLElement).closest('.se-clip')) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setPreviewPlaying(false);
                    setPlayheadFrame(clampShowFrame(show, (event.clientX - bounds.left) / zoom));
                  }}
                >
                  {track.clips.map((clip) => {
                    const left = clip.startFrame * zoom;
                    const width = Math.max(12, (clip.endFrame - clip.startFrame) * zoom);
                    return (
                      <div
                        key={clip.id}
                        data-testid={`clip-${clip.id}`}
                        className={`se-clip ${clip.kind} ${selectedClipId === clip.id ? 'is-selected' : ''} ${clip.loop.enabled ? 'is-looped' : ''}`}
                        style={{ left: `${left}px`, width: `${width}px`, '--clip-color': track.color } as CSSProperties}
                        onPointerDown={(event) => startDrag(event, clip, track, 'move')}
                      >
                        <button className="se-trim-handle start" aria-label="Raccourcir le début" onPointerDown={(event) => startDrag(event, clip, track, 'trim-start')} />
                        <div className="se-clip-title">
                          <span>{clip.name}</span>
                          <small>{clip.endFrame - clip.startFrame} fr {clip.loop.enabled ? `· ↻ ${clip.loop.lengthFrames}` : ''}</small>
                        </div>
                        {getClipKeyframes(clip).map((keyframe, index) => {
                          const markerLeft = Math.min(width - 8, Math.max(4, keyframe.frame * zoom));
                          return <i className="se-keyframe-marker" key={`${keyframe.frame}-${index}`} style={{ left: `${markerLeft}px` }} />;
                        })}
                        <button className="se-trim-handle end" aria-label="Raccourcir la fin" onPointerDown={(event) => startDrag(event, clip, track, 'trim-end')} />
                      </div>
                    );
                  })}
                  <div className="se-playhead" style={{ left: `${playheadLeft}px` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}
