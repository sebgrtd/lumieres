import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotsDirectory = path.resolve('screenshots');

test.beforeAll(() => {
  mkdirSync(screenshotsDirectory, { recursive: true });
});

test('captures a guided demo of the show editor', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto('/');
  await page.getByTestId('nav-timeline').click();

  await expect(page.getByTestId('timeline-editor')).toBeVisible();
  await expect(page.getByTestId('clip-16')).toBeVisible();

  await page.screenshot({
    path: path.join(screenshotsDirectory, 'demo-01-global-editor.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByTestId('stage-preview').screenshot({
    path: path.join(screenshotsDirectory, 'demo-02-stage-preview.png'),
    animations: 'disabled',
  });

  await page.locator('.se-library').screenshot({
    path: path.join(screenshotsDirectory, 'demo-03-library.png'),
    animations: 'disabled',
  });

  await page.getByTestId('add-blank-screen-animation').click();
  await expect(page.getByTestId('inspector')).toContainText('Animation écran vide');

  const xField = page.locator('.se-number-field').filter({ hasText: /^X/ }).locator('input');
  const widthField = page.locator('.se-number-field').filter({ hasText: /^Largeur/ }).locator('input');
  await xField.fill('84');
  await widthField.fill('32');

  const loopToggle = page.locator('.se-toggle-row input[type="checkbox"]');
  await loopToggle.check();

  await page.getByTestId('inspector').screenshot({
    path: path.join(screenshotsDirectory, 'demo-04-inspector-keyframes-loop.png'),
    animations: 'disabled',
  });

  const selectedElementClip = page.locator('.se-clip.element.is-selected');
  await selectedElementClip.scrollIntoViewIfNeeded();
  const clipBounds = await selectedElementClip.boundingBox();
  expect(clipBounds).not.toBeNull();
  if (clipBounds) {
    await page.mouse.move(clipBounds.x + clipBounds.width / 2, clipBounds.y + clipBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(clipBounds.x + clipBounds.width / 2 + 90, clipBounds.y + clipBounds.height / 2, { steps: 6 });
    await page.mouse.up();
  }

  await page.screenshot({
    path: path.join(screenshotsDirectory, 'demo-05-timeline-editing.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByTestId('add-blank-fixture-animation').click();
  await expect(page.getByTestId('inspector')).toContainText('Animation lyres vide');
  await page.screenshot({
    path: path.join(screenshotsDirectory, 'demo-06-fixture-animation.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('captures the guided demo on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('nav-timeline').click();
  await expect(page.getByTestId('timeline-editor')).toBeVisible();
  await page.getByTestId('add-blank-screen-animation').click();

  await page.screenshot({
    path: path.join(screenshotsDirectory, 'demo-07-mobile-editor.png'),
    fullPage: true,
    animations: 'disabled',
  });
});
