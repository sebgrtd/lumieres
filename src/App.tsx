import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Radio, Cpu, Settings, Activity, Trash2, Plus, Volume2 } from 'lucide-react';
import { Visualizer } from './components/Visualizer.tsx';
import { synthInstance } from './components/AudioEngine.ts';
import { analyzeAudioBeats } from './components/AudioAnalyzer.ts';

interface TimelineBlock {
  id: string;
  lane: 'wall' | 'lyres' | 'static';
  startTime: number;
  endTime: number;
  type: string;
  name: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'timeline' | 'config'>('dashboard');
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

  // Read-only visual tracks representation in UI
  const [blocks, setBlocks] = useState<TimelineBlock[]>([
    { id: '1', lane: 'wall', startTime: 0, endTime: 2.2, type: 'guitar_intro', name: 'Guitar Intro' },
    { id: '2', lane: 'lyres', startTime: 0, endTime: 2.2, type: 'black', name: 'Lyres Off' },
    { id: '3', lane: 'static', startTime: 0, endTime: 2.2, type: 'static_off', name: 'Spotlight Off' },
 
    { id: '4', lane: 'wall', startTime: 2.2, endTime: 5.0, type: 'intro_ticks', name: 'Intro Claps' },
    { id: '5', lane: 'lyres', startTime: 2.2, endTime: 5.0, type: 'lyre_intro', name: 'Intro Silver Sweep' },
    { id: '6', lane: 'static', startTime: 2.2, endTime: 5.0, type: 'static_off', name: 'Spotlight Off' },

    { id: '7', lane: 'wall', startTime: 5.0, endTime: 5.9, type: 'black', name: 'Temps Mort' },
    { id: '8', lane: 'lyres', startTime: 5.0, endTime: 5.9, type: 'black', name: 'Temps Mort' },
    { id: '9', lane: 'static', startTime: 5.0, endTime: 5.9, type: 'static_off', name: 'Temps Mort' },
 
    { id: '10', lane: 'wall', startTime: 5.9, endTime: 13.3, type: 'blue_star_burst', name: 'COSMÓ Blue Star' },
    { id: '11', lane: 'lyres', startTime: 5.9, endTime: 13.3, type: 'lyre_kick_pulse', name: 'Lyres Kick Snap' },
    { id: '12', lane: 'static', startTime: 5.9, endTime: 13.3, type: 'static_measure_pulse', name: 'Spot Blue Pulse' },
 
    { id: '13', lane: 'wall', startTime: 13.3, endTime: 20.7, type: 'quadrant_flashes', name: 'Quadrant Flash' },
    { id: '14', lane: 'lyres', startTime: 13.3, endTime: 20.7, type: 'lyre_circle_color', name: 'Lyres Color Circle' },
    { id: '15', lane: 'static', startTime: 13.3, endTime: 20.7, type: 'static_snare_flash', name: 'Spot Magenta Snare' },
 
    { id: '16', lane: 'wall', startTime: 20.7, endTime: 28.0, type: 'laser_sweeps', name: 'Tanzschein Lasers' },
    { id: '17', lane: 'lyres', startTime: 20.7, endTime: 28.0, type: 'lyre_buildup_strobe', name: 'Lyres Buildup Strobe' },
    { id: '18', lane: 'static', startTime: 20.7, endTime: 28.0, type: 'static_dimmer_rise', name: 'Spot Dimmer Rise' },
 
    { id: '19', lane: 'wall', startTime: 28.0, endTime: 45.0, type: 'reactive_drop', name: 'Tanzschein Drop' },
    { id: '20', lane: 'lyres', startTime: 28.0, endTime: 45.0, type: 'lyre_drop_trap', name: 'Lyres Mirrored Chases' },
    { id: '21', lane: 'static', startTime: 28.0, endTime: 45.0, type: 'static_drop_strobe', name: 'Spot Strobe Drop' }
  ]);

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [interactiveOverride, setInteractiveOverride] = useState<string | null>(null);
  const [frameState, setFrameState] = useState<Record<number, number[]>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const currentTimeRef = useRef(0);

  const [pingStatus, setPingStatus] = useState<Record<string, { status: string; latency: string }>>({});
  const [isPinging, setIsPinging] = useState(false);

  const addLog = (msg: string) => {
    setConsoleLogs((prev) => [ `[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 15) ]);
  };

  const runPingDiagnostics = async () => {
    setIsPinging(true);
    addLog('Démarrage du diagnostic ping des contrôleurs...');
    try {
      const response = await fetch('/api/ping');
      const data = await response.json();
      if (data.success) {
        const resultsMap: Record<string, { status: string; latency: string }> = {};
        data.results.forEach((res: any) => {
          resultsMap[res.ip] = { status: res.status, latency: res.latency };
          addLog(`  IP ${res.ip}: ${res.status === 'ONLINE' ? '🟢 EN LIGNE' : '🔴 HORS LIGNE'} (${res.latency})`);
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
  }, [interactiveOverride]);

  // Keep currentTime ref updated to avoid effect re-triggering during playback
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Sync Synthesizer with backend playback state
  useEffect(() => {
    if (isPlaying) {
      synthInstance.play(currentTimeRef.current, () => {}); // Play locally starting at the ref's current time
    } else {
      synthInstance.pause();
    }
  }, [isPlaying]);

  const handlePlay = () => {
    blurAll();
    if (isPlaying) {
      setIsPlaying(false);
      addLog('Show paused.');
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
    } else {
      setIsPlaying(true);
      addLog('Show playing...');
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'play' }));
      }
    }
  };

  const handleStop = () => {
    blurAll();
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
    synthInstance.stop();
    setIsPlaying(false);
    setCurrentTime(0);
    setFrameState({});
    addLog('BLACKOUT triggered! Turned off all controllers.');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'blackout' }));
    }
  };

  const saveConfig = async () => {
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
        addLog(`Error saving config: ${data.error}`);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* 1. Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-muted)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '2rem' }}>🇦🇹</span>
          <div>
            <h1 style={{ fontSize: '1.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Österreich</h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Son & Lumière Master Controller</span>
          </div>
        </div>

        {/* Telemetry Display */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
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
      <div style={{ display: 'flex', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-muted)', padding: '0 24px' }}>
        <button
          className="secondary"
          style={{ borderRadius: '0', borderBottom: activeTab === 'dashboard' ? '2px solid var(--color-red)' : 'none', color: activeTab === 'dashboard' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          onClick={() => setActiveTab('dashboard')}
        >
          <Activity size={16} style={{ marginRight: '6px', display: 'inline' }} /> Dashboard
        </button>
        <button
          className="secondary"
          style={{ borderRadius: '0', borderBottom: activeTab === 'timeline' ? '2px solid var(--color-red)' : 'none', color: activeTab === 'timeline' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          onClick={() => setActiveTab('timeline')}
        >
          <Cpu size={16} style={{ marginRight: '6px', display: 'inline' }} /> Timeline Editor
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
            
            <Visualizer frameState={frameState} config={config} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Playback controls */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>Playback Controller</h3>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <button onClick={handlePlay} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                    {isPlaying ? 'PAUSE' : 'PLAY SHOW'}
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
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Playback Time</span>
                    <span style={{ fontSize: '1.3rem', fontFamily: 'JetBrains Mono', fontWeight: 'bold' }}>
                      {currentTime.toFixed(2)}s
                    </span>
                  </div>
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
                    { key: 'space', label: '⬜ Austrian Flag Cross', color: 'badge-red', kbd: 'ESPACE' },
                    { key: 'a', label: '✨ Gold Imperial Sparkles', color: 'badge-gold', kbd: 'A' },
                    { key: 'l', label: '💡 Lyres Sky Strobe', color: 'badge-cyan', kbd: 'L' },
                    { key: 'c', label: '🎤 Singer COSMÓ (Star Eye)', color: 'badge-blue', kbd: 'C' },
                    { key: 'g', label: '🦌 Dancer Gazelle Mask', color: 'badge-cyan', kbd: 'G' },
                    { key: 'm', label: '🦍 Dancer Gorilla Mask', color: 'badge-green', kbd: 'M' },
                    { key: 'n', label: '🦁 Dancer Lion Mask', color: 'badge-orange', kbd: 'N' },
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
                <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>📊 Beat Detector & Audio Sync</h3>
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
                    {isAnalyzing ? "🔄 Analyse en cours..." : "🎙️ Analyser Rythmique MP3"}
                  </button>
                  {analysisStatus && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-accent)', padding: '6px', borderRadius: '4px', backgroundColor: 'rgba(0,255,255,0.05)', border: '1px solid rgba(0,255,255,0.1)' }}>
                      {analysisStatus}
                    </div>
                  )}
                  {detectedBeatsCount !== null && (
                    <div style={{ fontSize: '0.8rem', color: '#22c55e' }}>
                      ✅ {detectedBeatsCount} impacts rythmiques enregistrés et synchronisés !
                    </div>
                  )}
                </div>
              </div>

              {/* Diagnostic Panel */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>🔧 Diagnostic Réseau</h3>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      blurAll();
                      runPingDiagnostics();
                    }}
                    disabled={isPinging}
                    style={{ backgroundColor: 'var(--color-accent)', fontSize: '0.8rem', padding: '8px 14px' }}
                  >
                    {isPinging ? '🔄 Diagnostic...' : '📡 Tester Connectivité Wifi (Ping)'}
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
                    🎨 {telemetry.activeTestPattern?.type === 'all' ? '🛑 STOP TEST ALL' : 'Test ALL (R/G/B/Y)'}
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
                        {isActive ? `📡 ${labels[i]} (Streaming)` : ctrl.ip}
                      </button>
                    );
                  })}
                </div>

                {/* Ping results */}
                {Object.keys(pingStatus).length > 0 && (
                  <div style={{ fontSize: '0.8rem', backgroundColor: 'var(--bg-base)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-muted)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Résultats Ping Wifi</div>
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
                    <div style={{ marginBottom: '6px', color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase' }}>Packets envoyés par contrôleur (total)</div>
                    {Object.entries(telemetry.packetCountPerIp).length === 0 ? (
                      <div style={{ color: 'var(--text-muted)' }}>Aucun paquet envoyé</div>
                    ) : (
                      Object.entries(telemetry.packetCountPerIp).map(([ip, count]) => (
                        <div key={ip} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                          <span style={{ color: 'var(--text-primary)' }}>{ip}</span>
                          <span style={{ color: (count as number) > 0 ? '#22c55e' : '#ef4444' }}>{String(count)} pkts</span>
                        </div>
                      ))
                    )}
                    <div style={{ marginTop: '6px', borderTop: '1px solid var(--border-muted)', paddingTop: '6px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Loop: {telemetry.loopRunning ? '✅ Running' : '❌ Stopped'}
                      {' | '}
                      Override: {telemetry.activeOverride || 'none'}
                      {' | '}
                      Playing: {telemetry.isPlaying ? 'Yes' : 'No'}
                    </div>
                  </div>
                )}
              </div>

              {/* Console log */}
              <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '200px' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
            
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.1rem' }}>Show Sequence Ruler</h3>
                <span className="badge badge-gold">Track: COSMÓ - Tanzschein (45s Showcase - Eurovision 2026)</span>
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
                          left: `${(b.startTime / 45) * 100}%`,
                          width: `${((b.endTime - b.startTime) / 45) * 100}%`,
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
                          left: `${(b.startTime / 45) * 100}%`,
                          width: `${((b.endTime - b.startTime) / 45) * 100}%`,
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
                          left: `${(b.startTime / 45) * 100}%`,
                          width: `${((b.endTime - b.startTime) / 45) * 100}%`,
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
                    max={45}
                    step={0.1}
                    value={currentTime}
                    disabled // Driven strictly by server playback loop
                    style={{ width: '100%', cursor: 'not-allowed' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'JetBrains Mono' }}>
                    <span>0s (Intro Ticks)</span>
                    <span>7.4s (Blue Star)</span>
                    <span>14.8s (Quadrants)</span>
                    <span>22.2s (Buildup)</span>
                    <span>29.5s (Tanzschein Drop)</span>
                    <span>45s (End)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Block Editor */}
            {selectedBlockId && (
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '1.1rem' }}>Edit Animation Segment</h3>
                  <button
                    style={{ backgroundColor: '#dc2626', color: '#fff', padding: '6px 12px', fontSize: '0.8rem' }}
                    onClick={() => {
                      setBlocks(prev => prev.filter(b => b.id !== selectedBlockId));
                      setSelectedBlockId(null);
                      addLog('Removed block from timeline.');
                    }}
                  >
                    <Trash2 size={14} style={{ display: 'inline', marginRight: '4px' }} /> Delete Block
                  </button>
                </div>

                {(() => {
                  const block = blocks.find(b => b.id === selectedBlockId);
                  if (!block) return null;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Block Name</label>
                        <input
                          type="text"
                          value={block.name}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, name: val } : b));
                          }}
                        />

                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Animation Pattern</label>
                        <select
                          value={block.type}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, type: val } : b));
                          }}
                        >
                          {block.lane === 'wall' ? (
                            <>
                              <option value="intro_ticks">Intro Ticks</option>
                              <option value="blue_star_burst">COSMÓ Blue Star</option>
                              <option value="quadrant_flashes">Quadrant Flash</option>
                              <option value="laser_sweeps">Tanzschein Lasers</option>
                              <option value="reactive_drop">Tanzschein Drop</option>
                            </>
                          ) : block.lane === 'lyres' ? (
                            <>
                              <option value="lyre_intro">Intro Silver Sweep</option>
                              <option value="lyre_kick_pulse">Lyres Kick Snap</option>
                              <option value="lyre_circle_color">Lyres Color Circle</option>
                              <option value="lyre_buildup_strobe">Lyres Buildup Strobe</option>
                              <option value="lyre_drop_trap">Lyres Mirrored Chases</option>
                            </>
                          ) : (
                            <>
                              <option value="static_off">Spotlight Off</option>
                              <option value="static_measure_pulse">Spot Blue Pulse</option>
                              <option value="static_snare_flash">Spot Magenta Snare</option>
                              <option value="static_dimmer_rise">Spot Dimmer Rise</option>
                              <option value="static_drop_strobe">Spot Strobe Drop</option>
                            </>
                          )}
                        </select>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Start Time (seconds)</label>
                        <input
                          type="number"
                          step={0.1}
                          value={block.startTime}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, startTime: val } : b));
                          }}
                        />

                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>End Time (seconds)</label>
                        <input
                          type="number"
                          step={0.1}
                          value={block.endTime}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, endTime: val } : b));
                          }}
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {activeTab === 'config' && config && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem' }}>Adaptable LED Wall Layout</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '4px' }}>
                    Change la taille visible, le nombre de bandes ou les appareils, puis régénère le mapping physique.
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
                  Recalcule contrôleurs, univers et entityMap depuis la géométrie actuelle.
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
