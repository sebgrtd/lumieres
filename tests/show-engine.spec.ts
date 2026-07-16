import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  createElementKeyframe,
  evaluateScreenPixel,
  getElementStateAtFrame,
  prepareShowFrame,
} from '../src/show/showEngine.ts';
import { SHOW_TIMELINE, type TimelineBlock } from '../src/timeline/showTimeline.ts';
import {
  createBlankShow,
  isShowDocument,
  type ElementClip,
  type ShowDocument,
} from '../src/types/show.ts';

const show = JSON.parse(readFileSync(path.resolve('show.lumieres.json'), 'utf8')) as ShowDocument;

function documentBlocks(document: ShowDocument): TimelineBlock[] {
  return document.tracks.flatMap((track) => track.clips.map((clip) => {
    const type = clip.kind === 'pattern'
      ? clip.pattern
      : clip.kind === 'fixture' || clip.kind === 'projector'
        ? clip.preset
        : undefined;
    const lane = track.kind === 'screen' ? 'wall' : track.kind === 'fixture' ? 'lyres' : 'static';
    return {
      id: clip.id,
      lane,
      startTime: clip.startFrame / document.fps,
      endTime: clip.endFrame / document.fps,
      type: type ?? 'keyframes',
      name: clip.name,
    };
  }));
}

test('the root show document exactly mirrors the current dev timeline', () => {
  expect(isShowDocument(show)).toBe(true);
  expect(show.name).toBe('COSMÓ — Tanzschein');
  expect(show.fps).toBe(40);
  expect(show.durationFrames).toBe(1800);
  expect(show.audio).toMatchObject({ source: 'file', path: '/tanzschein.mp3', bpm: 130 });

  const byId = (left: TimelineBlock, right: TimelineBlock) => Number(left.id) - Number(right.id);
  expect(documentBlocks(show).sort(byId)).toEqual([...SHOW_TIMELINE].sort(byId));
});

test('inclusive boundary ordering remains identical to the dev server', () => {
  const wall = show.tracks.find((track) => track.id === 'dev-wall');
  const atDropBoundary = wall?.clips.find((clip) => 120 >= clip.startFrame && 120 <= clip.endFrame);
  const atVerseBoundary = wall?.clips.find((clip) => 1040 >= clip.startFrame && 1040 <= clip.endFrame);
  expect(atDropBoundary?.id).toBe('16');
  expect(atVerseBoundary?.id).toBe('19');
});

test('free screen keyframes interpolate without a preset', () => {
  const clip: ElementClip = {
    id: 'freeform',
    name: 'Freeform',
    kind: 'element',
    shape: 'rectangle',
    startFrame: 0,
    endFrame: 160,
    timeMode: 'clip',
    loop: { enabled: false, lengthFrames: 160 },
    keyframes: [
      createElementKeyframe(0, { x: 12, y: 64, width: 18, height: 18, rotation: -15, opacity: 1, fill: '#ef3340' }),
      createElementKeyframe(80, { x: 112, y: 64, width: 58, height: 18, rotation: 25, opacity: 1, fill: '#f0b429' }),
    ],
  };
  expect(getElementStateAtFrame(clip, 40)).toMatchObject({ x: 62, y: 64, width: 38, rotation: 5 });
});

test('a new project contains no audio, tracks or screen output', () => {
  const blank = createBlankShow({ name: 'Empty', fps: 40, durationFrames: 800 });
  expect(isShowDocument(blank)).toBe(true);
  expect(blank.audio.source).toBe('none');
  expect(blank.tracks).toEqual([]);

  const prepared = prepareShowFrame(blank, 400);
  expect(prepared.screenClips).toEqual([]);
  expect(evaluateScreenPixel(prepared, 64, 64)).toEqual([0, 0, 0]);
  expect(prepared.fixtures.every((fixture) => fixture.dimmer === 0)).toBe(true);
});

test('the import validator rejects structurally incomplete animation clips', () => {
  const invalid = structuredClone(show) as unknown as { tracks: Array<{ clips: unknown[] }> };
  invalid.tracks[0].clips.push({
    id: 'broken-element',
    name: 'Broken element',
    kind: 'element',
    startFrame: 0,
    endFrame: 10,
    timeMode: 'clip',
    loop: { enabled: false, lengthFrames: 10 },
    shape: 'rectangle',
  });
  expect(isShowDocument(invalid)).toBe(false);
});

test('custom JS pattern clips compile and evaluate correctly', () => {
  const customClip = {
    id: 'custom-pattern-test',
    name: 'Custom Pattern Test',
    kind: 'pattern' as const,
    pattern: 'custom' as const,
    code: 'r = 100; g = 150; b = 200;',
    startFrame: 0,
    endFrame: 40,
    timeMode: 'clip' as const,
    loop: { enabled: false, lengthFrames: 40 },
  };

  const doc: ShowDocument = {
    formatVersion: 1,
    id: 'test-custom-doc',
    name: 'Test Custom Doc',
    fps: 40,
    durationFrames: 40,
    audio: { label: 'Aucun', source: 'none', preset: null, bpm: 120 },
    tracks: [
      {
        id: 'test-track',
        name: 'Test Track',
        kind: 'screen',
        target: 'wall',
        color: '#ffffff',
        muted: false,
        locked: false,
        clips: [customClip],
      },
    ],
  };

  expect(isShowDocument(doc)).toBe(true);

  const prepared = prepareShowFrame(doc, 20);
  expect(prepared.screenClips).toHaveLength(1);

  const pixel = evaluateScreenPixel(prepared, 64, 64);
  expect(pixel).toEqual([100, 150, 200]);
});

test('custom JS pattern clips tolerate compilation/runtime errors gracefully', () => {
  const buggyClip = {
    id: 'buggy-pattern-test',
    name: 'Buggy Pattern Test',
    kind: 'pattern' as const,
    pattern: 'custom' as const,
    code: 'r = nonExistentVariable; // Syntax or runtime error',
    startFrame: 0,
    endFrame: 40,
    timeMode: 'clip' as const,
    loop: { enabled: false, lengthFrames: 40 },
  };

  const doc: ShowDocument = {
    formatVersion: 1,
    id: 'test-buggy-doc',
    name: 'Test Buggy Doc',
    fps: 40,
    durationFrames: 40,
    audio: { label: 'Aucun', source: 'none', preset: null, bpm: 120 },
    tracks: [
      {
        id: 'test-track',
        name: 'Test Track',
        kind: 'screen',
        target: 'wall',
        color: '#ffffff',
        muted: false,
        locked: false,
        clips: [buggyClip],
      },
    ],
  };

  const prepared = prepareShowFrame(doc, 20);
  const pixel = evaluateScreenPixel(prepared, 64, 64);
  // Should fallback to flashing red (which is red [255, 0, 0] or black [0, 0, 0] depending on frame/time)
  expect(pixel[0] === 255 || pixel[0] === 0).toBe(true);
  expect(pixel[1]).toBe(0);
  expect(pixel[2]).toBe(0);
});
