import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capacityForTeam,
  isValidMissionSettings,
  isValidSentenceSettings,
} from '../src/room-settings.js';

test('player seats are balanced across the selected number of teams', () => {
  const capacities = [1, 2, 3, 4].map((team) => capacityForTeam(10, 4, team));
  assert.deepEqual(capacities, [3, 3, 2, 2]);
  assert.equal(capacities.reduce((total, value) => total + value, 0), 10);
});

test('mission settings respect UI limits and the unique 72-mission bank', () => {
  assert.equal(isValidMissionSettings(24, 8, 3), true);
  assert.equal(isValidMissionSettings(24, 8, 4), false);
  assert.equal(isValidMissionSettings(6, 7, 3), false);
});

test('sentence settings allow flexible counts only inside supported bounds', () => {
  assert.equal(isValidSentenceSettings(5, 2), true);
  assert.equal(isValidSentenceSettings(1, 2), false);
  assert.equal(isValidSentenceSettings(5, 7), false);
});
