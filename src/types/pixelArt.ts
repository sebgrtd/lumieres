export const PIXEL_ART_WIDTH = 32;
export const PIXEL_ART_HEIGHT = 32;
export const PIXEL_ART_CHANNELS = 4;

export interface PixelArtFrame {
  width: number;
  height: number;
  pixels: number[];
}

export function createBlankPixelArt(): PixelArtFrame {
  return {
    width: PIXEL_ART_WIDTH,
    height: PIXEL_ART_HEIGHT,
    pixels: new Array(PIXEL_ART_WIDTH * PIXEL_ART_HEIGHT * PIXEL_ART_CHANNELS).fill(0),
  };
}

