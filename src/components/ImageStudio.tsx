import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Download,
  FlipHorizontal,
  FlipVertical,
  ImagePlus,
  RotateCcw,
  SlidersHorizontal,
  Upload,
  Sparkles,
  Crop,
  RefreshCcw,
  Palette,
} from 'lucide-react';

type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg';

interface CropState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LoadedImageMeta {
  name: string;
  type: string;
  width: number;
  height: number;
}

interface ImageStudioProps {
  config?: any;
}

const OUTPUT_FORMATS: Array<{ value: ExportFormat; label: string; note: string }> = [
  { value: 'png', label: 'PNG', note: 'lossless' },
  { value: 'jpeg', label: 'JPG', note: 'compressed' },
  { value: 'webp', label: 'WEBP', note: 'modern' },
  { value: 'svg', label: 'SVG', note: 'wrapper' },
];

const LED_SCREEN_SIZE = 128;
const MAX_PREVIEW_EDGE = 960;
const DEFAULT_EXPORT_NAME = 'edited-image';

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function getFileBaseName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

function toDegrees(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas export failed.'));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

function triggerDownload(blob: Blob, fileName: string): string {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  return url;
}

function buildSvgWrapper(dataUrl: string, width: number, height: number): Blob {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">\n  <image href="${dataUrl}" x="0" y="0" width="${width}" height="${height}" />\n</svg>`;
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}

function bytesToBase64(bytes: Uint8ClampedArray | Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function computePreviewDimensions(width: number, height: number): { width: number; height: number; scale: number } {
  const maxEdge = Math.max(width, height);
  if (maxEdge <= MAX_PREVIEW_EDGE) {
    return { width, height, scale: 1 };
  }

  const scale = MAX_PREVIEW_EDGE / maxEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function getContainedDrawSize(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): { width: number; height: number; scale: number } {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
    scale,
  };
}

function renderProcessedImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  crop: CropState,
  options: {
    outputWidth: number;
    outputHeight: number;
    rotation: number;
    flipX: boolean;
    flipY: boolean;
    brightness: number;
    contrast: number;
    saturation: number;
    grayscale: number;
    opacity: number;
    backgroundColor: string;
    transparentBackground: boolean;
    fitMode?: 'contain' | 'cover';
  },
): void {
  const { outputWidth, outputHeight, rotation, flipX, flipY, brightness, contrast, saturation, grayscale, opacity, backgroundColor, transparentBackground, fitMode = 'contain' } = options;

  ctx.save();
  ctx.clearRect(0, 0, outputWidth, outputHeight);

  if (!transparentBackground) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, outputWidth, outputHeight);
  }

  const normalizedRotation = toDegrees(rotation);
  const rotatedWidth = normalizedRotation === 90 || normalizedRotation === 270 ? crop.height : crop.width;
  const rotatedHeight = normalizedRotation === 90 || normalizedRotation === 270 ? crop.width : crop.height;
  const fit = fitMode === 'cover'
    ? {
        width: rotatedWidth * Math.max(outputWidth / rotatedWidth, outputHeight / rotatedHeight),
        height: rotatedHeight * Math.max(outputWidth / rotatedWidth, outputHeight / rotatedHeight),
        scale: Math.max(outputWidth / rotatedWidth, outputHeight / rotatedHeight),
      }
    : getContainedDrawSize(rotatedWidth, rotatedHeight, outputWidth, outputHeight);
  const drawWidth = crop.width * fit.scale;
  const drawHeight = crop.height * fit.scale;

  ctx.translate(outputWidth / 2, outputHeight / 2);
  ctx.rotate((normalizedRotation * Math.PI) / 180);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%) opacity(${opacity}%)`;
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight,
  );

  ctx.restore();
  ctx.filter = 'none';
}

export function ImageStudio({ config }: ImageStudioProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const exportUrlRef = useRef<string | null>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [loadedMeta, setLoadedMeta] = useState<LoadedImageMeta | null>(null);
  const [status, setStatus] = useState('Drop an image or choose a file to start editing.');
  const [exportName, setExportName] = useState(DEFAULT_EXPORT_NAME);
  const [crop, setCrop] = useState<CropState>({ x: 0, y: 0, width: 1, height: 1 });
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [grayscale, setGrayscale] = useState(0);
  const [opacity, setOpacity] = useState(100);
  const [backgroundColor, setBackgroundColor] = useState('#10131a');
  const [transparentBackground, setTransparentBackground] = useState(false);
  const [manualSize, setManualSize] = useState(false);
  const [fitToWall, setFitToWall] = useState(false);
  const [exportWidth, setExportWidth] = useState(0);
  const [exportHeight, setExportHeight] = useState(0);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [jpegQuality, setJpegQuality] = useState(92);
  const [isExporting, setIsExporting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [lastExportLabel, setLastExportLabel] = useState('');

  const wallSize = useMemo(() => {
    const width = Number(config?.ledWall?.visibleWidth);
    const height = Number(config?.ledWall?.visibleHeight);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width: Math.round(width), height: Math.round(height) };
    }
    return { width: LED_SCREEN_SIZE, height: LED_SCREEN_SIZE };
  }, [config]);

  const hasImage = loadedImage !== null && loadedMeta !== null;

  const cropSummary = useMemo(() => {
    if (!loadedMeta) {
      return 'No image loaded';
    }
    return `${Math.round(crop.width)} x ${Math.round(crop.height)} px crop`;
  }, [crop.height, crop.width, loadedMeta]);

  const renderTarget = useMemo(() => {
    if (!loadedMeta) {
      return { width: 1, height: 1 };
    }

    if (fitToWall && wallSize) {
      return wallSize;
    }

    if (manualSize) {
      return {
        width: Math.max(1, Math.round(exportWidth || loadedMeta.width)),
        height: Math.max(1, Math.round(exportHeight || loadedMeta.height)),
      };
    }

    const normalizedRotation = toDegrees(rotation);
    const rotatedWidth = normalizedRotation === 90 || normalizedRotation === 270 ? crop.height : crop.width;
    const rotatedHeight = normalizedRotation === 90 || normalizedRotation === 270 ? crop.width : crop.height;
    return {
      width: Math.max(1, Math.round(rotatedWidth)),
      height: Math.max(1, Math.round(rotatedHeight)),
    };
  }, [crop.height, crop.width, exportHeight, exportWidth, fitToWall, loadedMeta, manualSize, rotation, wallSize]);

  useEffect(() => {
    return () => {
      if (sourceUrlRef.current) {
        URL.revokeObjectURL(sourceUrlRef.current);
      }
      if (exportUrlRef.current) {
        URL.revokeObjectURL(exportUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!loadedImage || !loadedMeta) return;

    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const preview = computePreviewDimensions(renderTarget.width, renderTarget.height);
    canvas.width = preview.width;
    canvas.height = preview.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(preview.scale, preview.scale);
    renderProcessedImage(ctx, loadedImage, crop, {
      outputWidth: renderTarget.width,
      outputHeight: renderTarget.height,
      rotation,
      flipX,
      flipY,
      brightness,
      contrast,
      saturation,
      grayscale,
      opacity,
      backgroundColor,
      transparentBackground,
      fitMode: fitToWall ? 'cover' : 'contain',
    });
  }, [
    backgroundColor,
    brightness,
    contrast,
    crop,
    flipX,
    flipY,
    grayscale,
    loadedImage,
    loadedMeta,
    opacity,
    renderTarget.height,
    renderTarget.width,
    rotation,
    saturation,
    transparentBackground,
  ]);

  useEffect(() => {
    if (!loadedMeta) return;
    if (manualSize || fitToWall) return;
    setExportWidth(Math.max(1, Math.round(renderTarget.width)));
    setExportHeight(Math.max(1, Math.round(renderTarget.height)));
  }, [fitToWall, manualSize, loadedMeta, renderTarget.height, renderTarget.width]);

  const loadFile = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg')) {
      setStatus(`Unsupported file: ${file.name}`);
      return;
    }

    setStatus(`Loading ${file.name}...`);

    if (sourceUrlRef.current) {
      URL.revokeObjectURL(sourceUrlRef.current);
      sourceUrlRef.current = null;
    }

    const objectUrl = URL.createObjectURL(file);
    sourceUrlRef.current = objectUrl;

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const meta = {
        name: file.name,
        type: file.type || 'image/*',
        width: image.naturalWidth,
        height: image.naturalHeight,
      };

      setLoadedImage(image);
      setLoadedMeta(meta);
      setExportName(getFileBaseName(file.name) || DEFAULT_EXPORT_NAME);
      setCrop({ x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight });
      setExportWidth(image.naturalWidth);
      setExportHeight(image.naturalHeight);
      setRotation(0);
      setFlipX(false);
      setFlipY(false);
      setBrightness(100);
      setContrast(100);
      setSaturation(100);
      setGrayscale(0);
      setOpacity(100);
      setManualSize(false);
      setFitToWall(false);
      setStatus(`Loaded ${file.name} (${image.naturalWidth} x ${image.naturalHeight})`);
    };
    image.onerror = () => {
      setStatus(`Failed to load ${file.name}`);
    };
    image.src = objectUrl;
  };

  const updateCrop = (field: keyof CropState, value: number): void => {
    if (!loadedMeta) return;

    setCrop((prev) => {
      const next = { ...prev, [field]: value } as CropState;
      const maxWidth = loadedMeta.width;
      const maxHeight = loadedMeta.height;

      next.x = clamp(next.x, 0, Math.max(0, maxWidth - 1));
      next.y = clamp(next.y, 0, Math.max(0, maxHeight - 1));
      next.width = clamp(next.width, 1, maxWidth - next.x);
      next.height = clamp(next.height, 1, maxHeight - next.y);

      if (field === 'x' || field === 'width') {
        next.width = clamp(next.width, 1, maxWidth - next.x);
      }
      if (field === 'y' || field === 'height') {
        next.height = clamp(next.height, 1, maxHeight - next.y);
      }
      return next;
    });
  };

  const exportCurrentImage = async (): Promise<void> => {
    if (!loadedImage || !loadedMeta) {
      setStatus('Load an image before exporting.');
      return;
    }

    setIsExporting(true);
    setStatus(`Exporting ${exportFormat.toUpperCase()}...`);

    try {
      const targetWidth = Math.max(1, Math.round(fitToWall && wallSize ? wallSize.width : manualSize ? exportWidth : renderTarget.width));
      const targetHeight = Math.max(1, Math.round(fitToWall && wallSize ? wallSize.height : manualSize ? exportHeight : renderTarget.height));
      const useTransparentBackground = transparentBackground && exportFormat !== 'jpeg';

      const exportCanvas = exportCanvasRef.current ?? document.createElement('canvas');
      exportCanvasRef.current = exportCanvas;
      exportCanvas.width = targetWidth;
      exportCanvas.height = targetHeight;

      const ctx = exportCanvas.getContext('2d');
      if (!ctx) throw new Error('Unable to access export canvas context.');

      renderProcessedImage(ctx, loadedImage, crop, {
        outputWidth: targetWidth,
        outputHeight: targetHeight,
        rotation,
        flipX,
        flipY,
        brightness,
        contrast,
        saturation,
        grayscale,
        opacity,
        backgroundColor,
        transparentBackground: useTransparentBackground,
        fitMode: fitToWall ? 'cover' : 'contain',
      });

      const baseName = exportName.trim() || DEFAULT_EXPORT_NAME;
      const fileName = `${baseName}.${exportFormat === 'jpeg' ? 'jpg' : exportFormat}`;

      if (exportUrlRef.current) {
        URL.revokeObjectURL(exportUrlRef.current);
        exportUrlRef.current = null;
      }

      let blob: Blob;
      if (exportFormat === 'svg') {
        const pngBlob = await canvasToBlob(exportCanvas, 'image/png');
        const pngDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Failed to encode PNG data for SVG export.'));
          reader.readAsDataURL(pngBlob);
        });
        blob = buildSvgWrapper(pngDataUrl, targetWidth, targetHeight);
      } else {
        const mimeType = exportFormat === 'png' ? 'image/png' : exportFormat === 'jpeg' ? 'image/jpeg' : 'image/webp';
        const quality = exportFormat === 'jpeg' || exportFormat === 'webp' ? clamp(jpegQuality / 100, 0.1, 1) : undefined;
        blob = await canvasToBlob(exportCanvas, mimeType, quality);
      }

      exportUrlRef.current = triggerDownload(blob, fileName);
      setLastExportLabel(`${fileName} (${Math.round(blob.size / 1024)} KB)`);
      setStatus(`Exported ${fileName}`);

      window.setTimeout(() => {
        if (exportUrlRef.current) {
          URL.revokeObjectURL(exportUrlRef.current);
          exportUrlRef.current = null;
        }
      }, 2000);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  const resetEdits = (): void => {
    if (!loadedMeta) return;
    setCrop({ x: 0, y: 0, width: loadedMeta.width, height: loadedMeta.height });
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
    setGrayscale(0);
    setOpacity(100);
    setTransparentBackground(false);
    setManualSize(false);
    setFitToWall(false);
    setExportWidth(loadedMeta.width);
    setExportHeight(loadedMeta.height);
    setStatus('Edits reset.');
  };

  const applyWallPreset = (): void => {
    if (!wallSize) {
      setStatus('Aucun preset ecran detecte dans la configuration.');
      return;
    }

    setFitToWall(true);
    setManualSize(true);
    setExportWidth(wallSize.width);
    setExportHeight(wallSize.height);
    setExportFormat('jpeg');
    setJpegQuality(85);
    setStatus(`Preset ecran active: ${wallSize.width} x ${wallSize.height}, rendu en cover.`);
  };

  const sendToWall = async (): Promise<void> => {
    if (!loadedImage || !loadedMeta) {
      setStatus('Load an image before sending it to the wall.');
      return;
    }

    if (!wallSize) {
      setStatus('Aucune taille de wall detectee dans la config.');
      return;
    }

    setIsSending(true);
    setStatus(`Sending to wall at ${wallSize.width} x ${wallSize.height}...`);

    try {
      const sendCanvas = exportCanvasRef.current ?? document.createElement('canvas');
      exportCanvasRef.current = sendCanvas;
      sendCanvas.width = wallSize.width;
      sendCanvas.height = wallSize.height;

      const ctx = sendCanvas.getContext('2d');
      if (!ctx) throw new Error('Unable to access send canvas context.');

      renderProcessedImage(ctx, loadedImage, crop, {
        outputWidth: wallSize.width,
        outputHeight: wallSize.height,
        rotation,
        flipX,
        flipY,
        brightness,
        contrast,
        saturation,
        grayscale,
        opacity,
        backgroundColor,
        transparentBackground,
        fitMode: 'cover',
      });

      const imageData = ctx.getImageData(0, 0, wallSize.width, wallSize.height);
      const payload = {
        width: wallSize.width,
        height: wallSize.height,
        rgbaBase64: bytesToBase64(imageData.data),
      };

      const response = await fetch('/api/image-wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to send image to wall.');
      }

      setStatus(`Image sent to wall: ${wallSize.width} x ${wallSize.height}`);
      setLastExportLabel(`Sent to wall (${wallSize.width} x ${wallSize.height})`);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  const clearWall = async (): Promise<void> => {
    setStatus('Clearing wall image...');
    try {
      const response = await fetch('/api/image-wall', {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to clear wall image.');
      }
      setStatus('Wall image cleared.');
      setLastExportLabel('Wall cleared');
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const toggleFitToWall = (): void => {
    if (!wallSize) {
      setStatus('Aucun preset ecran detecte dans la configuration.');
      return;
    }

    setFitToWall((prev) => {
      const next = !prev;
      if (next) {
        setManualSize(true);
        setExportWidth(wallSize.width);
        setExportHeight(wallSize.height);
        setExportFormat('jpeg');
        setJpegQuality(85);
        setStatus(`Fit to LED wall active: ${wallSize.width} x ${wallSize.height}.`);
      } else {
        setStatus('Fit to LED wall desactive.');
      }
      return next;
    });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragActive(false);
    void loadFile(event.dataTransfer.files[0]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div className="badge badge-cyan" style={{ marginBottom: '10px' }}>
            <ImagePlus size={14} />
            Image Studio
          </div>
          <h2 style={{ fontSize: '1.6rem', marginBottom: '8px' }}>Edition et conversion d'images dans le navigateur</h2>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '72ch', lineHeight: 1.55 }}>
            Charge un PNG, JPG, WebP ou SVG, applique les reglages, puis exporte en PNG, JPG, WebP ou SVG.
            L'export SVG est un wrapper qui encapsule le rendu courant sous forme raster.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
          <span className="badge badge-gold">{loadedMeta ? `${loadedMeta.width} x ${loadedMeta.height}` : 'No image loaded'}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{status}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1.25fr) minmax(320px, 0.9fr)', gap: '24px', alignItems: 'start' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            style={{
              border: `1px dashed ${dragActive ? 'var(--color-red)' : 'var(--border-accent)'}`,
              borderRadius: '14px',
              padding: '16px',
              background: dragActive ? 'rgba(230, 20, 30, 0.08)' : 'var(--bg-surface-elevated)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="badge badge-red" style={{ minWidth: 'auto' }}>
                <Upload size={14} />
                Import
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>Glisse un fichier ou selectionne une image</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>PNG, JPG, WebP ou SVG depuis ton disque</div>
              </div>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="file"
                accept="image/*,.svg"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void loadFile(file);
                }}
              />
              <span className="badge badge-cyan">Choose file</span>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Output name
              <input value={exportName} onChange={(event) => setExportName(event.target.value)} placeholder="edited-image" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Export format
              <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
                {OUTPUT_FORMATS.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label} - {format.note}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              JPEG quality
              <input
                type="number"
                min={10}
                max={100}
                step={1}
                value={jpegQuality}
                onChange={(event) => setJpegQuality(clamp(parseInt(event.target.value, 10) || 92, 10, 100))}
                disabled={exportFormat !== 'jpeg' && exportFormat !== 'webp'}
              />
            </label>
          </div>

          <div
            style={{
              background: 'linear-gradient(135deg, rgba(230,20,30,0.08), rgba(24,115,255,0.08))',
              border: '1px solid var(--border-accent)',
              borderRadius: '16px',
              padding: '16px',
            }}
          >
            <div
              style={{
                position: 'relative',
                minHeight: '320px',
                borderRadius: '12px',
                overflow: 'hidden',
                background:
                  'linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.06) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.06) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.06) 75%)',
                backgroundSize: '24px 24px',
                backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {hasImage ? (
                <canvas
                  ref={previewCanvasRef}
                  style={{
                    display: 'block',
                    maxWidth: '100%',
                    height: 'auto',
                    width: '100%',
                    imageRendering: 'auto',
                    background: 'transparent',
                  }}
                />
              ) : (
                <div style={{ textAlign: 'center', maxWidth: '34ch', color: 'var(--text-secondary)', padding: '24px' }}>
                  <div className="badge badge-gold" style={{ marginBottom: '12px' }}>
                    <Sparkles size={14} />
                    Preview
                  </div>
                  <p style={{ lineHeight: 1.6 }}>
                    Le rendu apparait ici des qu'un fichier est charge. Tu peux ensuite exporter le resultat modifie.
                  </p>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '14px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button className="secondary" onClick={resetEdits} disabled={!hasImage} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCcw size={16} />
                  Reset
                </button>
                <button className="secondary" onClick={() => void sendToWall()} disabled={!hasImage || !wallSize || isSending} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={16} />
                  {isSending ? 'Sending...' : 'Send to wall'}
                </button>
                <button className="secondary" onClick={() => void clearWall()} disabled={!wallSize} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  Clear wall
                </button>
                <button onClick={() => void exportCurrentImage()} disabled={!hasImage || isExporting} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <Download size={16} />
                  {isExporting ? 'Exporting...' : 'Download'}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span className="badge badge-cyan">{renderTarget.width} x {renderTarget.height}</span>
                {fitToWall && wallSize && (
                  <span className="badge badge-gold">LED wall fit active</span>
                )}
                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '6px' }}>{lastExportLabel || cropSummary}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <SlidersHorizontal size={18} />
              <h3 style={{ fontSize: '1.05rem' }}>Edits</h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Brightness {formatPercent(brightness)}
                <input type="range" min={0} max={200} value={brightness} onChange={(event) => setBrightness(parseInt(event.target.value, 10))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Contrast {formatPercent(contrast)}
                <input type="range" min={0} max={200} value={contrast} onChange={(event) => setContrast(parseInt(event.target.value, 10))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Saturation {formatPercent(saturation)}
                <input type="range" min={0} max={200} value={saturation} onChange={(event) => setSaturation(parseInt(event.target.value, 10))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Grayscale {formatPercent(grayscale)}
                <input type="range" min={0} max={100} value={grayscale} onChange={(event) => setGrayscale(parseInt(event.target.value, 10))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Opacity {formatPercent(opacity)}
                <input type="range" min={0} max={100} value={opacity} onChange={(event) => setOpacity(parseInt(event.target.value, 10))} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="secondary" onClick={() => setFlipX((prev) => !prev)} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <FlipHorizontal size={16} />
                Flip H
              </button>
              <button className="secondary" onClick={() => setFlipY((prev) => !prev)} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <FlipVertical size={16} />
                Flip V
              </button>
              <button className="secondary" onClick={() => setRotation((prev) => (prev + 90) % 360)} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <RotateCcw size={16} />
                Rotate 90?
              </button>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Crop size={18} />
              <h3 style={{ fontSize: '1.05rem' }}>Crop and size</h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                X
                <input
                  type="number"
                  min={0}
                  value={crop.x}
                  disabled={!hasImage}
                  onChange={(event) => updateCrop('x', parseInt(event.target.value, 10) || 0)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Y
                <input
                  type="number"
                  min={0}
                  value={crop.y}
                  disabled={!hasImage}
                  onChange={(event) => updateCrop('y', parseInt(event.target.value, 10) || 0)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Width
                <input
                  type="number"
                  min={1}
                  value={crop.width}
                  disabled={!hasImage}
                  onChange={(event) => updateCrop('width', parseInt(event.target.value, 10) || 1)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Height
                <input
                  type="number"
                  min={1}
                  value={crop.height}
                  disabled={!hasImage}
                  onChange={(event) => updateCrop('height', parseInt(event.target.value, 10) || 1)}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', alignItems: 'end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Export width
                <input
                  type="number"
                  min={1}
                  disabled={!hasImage || !manualSize || fitToWall}
                  value={exportWidth}
                  onChange={(event) => setExportWidth(clamp(parseInt(event.target.value, 10) || 1, 1, 32768))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Export height
                <input
                  type="number"
                  min={1}
                  disabled={!hasImage || !manualSize || fitToWall}
                  value={exportHeight}
                  onChange={(event) => setExportHeight(clamp(parseInt(event.target.value, 10) || 1, 1, 32768))}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={manualSize}
                  disabled={!hasImage || fitToWall}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setManualSize(checked);
                    if (!checked) {
                      setFitToWall(false);
                    }
                  }}
                  style={{ width: '16px', height: '16px' }}
                />
                Manual output size
              </label>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="secondary" onClick={toggleFitToWall} disabled={!hasImage || !wallSize} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={16} />
                {fitToWall ? 'Disable wall fit' : 'Fit to LED wall'}
              </button>
              <button className="secondary" onClick={applyWallPreset} disabled={!hasImage || !wallSize} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={16} />
                Apply wall preset
              </button>
              {wallSize && (
                <span className="badge badge-gold">
                  Wall preset {wallSize.width}x{wallSize.height}
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={transparentBackground}
                  disabled={!hasImage}
                  onChange={(event) => setTransparentBackground(event.target.checked)}
                  style={{ width: '16px', height: '16px' }}
                />
                Transparent background
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Background color
                <input
                  type="color"
                  value={backgroundColor}
                  disabled={!hasImage || transparentBackground}
                  onChange={(event) => setBackgroundColor(event.target.value)}
                  style={{ padding: '0', minHeight: '44px' }}
                />
              </label>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Palette size={18} />
              <h3 style={{ fontSize: '1.05rem' }}>Image info</h3>
            </div>
            {loadedMeta ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.85rem' }}>
                <div style={{ color: 'var(--text-secondary)' }}>File</div>
                <div>{loadedMeta.name}</div>
                <div style={{ color: 'var(--text-secondary)' }}>Type</div>
                <div>{loadedMeta.type}</div>
                <div style={{ color: 'var(--text-secondary)' }}>Size</div>
                <div>{loadedMeta.width} x {loadedMeta.height}</div>
                <div style={{ color: 'var(--text-secondary)' }}>Rotation</div>
                <div>{rotation}?</div>
                <div style={{ color: 'var(--text-secondary)' }}>Filters</div>
                <div>brightness, contrast, saturation, grayscale, opacity</div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                Aucun fichier charge pour le moment.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
