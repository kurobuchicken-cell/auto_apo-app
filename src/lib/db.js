'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'apo.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS drafts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER,
  subject            TEXT,
  body               TEXT,
  pain_hypothesis    TEXT,
  confidence         TEXT,
  status             TEXT,
  discord_message_id TEXT,
  created_at         TEXT,
  updated_at         TEXT
);

CREATE TABLE IF NOT EXISTS sent_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER,
  draft_id   INTEGER,
  sent_at    TEXT,
  channel    TEXT
);
`;

// M4実装時点のDBファイルには discord_message_id が無いため、既存ファイルにも後付けできるようにする。
function ensureDiscordMessageIdColumn(db) {
  const columns = db.prepare(`PRAGMA table_info(drafts)`).all();
  if (!columns.some((c) => c.name === 'discord_message_id')) {
    db.exec(`ALTER TABLE drafts ADD COLUMN discord_message_id TEXT`);
  }
}

function openDb(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  ensureDiscordMessageIdColumn(db);
  return db;
}

// M4の下書き生成結果を1件保存する。status は常に pending_approval で登録する（仕様書§3 M4）。
function insertDraft(db, { company_id, subject, body, pain_hypothesis, confidence, status = 'pending_approval' }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO drafts (company_id, subject, body, pain_hypothesis, confidence, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);
  return stmt.get(company_id, subject, body, pain_hypothesis, confidence, status, now, now);
}

function getDraftsByStatus(db, status) {
  return db.prepare(`SELECT * FROM drafts WHERE status = ? ORDER BY id ASC`).all(status);
}

// M7：sent/repliedなど、複数statusにまたがる下書きを一度に取得する（反応待ち・アポ化待ちの一覧表示用）。
function getDraftsByStatuses(db, statuses) {
  const placeholders = statuses.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM drafts WHERE status IN (${placeholders}) ORDER BY id ASC`).all(...statuses);
}

// M7の歩留まりレポート用（送信数→返信数→アポ数）。
function countDraftsByStatus(db, status) {
  return db.prepare(`SELECT COUNT(*) as count FROM drafts WHERE status = ?`).get(status).count;
}

function getDraftById(db, id) {
  return db.prepare(`SELECT * FROM drafts WHERE id = ?`).get(id);
}

function getDraftByDiscordMessageId(db, messageId) {
  return db.prepare(`SELECT * FROM drafts WHERE discord_message_id = ?`).get(messageId);
}

function setDraftDiscordMessageId(db, id, messageId) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE drafts SET discord_message_id = ?, updated_at = ? WHERE id = ?`).run(messageId, now, id);
}

// GO/NOT GO判定でのstatus更新（仕様書§3 M5：approved | rejected）。
function updateDraftStatus(db, id, status) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE drafts SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, id);
}

// ✏️（要修正）でM4を再実行した結果を既存のdraft行に上書きする。
function updateDraftContent(db, id, { subject, body, pain_hypothesis, confidence, status }) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE drafts SET subject = ?, body = ?, pain_hypothesis = ?, confidence = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(subject, body, pain_hypothesis, confidence, status, now, id);
}

// M6の送信記録（仕様書§3 M6・§5）。channelは'email'（v1は手動送信）を想定。
function insertSentLog(db, { company_id, draft_id, channel }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO sent_log (company_id, draft_id, sent_at, channel)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `);
  return stmt.get(company_id, draft_id, now, channel);
}

function getSentLogByDraftId(db, draftId) {
  return db.prepare(`SELECT * FROM sent_log WHERE draft_id = ?`).get(draftId);
}

// M7の歩留まりレポート用。statusはsent以降replied等に進むため、送信総数はsent_logの件数から数える。
function countSentLog(db) {
  return db.prepare(`SELECT COUNT(*) as count FROM sent_log`).get().count;
}

module.exports = {
  openDb,
  insertDraft,
  getDraftsByStatus,
  getDraftsByStatuses,
  countDraftsByStatus,
  getDraftById,
  getDraftByDiscordMessageId,
  setDraftDiscordMessageId,
  updateDraftStatus,
  updateDraftContent,
  insertSentLog,
  getSentLogByDraftId,
  countSentLog,
  DEFAULT_DB_PATH,
};
