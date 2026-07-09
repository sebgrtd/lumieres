import assert from 'node:assert/strict';
import {
  buildConfigFromHardware,
  DEFAULT_LED_WALL_CONFIG,
  getEntityIdFromGridWithConfig,
} from '../src/router/mapping.ts';

const config = buildConfigFromHardware();

assert.equal(config.controllers.length, 4, 'default hardware should use four LED controllers');
assert.ok(Object.keys(config.entityMap).length > 16000, 'default mapping should cover LED wall and fixtures');

const firstPixelId = getEntityIdFromGridWithConfig(0, 0, DEFAULT_LED_WALL_CONFIG);
const secondColumnBottomId = getEntityIdFromGridWithConfig(1, 0, DEFAULT_LED_WALL_CONFIG);
assert.equal(firstPixelId, 101, 'first visible pixel should skip hidden start LED');
assert.equal(secondColumnBottomId, 357, 'folded return column should include strip stride and hidden top LED');

Object.entries(config.entityMap).forEach(([entityId, target]) => {
  assert.ok(target.channel >= 0 && target.channel < 512, `entity ${entityId} channel should stay in DMX bounds`);
  assert.ok(target.universe >= 0, `entity ${entityId} universe should be positive`);
  assert.ok(target.ip.length > 0, `entity ${entityId} should have a target IP`);
});

const compact = buildConfigFromHardware({
  visibleWidth: 32,
  visibleHeight: 64,
  strips: 16,
  ledsPerStrip: 131,
  hiddenStartLeds: 1,
  hiddenBetweenRunsLeds: 1,
  hiddenEndLeds: 1,
  stripsPerController: 8,
});

assert.equal(compact.controllers.length, 2, 'compact wall should derive fewer controllers');
assert.equal(compact.ledWall.visibleWidth, 32);
assert.equal(compact.ledWall.visibleHeight, 64);
assert.ok(compact.controllers.every((ctrl) => ctrl.universes.length > 0), 'each derived controller should own universes');

console.log('mapping tests passed');
