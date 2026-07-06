import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Radio, Cpu, Settings, Activity, Trash2, Plus, Palette } from 'lucide-react';
import { Visualizer } from './components/Visualizer.tsx';
import { synthInstance } from './components/AudioEngine.ts';
import { PixelArtStudio } from './components/PixelArtStudio.tsx';
import { createBlankPixelArt, type PixelArtFrame } from './types/pixelArt.ts';

interface TimelineBlock {
  id: string;
  lane: 'wall' | 'lyres' | 'static';
  startTime: number;
  endTime: number;
  type: string;
  name: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'timeline' | 'pixelart' | 'config'>('dashboard');
  const [wsConnected, setWsConnected] = useState(false);
  const [telemetry, setTelemetry] = useState<any>({ fps: 0, packetsPerSec: 0, kbps: 0, ehubPacketsPerSec: 0 });
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<string[]>(['System initialized. Austrian theme selected.']);
  const [config, setConfig] = useState<any>(null);
  const [pixelArt, setPixelArt] = useState<PixelArtFrame>(createBlankPixelArt());
  const [pixelArtDirty, setPixelArtDirty] = useState(false);

  // Read-only visual tracks representation in UI
  const [blocks, setBlocks] = useState<TimelineBlock[]>([
    { id: '1', lane: 'wall', startTime: 0, endTime: 12, type: 'radial_ripple', name: 'Waltz Ripples (Red/White)' },
    { id: '2', lane: 'lyres', startTime: 0, endTime: 12, type: 'lyre_waltz', name: 'Slow Gold Waltz Pan/Tilt' },
    { id: '3', lane: 'wall', startTime: 12, endTime: 15, type: 'gradient_sweep', name: 'Speed Up Flag Sweep' },
    { id: '4', lane: 'lyres', startTime: 12, endTime: 15, type: 'lyre_rise', name: 'Beams Rise' },
    { id: '5', lane: 'wall', startTime: 15, endTime: 35, type: 'strobe_flash', name: 'Austria Strobe Drops' },
    { id: '6', lane: 'wall', startTime: 20, endTime: 35, type: 'equalizer', name: 'Trap Audio Spectrum' },
    { id: '7', lane: 'lyres', startTime: 15, endTime: 35, type: 'lyre_trap', name: 'Fast Mirrored Cross Chases' },
  ]);

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [interactiveOverride, setInteractiveOverride] = useState<string | null>(null);
  const [frameState, setFrameState] = useState<Record<number, number[]>>({});

  const wsRef = useRef<WebSocket | null>(null);

  const [pingStatus, setPingStatus] = useState<Record<string, { status: string; latency: string }>>({});
  const [isPinging, setIsPinging] = useState(false);

  const addLog = (msg: string) => {
    setConsoleLogs((prev) => [ `[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 15) ]);
  };

  const sendWsMessage = (payload: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  };

  const clearPixelArtLiveMode = (reason: string) => {
    if (sendWsMessage({ type: 'hide-pixel-art' })) {
      addLog(reason);
    }
  };

  const savePixelArtDraft = () => {
    const sent = sendWsMessage({ type: 'set-pixel-art', data: pixelArt });
    if (sent) {
      setPixelArtDirty(false);
      addLog('Pixel art saved to backend.');
    } else {
      addLog('Cannot save pixel art: WebSocket offline.');
    }
  };

  const publishPixelArtLive = () => {
    const sent = sendWsMessage({ type: 'show-pixel-art', data: pixelArt });
    if (sent) {
      setPixelArtDirty(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setFrameState({});
      addLog('Pixel art published live on the wall.');
    } else {
      addLog('Cannot publish pixel art: WebSocket offline.');
    }
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
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'config') {
          setConfig(msg.data);
        } else if (msg.type === 'pixel-art') {
          setPixelArt(msg.data);
          setPixelArtDirty(false);
        } else if (msg.type === 'telemetry') {
          setTelemetry(msg.data);
        } else if (msg.type === 'frame') {
          // Sync UI clock and pixel visualizer state with backend
          setFrameState(msg.data);
          setCurrentTime(msg.time);
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

  // Sync Synthesizer with backend playback state
  useEffect(() => {
    if (isPlaying) {
      synthInstance.play(() => {}); // Play locally on speakers
    } else {
      synthInstance.pause();
    }
  }, [isPlaying]);

  const handlePlay = () => {
    blurAll();
    if (isPlaying) {
      setIsPlaying(false);
      addLog('Show paused.');
      sendWsMessage({ type: 'stop' });
    } else {
      setIsPlaying(true);
      addLog('Show playing...');
      sendWsMessage({ type: 'play' });
    }
  };

  const handleStop = () => {
    blurAll();
    synthInstance.stop();
    setIsPlaying(false);
    setCurrentTime(0);
    addLog('Show stopped & rewound.');
    sendWsMessage({ type: 'stop' });
  };

  const handleBlackout = () => {
    blurAll();
    synthInstance.stop();
    setIsPlaying(false);
    setCurrentTime(0);
    setFrameState({});
    addLog('BLACKOUT triggered! Turned off all controllers.');
    sendWsMessage({ type: 'blackout' });
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
          style={{ borderRadius: '0', borderBottom: activeTab === 'pixelart' ? '2px solid var(--color-red)' : 'none', color: activeTab === 'pixelart' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          onClick={() => setActiveTab('pixelart')}
        >
          <Palette size={16} style={{ marginRight: '6px', display: 'inline' }} /> Pixel Art Studio
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
                <span className="badge badge-gold">Track: Apashe - Lacrimosa (35s Extract)</span>
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
                          left: `${(b.startTime / 35) * 100}%`,
                          width: `${((b.endTime - b.startTime) / 35) * 100}%`,
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
                          left: `${(b.startTime / 35) * 100}%`,
                          width: `${((b.endTime - b.startTime) / 35) * 100}%`,
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

                {/* Slider */}
                <div style={{ position: 'relative', height: '24px', marginTop: '10px' }}>
                  <input
                    type="range"
                    min={0}
                    max={35}
                    step={0.1}
                    value={currentTime}
                    disabled // Driven strictly by server playback loop
                    style={{ width: '100%', cursor: 'not-allowed' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'JetBrains Mono' }}>
                    <span>0s (Intro Waltz)</span>
                    <span>12s (Build Up)</span>
                    <span>15s (Mozart Drop)</span>
                    <span>35s (End)</span>
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
                              <option value="radial_ripple">Radial Flag Ripples</option>
                              <option value="gradient_sweep">Speed Up Sweep</option>
                              <option value="strobe_flash">Austrian Flag Strobe</option>
                              <option value="equalizer">Equalizer Spectrum</option>
                            </>
                          ) : (
                            <>
                              <option value="lyre_waltz">Slow circular Waltz</option>
                              <option value="lyre_rise">Beams Rise</option>
                              <option value="lyre_trap">Aggressive trap chases</option>
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

        {activeTab === 'pixelart' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: '1.1rem' }}>Pixel Art Workspace</h3>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <span className={`badge ${pixelArtDirty ? 'badge-gold' : 'badge-green'}`}>
                    {pixelArtDirty ? 'MODIFIED' : 'SYNCED'}
                  </span>
                  <span className={`badge ${wsConnected ? 'badge-green' : 'badge-red'}`}>
                    {wsConnected ? 'WS ONLINE' : 'WS OFFLINE'}
                  </span>
                </div>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', maxWidth: '72ch', lineHeight: 1.6 }}>
                Dessine un visuel 32x32 pour le mur LED, importe une image puis réduis-la en pixel art, ou publie le résultat en live sur l'installation.
              </p>
            </div>

            <PixelArtStudio
              pixelArt={pixelArt}
              onChange={(next) => {
                setPixelArt(next);
                setPixelArtDirty(true);
              }}
              onSaveDraft={savePixelArtDraft}
              onGoLive={publishPixelArtLive}
              onStopLive={() => {
                clearPixelArtLiveMode('Pixel art live mode stopped.');
              }}
              wsConnected={wsConnected}
              isDirty={pixelArtDirty}
              onLog={addLog}
            />
          </div>
        )}

        {activeTab === 'config' && config && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
            
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
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-base)', borderRadius: '8px', border: '1px solid var(--border-accent)' }}>
                    <div>
                      <span style={{ fontSize: '0.95rem', fontWeight: '600', fontFamily: 'JetBrains Mono' }}>{ctrl.ip}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>
                        Universes: {ctrl.universes.length} ({ctrl.universes.join(', ')})
                      </span>
                    </div>
                    <button
                      style={{ backgroundColor: 'transparent', color: '#ef4444', padding: '4px', border: 'none' }}
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
