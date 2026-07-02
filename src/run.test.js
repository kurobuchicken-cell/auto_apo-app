'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStages } = require('./run');

test('parseStages: all は m1〜m4 を返す（M5/M6/M7は個別起動のため含めない）', () => {
  assert.deepEqual(parseStages('all'), ['m1', 'm2', 'm3', 'm4']);
});

test('parseStages: 単体ステージをそのまま返す', () => {
  assert.deepEqual(parseStages('m1'), ['m1']);
  assert.deepEqual(parseStages('m5'), ['m5']);
  assert.deepEqual(parseStages('m7'), ['m7']);
});

test('parseStages: 範囲指定を展開する', () => {
  assert.deepEqual(parseStages('m2-m4'), ['m2', 'm3', 'm4']);
  assert.deepEqual(parseStages('m1-m7'), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
});

test('parseStages: 不正な値はエラー', () => {
  assert.throws(() => parseStages('m9'), /不正/);
  assert.throws(() => parseStages('m4-m2'), /不正/);
  assert.throws(() => parseStages(''), /必須/);
  assert.throws(() => parseStages(undefined), /必須/);
});
