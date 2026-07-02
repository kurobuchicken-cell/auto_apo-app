'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  openDb,
  insertDraft,
  getDraftsByStatus,
  getDraftById,
  getDraftByDiscordMessageId,
  setDraftDiscordMessageId,
  updateDraftStatus,
  updateDraftContent,
} = require('./db');

function withTempDb(fn) {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apo-db-test-')), 'apo.db');
  const db = openDb(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
}

test('insertDraft -> getDraftsByStatus(pending_approval) で取得できる', () => {
  withTempDb((db) => {
    const draft = insertDraft(db, {
      company_id: 1,
      subject: '件名A',
      body: '本文A',
      pain_hypothesis: '仮説A',
      confidence: 'normal',
    });
    assert.equal(draft.status, 'pending_approval');

    const pending = getDraftsByStatus(db, 'pending_approval');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, draft.id);
    assert.equal(pending[0].discord_message_id, null);
  });
});

test('setDraftDiscordMessageId -> getDraftByDiscordMessageId で往復できる', () => {
  withTempDb((db) => {
    const draft = insertDraft(db, { company_id: 2, subject: 's', body: 'b', pain_hypothesis: 'p', confidence: 'normal' });
    setDraftDiscordMessageId(db, draft.id, 'msg-123');

    const found = getDraftByDiscordMessageId(db, 'msg-123');
    assert.ok(found);
    assert.equal(found.id, draft.id);
    assert.equal(getDraftByDiscordMessageId(db, 'no-such-id'), undefined);
  });
});

test('updateDraftStatus で GO/NOT GO の状態遷移ができる', () => {
  withTempDb((db) => {
    const draft = insertDraft(db, { company_id: 3, subject: 's', body: 'b', pain_hypothesis: 'p', confidence: 'normal' });

    updateDraftStatus(db, draft.id, 'approved');
    assert.equal(getDraftById(db, draft.id).status, 'approved');

    updateDraftStatus(db, draft.id, 'rejected');
    assert.equal(getDraftById(db, draft.id).status, 'rejected');
  });
});

test('updateDraftContent で✏️要修正後の再生成内容に上書きできる', () => {
  withTempDb((db) => {
    const draft = insertDraft(db, {
      company_id: 4,
      subject: '旧件名',
      body: '旧本文',
      pain_hypothesis: '旧仮説',
      confidence: 'normal',
    });
    setDraftDiscordMessageId(db, draft.id, 'msg-456');

    updateDraftContent(db, draft.id, {
      subject: '新件名',
      body: '新本文',
      pain_hypothesis: '新仮説',
      confidence: 'normal',
      status: 'pending_approval',
    });

    const updated = getDraftById(db, draft.id);
    assert.equal(updated.subject, '新件名');
    assert.equal(updated.body, '新本文');
    assert.equal(updated.status, 'pending_approval');
    // discord_message_idはM5側の責務のため、M4のupdateDraftContentでは変更されないこと
    assert.equal(updated.discord_message_id, 'msg-456');
  });
});
