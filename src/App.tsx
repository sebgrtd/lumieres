import { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, Square, Radio, Cpu, Settings, Activity, Trash2, Plus, Volume2, ImagePlus } from 'lucide-react';
import { Visualizer } from './components/Visualizer.tsx';
import { synthInstance } from './components/AudioEngine.ts';
import { analyzeAudioBeats } from './components/AudioAnalyzer.ts';
import { SHOW_DURATION_SECONDS, SHOW_TIMELINE, type EffectParams, type TimelineBlock } from './timeline/showTimeline.ts';
import { ImageStudio } from './components/ImageStudio.tsx';
import { validateRouterConfig, type ConfigHealthItem, type RouterConfig } from './router/mapping.ts';
import { ShowEditor } from './components/show-editor/ShowEditor.tsx';
import { cloneShow, isShowDocument, type ShowDocument } from './types/show.ts';
import defaultShowData from '../show.lumieres.json';

const DEFAULT_SHOW_DOCUMENT = defaultShowData as unknown as ShowDocument;

const LANE_LABELS: Record<TimelineBlock['lane'], string> = {
  wall: 'LED Wall Lane',
  lyres: 'Moving Heads',
  static: 'Static Spotlight',
};

const LANE_COLORS: Record<TimelineBlock['lane'], { bg: string; border: string; badge: string }> = {
  wall: { bg: 'rgba(230, 20, 30, 0.25)', border: 'var(--color-red)', badge: 'badge-red' },
  lyres: { bg: 'rgba(235, 180, 45, 0.2)', border: 'var(--color-gold)', badge: 'badge-gold' },
  static: { bg: 'rgba(59, 130, 246, 0.25)', border: 'var(--color-cyan)', badge: 'badge-cyan' },
};

const EFFECT_OPTIONS: Record<TimelineBlock['lane'], { value: string; label: string }[]> = {
  wall: [
    { value: 'black', label: 'Blackout' },
    { value: 'guitar_intro', label: 'Guitar Intro' },
    { value: 'intro_ticks', label: 'Intro Ticks' },
    { value: 'blue_star_burst', label: 'COSMO Blue Star' },
    { value: 'quadrant_flashes', label: 'Quadrant Flash' },
    { value: 'laser_sweeps', label: 'Tanzschein Lasers' },
    { value: 'reactive_drop', label: 'Tanzschein Drop' },
  ],
  lyres: [
    { value: 'black', label: 'Lyres Off' },
    { value: 'lyre_intro', label: 'Intro Silver Sweep' },
    { value: 'lyre_kick_pulse', label: 'Lyres Kick Snap' },
    { value: 'lyre_circle_color', label: 'Lyres Color Circle' },
    { value: 'lyre_buildup_strobe', label: 'Lyres Buildup Strobe' },
    { value: 'lyre_drop_trap', label: 'Lyres Mirrored Chases' },
  ],
  static: [
    { value: 'static_off', label: 'Spotlight Off' },
    { value: 'static_measure_pulse', label: 'Spot Blue Pulse' },
    { value: 'static_snare_flash', label: 'Spot Magenta Snare' },
    { value: 'static_dimmer_rise', label: 'Spot Dimmer Rise' },
    { value: 'static_drop_strobe', label: 'Spot Strobe Drop' },
  ],
};

const DEFAULT_EFFECT_PARAMS: EffectParams = {
  intensity: 1,
  color: '#ffffff',
  speed: 1,
  strobe: 0,
};

const getEffectParams = (block: TimelineBlock): EffectParams => ({
  ...DEFAULT_EFFECT_PARAMS,
  ...(block.params || {}),
});

const summarizeConfigHealth = (items: ConfigHealthItem[]) => {
  const errors = items.filter((item) => item.level === 'error').length;
  const warnings = items.filter((item) => item.level === 'warning').length;
  return { errors, warnings };
};

interface DmxMonitorState {
  generatedAt: number;
  loopRunning: boolean;
  isPlaying: boolean;
  activeOverride: string | null;
  bufferCount: number;
  dirtyUniverses: string[];
  availableUniverses: string[];
  selectedUniverse: null | {
    key: string;
    nonZeroCount: number;
    firstChannels: number[];
    nonZeroChannels: Array<{ channel: number; value: number }>;
  };
  lastArtNetPackets: Array<{ ip: string; universe: number; artnetUniverse: number; bytes: number; sentAt: number }>;
  inspectedEntity: null | {
    id: number;
    target: null | { ip: string; universe: number; channel: number; type: string; fixtureId?: string };
    value: null | { channel: number; bytes: number[] };
  };
  controllers: Array<{ ip: string; startUniverse: number; universeCount: number; firstUniverse?: number; lastUniverse?: number }>;
  entityCount: number;
}

interface EHubMonitorState {
  listeningPort: number;
  packetsPerSec: number;
  totalPacketsThisSecond: number;
  mappedEntityCount: number;
  loopRunning: boolean;
  lastPacket: null | {
    receivedAt: number;
    entityCount: number;
    mappedCount: number;
    unmappedCount: number;
    dirtyUniverses: string[];
    sample: Array<{ id: number; r: number; g: number; b: number; w: number }>;
    source: 'udp' | 'fake';
  };
  recentPackets: Array<NonNullable<EHubMonitorState['lastPacket']>>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'timeline' | 'images' | 'debug' | 'ehub' | 'config'>('dashboard');
  const [wsConnected, setWsConnected] = useState(false);
  const [telemetry, setTelemetry] = useState<any>({ fps: 0, packetsPerSec: 0, kbps: 0, ehubPacketsPerSec: 0 });
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<string[]>(['System initialized. Austrian theme selected.']);
  const [config, setConfig] = useState<any>(null);

  // Audio Analyzer states
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [detectedBeatsCount, setDetectedBeatsCount] = useState<number | null>(null);

  // Function to run beat analysis and sync with server
  const runBeatAnalysis = async (customSocket?: WebSocket) => {
    setIsAnalyzing(true);
    setAnalysisStatus("Initialisation de l'analyse rythmique...");
    const peaks = await analyzeAudioBeats((msg) => {
      setAnalysisStatus(msg);
    });
    setIsAnalyzing(false);
    setDetectedBeatsCount(peaks.length);
    
    const targetSocket = customSocket || wsRef.current;
    if (peaks.length > 0 && targetSocket && targetSocket.readyState === WebSocket.OPEN) {
      targetSocket.send(JSON.stringify({ type: 'set-beats', beats: peaks }));
    }
  };

  const [blocks, setBlocks] = useState<TimelineBlock[]>(() => SHOW_TIMELINE.map((block) => ({ ...block })));
  const [showDirty, setShowDirty] = useState(false);
  const [showDocument, setShowDocument] = useState<ShowDocument>(() => cloneShow(DEFAULT_SHOW_DOCUMENT));
  const [showDocumentDirty, setShowDocumentDirty] = useState(false);

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [previewingBlockId, setPreviewingBlockId] = useState<string | null>(null);
  const [interactiveOverride, setInteractiveOverride] = useState<string | null>(null);
  const [frameState, setFrameState] = useState<Record<number, number[]>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const currentTimeRef = useRef(0);
  const importShowFileRef = useRef<HTMLInputElement | null>(null);

  const [pingStatus, setPingStatus] = useState<Record<string, { status: string; latency: string }>>({});
  const [isPinging, setIsPinging] = useState(false);
  const [dmxMonitor, setDmxMonitor] = useState<DmxMonitorState | null>(null);
  const [selectedUniverseKey, setSelectedUniverseKey] = useState('');
  const [inspectEntityId, setInspectEntityId] = useState('100');
  const [ehubMonitor, setEhubMonitor] = useState<EHubMonitorState | null>(null);
  const configHealth = useMemo<ConfigHealthItem[]>(() => (
    config ? validateRouterConfig(config as RouterConfig) : [{ level: 'warning', message: 'No configuration loaded yet.' }]
  ), [config]);
  const configHealthSummary = useMemo(() => summarizeConfigHealth(configHealth), [configHealth]);

  const addLog = (msg: string) => {
    setConsoleLogs((prev) => [ `[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 15) ]);
  };

  const runPingDiagnostics = async () => {
    setIsPinging(true);
    addLog('Demarrage du diagnostic ping des controleurs...');
    try {
      const response = await fetch('/api/ping');
      const data = await response.json();
      if (data.success) {
        const resultsMap: Record<string, { status: string; latency: string }> = {};
        data.results.forEach((res: any) => {
          resultsMap[res.ip] = { status: res.status, latency: res.latency };
          addLog(`  IP ${res.ip}: ${res.status === 'ONLINE' ? 'EN LIGNE' : 'HORS LIGNE'} (${res.latency})`);
        });
        setPingStatus(resultsMap);
      } else {
        addLog('Erreur lors du diagnostic ping.');
      }
    } catch (err) {
      addLog(`Erreur de communication API: ${(err as Error).message}`);
    } finally {
      setIsPinging(false);
    }
  };

  const blurAll = () => {
    (document.activeElement as HTMLElement)?.blur();
  };

  // Connect to WebSocket Server
  useEffect(() => {
    const wsUrl = `ws://${window.location.host}/ws`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      setWsConnected(true);
      addLog('Connected to ArtNet Routing Server via WebSocket.');
      // Automatically run beat analysis and upload to server on load
      runBeatAnalysis(socket);
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'config') {
          setConfig(msg.data);
        } else if (msg.type === 'timeline') {
          setBlocks(msg.data);
          setShowDirty(false);
        } else if (msg.type === 'show-document' && isShowDocument(msg.data)) {
          setShowDocument(cloneShow(msg.data));
          setShowDocumentDirty(false);
        } else if (msg.type === 'telemetry') {
          setTelemetry(msg.data);
        } else if (msg.type === 'frame') {
          // Sync UI clock and pixel visualizer state with backend
          setFrameState(msg.data);
          setCurrentTime(msg.time);
          synthInstance.syncTime(msg.time);
        } else if (msg.type === 'clear') {
          setFrameState({});
          setCurrentTime(0);
        } else if (msg.type === 'log') {
          addLog(`[SERVER] ${msg.message}`);
        }
      } catch (e) {
        console.error(e);
      }
    };

    socket.onclose = () => {
      setWsConnected(false);
      addLog('WebSocket disconnected. Reconnecting...');
    };

    return () => {
      socket.close();
    };
  }, []);

  // Keyboard Overrides Sender (P6 Interactivity)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTab === 'timeline') return;
      const code = e.code.toLowerCase();
      let keyToSend = null;
      if (code === 'space') {
        e.preventDefault();
        keyToSend = 'space';
      } else if (code === 'keya') {
        keyToSend = 'a';
      } else if (code === 'keyl') {
        keyToSend = 'l';
      } else if (code === 'keyc') {
        keyToSend = 'c';
      } else if (code === 'keyg') {
        keyToSend = 'g';
      } else if (code === 'keym') {
        keyToSend = 'm';
      } else if (code === 'keyn') {
        keyToSend = 'n';
      }

      if (keyToSend && interactiveOverride !== keyToSend) {
        setInteractiveOverride(keyToSend);
        addLog(`Interactive Override: ${keyToSend.toUpperCase()}`);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'override', key: keyToSend }));
        }
      }
    };

    const handleKeyUp = () => {
      if (interactiveOverride !== null) {
        setInteractiveOverride(null);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'override', key: null }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [activeTab, interactiveOverride]);

  // Keep currentTime ref updated to avoid effect re-triggering during playback
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    if (!previewingBlockId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const block = blocks.find((item) => item.id === previewingBlockId);
    if (block) {
      wsRef.current.send(JSON.stringify({ type: 'preview-block', block }));
    }
  }, [blocks, previewingBlockId]);

  useEffect(() => {
    if (activeTab !== 'debug') return;
    let cancelled = false;

    const loadMonitor = async () => {
      try {
        const params = new URLSearchParams();
        if (selectedUniverseKey) params.set('universeKey', selectedUniverseKey);
        if (inspectEntityId.trim()) params.set('entityId', inspectEntityId.trim());
        const response = await fetch(`/api/dmx-monitor?${params.toString()}`);
        const data = await response.json();
        if (!cancelled) {
          setDmxMonitor(data);
          if (!selectedUniverseKey && data.selectedUniverse?.key) {
            setSelectedUniverseKey(data.selectedUniverse.key);
          }
        }
      } catch (e) {
        addLog(`DMX monitor error: ${(e as Error).message}`);
      }
    };

    loadMonitor();
    const interval = window.setInterval(loadMonitor, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeTab, selectedUniverseKey, inspectEntityId]);

  useEffect(() => {
    if (activeTab !== 'ehub') return;
    let cancelled = false;

    const loadEhubMonitor = async () => {
      try {
        const response = await fetch('/api/ehub-monitor');
        const data = await response.json();
        if (!cancelled) setEhubMonitor(data);
      } catch (e) {
        addLog(`eHub monitor error: ${(e as Error).message}`);
      }
    };

    loadEhubMonitor();
    const interval = window.setInterval(loadEhubMonitor, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeTab]);

  // Sync Synthesizer with backend playback state
  useEffect(() => {
    if (isPlaying) {
      synthInstance.play(currentTimeRef.current, () => {}); // Play locally starting at the ref's current time
    } else {
      synthInstance.pause();
    }
  }, [isPlaying]);

  const handleResumePause = () => {
    blurAll();
    setPreviewingBlockId(null);
    if (isPlaying) {
      setIsPlaying(false);
      addLog('Show paused.');
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'pause' }));
      }
    } else {
      if (currentTimeRef.current <= 0.05) {
        addLog('Use RESTART FROM 0 to start a fresh demo. Current Playback only resumes a paused show.');
        return;
      }
      setIsPlaying(true);
      addLog(`Show resumed from ${currentTimeRef.current.toFixed(2)}s.`);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'play' }));
      }
    }
  };

  const handleStop = () => {
    blurAll();
    setPreviewingBlockId(null);
    synthInstance.stop();
    setIsPlaying(false);
    setCurrentTime(0);
    addLog('Show stopped & rewound.');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
  };

  const handleBlackout = () => {
    blurAll();
    setPreviewingBlockId(null);
    synthInstance.stop();
    setIsPlaying(false);
    setCurrentTime(0);
    setFrameState({});
    addLog('BLACKOUT triggered! Turned off all controllers.');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'blackout' }));
    }
  };

  const handleRestartFinalDemo = async () => {
    blurAll();
    setActiveTab('dashboard');

    if (showDirty) {
      await saveShow();
    }

    if (detectedBeatsCount === null && !isAnalyzing) {
      await runBeatAnalysis();
    }

    synthInstance.stop();
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setFrameState({});
    setInteractiveOverride(null);
    setIsPlaying(true);
    synthInstance.play(0, () => {});

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'demo-start' }));
    }

    addLog('FINAL DEMO MODE: saved, synced and restarted from 0.00s.');
  };

  const sortTimelineBlocks = (nextBlocks: TimelineBlock[]) => (
    [...nextBlocks].sort((a, b) => a.startTime - b.startTime || a.lane.localeCompare(b.lane))
  );

  const updateSelectedBlock = (patch: Partial<TimelineBlock>) => {
    if (!selectedBlockId) return;

    setBlocks((prev) => sortTimelineBlocks(prev.map((block) => {
      if (block.id !== selectedBlockId) return block;

      const next = { ...block, ...patch };
      const startTime = Math.max(0, Math.min(SHOW_DURATION_SECONDS - 0.1, Number(next.startTime) || 0));
      const endTime = Math.max(startTime + 0.1, Math.min(SHOW_DURATION_SECONDS, Number(next.endTime) || startTime + 1));

      return {
        ...next,
        startTime: Number(startTime.toFixed(2)),
        endTime: Number(endTime.toFixed(2)),
      };
    })));
    setShowDirty(true);
  };

  const updateSelectedBlockParams = (patch: Partial<EffectParams>) => {
    if (!selectedBlockId) return;

    setBlocks((prev) => prev.map((block) => {
      if (block.id !== selectedBlockId) return block;
      return {
        ...block,
        params: {
          ...getEffectParams(block),
          ...patch,
        },
      };
    }));
    setShowDirty(true);
  };

  const previewSelectedBlock = (block: TimelineBlock) => {
    blurAll();
    if (previewingBlockId === block.id) {
      setPreviewingBlockId(null);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'preview-stop' }));
      }
      return;
    }

    setIsPlaying(false);
    setPreviewingBlockId(block.id);
    addLog(`Preview segment: ${block.name}`);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'preview-block', block }));
    }
  };

  const addTimelineBlock = (lane: TimelineBlock['lane']) => {
    const defaultEffect = EFFECT_OPTIONS[lane][0];
    const startTime = Math.min(Math.max(0, currentTime), SHOW_DURATION_SECONDS - 1);
    const block: TimelineBlock = {
      id: `block-${Date.now()}`,
      lane,
      startTime: Number(startTime.toFixed(2)),
      endTime: Number(Math.min(SHOW_DURATION_SECONDS, startTime + 2).toFixed(2)),
      type: defaultEffect.value,
      name: defaultEffect.label,
      params: { ...DEFAULT_EFFECT_PARAMS },
    };

    setBlocks((prev) => sortTimelineBlocks([...prev, block]));
    setSelectedBlockId(block.id);
    setShowDirty(true);
  };

  const duplicateSelectedBlock = () => {
    const block = blocks.find((item) => item.id === selectedBlockId);
    if (!block) return;

    const duration = block.endTime - block.startTime;
    const startTime = Math.min(SHOW_DURATION_SECONDS - duration, block.endTime);
    const duplicate = {
      ...block,
      id: `block-${Date.now()}`,
      startTime: Number(startTime.toFixed(2)),
      endTime: Number((startTime + duration).toFixed(2)),
      name: `${block.name} Copy`,
    };

    setBlocks((prev) => sortTimelineBlocks([...prev, duplicate]));
    setSelectedBlockId(duplicate.id);
    setShowDirty(true);
  };

  const deleteSelectedBlock = () => {
    if (!selectedBlockId) return;
    setBlocks((prev) => prev.filter((block) => block.id !== selectedBlockId));
    if (previewingBlockId === selectedBlockId && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'preview-stop' }));
    }
    setPreviewingBlockId(null);
    setSelectedBlockId(null);
    setShowDirty(true);
  };

  const saveShow = async () => {
    try {
      const res = await fetch('/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
      });
      const data = await res.json();
      if (data.success) {
        setBlocks(data.blocks);
        setShowDirty(false);
        addLog(`Show timeline saved: ${data.blocks.length} segments.`);
      } else {
        addLog(`Error saving show: ${data.error}`);
      }
    } catch (e) {
      addLog(`Failed to save show: ${(e as Error).message}`);
    }
  };

  const saveShowDocument = async (candidate: ShowDocument): Promise<boolean> => {
    try {
      const response = await fetch('/api/show-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(candidate),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        addLog(`Impossible d'enregistrer le show : ${data.error ?? 'erreur inconnue'}`);
        return false;
      }
      setShowDocument(cloneShow(candidate));
      setShowDocumentDirty(false);
      addLog('Show enregistré dans show.lumieres.json.');
      return true;
    } catch (error) {
      addLog(`Serveur indisponible : ${(error as Error).message}`);
      return false;
    }
  };

  const playShowDocumentFromFrame = async (candidate: ShowDocument, frame: number) => {
    const saved = await saveShowDocument(candidate);
    if (!saved) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'play-document', frame }));
    }
    currentTimeRef.current = frame / candidate.fps;
    setCurrentTime(frame / candidate.fps);
    setIsPlaying(true);
    addLog(`Show document envoyé en live depuis la frame ${frame}.`);
  };

  const resetShow = async () => {
    try {
      const res = await fetch('/api/show/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBlocks(data.blocks);
        setSelectedBlockId(null);
        setShowDirty(false);
        addLog('Show timeline reset to default sequence.');
      } else {
        addLog(`Error resetting show: ${data.error}`);
      }
    } catch (e) {
      addLog(`Failed to reset show: ${(e as Error).message}`);
    }
  };

  const importShow = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const importedBlocks = Array.isArray(parsed) ? parsed : parsed.blocks;
      if (!Array.isArray(importedBlocks)) {
        throw new Error('JSON must contain a blocks array.');
      }
      setBlocks(sortTimelineBlocks(importedBlocks));
      setSelectedBlockId(null);
      setShowDirty(true);
      addLog(`Imported ${importedBlocks.length} show segments. Save to apply on backend.`);
    } catch (e) {
      addLog(`Failed to import show: ${(e as Error).message}`);
    } finally {
      if (importShowFileRef.current) {
        importShowFileRef.current.value = '';
      }
    }
  };

  const saveConfig = async () => {
    const errors = configHealth.filter((item) => item.level === 'error');
    if (errors.length > 0) {
      addLog(`Config save blocked: ${errors.length} error(s) must be fixed.`);
      return;
    }

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.success) {
        addLog('Configuration successfully saved to backend config.json');
      } else {
        const health = Array.isArray(data.health) ? data.health as ConfigHealthItem[] : [];
        addLog(`Error saving config: ${data.error}${health.length ? ` (${health.filter((item) => item.level === 'error').length} validation error(s))` : ''}`);
      }
    } catch (e) {
      addLog(`Failed to connect to backend: ${(e as Error).message}`);
    }
  };

  const updateLedWallConfig = (key: string, value: number) => {
    setConfig((prev: any) => ({
      ...prev,
      ledWall: {
        ...prev.ledWall,
        [key]: value,
      },
    }));
  };

  const updateMovingHeadsConfig = (key: string, value: number) => {
    setConfig((prev: any) => ({
      ...prev,
      fixtures: {
        ...prev.fixtures,
        movingHeads: {
          ...prev.fixtures?.movingHeads,
          [key]: value,
        },
      },
    }));
  };

  const deriveLedWallWiringFromSize = () => {
    setConfig((prev: any) => {
      const ledWall = prev.ledWall || {};
      const visibleWidth = Math.max(1, Number(ledWall.visibleWidth) || 128);
      const visibleHeight = Math.max(1, Number(ledWall.visibleHeight) || 128);
      const hiddenStartLeds = Math.max(0, Number(ledWall.hiddenStartLeds) || 0);
      const hiddenBetweenRunsLeds = Math.max(0, Number(ledWall.hiddenBetweenRunsLeds) || 0);
      const hiddenEndLeds = Math.max(0, Number(ledWall.hiddenEndLeds) || 0);

      return {
        ...prev,
        ledWall: {
          ...ledWall,
          strips: Math.ceil(visibleWidth / 2),
          ledsPerStrip: visibleHeight * 2 + hiddenStartLeds + hiddenBetweenRunsLeds + hiddenEndLeds,
        },
      };
    });
    addLog('Derived strip count and LEDs per strip from visible wall size.');
  };

  const regeneratePhysicalMapping = async () => {
    const errors = configHealth.filter((item) => item.level === 'error');
    if (errors.length > 0) {
      addLog(`Mapping regeneration blocked: ${errors.length} config error(s) must be fixed.`);
      return;
    }

    try {
      const res = await fetch('/api/config/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ledWall: config.ledWall,
          fixtures: config.fixtures,
          controllerIps: config.controllers.map((ctrl: any) => ctrl.ip),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
        addLog(`Regenerated mapping: ${data.summary.totalEntities} entities, ${data.summary.controllers} controllers.`);
      } else {
        addLog(`Error regenerating mapping: ${data.error}`);
      }
    } catch (e) {
      addLog(`Failed to regenerate mapping: ${(e as Error).message}`);
    }
  };

  const demoProgress = Math.min(100, Math.max(0, (currentTime / SHOW_DURATION_SECONDS) * 100));
  const configuredControllers = config?.controllers?.length || 0;
  const configuredEntities = Object.keys(config?.entityMap || {}).length;
  const demoLanes = new Set(blocks.map((block) => block.lane));
  const demoReady = wsConnected && configuredControllers > 0 && configuredEntities > 0 && blocks.length > 0;
  const toggleBenchmark = () => {
    blurAll();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: telemetry.benchmarkActive ? 'benchmark-stop' : 'benchmark-start' }));
    }
    addLog(telemetry.benchmarkActive ? 'Stopping routing benchmark.' : 'Starting full wall routing benchmark.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* 1. Header */}
      <header className="app-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-muted)' }}>
        <div className="app-brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>AT</span>
          <div>
            <h1 style={{ fontSize: '1.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>OSTERREICH</h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Son & Lumiere Master Controller</span>
          </div>
        </div>

        {/* Telemetry Display */}
        <div className="app-telemetry" style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>ArtNet Pipeline</span>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.9rem', color: 'var(--color-gold)' }}>
              {telemetry.fps} FPS | {telemetry.packetsPerSec} pkt/s | {telemetry.kbps} kbps
            </span>
          </div>

          <div style={{ textAlign: 'right' }}>
            <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Unity eHub Target</span>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.9rem', color: 'var(--color-cyan)' }}>
              {telemetry.ehubPacketsPerSec} pkt/s (UDP 5000)
            </span>
          </div>

          <div className={`badge ${wsConnected ? 'badge-green' : 'badge-red'}`} style={{ gap: '4px' }}>
            <Radio size={14} />
            {wsConnected ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>
      </header>

      {/* 2. Navigation */}
      <div className="app-navigation" style={{ display: 'flex', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-muted)', padding: '0 24px' }}>
        <button
          data-testid="nav-dashboard"
          className="secondary"
          style={{ borderRadius: '0', borderBottom: activeTab === 'dashboard' ? '2px solid var(--color-red)' : 'none', color: activeTab === 'dashboard' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          onClick={() => setActiveTab('dashboard')}
        >
          <Activity size={16} style={{ marginRight: '6px', display: 'inline' }} /> Dashboard
        </button>
        <button
          data-testid="nav-timeline"
          className="secondary"
          style={{ borderRadius: '0', borderBottom: activeTab === 'timeline' ? '2px solid var(--color-red)' : 'none', color: activeTab === 'timeline' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          onClick={() => setActiveTab('timeline')}
        >
          <Cpu size={16} style={{ marginRight: '6px', display: 'inline' }} /> Timeline Editor
        </button>
        <button
          data-testid="nav-images"
          className="secondary"
          style={{ borderRadius: '0', borderBottom: activeTab === 'images' ? '2px solid var(--color-red)' : 'none', color: activeTab === 'images' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          onClick={() => setActiveTab('images')}
        >
          <ImagePlus size={16} style={{ marginRight: '6px', display: 'inline' }} /> Image Studio
        </button>
        <button
          className="secondary"
          style={{ borderRadius: '0', borderBottom: activeTab === 'debug' ? '2px solid var(--color-red)' : 'none', color: activeTab === 'debug' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          onClick={() => setActiveTab('debug')}
        >
          <Radio size={16} style={{ marginRight: '6px', display: 'inline' }} /> Debug Monitor
        </button>
        <button
          className="secondary"
          style={{ borderRadius: '0', borderBottom: activeTab === 'ehub' ? '2px solid var(--color-red)' : 'none', color: activeTab === 'ehub' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          onClick={() => setActiveTab('ehub')}
        >
          <Cpu size={16} style={{ marginRight: '6px', display: 'inline' }} /> eHub Monitor
        </button>
        <button
          className="secondary"
          style={{ borderRadius: '0', borderBottom: activeTab === 'config' ? '2px solid var(--color-red)' : 'none', color: activeTab === 'config' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          onClick={() => setActiveTab('config')}
        >
          <Settings size={16} style={{ marginRight: '6px', display: 'inline' }} /> Hardware Config
        </button>
      </div>

      {/* 3. Content */}
      <main style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'dashboard' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', flex: 1 }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Visualizer frameState={frameState} config={config} />

              {/* Diagnostic Panel */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>Diagnostic Reseau</h3>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      blurAll();
                      runPingDiagnostics();
                    }}
                    disabled={isPinging}
                    style={{ backgroundColor: 'var(--color-accent)', fontSize: '0.8rem', padding: '8px 14px' }}
                  >
                    {isPinging ? 'Diagnostic...' : 'Tester Connectivite Wifi (Ping)'}
                  </button>
                  <button
                    onClick={() => {
                      blurAll();
                      addLog('Sending TEST ALL controllers...');
                      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: 'test-all' }));
                      }
                    }}
                    style={{ 
                      backgroundColor: telemetry.activeTestPattern?.type === 'all' ? 'hsl(260, 80%, 55%)' : 'hsl(260, 60%, 45%)', 
                      fontSize: '0.8rem', 
                      padding: '8px 14px',
                      border: telemetry.activeTestPattern?.type === 'all' ? '2px solid white' : 'none',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    {telemetry.activeTestPattern?.type === 'all' ? 'STOP TEST ALL' : 'Test ALL (R/G/B/Y)'}
                  </button>
                  {(config?.controllers || []).map((ctrl: any, i: number) => {
                    const colors = ['#ef4444', '#22c55e', '#3b82f6', '#eab308'];
                    const labels = ['RED', 'GREEN', 'BLUE', 'YELLOW'];
                    const isActive = telemetry.activeTestPattern?.type === 'controller' && telemetry.activeTestPattern?.controllerIdx === i;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          blurAll();
                          const colorMap = [[255,0,0],[0,255,0],[0,0,255],[255,255,0]];
                          addLog(`Testing controller ${ctrl.ip} (${labels[i]})...`);
                          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                            wsRef.current.send(JSON.stringify({ type: 'test-controller', controllerIdx: i, color: colorMap[i] }));
                          }
                        }}
                        style={{ 
                          backgroundColor: colors[i], 
                          color: i === 3 ? '#000' : '#fff', 
                          fontSize: '0.75rem', 
                          padding: '6px 10px',
                          border: isActive ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.1)',
                          boxShadow: isActive ? `0 0 12px ${colors[i]}` : 'none',
                          fontWeight: isActive ? 'bold' : 'normal',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                      >
                        {isActive ? `${labels[i]} (Streaming)` : ctrl.ip}
                      </button>
                    );
                  })}
                </div>

                {Object.keys(pingStatus).length > 0 && (
                  <div style={{ fontSize: '0.8rem', backgroundColor: 'var(--bg-base)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-muted)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Resultats Ping Wifi</div>
                    {Object.entries(pingStatus).map(([ip, data]: any) => (
                      <div key={ip} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--text-primary)' }}>{ip}</span>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.75rem', fontFamily: 'JetBrains Mono', color: 'var(--text-muted)' }}>{data.latency}</span>
                          <span className={`badge ${data.status === 'ONLINE' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
                            {data.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {telemetry.packetCountPerIp && (
                  <div style={{ fontSize: '0.8rem', fontFamily: 'JetBrains Mono', backgroundColor: 'var(--bg-base)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-muted)' }}>
                    <div style={{ marginBottom: '6px', color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase' }}>Packets envoyes par controleur (total)</div>
                    {Object.entries(telemetry.packetCountPerIp).length === 0 ? (
                      <div style={{ color: 'var(--text-muted)' }}>Aucun paquet envoye</div>
                    ) : (
                      Object.entries(telemetry.packetCountPerIp).map(([ip, count]) => (
                        <div key={ip} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                          <span style={{ color: 'var(--text-primary)' }}>{ip}</span>
                          <span style={{ color: (count as number) > 0 ? '#22c55e' : '#ef4444' }}>{String(count)} pkts</span>
                        </div>
                      ))
                    )}
                    <div style={{ marginTop: '6px', borderTop: '1px solid var(--border-muted)', paddingTop: '6px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Loop: {telemetry.loopRunning ? 'Running' : 'Stopped'}
                      {' | '}
                      Override: {telemetry.activeOverride || 'none'}
                      {' | '}
                      Playing: {telemetry.isPlaying ? 'Yes' : 'No'}
                    </div>
                  </div>
                )}
              </div>

              {/* Console log */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: '220px' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '10px' }}>DMX Packet Monitor & Logger</h3>
                <div style={{ flex: 1, backgroundColor: 'hsl(224, 25%, 4%)', borderRadius: '8px', padding: '12px', fontFamily: 'JetBrains Mono', fontSize: '0.8rem', overflowY: 'auto', border: '1px solid var(--border-muted)', color: '#22c55e' }}>
                  {consoleLogs.map((log, i) => (
                    <div key={i} style={{ marginBottom: '4px' }}>{log}</div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Final demo proof panel */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px', border: '1px solid var(--color-gold)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>Restart Final Demo</h3>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>COSMO - Tanzschein / {SHOW_DURATION_SECONDS}s synchronized show</span>
                  </div>
                  <button
                    onClick={handleRestartFinalDemo}
                    disabled={!demoReady || isAnalyzing}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      backgroundColor: demoReady ? 'var(--color-gold)' : 'var(--bg-surface-elevated)',
                      color: demoReady ? '#080b12' : 'var(--text-muted)',
                      fontWeight: 'bold',
                      minWidth: '180px',
                      justifyContent: 'center',
                    }}
                  >
                    <Play size={18} />
                    {isAnalyzing ? 'SYNCING AUDIO' : 'RESTART FROM 0'}
                  </button>
                </div>

                <div style={{ height: '10px', backgroundColor: 'var(--bg-base)', borderRadius: '999px', overflow: 'hidden', border: '1px solid var(--border-muted)' }}>
                  <div style={{ width: `${demoProgress}%`, height: '100%', backgroundColor: 'var(--color-gold)', transition: 'width 120ms linear' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px' }}>
                  <div style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-muted)', borderRadius: '6px', padding: '10px' }}>
                    <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Playback</span>
                    <span style={{ fontFamily: 'JetBrains Mono', color: isPlaying ? '#22c55e' : 'var(--text-primary)' }}>{currentTime.toFixed(2)}s</span>
                  </div>
                  <div style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-muted)', borderRadius: '6px', padding: '10px' }}>
                    <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Devices</span>
                    <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--color-cyan)' }}>{configuredControllers} ctrl / {configuredEntities} ent</span>
                  </div>
                  <div style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-muted)', borderRadius: '6px', padding: '10px' }}>
                    <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Show Lanes</span>
                    <span style={{ fontFamily: 'JetBrains Mono', color: demoLanes.size >= 3 ? '#22c55e' : 'var(--color-gold)' }}>{demoLanes.size}/3 active</span>
                  </div>
                  <div style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-muted)', borderRadius: '6px', padding: '10px' }}>
                    <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Realtime</span>
                    <span style={{ fontFamily: 'JetBrains Mono', color: telemetry.loopRunning ? '#22c55e' : 'var(--text-primary)' }}>{telemetry.fps} FPS / {telemetry.packetsPerSec} pkt/s</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', paddingTop: '2px' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', minWidth: '120px' }}>Current playback</span>
                  <button
                    onClick={handleResumePause}
                    disabled={!isPlaying && currentTime <= 0.05}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                    {isPlaying ? 'PAUSE CURRENT' : currentTime > 0.05 ? 'RESUME CURRENT' : 'NO PAUSED SHOW'}
                  </button>
                  <button className="secondary" onClick={handleStop} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Square size={18} />
                    STOP
                  </button>
                  <button
                    onClick={handleBlackout}
                    style={{
                      backgroundColor: 'hsl(0, 80%, 45%)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      boxShadow: '0 0 15px rgba(220, 20, 20, 0.4)'
                    }}
                  >
                    BLACKOUT
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span className={`badge ${wsConnected ? 'badge-green' : 'badge-red'}`}>WebSocket</span>
                  <span className={`badge ${detectedBeatsCount ? 'badge-green' : 'badge-gold'}`}>{detectedBeatsCount ? `${detectedBeatsCount} beats synced` : 'Audio analysis pending'}</span>
                  <span className={`badge ${showDirty ? 'badge-red' : 'badge-green'}`}>{showDirty ? 'Save show pending' : 'Show saved'}</span>
                  <span className={`badge ${configuredControllers > 0 ? 'badge-green' : 'badge-red'}`}>Physical config</span>
                  <span className={`badge ${telemetry.droppedFrames === 0 ? 'badge-green' : 'badge-red'}`}>{telemetry.droppedFrames ?? 0} dropped</span>
                  <span className="badge badge-cyan">{telemetry.avgFrameTimeMs ?? 0}ms avg</span>
                </div>
              </div>

              {/* Live Overrides - Clickable buttons + keyboard */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>Live Overrides (P6)</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Clique ou maintiens la touche clavier. Fonctionne SANS lancer le show.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { key: 'space', label: 'Austrian Flag Cross', color: 'badge-red', kbd: 'ESPACE' },
                    { key: 'a', label: 'Gold Imperial Sparkles', color: 'badge-gold', kbd: 'A' },
                    { key: 'l', label: 'Lyres Sky Strobe', color: 'badge-cyan', kbd: 'L' },
                    { key: 'c', label: 'Singer COSMO (Star Eye)', color: 'badge-blue', kbd: 'C' },
                    { key: 'g', label: 'Dancer Gazelle Mask', color: 'badge-cyan', kbd: 'G' },
                    { key: 'm', label: 'Dancer Gorilla Mask', color: 'badge-green', kbd: 'M' },
                    { key: 'n', label: 'Dancer Lion Mask', color: 'badge-orange', kbd: 'N' },
                  ].map(({ key, label, color, kbd }) => (
                    <button
                      key={key}
                      onMouseDown={() => {
                        setInteractiveOverride(key);
                        addLog(`Override ACTIVATED: ${key.toUpperCase()}`);
                        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                          wsRef.current.send(JSON.stringify({ type: 'override', key }));
                        }
                      }}
                      onMouseUp={() => {
                        setInteractiveOverride(null);
                        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                          wsRef.current.send(JSON.stringify({ type: 'override', key: null }));
                        }
                      }}
                      onMouseLeave={() => {
                        if (interactiveOverride === key) {
                          setInteractiveOverride(null);
                          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                            wsRef.current.send(JSON.stringify({ type: 'override', key: null }));
                          }
                        }
                      }}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 14px', backgroundColor: interactiveOverride === key ? 'rgba(230,20,30,0.15)' : 'var(--bg-base)',
                        borderRadius: '6px', border: interactiveOverride === key ? '1px solid var(--color-red)' : '1px solid var(--border-muted)',
                        cursor: 'pointer', width: '100%', textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: '0.9rem' }}>[{kbd}] {label}</span>
                      <span className={`badge ${interactiveOverride === key ? color : 'secondary'}`}>
                        {interactiveOverride === key ? 'ACTIVE' : 'READY'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Beat Detector Panel */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>Beat Detector & Audio Sync</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Analyse le fichier audio pour extraire les transitoires (Kicks, impacts) et les synchroniser avec le serveur DMX.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button
                    onClick={() => {
                      blurAll();
                      runBeatAnalysis();
                    }}
                    disabled={isAnalyzing}
                    style={{ 
                      backgroundColor: 'var(--color-primary)', 
                      color: 'white',
                      fontSize: '0.85rem', 
                      padding: '10px 16px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '8px',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    <Volume2 size={16} />
                    {isAnalyzing ? "Analyse en cours..." : "Analyser Rythmique MP3"}
                  </button>
                  {analysisStatus && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-accent)', padding: '6px', borderRadius: '4px', backgroundColor: 'rgba(0,255,255,0.05)', border: '1px solid rgba(0,255,255,0.1)' }}>
                      {analysisStatus}
                    </div>
                  )}
                  {detectedBeatsCount !== null && (
                    <div style={{ fontSize: '0.8rem', color: '#22c55e' }}>
                      {detectedBeatsCount} impacts rythmiques enregistres et synchronises !
                    </div>
                  )}
                </div>
              </div>

              {/* Diagnostic Panel */}
              <div className="card" style={{ display: 'none' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>Diagnostic Reseau</h3>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      blurAll();
                      runPingDiagnostics();
                    }}
                    disabled={isPinging}
                    style={{ backgroundColor: 'var(--color-accent)', fontSize: '0.8rem', padding: '8px 14px' }}
                  >
                    {isPinging ? 'Diagnostic...' : 'Tester Connectivite Wifi (Ping)'}
                  </button>
                  <button
                    onClick={() => {
                      blurAll();
                      addLog('Sending TEST ALL controllers...');
                      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: 'test-all' }));
                      }
                    }}
                    style={{ 
                      backgroundColor: telemetry.activeTestPattern?.type === 'all' ? 'hsl(260, 80%, 55%)' : 'hsl(260, 60%, 45%)', 
                      fontSize: '0.8rem', 
                      padding: '8px 14px',
                      border: telemetry.activeTestPattern?.type === 'all' ? '2px solid white' : 'none',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    {telemetry.activeTestPattern?.type === 'all' ? 'STOP TEST ALL' : 'Test ALL (R/G/B/Y)'}
                  </button>
                  {(config?.controllers || []).map((ctrl: any, i: number) => {
                    const colors = ['#ef4444', '#22c55e', '#3b82f6', '#eab308'];
                    const labels = ['RED', 'GREEN', 'BLUE', 'YELLOW'];
                    const isActive = telemetry.activeTestPattern?.type === 'controller' && telemetry.activeTestPattern?.controllerIdx === i;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          blurAll();
                          const colorMap = [[255,0,0],[0,255,0],[0,0,255],[255,255,0]];
                          addLog(`Testing controller ${ctrl.ip} (${labels[i]})...`);
                          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                            wsRef.current.send(JSON.stringify({ type: 'test-controller', controllerIdx: i, color: colorMap[i] }));
                          }
                        }}
                        style={{ 
                          backgroundColor: colors[i], 
                          color: i === 3 ? '#000' : '#fff', 
                          fontSize: '0.75rem', 
                          padding: '6px 10px',
                          border: isActive ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.1)',
                          boxShadow: isActive ? `0 0 12px ${colors[i]}` : 'none',
                          fontWeight: isActive ? 'bold' : 'normal',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                      >
                        {isActive ? `${labels[i]} (Streaming)` : ctrl.ip}
                      </button>
                    );
                  })}
                </div>

                {/* Ping results */}
                {Object.keys(pingStatus).length > 0 && (
                  <div style={{ fontSize: '0.8rem', backgroundColor: 'var(--bg-base)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-muted)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Resultats Ping Wifi</div>
                    {Object.entries(pingStatus).map(([ip, data]: any) => (
                      <div key={ip} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--text-primary)' }}>{ip}</span>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.75rem', fontFamily: 'JetBrains Mono', color: 'var(--text-muted)' }}>{data.latency}</span>
                          <span className={`badge ${data.status === 'ONLINE' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
                            {data.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Per-IP packet counts */}
                {telemetry.packetCountPerIp && (
                  <div style={{ fontSize: '0.8rem', fontFamily: 'JetBrains Mono', backgroundColor: 'var(--bg-base)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-muted)' }}>
                    <div style={{ marginBottom: '6px', color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase' }}>Packets envoyes par controleur (total)</div>
                    {Object.entries(telemetry.packetCountPerIp).length === 0 ? (
                      <div style={{ color: 'var(--text-muted)' }}>Aucun paquet envoye</div>
                    ) : (
                      Object.entries(telemetry.packetCountPerIp).map(([ip, count]) => (
                        <div key={ip} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                          <span style={{ color: 'var(--text-primary)' }}>{ip}</span>
                          <span style={{ color: (count as number) > 0 ? '#22c55e' : '#ef4444' }}>{String(count)} pkts</span>
                        </div>
                      ))
                    )}
                    <div style={{ marginTop: '6px', borderTop: '1px solid var(--border-muted)', paddingTop: '6px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Loop: {telemetry.loopRunning ? 'Running' : 'Stopped'}
                      {' | '}
                      Override: {telemetry.activeOverride || 'none'}
                      {' | '}
                      Playing: {telemetry.isPlaying ? 'Yes' : 'No'}
                    </div>
                  </div>
                )}
              </div>

              {/* Console log */}
              <div className="card" style={{ display: 'none' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '10px' }}>DMX Packet Monitor & Logger</h3>
                <div style={{ flex: 1, backgroundColor: 'hsl(224, 25%, 4%)', borderRadius: '8px', padding: '12px', fontFamily: 'JetBrains Mono', fontSize: '0.8rem', overflowY: 'auto', border: '1px solid var(--border-muted)', color: '#22c55e' }}>
                  {consoleLogs.map((log, i) => (
                    <div key={i} style={{ marginBottom: '4px' }}>{log}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'timeline' && (
          <ShowEditor
            show={showDocument}
            dirty={showDocumentDirty}
            connected={wsConnected}
            serverPlaying={isPlaying}
            serverTime={currentTime}
            onChange={(next) => {
              setShowDocument(next);
              setShowDocumentDirty(true);
            }}
            onSave={saveShowDocument}
            onGoLive={playShowDocumentFromFrame}
            onStopLive={handleStop}
            onLog={addLog}
          />
        )}

        {false && activeTab === 'timeline' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
            
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem' }}>Show Authoring Timeline</h3>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Track: COSMO - Tanzschein ({SHOW_DURATION_SECONDS}s)</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span className={`badge ${showDirty ? 'badge-red' : 'badge-green'}`}>{showDirty ? 'UNSAVED' : 'SAVED'}</span>
                  <button className="secondary" onClick={() => addTimelineBlock('wall')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Plus size={15} /> Wall</button>
                  <button className="secondary" onClick={() => addTimelineBlock('lyres')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Plus size={15} /> Lyres</button>
                  <button className="secondary" onClick={() => addTimelineBlock('static')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Plus size={15} /> Spot</button>
                  <button onClick={saveShow}>Save Show</button>
                </div>
              </div>
 
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'var(--bg-base)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-accent)' }}>
                {/* Lane 1 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div style={{ width: '100px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>LED Wall Lane</div>
                  <div style={{ flex: 1, height: '40px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '6px', position: 'relative', overflow: 'hidden' }}>
                    {blocks.filter(b => b.lane === 'wall').map(b => (
                      <div
                        key={b.id}
                        onClick={() => setSelectedBlockId(b.id)}
                        style={{
                          position: 'absolute',
                          left: `${(b.startTime / SHOW_DURATION_SECONDS) * 100}%`,
                          width: `${((b.endTime - b.startTime) / SHOW_DURATION_SECONDS) * 100}%`,
                          height: '100%',
                          backgroundColor: 'rgba(230, 20, 30, 0.25)',
                          border: selectedBlockId === b.id ? '2px solid var(--color-red)' : '1px solid var(--color-red)',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: '8px',
                          fontSize: '0.75rem',
                          color: '#fff',
                          cursor: 'pointer',
                        }}
                      >
                        {b.name}
                      </div>
                    ))}
                  </div>
                </div>
 
                {/* Lane 2 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div style={{ width: '100px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Moving Heads</div>
                  <div style={{ flex: 1, height: '40px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '6px', position: 'relative', overflow: 'hidden' }}>
                    {blocks.filter(b => b.lane === 'lyres').map(b => (
                      <div
                        key={b.id}
                        onClick={() => setSelectedBlockId(b.id)}
                        style={{
                          position: 'absolute',
                          left: `${(b.startTime / SHOW_DURATION_SECONDS) * 100}%`,
                          width: `${((b.endTime - b.startTime) / SHOW_DURATION_SECONDS) * 100}%`,
                          height: '100%',
                          backgroundColor: 'rgba(235, 180, 45, 0.2)',
                          border: selectedBlockId === b.id ? '2px solid var(--color-gold)' : '1px solid var(--color-gold)',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: '8px',
                          fontSize: '0.75rem',
                          color: '#fff',
                          cursor: 'pointer',
                        }}
                      >
                        {b.name}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Lane 3 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <div style={{ width: '100px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Static Spotlight</div>
                  <div style={{ flex: 1, height: '40px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '6px', position: 'relative', overflow: 'hidden' }}>
                    {blocks.filter(b => b.lane === 'static').map(b => (
                      <div
                        key={b.id}
                        onClick={() => setSelectedBlockId(b.id)}
                        style={{
                          position: 'absolute',
                          left: `${(b.startTime / SHOW_DURATION_SECONDS) * 100}%`,
                          width: `${((b.endTime - b.startTime) / SHOW_DURATION_SECONDS) * 100}%`,
                          height: '100%',
                          backgroundColor: 'rgba(59, 130, 246, 0.25)',
                          border: selectedBlockId === b.id ? '2px solid var(--color-cyan)' : '1px solid var(--color-cyan)',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: '8px',
                          fontSize: '0.75rem',
                          color: '#fff',
                          cursor: 'pointer',
                        }}
                      >
                        {b.name}
                      </div>
                    ))}
                  </div>
                </div>
 
                {/* Slider */}
                <div style={{ position: 'relative', height: '24px', marginTop: '10px' }}>
                  <input
                    type="range"
                    min={0}
                    max={SHOW_DURATION_SECONDS}
                    step={0.1}
                    value={currentTime}
                    disabled // Driven strictly by server playback loop
                    style={{ width: '100%', cursor: 'not-allowed' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'JetBrains Mono' }}>
                    <span>0s (Buildup End)</span>
                    <span>3.0s (Drop 1)</span>
                    <span>20.0s (Verse 2)</span>
                    <span>32.0s (Buildup 2)</span>
                    <span>40.0s (Drop 2)</span>
                    <span>45s (End)</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginTop: '16px' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button className="secondary" onClick={duplicateSelectedBlock} disabled={!selectedBlockId}>Duplicate Segment</button>
                    <button className="secondary" onClick={deleteSelectedBlock} disabled={!selectedBlockId} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Trash2 size={15} /> Delete</button>
                    <button className="secondary" onClick={resetShow}>Reset Default Show</button>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <input
                      ref={importShowFileRef}
                      type="file"
                      accept="application/json,.json"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) importShow(file);
                      }}
                      style={{ display: 'none' }}
                    />
                    <button className="secondary" onClick={() => importShowFileRef.current?.click()}>Import Show JSON</button>
                    <button
                      className="secondary"
                      onClick={() => {
                        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ duration: SHOW_DURATION_SECONDS, blocks }, null, 2));
                        const dlAnchorElem = document.createElement('a');
                        dlAnchorElem.setAttribute("href", dataStr);
                        dlAnchorElem.setAttribute("download", "show.json");
                        dlAnchorElem.click();
                        addLog('Exported show JSON file to browser download folder.');
                      }}
                    >
                      Export Show JSON
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Block Editor */}
            {selectedBlockId && (
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '1.1rem' }}>Animation Segment</h3>
                  <span className={`badge ${LANE_COLORS[blocks.find(b => b.id === selectedBlockId)?.lane || 'wall'].badge}`}>
                    {LANE_LABELS[blocks.find(b => b.id === selectedBlockId)?.lane || 'wall']}
                  </span>
                </div>

                {(() => {
                  const block = blocks.find(b => b.id === selectedBlockId)!;
                  const params = getEffectParams(block);
                  return (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Block Name</label>
                          <input
                            type="text"
                            value={block.name}
                            onChange={(event) => updateSelectedBlock({ name: event.target.value })}
                          />

                          <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Target Lane</label>
                          <select
                            value={block.lane}
                            onChange={(event) => {
                              const lane = event.target.value as TimelineBlock['lane'];
                              updateSelectedBlock({
                                lane,
                                type: EFFECT_OPTIONS[lane][0].value,
                                name: EFFECT_OPTIONS[lane][0].label,
                                params: { ...DEFAULT_EFFECT_PARAMS },
                              });
                            }}
                          >
                            <option value="wall">LED Wall</option>
                            <option value="lyres">Moving Heads</option>
                            <option value="static">Static Spotlight</option>
                          </select>

                          <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Animation Pattern</label>
                          <select
                            value={block.type}
                            onChange={(event) => {
                              const selectedEffect = EFFECT_OPTIONS[block.lane].find((effect) => effect.value === event.target.value);
                              updateSelectedBlock({
                                type: event.target.value,
                                name: selectedEffect?.label || block.name,
                              });
                            }}
                          >
                            {EFFECT_OPTIONS[block.lane].map((effect) => (
                              <option key={effect.value} value={effect.value}>{effect.label}</option>
                            ))}
                          </select>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Start Time (seconds)</label>
                          <input
                            type="number"
                            step={0.1}
                            min={0}
                            max={SHOW_DURATION_SECONDS}
                            value={block.startTime}
                            onChange={(event) => updateSelectedBlock({ startTime: Number(event.target.value) })}
                          />

                          <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>End Time (seconds)</label>
                          <input
                            type="number"
                            step={0.1}
                            min={0.1}
                            max={SHOW_DURATION_SECONDS}
                            value={block.endTime}
                            onChange={(event) => updateSelectedBlock({ endTime: Number(event.target.value) })}
                          />

                          <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Quick Position</label>
                          <input
                            type="range"
                            min={0}
                            max={SHOW_DURATION_SECONDS}
                            step={0.1}
                            value={block.startTime}
                            onChange={(event) => {
                              const duration = block.endTime - block.startTime;
                              const startTime = Number(event.target.value);
                              updateSelectedBlock({
                                startTime,
                                endTime: Math.min(SHOW_DURATION_SECONDS, startTime + duration),
                              });
                            }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', padding: '14px', backgroundColor: 'var(--bg-base)', borderRadius: '8px', border: '1px solid var(--border-muted)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Color
                            <input
                              type="color"
                              value={params.color}
                              onChange={(event) => updateSelectedBlockParams({ color: event.target.value })}
                              style={{ height: '38px', padding: '3px' }}
                            />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Intensity {Math.round(params.intensity * 100)}%
                            <input
                              type="range"
                              min={0}
                              max={1.5}
                              step={0.05}
                              value={params.intensity}
                              onChange={(event) => updateSelectedBlockParams({ intensity: Number(event.target.value) })}
                            />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Speed x{params.speed.toFixed(2)}
                            <input
                              type="range"
                              min={0.25}
                              max={3}
                              step={0.05}
                              value={params.speed}
                              onChange={(event) => updateSelectedBlockParams({ speed: Number(event.target.value) })}
                            />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Strobe {Math.round(params.strobe * 100)}%
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={params.strobe}
                              onChange={(event) => updateSelectedBlockParams({ strobe: Number(event.target.value) })}
                            />
                          </label>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
                          <div style={{ height: '72px', borderRadius: '8px', border: '1px solid var(--border-accent)', background: `linear-gradient(135deg, ${params.color}, rgba(0,0,0,${Math.max(0, 1 - params.intensity)}))`, boxShadow: previewingBlockId === block.id ? `0 0 18px ${params.color}` : 'none' }} />
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                              {block.lane.toUpperCase()} / {block.type} / {(block.endTime - block.startTime).toFixed(1)}s
                            </div>
                            <button className={previewingBlockId === block.id ? '' : 'secondary'} onClick={() => previewSelectedBlock(block)}>
                              {previewingBlockId === block.id ? 'Stop Preview' : 'Preview Segment'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {activeTab === 'images' && <ImageStudio config={config} />}

        {activeTab === 'debug' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem' }}>DMX / ArtNet Debug Monitor</h3>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Live snapshot before ArtNet encapsulation and network send.</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className={telemetry.benchmarkActive ? '' : 'secondary'}
                    onClick={toggleBenchmark}
                  >
                    {telemetry.benchmarkActive ? 'Stop Stress Test' : 'Full Wall Stress Test'}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setSelectedUniverseKey('');
                      setDmxMonitor(null);
                    }}
                  >
                    Refresh Snapshot
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '10px' }}>
                {[
                  ['Loop', dmxMonitor?.loopRunning ? 'RUNNING' : 'STOPPED', dmxMonitor?.loopRunning ? '#22c55e' : 'var(--text-muted)'],
                  ['Buffers', String(dmxMonitor?.bufferCount ?? 0), 'var(--color-cyan)'],
                  ['Entities', String(dmxMonitor?.entityCount ?? 0), 'var(--color-gold)'],
                  ['Dirty/frame', String(dmxMonitor?.dirtyUniverses?.length ?? 0), 'var(--color-red)'],
                  ['Packets', String(dmxMonitor?.lastArtNetPackets?.length ?? 0), '#22c55e'],
                  ['Benchmark', telemetry.benchmarkActive ? 'ACTIVE' : 'IDLE', telemetry.benchmarkActive ? '#22c55e' : 'var(--text-muted)'],
                ].map(([label, value, color]) => (
                  <div key={label} style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-muted)', borderRadius: '6px', padding: '10px' }}>
                    <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                    <span style={{ fontFamily: 'JetBrains Mono', color }}>{value}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '10px' }}>
                {[
                  ['FPS', telemetry.fps ?? 0],
                  ['Avg frame', `${telemetry.avgFrameTimeMs ?? 0}ms`],
                  ['Max frame', `${telemetry.maxFrameTimeMs ?? 0}ms`],
                  ['Dirty U/frame', telemetry.dirtyUniversesPerFrame ?? 0],
                  ['ArtNet/frame', telemetry.artNetPacketsPerFrame ?? 0],
                ].map(([label, value]) => (
                  <div key={label} style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-muted)', borderRadius: '6px', padding: '10px' }}>
                    <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                    <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--text-primary)' }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.7fr', gap: '20px' }}>
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '1rem' }}>Universe Buffer</h3>
                  <select
                    value={selectedUniverseKey}
                    onChange={(event) => setSelectedUniverseKey(event.target.value)}
                    style={{ minWidth: '220px' }}
                  >
                    {(dmxMonitor?.availableUniverses || []).map((key) => (
                      <option key={key} value={key}>{key}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '4px' }}>
                  {(dmxMonitor?.selectedUniverse?.firstChannels || Array.from({ length: 96 }, () => 0)).map((value, channel) => (
                    <div
                      key={channel}
                      title={`CH ${channel}: ${value}`}
                      style={{
                        height: '34px',
                        borderRadius: '4px',
                        border: '1px solid var(--border-muted)',
                        backgroundColor: value > 0 ? `rgba(34, 197, 94, ${Math.max(0.12, value / 255)})` : 'var(--bg-base)',
                        color: value > 160 ? '#020617' : 'var(--text-secondary)',
                        fontFamily: 'JetBrains Mono',
                        fontSize: '0.65rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {value}
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Non-zero channels: {dmxMonitor?.selectedUniverse?.nonZeroCount ?? 0}
                </div>
              </div>

              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <h3 style={{ fontSize: '1rem' }}>Entity Inspector</h3>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Entity ID
                  <input
                    type="number"
                    value={inspectEntityId}
                    onChange={(event) => setInspectEntityId(event.target.value)}
                  />
                </label>
                {dmxMonitor?.inspectedEntity?.target ? (
                  <div style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-muted)', borderRadius: '6px', padding: '10px', fontFamily: 'JetBrains Mono', fontSize: '0.78rem', lineHeight: 1.8 }}>
                    <div>IP: {dmxMonitor.inspectedEntity.target.ip}</div>
                    <div>Universe: {dmxMonitor.inspectedEntity.target.universe}</div>
                    <div>Channel: {dmxMonitor.inspectedEntity.target.channel}</div>
                    <div>Type: {dmxMonitor.inspectedEntity.target.type}</div>
                    <div>Bytes: {(dmxMonitor.inspectedEntity.value?.bytes || []).join(', ')}</div>
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No mapped entity for this ID.</div>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h3 style={{ fontSize: '1rem' }}>Recent ArtNet Packets</h3>
                <div style={{ maxHeight: '260px', overflowY: 'auto', fontFamily: 'JetBrains Mono', fontSize: '0.75rem' }}>
                  {(dmxMonitor?.lastArtNetPackets || []).map((packet, idx) => (
                    <div key={`${packet.sentAt}-${idx}`} style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 0.7fr 0.7fr', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border-muted)' }}>
                      <span>{packet.ip}</span>
                      <span>U {packet.universe}</span>
                      <span>Art {packet.artnetUniverse}</span>
                      <span>{Date.now() - packet.sentAt}ms</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h3 style={{ fontSize: '1rem' }}>Dirty Universes</h3>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {(dmxMonitor?.dirtyUniverses || []).length === 0 ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No dirty universes in last frame.</span>
                  ) : (
                    dmxMonitor!.dirtyUniverses.map((key) => (
                      <button key={key} className="secondary" onClick={() => setSelectedUniverseKey(key)} style={{ fontFamily: 'JetBrains Mono', fontSize: '0.72rem', padding: '5px 8px' }}>
                        {key}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ehub' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem' }}>Unity eHub Monitor</h3>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>UDP state input routed into the same ArtNet pipeline as the show engine.</span>
                </div>
                <button
                  onClick={async () => {
                    try {
                      const response = await fetch('/api/ehub/fake', { method: 'POST' });
                      const data = await response.json();
                      addLog(`Fake eHub packet routed: ${data.entityCount} entities.`);
                      const monitor = await fetch('/api/ehub-monitor');
                      setEhubMonitor(await monitor.json());
                    } catch (e) {
                      addLog(`Fake eHub failed: ${(e as Error).message}`);
                    }
                  }}
                >
                  Send Fake eHub Packet
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '10px' }}>
                {[
                  ['Port', String(ehubMonitor?.listeningPort ?? 5000), 'var(--color-cyan)'],
                  ['Packets/s', String(ehubMonitor?.packetsPerSec ?? 0), '#22c55e'],
                  ['Last entities', String(ehubMonitor?.lastPacket?.entityCount ?? 0), 'var(--color-gold)'],
                  ['Mapped', `${ehubMonitor?.lastPacket?.mappedCount ?? 0}/${ehubMonitor?.lastPacket?.entityCount ?? 0}`, '#22c55e'],
                  ['Loop', ehubMonitor?.loopRunning ? 'RUNNING' : 'IDLE', ehubMonitor?.loopRunning ? '#22c55e' : 'var(--text-muted)'],
                ].map(([label, value, color]) => (
                  <div key={label} style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-muted)', borderRadius: '6px', padding: '10px' }}>
                    <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                    <span style={{ fontFamily: 'JetBrains Mono', color }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ fontSize: '1rem' }}>Recent eHub Packets</h3>
                <div style={{ maxHeight: '360px', overflowY: 'auto', fontFamily: 'JetBrains Mono', fontSize: '0.76rem' }}>
                  {(ehubMonitor?.recentPackets || []).length === 0 ? (
                    <div style={{ color: 'var(--text-muted)' }}>No eHub packet received yet. Use fake packet or start Unity.</div>
                  ) : (
                    ehubMonitor!.recentPackets.map((packet, idx) => (
                      <div key={`${packet.receivedAt}-${idx}`} style={{ display: 'grid', gridTemplateColumns: '0.7fr 0.9fr 0.9fr 0.9fr 1fr', gap: '8px', padding: '8px 0', borderBottom: '1px solid var(--border-muted)' }}>
                        <span className={`badge ${packet.source === 'fake' ? 'badge-gold' : 'badge-green'}`}>{packet.source}</span>
                        <span>{packet.entityCount} ent</span>
                        <span>{packet.mappedCount} mapped</span>
                        <span>{packet.unmappedCount} missed</span>
                        <span>{Date.now() - packet.receivedAt}ms ago</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ fontSize: '1rem' }}>Last Packet Sample</h3>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {(ehubMonitor?.lastPacket?.dirtyUniverses || []).map((key) => (
                    <span key={key} className="badge badge-cyan" style={{ fontFamily: 'JetBrains Mono' }}>{key}</span>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', fontFamily: 'JetBrains Mono', fontSize: '0.75rem' }}>
                  {(ehubMonitor?.lastPacket?.sample || []).map((entity) => (
                    <div key={entity.id} style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-muted)', borderRadius: '6px', padding: '8px' }}>
                      <div style={{ color: 'var(--color-gold)' }}>#{entity.id}</div>
                      <div>R {entity.r} / G {entity.g} / B {entity.b} / W {entity.w}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'config' && config && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem' }}>Config Health</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '4px' }}>
                    Validation du setup physique: IP, univers, canaux DMX, capacite et mapping.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {configHealthSummary.errors > 0 && <span className="badge badge-red">{configHealthSummary.errors} errors</span>}
                  {configHealthSummary.warnings > 0 && <span className="badge badge-gold">{configHealthSummary.warnings} warnings</span>}
                  {configHealthSummary.errors === 0 && configHealthSummary.warnings === 0 && <span className="badge badge-cyan">ready</span>}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
                {configHealth.map((item, index) => {
                  const borderColor = item.level === 'error' ? '#ef4444' : item.level === 'warning' ? 'var(--color-gold)' : 'var(--color-cyan)';
                  const badgeClass = item.level === 'error' ? 'badge-red' : item.level === 'warning' ? 'badge-gold' : 'badge-cyan';
                  return (
                    <div key={`${item.level}-${item.message}-${index}`} style={{ backgroundColor: 'var(--bg-base)', border: `1px solid ${borderColor}`, borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.86rem', fontWeight: 600 }}>{item.message}</span>
                        <span className={`badge ${badgeClass}`}>{item.level}</span>
                      </div>
                      {item.detail && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem', fontFamily: 'JetBrains Mono' }}>{item.detail}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem' }}>Adaptable LED Wall Layout</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '4px' }}>
                    Change la taille visible, le nombre de bandes ou les appareils, puis regenere le mapping physique.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="badge badge-cyan">{config.ledWall?.visibleWidth}x{config.ledWall?.visibleHeight}px</span>
                  <span className="badge badge-gold">{Object.keys(config.entityMap || {}).length} entities</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                {[
                  ['visibleWidth', 'Visible width'],
                  ['visibleHeight', 'Visible height'],
                  ['strips', 'LED strips'],
                  ['ledsPerStrip', 'LEDs per strip'],
                  ['stripsPerController', 'Strips/controller'],
                  ['hiddenStartLeds', 'Hidden start LEDs'],
                  ['hiddenBetweenRunsLeds', 'Hidden top LEDs'],
                  ['hiddenEndLeds', 'Hidden end LEDs'],
                ].map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {label}
                    <input
                      type="number"
                      min={key === 'hiddenStartLeds' || key === 'hiddenBetweenRunsLeds' || key === 'hiddenEndLeds' ? 0 : 1}
                      value={config.ledWall?.[key] ?? 0}
                      onChange={(e) => updateLedWallConfig(key, parseInt(e.target.value, 10) || 0)}
                    />
                  </label>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Moving heads count
                  <input
                    type="number"
                    min={0}
                    value={config.fixtures?.movingHeads?.count ?? 0}
                    onChange={(e) => updateMovingHeadsConfig('count', parseInt(e.target.value, 10) || 0)}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Moving head channels
                  <input
                    type="number"
                    min={1}
                    value={config.fixtures?.movingHeads?.channelsPerFixture ?? 13}
                    onChange={(e) => updateMovingHeadsConfig('channelsPerFixture', parseInt(e.target.value, 10) || 13)}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="secondary" onClick={deriveLedWallWiringFromSize}>Derive wiring from size</button>
                <button onClick={regeneratePhysicalMapping}>Regenerate physical mapping</button>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                  Recalcule controleurs, univers et entityMap depuis la geometrie actuelle.
                </span>
              </div>
            </div>
            
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.1rem' }}>Physical Controller IP Maps (P1)</h3>
                <button
                  onClick={() => {
                    const newIp = prompt('Enter Controller IP Address:', '192.168.1.50');
                    if (newIp) {
                      setConfig((prev: any) => ({
                        ...prev,
                        controllers: [...prev.controllers, { ip: newIp, universes: [] }]
                      }));
                      addLog(`Added physical controller ${newIp}`);
                    }
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '6px 12px' }}
                >
                  <Plus size={14} /> Add Controller
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {config.controllers.map((ctrl: any, i: number) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px', backgroundColor: 'var(--bg-base)', borderRadius: '8px', border: '1px solid var(--border-accent)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: '600', fontFamily: 'JetBrains Mono' }}>{ctrl.ip}</span>
                      <button
                        style={{ backgroundColor: 'transparent', color: '#ef4444', padding: '4px', border: 'none', cursor: 'pointer' }}
                        onClick={() => {
                          setConfig((prev: any) => ({
                            ...prev,
                            controllers: prev.controllers.filter((_: any, idx: number) => idx !== i)
                          }));
                          addLog(`Removed controller ${ctrl.ip}`);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '12px', alignItems: 'center' }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Universes</label>
                        <span style={{ fontSize: '0.75rem', fontFamily: 'JetBrains Mono', color: 'var(--text-muted)' }}>
                          {ctrl.universes.length} ({ctrl.universes[0]}..{ctrl.universes[ctrl.universes.length - 1]})
                        </span>
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>ArtNet Offset</label>
                        <input
                          type="number"
                          value={ctrl.startUniverse ?? 0}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setConfig((prev: any) => {
                              const updated = [...prev.controllers];
                              updated[i] = { ...updated[i], startUniverse: val };
                              return { ...prev, controllers: updated };
                            });
                          }}
                          style={{
                            width: '80px',
                            padding: '4px 8px',
                            backgroundColor: 'var(--bg-card)',
                            border: '1px solid var(--border-muted)',
                            borderRadius: '4px',
                            color: 'var(--text-primary)',
                            fontFamily: 'JetBrains Mono',
                            fontSize: '0.8rem'
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                <button onClick={saveConfig}>Save to config.json</button>
                <button
                  className="secondary"
                  onClick={() => {
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
                    const dlAnchorElem = document.createElement('a');
                    dlAnchorElem.setAttribute("href", dataStr);
                    dlAnchorElem.setAttribute("download", "config.json");
                    dlAnchorElem.click();
                    addLog('Exported configuration JSON file to browser download folder.');
                  }}
                >
                  Export JSON Config
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
