import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotsDirectory = path.resolve('screenshots');

test.beforeAll(() => {
  mkdirSync(screenshotsDirectory, { recursive: true });
});

test('edits a screen element frame by frame and keeps the root show importable', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto('/');
  await page.getByTestId('nav-timeline').click();
  await page.getByTestId('show-import').setInputFiles(path.resolve('show.lumieres.json'));

  await expect(page.getByTestId('timeline-editor')).toBeVisible();
  await expect(page.getByTestId('clip-16')).toContainText('Portrait COSMÓ');
  await expect(page.getByTestId('clip-19')).toContainText('HEY / HEY!');
  await expect(page.getByTestId('playhead-timecode')).toContainText('00:00:00');

  await page.getByTestId('add-rectangle').click();
  await expect(page.getByTestId('inspector')).toContainText('Rectangle écran');

  const xField = page.locator('.se-number-field').filter({ hasText: /^X/ }).locator('input');
  await xField.fill('84');
  await expect(xField).toHaveValue('84');

  const loopToggle = page.locator('.se-toggle-row input[type="checkbox"]');
  await loopToggle.check();
  await expect(page.getByTestId('inspector')).toContainText('Longueur de boucle');

  const selectedElementClip = page.locator('.se-clip.element.is-selected');
  await selectedElementClip.scrollIntoViewIfNeeded();
  const clipBounds = await selectedElementClip.boundingBox();
  expect(clipBounds).not.toBeNull();
  if (clipBounds) {
    await page.mouse.move(clipBounds.x + clipBounds.width / 2, clipBounds.y + clipBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(clipBounds.x + clipBounds.width / 2 + 45, clipBounds.y + clipBounds.height / 2, { steps: 4 });
    await page.mouse.up();
  }
  const startFrameField = page.locator('.se-number-field').filter({ hasText: /^Début/ }).locator('input');
  await expect(startFrameField).not.toHaveValue('0');

  await page.getByTestId('add-fixture').click();
  await expect(page.getByTestId('inspector')).toContainText('Balayage lyres');
  await expect(page.getByTestId('inspector')).toContainText('Pan');

  const importedShow = path.resolve('show.lumieres.json');
  await page.getByTestId('show-import').setInputFiles(importedShow);
  await expect(page.getByLabel('Nom du show')).toHaveValue('COSMÓ — Tanzschein');
  await expect(page.getByTestId('clip-28')).toContainText('Final lasers');

  await page.screenshot({
    path: path.join(screenshotsDirectory, 'timeline-editor-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('the editor remains usable on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('nav-timeline').click();

  await expect(page.getByTestId('timeline-editor')).toBeVisible();
  await expect(page.getByTestId('stage-preview')).toBeVisible();
  await page.getByTestId('add-rectangle').click();
  await expect(page.getByTestId('inspector')).toContainText('Rectangle écran');
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);

  await page.screenshot({
    path: path.join(screenshotsDirectory, 'timeline-editor-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('every screen plan can be selected, adjusted and cut without changing the source show', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto('/');
  await page.getByTestId('nav-timeline').click();
  await page.getByTestId('show-import').setInputFiles(path.resolve('show.lumieres.json'));
  await page.getByTestId('show-import').setInputFiles(path.resolve('show.lumieres.json'));

  for (const clipId of ['16', '19', '19-character-1', '19-text-2', '19-character-2', '25', '25-2', '25-3', '25-4', '25-5', '25-6', '25-7', '25-8', '28']) {
    await page.getByTestId(`clip-${clipId}`).click();
    await expect(page.getByTestId('inspector')).toContainText('Plan écran');
    await expect(page.getByTestId('screen-plan-controls')).toBeVisible();
  }

  await page.getByTestId('clip-19-character-1').click();
  await page.locator('.se-ruler').click({ position: { x: 450, y: 20 } });
  await expect(page.getByTestId('split-screen-plan')).toBeEnabled();
  await page.getByTestId('split-screen-plan').click();
  await expect(page.locator('.se-clip.pattern')).toHaveCount(15);
  await expect(page.getByTestId('inspector')).toContainText('suite');

  await page.getByTestId('clip-25-2').click();
  await expect(page.getByTestId('lyrics-plan-editor')).toBeVisible();
  const inspectorSizing = await page.evaluate(() => {
    const inspector = document.querySelector<HTMLElement>('.se-inspector');
    const heading = document.querySelector<HTMLElement>('.se-inspector .se-panel-heading');
    const scroll = document.querySelector<HTMLElement>('.se-inspector-scroll');
    return {
      available: (inspector?.clientHeight ?? 0) - (heading?.offsetHeight ?? 0),
      used: scroll?.clientHeight ?? 0,
    };
  });
  expect(inspectorSizing.used).toBeGreaterThanOrEqual(inspectorSizing.available - 2);
  await page.getByTestId('lyrics-line-1').fill('NOUVEAU');
  await page.getByTestId('lyrics-line-2').fill('TEXTE');
  await expect(page.getByTestId('lyrics-line-1')).toHaveValue('NOUVEAU');
});

test('the timeline grows when a plan is added beyond the current ending', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto('/');
  await page.getByTestId('nav-timeline').click();
  await page.getByTestId('show-import').setInputFiles(path.resolve('show.lumieres.json'));

  await page.keyboard.press('Space');
  await expect(page.getByTestId('preview-play-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('preview-play-toggle')).toHaveAttribute('aria-pressed', 'false');

  const audioWidthBefore = await page.locator('.se-audio-clip').evaluate((element) => element.getBoundingClientRect().width);

  const futureFrame = 2200;
  await page.evaluate((frame) => {
    const scroll = document.querySelector<HTMLElement>('.se-timeline-scroll');
    const ruler = document.querySelector<HTMLElement>('.se-ruler');
    if (!scroll || !ruler) throw new Error('Timeline unavailable');
    const zoom = Number(document.querySelector<HTMLInputElement>('[data-testid="timeline-zoom"]')?.value ?? 0.9);
    scroll.scrollLeft = frame * zoom - 600;
    const bounds = ruler.getBoundingClientRect();
    ruler.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: bounds.left + frame * zoom,
      clientY: bounds.top + 10,
    }));
  }, futureFrame);

  await expect(page.locator('.se-project-meta')).toContainText('1800 frames');
  await expect(page.getByTestId('playhead-timecode')).toContainText('00:55:00');
  await expect(page.locator('.se-audio-clip')).toHaveCSS('width', `${audioWidthBefore}px`);
  await page.getByTestId('add-rectangle').click();
  await expect(page.locator('.se-project-meta')).toContainText('2360 frames');
  await expect(page.locator('.se-audio-clip')).toHaveCSS('width', `${audioWidthBefore}px`);

  const endHandle = page.locator('.se-clip.is-selected .se-trim-handle.end');
  await endHandle.scrollIntoViewIfNeeded();
  const endHandleBounds = await endHandle.boundingBox();
  expect(endHandleBounds).not.toBeNull();
  if (endHandleBounds) {
    await page.mouse.move(endHandleBounds.x + endHandleBounds.width / 2, endHandleBounds.y + endHandleBounds.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(endHandleBounds.x - 40, endHandleBounds.y + endHandleBounds.height / 2, { steps: 4 });
    await page.mouse.up();
  }
  const trimmedEnd = Number(await page.locator('.se-number-field').filter({ hasText: 'Fin' }).locator('input').inputValue());
  expect(trimmedEnd).toBeLessThan(2360);
  expect(trimmedEnd).toBeGreaterThan(2200);
});

test('decomposes pattern into shapes and allows visual dragging on the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto('/');
  await page.getByTestId('nav-timeline').click();

  await page.getByTestId('clip-28').click();
  await expect(page.getByTestId('inspector')).toContainText('Plan écran');

  await page.getByRole('button', { name: 'Décomposer en formes éditables' }).click();

  await expect(page.getByTestId('clip-28')).toContainText('Final lasers');
  await expect(page.getByTestId('clip-28')).toHaveCount(1);
  const laserClip = page.locator('.se-clip.element').first();
  await laserClip.click({ force: true });
  await expect(page.getByTestId('inspector')).toContainText('Laser Diagonal');

  const bbox = page.locator('.se-canvas-bounding-box');
  await expect(bbox).toBeVisible();

  const initialX = await page.locator('.se-number-field').filter({ hasText: /^X/ }).locator('input').inputValue();

  const bboxBounds = await bbox.boundingBox();
  expect(bboxBounds).not.toBeNull();
  if (bboxBounds) {
    await page.mouse.move(bboxBounds.x + bboxBounds.width / 2, bboxBounds.y + bboxBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bboxBounds.x + bboxBounds.width / 2 + 50, bboxBounds.y + bboxBounds.height / 2 - 30, { steps: 5 });
    await page.mouse.up();
  }

  const finalX = await page.locator('.se-number-field').filter({ hasText: /^X/ }).locator('input').inputValue();
  expect(finalX).not.toBe(initialX);

  const generatedTrack = page.locator('.se-track-row').filter({ hasText: 'Lasers (Rotatifs)' }).first();
  await expect(generatedTrack).toBeVisible();
  await generatedTrack.getByRole('button', { name: /Supprimer la piste/ }).click();
  await expect(generatedTrack).toHaveCount(0);
  await expect(page.getByTestId('clip-28')).toHaveCount(1);

  await page.screenshot({
    path: path.join(screenshotsDirectory, 'decomposed-interactive-drag.png'),
    fullPage: true,
  });
});
