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

module.exports = {
  openDb,
  insertDraft,
  getDraftsByStatus,
  getDraftById,
  getDraftByDiscordMessageId,
  setDraftDiscordMessageId,
  updateDraftStatus,
  updateDraftContent,
  DEFAULT_DB_PATH,
};
