import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotsDirectory = path.resolve('screenshots');

async function setNumberField(page: import('@playwright/test').Page, label: RegExp, value: string) {
  const field = page.locator('.se-number-field').filter({ hasText: label }).locator('input');
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

async function setFillColor(page: import('@playwright/test').Page, value: string) {
  const field = page.locator('.se-color-field').filter({ hasText: /Remplissage/ }).locator('input[type="color"]');
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

async function clickFrame(page: import('@playwright/test').Page, frame: number) {
  const ruler = page.locator('.se-ruler').first();
  await ruler.scrollIntoViewIfNeeded();
  const bounds = await ruler.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await ruler.click({ position: { x: frame * 0.9, y: bounds.height / 2 } });
}

async function capture(page: import('@playwright/test').Page, filename: string) {
  if (await page.getByTestId('new-project-dialog').isHidden()) {
    await page.locator('.se-stage-toolbar').click({ position: { x: 32, y: 20 } });
    await page.waitForTimeout(120);
  }
  await page.screenshot({
    path: path.join(screenshotsDirectory, filename),
    fullPage: true,
    animations: 'disabled',
    type: 'jpeg',
    quality: 94,
  });
}

test.beforeAll(() => {
  mkdirSync(screenshotsDirectory, { recursive: true });
});

test('rebuilds the screen effect from a truly empty project using only the editor', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto('/');
  await page.getByTestId('nav-timeline').click();
  await expect(page.getByTestId('timeline-editor')).toBeVisible();

  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('new-project-dialog')).toBeVisible();
  await page.getByTestId('new-project-name').fill('Démo écran — depuis zéro');
  await page.getByTestId('new-project-fps').fill('40');
  await page.getByTestId('new-project-duration').fill('20');
  await capture(page, 'from-zero-01-new-project.jpg');

  await page.getByTestId('create-empty-project').click();
  await expect(page.getByTestId('new-project-dialog')).toBeHidden();
  await expect(page.getByTestId('empty-timeline')).toContainText('0 piste');
  await expect(page.getByTestId('timeline-editor').locator('.se-timeline-toolbar')).toContainText('0 pistes');
  await capture(page, 'from-zero-02-empty-timeline.jpg');

  await page.getByTestId('add-rectangle').click();
  await expect(page.getByTestId('inspector')).toContainText('Rectangle écran');
  await page.locator('.se-text-field').filter({ hasText: /^Nom/ }).locator('input').fill('Bandeau aller-retour');
  await setNumberField(page, /^Fin/, '480');
  await page.getByTestId('add-element-keyframe').click();
  await setNumberField(page, /^X/, '12');
  await setNumberField(page, /^Y/, '64');
  await setNumberField(page, /^Largeur/, '18');
  await setNumberField(page, /^Hauteur/, '18');
  await setNumberField(page, /^Rotation/, '-15');
  await setFillColor(page, '#ef3340');
  await expect(page.locator('.se-keyframe-count')).toContainText('1 keyframe');
  await capture(page, 'from-zero-03-keyframe-start.jpg');

  await clickFrame(page, 80);
  await expect(page.getByTestId('playhead-timecode')).toContainText('00:02:00');
  await page.getByTestId('add-element-keyframe').click();
  await setNumberField(page, /^X/, '112');
  await setNumberField(page, /^Largeur/, '58');
  await setNumberField(page, /^Rotation/, '25');
  await setFillColor(page, '#f0b429');
  await expect(page.locator('.se-keyframe-count')).toContainText('2 keyframe');
  await capture(page, 'from-zero-04-keyframe-arrival.jpg');

  await clickFrame(page, 160);
  await expect(page.getByTestId('playhead-timecode')).toContainText('00:04:00');
  await page.getByTestId('add-element-keyframe').click();
  await setNumberField(page, /^X/, '12');
  await setNumberField(page, /^Largeur/, '18');
  await setNumberField(page, /^Rotation/, '-15');
  await setFillColor(page, '#ef3340');
  await page.locator('.se-toggle-row input[type="checkbox"]').check();
  await setNumberField(page, /^Longueur de boucle/, '160');
  await expect(page.locator('.se-keyframe-count')).toContainText('3 keyframe');
  await clickFrame(page, 159);
  await expect(page.getByTestId('playhead-timecode')).toContainText('00:03:39');
  await capture(page, 'from-zero-05-loop-ready.jpg');

  await clickFrame(page, 40);
  await expect(page.getByTestId('playhead-timecode')).toContainText('00:01:00');
  await expect(page.getByTestId('stage-preview')).toBeVisible();
  await capture(page, 'from-zero-06-effect-preview.jpg');
});
