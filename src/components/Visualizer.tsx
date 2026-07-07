import { useRef, useEffect } from 'react';
import { getEntityIdFromGrid } from '../router/mapping.ts';

interface VisualizerProps {
  frameState: Record<number, number[]>; // Map of entityId -> [r,g,b,w]
}

export const Visualizer = ({ frameState }: VisualizerProps) => {
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lyresCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Render LED Wall (128x128)
  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(128, 128);
    const data = imgData.data;

    // Loop through 2D coordinate grid (x: 0..127, y: 0..127)
    for (let x = 0; x < 128; x++) {
      for (let y = 0; y < 128; y++) {
        const entityId = getEntityIdFromGrid(x, 127 - y);
        const color = frameState[entityId] || [0, 0, 0, 0];

        // Pixel index in 1D array
        const pixelIdx = (y * 128 + x) * 4;
        data[pixelIdx] = color[0];     // R
        data[pixelIdx + 1] = color[1]; // G
        data[pixelIdx + 2] = color[2]; // B
        data[pixelIdx + 3] = 255;      // A
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [frameState]);

  // Render Moving Heads (Lyres)
  useEffect(() => {
    const canvas = lyresCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.fillStyle = '#0f131e';
    ctx.fillRect(0, 0, width, height);

    // Draw stage/floor line
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, height - 30);
    ctx.lineTo(width - 10, height - 30);
    ctx.stroke();

    const spacing = width / 5;

    for (let l = 0; l < 4; l++) {
      const x = spacing * (l + 1);
      const y = height - 50;

      // Extract DMX channels from frameState for this lyre
      const baseId = 34000 + (l + 1) * 100;
      
      const getDmxVal = (ch: number) => {
        const ent = frameState[baseId + ch - 1]; // 1-indexed
        return ent ? ent[0] : 0;
      };

      const pan = getDmxVal(1);      // Channel 1: Pan (0-255)
      const tilt = getDmxVal(3);     // Channel 3: Tilt (0-255)
      const dimmer = getDmxVal(6);   // Channel 6: Dimmer (0-255)
      const strobe = getDmxVal(7);   // Channel 7: Strobe (0-255)
      const colorCh = getDmxVal(8);  // Channel 8: Color Wheel (0-255)

      // Calculate angles
      const panAngle = ((pan / 255) * 540 - 270) * (Math.PI / 180);
      const tiltAngle = ((tilt / 255) * 270 - 135) * (Math.PI / 180);

      // Determine beam color
      let beamColor = 'rgb(255, 235, 120)'; // default gold
      if (colorCh < 30) {
        beamColor = 'rgb(255, 255, 255)'; // white
      } else if (colorCh < 60) {
        beamColor = 'rgb(255, 40, 40)';     // red
      } else if (colorCh < 90) {
        beamColor = 'rgb(40, 255, 40)';     // green
      } else if (colorCh < 120) {
        beamColor = 'rgb(40, 40, 255)';     // blue
      } else if (colorCh < 150) {
        beamColor = 'rgb(255, 215, 0)';     // gold/yellow
      } else if (colorCh < 180) {
        beamColor = 'rgb(255, 40, 255)';    // magenta
      } else {
        beamColor = 'rgb(0, 255, 255)';     // cyan
      }

      let isLit = dimmer > 0;
      if (strobe > 10) {
        const speed = strobe / 10;
        const flash = Math.floor(Date.now() / (1000 / speed)) % 2 === 0;
        isLit = isLit && flash;
      }

      if (isLit) {
        const beamIntensity = dimmer / 255;
        const beamLength = 180;
        const endX = x + beamLength * Math.sin(panAngle * 0.3) * Math.cos(tiltAngle * 0.5);
        const endY = y - beamLength * Math.cos(panAngle * 0.3) * Math.cos(tiltAngle * 0.5);

        const grad = ctx.createLinearGradient(x, y, endX, endY);
        const colorWithAlphaStart = beamColor.replace('rgb', 'rgba').replace(')', `, ${beamIntensity * 0.4})`);
        const colorWithAlphaEnd = beamColor.replace('rgb', 'rgba').replace(')', `, 0.0)`);
        
        grad.addColorStop(0, colorWithAlphaStart);
        grad.addColorStop(1, colorWithAlphaEnd);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x - 5, y);
        ctx.lineTo(endX - 25, endY);
        ctx.lineTo(endX + 25, endY);
        ctx.lineTo(x + 5, y);
        ctx.closePath();
        ctx.fill();

        const glow = ctx.createRadialGradient(x, y, 2, x, y, 15);
        glow.addColorStop(0, '#ffffff');
        glow.addColorStop(0.5, beamColor);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x - 15, y + 10, 30, 8);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y + 5, 8, Math.PI, 0);
      ctx.stroke();
      
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(panAngle * 0.2 + tiltAngle * 0.4);
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isLit ? beamColor : '#334155';
      ctx.fillRect(-3, -8, 6, 3);
      ctx.restore();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText(`LYRE ${l + 1}`, x, y + 30);
    }
  }, [frameState]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', height: '100%' }}>
      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: '350px' }}>
        <div style={{ position: 'absolute', top: '12px', left: '15px' }} className="badge badge-red">
          Mur LED 128x128
        </div>
        <div style={{ width: '320px', height: '320px', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden', border: '2px solid var(--border-accent)', boxShadow: '0 0 20px rgba(0,0,0,0.8)' }}>
          <canvas
            ref={gridCanvasRef}
            width={128}
            height={128}
            style={{
              width: '100%',
              height: '100%',
              imageRendering: 'pixelated',
            }}
          />
        </div>
      </div>

      <div className="card" style={{ height: '220px', position: 'relative', padding: '0', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '12px', left: '15px', zIndex: 10 }} className="badge badge-gold">
          DMX Lyres (Univers 33)
        </div>
        <canvas
          ref={lyresCanvasRef}
          width={600}
          height={220}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
};
