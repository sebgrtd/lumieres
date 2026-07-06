import { useEffect, useRef, useState } from 'react';
import { Eraser, ImageUp, Paintbrush, Save, Trash2 } from 'lucide-react';
import { createBlankPixelArt, PIXEL_ART_HEIGHT, PIXEL_ART_WIDTH, type PixelArtFrame } from '../types/pixelArt.ts';

interface PixelArtStudioProps {
  pixelArt: PixelArtFrame;
  onChange: (next: PixelArtFrame) => void;
  onSaveDraft: () => void;
  onGoLive: () => void;
  onStopLive: () => void;
  wsConnected: boolean;
  isDirty: boolean;
  onLog: (msg: string) => void;
}

const PRESET_COLORS = [
  { label: 'Red', value: '#e6141e' },
  { label: 'White', value: '#f4f4f5' },
  { label: 'Gold', value: '#ebb42d' },
  { label: 'Cyan', value: '#22d3ee' },
  { label: 'Black', value: '#000000' },
];

function hexToRgba(hex: string): [number, number, number, number] {
  const normalized = hex.replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized;

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);

  return [Number.isFinite(r) ? r : 0, Number.isFinite(g) ? g : 0, Number.isFinite(b) ? b : 0, 255];
}

function rgbaToCss(pixels: number[], index: number): string {
  const offset = index * 4;
  const r = pixels[offset] ?? 0;
  const g = pixels[offset + 1] ?? 0;
  const b = pixels[offset + 2] ?? 0;
  const a = pixels[offset + 3] ?? 0;

  if (a <= 0) {
    return 'rgba(0, 0, 0, 0)';
  }

  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

export function PixelArtStudio({
  pixelArt,
  onChange,
  onSaveDraft,
  onGoLive,
  onStopLive,
  wsConnected,
  isDirty,
  onLog,
}: PixelArtStudioProps) {
  const [selectedColor, setSelectedColor] = useState('#e6141e');
  const [tool, setTool] = useState<'paint' | 'erase'>('paint');
  const [isDrawing, setIsDrawing] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handlePointerUp = () => setIsDrawing(false);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < pixelArt.height; y++) {
      for (let x = 0; x < pixelArt.width; x++) {
        const idx = y * pixelArt.width + x;
        const offset = idx * 4;
        const a = pixelArt.pixels[offset + 3] ?? 0;
        if (a <= 0) continue;

        ctx.fillStyle = rgbaToCss(pixelArt.pixels, idx);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, [pixelArt]);

  const commitPixel = (cellIndex: number) => {
    const nextPixels = pixelArt.pixels.slice();
    const offset = cellIndex * 4;

    if (tool === 'erase') {
      nextPixels[offset] = 0;
      nextPixels[offset + 1] = 0;
      nextPixels[offset + 2] = 0;
      nextPixels[offset + 3] = 0;
    } else {
      const [r, g, b, a] = hexToRgba(selectedColor);
      nextPixels[offset] = r;
      nextPixels[offset + 1] = g;
      nextPixels[offset + 2] = b;
      nextPixels[offset + 3] = a;
    }

    onChange({
      width: pixelArt.width,
      height: pixelArt.height,
      pixels: nextPixels,
    });
  };

  const handleImageImport = async (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = PIXEL_ART_WIDTH;
      canvas.height = PIXEL_ART_HEIGHT;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      onChange({
        width: PIXEL_ART_WIDTH,
        height: PIXEL_ART_HEIGHT,
        pixels: Array.from(imageData.data),
      });
      onLog(`Image importée et convertie en pixel art: ${file.name}`);
      URL.revokeObjectURL(url);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      onLog(`Impossible d'importer l'image: ${file.name}`);
    };

    img.src = url;
  };

  const clearArt = () => {
    onChange(createBlankPixelArt());
    onLog('Pixel art effacé.');
  };

  const cells = Array.from({ length: pixelArt.width * pixelArt.height }, (_, index) => index);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(320px, 0.9fr)', gap: '20px', alignItems: 'start' }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem' }}>Pixel Art Studio</h3>
            <p style={{ marginTop: '4px', color: 'var(--text-secondary)', fontSize: '0.84rem', maxWidth: '58ch' }}>
              Dessine directement en 32x32 ou importe une image pour la convertir en version pixelisée et l'envoyer sur le mur LED.
            </p>
          </div>
          <div className={`badge ${isDirty ? 'badge-gold' : 'badge-green'}`}>
            {isDirty ? 'UNSAVED' : 'SYNCED'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {PRESET_COLORS.map((preset) => (
            <button
              key={preset.value}
              className={selectedColor === preset.value && tool === 'paint' ? '' : 'secondary'}
              onClick={() => {
                setSelectedColor(preset.value);
                setTool('paint');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                border: selectedColor === preset.value && tool === 'paint' ? `1px solid ${preset.value}` : undefined,
              }}
            >
              <span
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '999px',
                  backgroundColor: preset.value,
                  border: '1px solid rgba(255,255,255,0.35)',
                  display: 'inline-block',
                }}
              />
              {preset.label}
            </button>
          ))}

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-accent)', borderRadius: '8px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Couleur</span>
            <input
              type="color"
              value={selectedColor}
              onChange={(e) => {
                setSelectedColor(e.target.value);
                setTool('paint');
              }}
              style={{ width: '42px', height: '28px', padding: 0, border: 'none', background: 'transparent' }}
            />
          </label>

          <button
            className={tool === 'paint' ? '' : 'secondary'}
            onClick={() => setTool('paint')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Paintbrush size={16} />
            Peindre
          </button>

          <button
            className={tool === 'erase' ? '' : 'secondary'}
            onClick={() => setTool('erase')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Eraser size={16} />
            Effacer
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${pixelArt.width}, minmax(0, 1fr))`,
            gap: '1px',
            backgroundColor: 'var(--border-muted)',
            padding: '1px',
            borderRadius: '10px',
            width: '100%',
            maxWidth: '640px',
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          {cells.map((cellIndex) => (
            <div
              key={cellIndex}
              onPointerDown={() => {
                setIsDrawing(true);
                commitPixel(cellIndex);
              }}
              onPointerEnter={() => {
                if (isDrawing) commitPixel(cellIndex);
              }}
              style={{
                aspectRatio: '1',
                backgroundColor: rgbaToCss(pixelArt.pixels, cellIndex),
                cursor: tool === 'erase' ? 'cell' : 'crosshair',
                minWidth: 0,
                minHeight: 0,
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="secondary" onClick={() => fileInputRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ImageUp size={16} />
            Importer une image
          </button>
          <button className="secondary" onClick={clearArt} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Trash2 size={16} />
            Vider
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.currentTarget.value = '';
              if (file) {
                void handleImageImport(file);
              }
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ fontSize: '1rem' }}>Aperçu mur LED</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '4px' }}>
                Le rendu est affiché en 32x32 puis étiré pour simuler le mur 128x128.
              </p>
            </div>
            <div className={`badge ${wsConnected ? 'badge-green' : 'badge-red'}`}>
              {wsConnected ? 'CONNECTED' : 'OFFLINE'}
            </div>
          </div>

          <canvas
            ref={previewCanvasRef}
            width={PIXEL_ART_WIDTH}
            height={PIXEL_ART_HEIGHT}
            style={{
              width: '100%',
              maxWidth: '420px',
              aspectRatio: '1',
              imageRendering: 'pixelated',
              borderRadius: '12px',
              border: '1px solid var(--border-accent)',
              backgroundColor: '#05070c',
              boxShadow: '0 0 20px rgba(0, 0, 0, 0.35)',
            }}
          />
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h3 style={{ fontSize: '1rem' }}>Publication</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.5 }}>
            Sauvegarde le pixel art dans le backend, puis envoie-le en mode live sur le mur LED.
          </p>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={onSaveDraft} className="secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Save size={16} />
              Sauver le brouillon
            </button>
            <button onClick={onGoLive} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Paintbrush size={16} />
              Envoyer en live
            </button>
            <button onClick={onStopLive} className="secondary">
              Stop live
            </button>
          </div>

          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Astuce: utilise un contraste fort et des formes simples. Le mur est affiché en blocs de 4x4 pixels physiques.
          </div>
        </div>
      </div>
    </div>
  );
}
