'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'apo.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS drafts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER,
  subject          TEXT,
  body             TEXT,
  pain_hypothesis  TEXT,
  confidence       TEXT,
  status           TEXT,
  created_at       TEXT,
  updated_at       TEXT
);
`;

function openDb(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
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

module.exports = {
  openDb,
  insertDraft,
  DEFAULT_DB_PATH,
};
