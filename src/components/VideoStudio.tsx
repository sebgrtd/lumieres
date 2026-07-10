import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Download,
  Film,
  FlipHorizontal,
  FlipVertical,
  ImagePlus,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  StopCircle,
  Upload,
} from 'lucide-react';

type ExportFormat = 'webm' | 'png';

interface CropState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VideoMeta {
  name: string;
  type: string;
  width: number;
  height: number;
  duration: number;
}

type VideoSourceKind = 'file' | 'youtube';

interface VideoSourceState {
  kind: VideoSourceKind;
  name: string;
  url?: string;
  youtubeId?: string;
}

interface VideoStudioProps {
  config?: any;
}

const LED_SCREEN_SIZE = 128;
const MAX_PREVIEW_EDGE = 960;
const DEFAULT_EXPORT_NAME = 'edited-video';

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

function formatSeconds(value: number): string {
  return `${value.toFixed(2)}s`;
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

function bytesToBase64(bytes: Uint8ClampedArray | Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function parseYouTubeVideoId(input: string): string | null {
  try {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') {
        return url.searchParams.get('v');
      }
      if (url.pathname.startsWith('/shorts/')) {
        return url.pathname.split('/')[2] || null;
      }
      if (url.pathname.startsWith('/embed/')) {
        return url.pathname.split('/')[2] || null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function buildYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=0&controls=1&rel=0&modestbranding=1&playsinline=1`;
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

function getContainedDrawSize(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): { scale: number } {
  return { scale: Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight) };
}

function getCoveredDrawSize(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): { scale: number } {
  return { scale: Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight) };
}

function renderProcessedFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
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
  const {
    outputWidth,
    outputHeight,
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
    fitMode = 'contain',
  } = options;

  if (!video.videoWidth || !video.videoHeight) return;

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
    ? getCoveredDrawSize(rotatedWidth, rotatedHeight, outputWidth, outputHeight)
    : getContainedDrawSize(rotatedWidth, rotatedHeight, outputWidth, outputHeight);

  const drawWidth = crop.width * fit.scale;
  const drawHeight = crop.height * fit.scale;

  ctx.translate(outputWidth / 2, outputHeight / 2);
  ctx.rotate((normalizedRotation * Math.PI) / 180);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%) opacity(${opacity}%)`;
  ctx.drawImage(
    video,
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

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = clamp(time, 0, Number.isFinite(video.duration) ? Math.max(0, video.duration) : time);
    if (Math.abs(video.currentTime - target) < 0.01) {
      resolve();
      return;
    }

    const onSeeked = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Video seek failed.'));
    };

    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = target;
  });
}

export function VideoStudio({ config }: VideoStudioProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const exportUrlRef = useRef<string | null>(null);
  const previewRafRef = useRef<number | null>(null);
  const wallRafRef = useRef<number | null>(null);
  const exportRafRef = useRef<number | null>(null);
  const wallSendTimeRef = useRef(0);
  const wallStreamingRef = useRef(false);

  const [loadedMeta, setLoadedMeta] = useState<VideoMeta | null>(null);
  const [source, setSource] = useState<VideoSourceState | null>(null);
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [status, setStatus] = useState('Drop a video or choose a file to start editing.');
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
  const [exportFormat, setExportFormat] = useState<ExportFormat>('webm');
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
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

  const hasVideo = loadedMeta !== null;
  const canProcessFrames = source?.kind === 'file';

  const renderTarget = useMemo(() => {
    if (!loadedMeta) {
      return { width: 1, height: 1 };
    }

    if (fitToWall) {
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
      if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current);
      if (wallRafRef.current) cancelAnimationFrame(wallRafRef.current);
      if (exportRafRef.current) cancelAnimationFrame(exportRafRef.current);
    };
  }, []);

  const redrawPreview = () => {
    const video = videoRef.current;
    const canvas = previewCanvasRef.current;
    if (!video || !canvas || !loadedMeta) return;

    const preview = computePreviewDimensions(renderTarget.width, renderTarget.height);
    canvas.width = preview.width;
    canvas.height = preview.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(preview.scale, preview.scale);
    renderProcessedFrame(ctx, video, crop, {
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
  };

  useEffect(() => {
    if (!hasVideo) return;

    redrawPreview();
    if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current);

    const tick = () => {
      redrawPreview();
      const video = videoRef.current;
      if (video && !video.paused && !video.ended) {
        previewRafRef.current = requestAnimationFrame(tick);
      }
    };

    const video = videoRef.current;
    if (video && !video.paused && !video.ended) {
      previewRafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current);
    };
  }, [
    backgroundColor,
    brightness,
    contrast,
    crop,
    fitToWall,
    flipX,
    flipY,
    grayscale,
    hasVideo,
    opacity,
    renderTarget.height,
    renderTarget.width,
    rotation,
    saturation,
    transparentBackground,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    if (source?.kind === 'youtube' && source.youtubeId) {
      iframe.src = buildYouTubeEmbedUrl(source.youtubeId);
    } else {
      iframe.src = 'about:blank';
    }
  }, [source]);

  useEffect(() => {
    if (source?.kind !== 'youtube') return;
    if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current);
    if (wallRafRef.current) cancelAnimationFrame(wallRafRef.current);
    if (exportRafRef.current) cancelAnimationFrame(exportRafRef.current);
    setIsPlaying(false);
    setIsSending(false);
  }, [source]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateTime = () => setCurrentTime(video.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    updateTime();

    return () => {
      video.removeEventListener('timeupdate', updateTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, [hasVideo]);

  const loadFile = async (file: File): Promise<void> => {
    if (!file.type.startsWith('video/')) {
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

    const video = videoRef.current;
    if (!video) {
      setStatus('Video element not ready.');
      return;
    }

    video.src = objectUrl;
    video.load();
    video.onloadedmetadata = () => {
      const meta = {
        name: file.name,
        type: file.type || 'video/*',
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      };

      setLoadedMeta(meta);
      setSource({ kind: 'file', name: file.name, url: objectUrl });
      setExportName(getFileBaseName(file.name) || DEFAULT_EXPORT_NAME);
      setCrop({ x: 0, y: 0, width: video.videoWidth, height: video.videoHeight });
      setExportWidth(video.videoWidth);
      setExportHeight(video.videoHeight);
      setTrimStart(0);
      setTrimEnd(video.duration || 0);
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
      setPlaybackRate(1);
      setStatus(`Loaded ${file.name} (${video.videoWidth} x ${video.videoHeight}, ${video.duration.toFixed(2)}s)`);
      redrawPreview();
    };
    video.onerror = () => {
      setStatus(`Failed to load ${file.name}`);
    };
  };

  const loadYouTubeUrl = (): void => {
    const videoId = parseYouTubeVideoId(videoUrlInput);
    if (!videoId) {
      setStatus('Invalid YouTube URL.');
      return;
    }

    if (sourceUrlRef.current) {
      URL.revokeObjectURL(sourceUrlRef.current);
      sourceUrlRef.current = null;
    }

    setSource({ kind: 'youtube', name: `YouTube ${videoId}`, youtubeId: videoId });
    setLoadedMeta({
      name: `YouTube ${videoId}`,
      type: 'video/youtube',
      width: wallSize.width,
      height: wallSize.height,
      duration: 0,
    });
    setExportName(`youtube-${videoId}`);
    setCrop({ x: 0, y: 0, width: wallSize.width, height: wallSize.height });
    setExportWidth(wallSize.width);
    setExportHeight(wallSize.height);
    setFitToWall(true);
    setManualSize(true);
    setStatus('YouTube source loaded in preview mode. Export/send are disabled for iframe sources.');
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
      return next;
    });
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
    setTrimStart(0);
    setTrimEnd(loadedMeta.duration);
    setPlaybackRate(1);
    setStatus('Edits reset.');
  };

  const applyWallPreset = (): void => {
    if (!wallSize) {
      setStatus('No LED wall preset detected.');
      return;
    }

    setManualSize(true);
    setFitToWall(false);
    setExportWidth(wallSize.width);
    setExportHeight(wallSize.height);
    setExportFormat('webm');
    setStatus(`Wall preset set to ${wallSize.width} x ${wallSize.height}.`);
  };

  const toggleFitToWall = (): void => {
    if (!wallSize) {
      setStatus('No LED wall preset detected.');
      return;
    }

    setFitToWall((prev) => {
      const next = !prev;
      if (next) {
        setManualSize(true);
        setExportWidth(wallSize.width);
        setExportHeight(wallSize.height);
        setStatus(`Wall preset activated: ${wallSize.width} x ${wallSize.height}.`);
      } else {
        setStatus('Wall preset disabled.');
      }
      return next;
    });
  };

  const clearWall = async (): Promise<void> => {
    try {
      const response = await fetch('/api/image-wall', { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to clear wall image.');
      }
      setStatus('Wall cleared.');
      setLastExportLabel('Wall cleared');
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const prepareWallOutput = (): void => {
    setManualSize(true);
    setExportWidth(wallSize.width);
    setExportHeight(wallSize.height);
    setFitToWall(false);
  };

  const sendFrameToWall = async (): Promise<void> => {
    if (!canProcessFrames) {
      throw new Error('YouTube embeds cannot be sampled into canvas. Use a local video file for wall export.');
    }
    const video = videoRef.current;
    if (!video || !loadedMeta) {
      setStatus('Load a video before sending it to the wall.');
      return;
    }

    const targetWidth = wallSize.width;
    const targetHeight = wallSize.height;
    prepareWallOutput();
    const sendCanvas = exportCanvasRef.current ?? document.createElement('canvas');
    exportCanvasRef.current = sendCanvas;
    sendCanvas.width = targetWidth;
    sendCanvas.height = targetHeight;

    const ctx = sendCanvas.getContext('2d');
    if (!ctx) throw new Error('Unable to access wall canvas context.');

    renderProcessedFrame(ctx, video, crop, {
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
      transparentBackground,
      fitMode: 'contain',
    });

    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const response = await fetch('/api/image-wall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        width: targetWidth,
        height: targetHeight,
        rgbaBase64: bytesToBase64(imageData.data),
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to send frame to wall.');
    }
  };

  const startWallPlayback = async (): Promise<void> => {
    if (!canProcessFrames) {
      setStatus('YouTube embeds cannot stream frames to the wall. Use a local file.');
      return;
    }
    const video = videoRef.current;
    if (!video || !loadedMeta) {
      setStatus('Load a video before playing it on the wall.');
      return;
    }

    if (!wallSize) {
      setStatus('No LED wall detected.');
      return;
    }

    prepareWallOutput();
    setIsSending(true);
    wallStreamingRef.current = true;
    setStatus(`Streaming video to wall at ${wallSize.width} x ${wallSize.height}...`);

    try {
      await seekTo(video, trimStart);
      video.playbackRate = playbackRate;
      await video.play();
      setIsPlaying(true);

      const loop = async () => {
        if (!wallStreamingRef.current) return;

        if (video.currentTime >= trimEnd) {
          if (trimEnd > trimStart + 0.05) {
            await seekTo(video, trimStart);
            await video.play();
          } else {
            wallStreamingRef.current = false;
            setIsPlaying(false);
            setIsSending(false);
            return;
          }
        }

        const now = performance.now();
        if (now - wallSendTimeRef.current >= 66) {
          wallSendTimeRef.current = now;
          await sendFrameToWall();
        }

        wallRafRef.current = requestAnimationFrame(() => {
          void loop();
        });
      };

      wallSendTimeRef.current = 0;
      wallRafRef.current = requestAnimationFrame(() => {
        void loop();
      });
    } catch (error) {
      wallStreamingRef.current = false;
      setIsPlaying(false);
      setIsSending(false);
      setStatus((error as Error).message);
    }
  };

  const stopWallPlayback = async (): Promise<void> => {
    wallStreamingRef.current = false;
    setIsPlaying(false);
    setIsSending(false);
    if (wallRafRef.current) cancelAnimationFrame(wallRafRef.current);
    const video = videoRef.current;
    if (video) video.pause();
    await clearWall();
  };

  const exportCurrentMedia = async (): Promise<void> => {
    if (!canProcessFrames) {
      setStatus('YouTube embeds cannot be exported from the browser. Use a local video file.');
      return;
    }
    const video = videoRef.current;
    if (!video || !loadedMeta) {
      setStatus('Load a video before exporting.');
      return;
    }

    setIsExporting(true);
    setStatus(`Exporting ${exportFormat.toUpperCase()}...`);

    try {
      const targetWidth = Math.max(1, Math.round(fitToWall ? wallSize.width : manualSize ? exportWidth : renderTarget.width));
      const targetHeight = Math.max(1, Math.round(fitToWall ? wallSize.height : manualSize ? exportHeight : renderTarget.height));

      const exportCanvas = exportCanvasRef.current ?? document.createElement('canvas');
      exportCanvasRef.current = exportCanvas;
      exportCanvas.width = targetWidth;
      exportCanvas.height = targetHeight;

      const ctx = exportCanvas.getContext('2d');
      if (!ctx) throw new Error('Unable to access export canvas context.');

      if (exportFormat === 'png') {
        await seekTo(video, clamp(video.currentTime, 0, loadedMeta.duration));
        renderProcessedFrame(ctx, video, crop, {
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
          transparentBackground,
          fitMode: fitToWall ? 'cover' : 'contain',
        });

        const blob = await canvasToBlob(exportCanvas, 'image/png');
        const baseName = exportName.trim() || DEFAULT_EXPORT_NAME;
        const fileName = `${baseName}.png`;
        exportUrlRef.current = triggerDownload(blob, fileName);
        setLastExportLabel(`${fileName} (${Math.round(blob.size / 1024)} KB)`);
        setStatus(`Exported ${fileName}`);
        return;
      }

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

      const stream = exportCanvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
      const chunks: BlobPart[] = [];

      const stopPromise = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        recorder.onerror = () => reject(new Error('Video recorder failed.'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });

      await seekTo(video, trimStart);
      video.playbackRate = playbackRate;
      await video.play();

      const recordLoop = async () => {
        if (video.currentTime >= trimEnd) {
          recorder.stop();
          video.pause();
          return;
        }

        renderProcessedFrame(ctx, video, crop, {
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
          transparentBackground,
          fitMode: fitToWall ? 'cover' : 'contain',
        });

        exportRafRef.current = requestAnimationFrame(() => {
          void recordLoop();
        });
      };

      recorder.start();
      exportRafRef.current = requestAnimationFrame(() => {
        void recordLoop();
      });

      const blob = await stopPromise;
      const baseName = exportName.trim() || DEFAULT_EXPORT_NAME;
      const fileName = `${baseName}.webm`;
      exportUrlRef.current = triggerDownload(blob, fileName);
      setLastExportLabel(`${fileName} (${Math.round(blob.size / 1024)} KB)`);
      setStatus(`Exported ${fileName}`);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  const startPlayback = async (): Promise<void> => {
    if (!canProcessFrames) {
      setStatus('YouTube embeds use the iframe player, not the local preview player.');
      return;
    }
    const video = videoRef.current;
    if (!video || !loadedMeta) {
      setStatus('Load a video first.');
      return;
    }

    try {
      await seekTo(video, trimStart);
      video.playbackRate = playbackRate;
      await video.play();
      setIsPlaying(true);
      setStatus('Preview playback started.');
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const pausePlayback = (): void => {
    const video = videoRef.current;
    if (video) video.pause();
    setIsPlaying(false);
    setStatus('Preview paused.');
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragActive(false);
    void loadFile(event.dataTransfer.files[0]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
      <video
        ref={videoRef}
        style={{ display: 'none' }}
        playsInline
        muted
        controls={false}
      />
      <iframe
        ref={iframeRef}
        title="YouTube video preview"
        style={{ display: 'none' }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      />

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div className="badge badge-cyan" style={{ marginBottom: '10px' }}>
            <Film size={14} />
            Video Studio
          </div>
          <h2 style={{ fontSize: '1.6rem', marginBottom: '8px' }}>Edition et conversion de videos dans le navigateur</h2>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '72ch', lineHeight: 1.55 }}>
            Importe une video, ajuste le trim et les reglages, puis exporte en WebM ou envoie les frames sur le mur LED.
            Le mode wall utilise un rendu 128x128 en cover.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
          <span className="badge badge-gold">{loadedMeta ? `${loadedMeta.width} x ${loadedMeta.height}` : 'No video loaded'}</span>
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
                <div style={{ fontWeight: 600 }}>Glisse un fichier ou selectionne une video</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>MP4, WebM, MOV, MKV selon le navigateur</div>
              </div>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="file"
                accept="video/*"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void loadFile(file);
                }}
              />
              <span className="badge badge-cyan">Choose file</span>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '12px', alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              YouTube URL
              <input
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={videoUrlInput}
                onChange={(event) => setVideoUrlInput(event.target.value)}
              />
            </label>
            <button className="secondary" onClick={loadYouTubeUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              Load URL
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Output name
              <input value={exportName} onChange={(event) => setExportName(event.target.value)} placeholder="edited-video" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Export format
              <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
                <option value="webm">WebM - video export</option>
                <option value="png">PNG - current frame</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Playback rate
              <input
                type="number"
                min={0.25}
                max={4}
                step={0.05}
                value={playbackRate}
                onChange={(event) => setPlaybackRate(clamp(parseFloat(event.target.value) || 1, 0.25, 4))}
              />
            </label>
          </div>

          <div style={{ background: 'linear-gradient(135deg, rgba(230,20,30,0.08), rgba(24,115,255,0.08))', border: '1px solid var(--border-accent)', borderRadius: '16px', padding: '16px' }}>
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
              {source?.kind === 'youtube' ? (
                <iframe
                  ref={iframeRef}
                  title="YouTube video preview"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    minHeight: '320px',
                    border: '0',
                    background: '#000',
                  }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                />
              ) : hasVideo ? (
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
                    <ImagePlus size={14} />
                    Preview
                  </div>
                  <p style={{ lineHeight: 1.6 }}>
                    Le rendu video apparait ici apres chargement. Tu peux ensuite exporter ou envoyer les frames sur le mur.
                  </p>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '14px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {!isPlaying ? (
              <button className="secondary" onClick={() => void startPlayback()} disabled={!hasVideo || !canProcessFrames} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <Play size={16} />
                Play
              </button>
                ) : (
                  <button className="secondary" onClick={pausePlayback} disabled={!hasVideo || !canProcessFrames} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <Pause size={16} />
                    Pause
                  </button>
                )}
                <button className="secondary" onClick={() => void startWallPlayback()} disabled={!hasVideo || !canProcessFrames || isSending} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <Film size={16} />
                  {isSending ? 'Sending...' : 'Send to wall'}
                </button>
                <button className="secondary" onClick={resetEdits} disabled={!hasVideo} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCcw size={16} />
                  Reset
                </button>
              <button className="secondary" onClick={() => void toggleFitToWall()} disabled={!hasVideo} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={16} />
                {fitToWall ? 'Disable Wall Preset' : 'Apply Wall Preset'}
              </button>
                <button className="secondary" onClick={applyWallPreset} disabled={!hasVideo} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={16} />
                  Set Wall Size
                </button>
                <button className="secondary" onClick={() => void stopWallPlayback()} disabled={!hasVideo || !isSending || !canProcessFrames} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <StopCircle size={16} />
                  Stop wall
                </button>
                <button className="secondary" onClick={() => void clearWall()} disabled={!hasVideo} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  Clear wall
                </button>
                <button onClick={() => void exportCurrentMedia()} disabled={!hasVideo || isExporting || !canProcessFrames} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <Download size={16} />
                  {isExporting ? 'Exporting...' : 'Download'}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span className="badge badge-cyan">{renderTarget.width} x {renderTarget.height}</span>
                {fitToWall && <span className="badge badge-gold" style={{ marginTop: '8px' }}>Wall preset active</span>}
                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '6px' }}>{lastExportLabel || 'No export yet'}</span>
              </div>
            </div>
            {!canProcessFrames && (
              <div className="badge badge-red" style={{ justifyContent: 'center' }}>
                YouTube preview only: export and wall streaming are disabled for iframe sources.
              </div>
            )}
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
                Brightness {Math.round(brightness)}%
                <input type="range" min={0} max={200} value={brightness} onChange={(event) => setBrightness(parseInt(event.target.value, 10))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Contrast {Math.round(contrast)}%
                <input type="range" min={0} max={200} value={contrast} onChange={(event) => setContrast(parseInt(event.target.value, 10))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Saturation {Math.round(saturation)}%
                <input type="range" min={0} max={200} value={saturation} onChange={(event) => setSaturation(parseInt(event.target.value, 10))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Grayscale {Math.round(grayscale)}%
                <input type="range" min={0} max={100} value={grayscale} onChange={(event) => setGrayscale(parseInt(event.target.value, 10))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Opacity {Math.round(opacity)}%
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
                Rotate 90
              </button>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Film size={18} />
              <h3 style={{ fontSize: '1.05rem' }}>Trim and size</h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Start
                <input type="number" min={0} step={0.05} value={trimStart} onChange={(event) => setTrimStart(clamp(parseFloat(event.target.value) || 0, 0, loadedMeta?.duration || 0))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                End
                <input type="number" min={0} step={0.05} value={trimEnd} onChange={(event) => setTrimEnd(clamp(parseFloat(event.target.value) || 0, 0, loadedMeta?.duration || 0))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Export width
                <input type="number" min={1} disabled={!hasVideo || !manualSize || fitToWall} value={exportWidth} onChange={(event) => setExportWidth(clamp(parseInt(event.target.value, 10) || 1, 1, 32768))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Export height
                <input type="number" min={1} disabled={!hasVideo || !manualSize || fitToWall} value={exportHeight} onChange={(event) => setExportHeight(clamp(parseInt(event.target.value, 10) || 1, 1, 32768))} />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={manualSize}
                  disabled={!hasVideo || fitToWall}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setManualSize(checked);
                    if (!checked) setFitToWall(false);
                  }}
                  style={{ width: '16px', height: '16px' }}
                />
                Manual output size
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={transparentBackground}
                  disabled={!hasVideo}
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
                  disabled={!hasVideo || transparentBackground}
                  onChange={(event) => setBackgroundColor(event.target.value)}
                  style={{ padding: '0', minHeight: '44px' }}
                />
              </label>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ImagePlus size={18} />
              <h3 style={{ fontSize: '1.05rem' }}>Video info</h3>
            </div>
            {loadedMeta ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.85rem' }}>
                <div style={{ color: 'var(--text-secondary)' }}>File</div>
                <div>{loadedMeta.name}</div>
                <div style={{ color: 'var(--text-secondary)' }}>Type</div>
                <div>{loadedMeta.type}</div>
                <div style={{ color: 'var(--text-secondary)' }}>Size</div>
                <div>{loadedMeta.width} x {loadedMeta.height}</div>
                <div style={{ color: 'var(--text-secondary)' }}>Duration</div>
                <div>{formatSeconds(loadedMeta.duration)}</div>
                <div style={{ color: 'var(--text-secondary)' }}>Time</div>
                <div>{formatSeconds(currentTime)}</div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                Aucun fichier video charge pour le moment.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
