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

  await expect(page.getByTestId('timeline-editor')).toBeVisible();
  await expect(page.getByTestId('clip-16')).toContainText('Tanzschein Laser Sweeps');
  await expect(page.getByTestId('clip-19')).toContainText('Tanzschein Chorus Drop');
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
  await expect(page.getByTestId('clip-31')).toContainText('Tanzschein Chorus Drop 2');

  await page.getByTestId('add-rectangle').click();
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
