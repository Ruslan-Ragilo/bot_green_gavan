/**
 * Ожидание текстового ввода от жильца (точное время, пожелание, новое время заказа).
 *
 * Одно состояние на пользователя: новый запрос ввода заменяет предыдущий.
 * Состояние сбрасывается при любом нажатии кнопки или команде (см. middleware в bot.js),
 * поэтому если жилец ушёл с экрана ввода, его следующее сообщение не будет «съедено».
 * Обработчики кнопок, которые запрашивают ввод, выставляют состояние уже после сброса.
 */

import { db } from '../db/index.js';

// Таблица для сохранения состояния ввода между перезапусками процесса
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_user_inputs (
    user_id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    data TEXT,
    created_at INTEGER NOT NULL
  );
`);

const stmtGet = db.prepare('SELECT type, data, created_at FROM pending_user_inputs WHERE user_id = ?');
const stmtSet = db.prepare(`
  INSERT INTO pending_user_inputs (user_id, type, data, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    type = excluded.type,
    data = excluded.data,
    created_at = excluded.created_at
`);
const stmtDel = db.prepare('DELETE FROM pending_user_inputs WHERE user_id = ?');

const TTL_MS = 30 * 60 * 1000;

export function setPendingInput(userId, type, data = {}) {
  try {
    stmtSet.run(userId, type, JSON.stringify(data), Date.now());
  } catch (err) {
    console.error('[PendingInput] set error:', err.message);
  }
}

export function getPendingInput(userId, type) {
  try {
    const row = stmtGet.get(userId);
    if (!row) return null;
    if (Date.now() - row.created_at > TTL_MS) {
      stmtDel.run(userId);
      return null;
    }
    if (row.type !== type) return null;
    let data = {};
    try { data = JSON.parse(row.data || '{}'); } catch (_) {}
    return { type: row.type, ...data };
  } catch (err) {
    console.error('[PendingInput] get error:', err.message);
    return null;
  }
}

export function clearPendingInput(userId) {
  try {
    stmtDel.run(userId);
  } catch (err) {
    console.error('[PendingInput] delete error:', err.message);
  }
}

// Middleware: любая кнопка или команда означает, что жилец ушёл с экрана ввода
export function resetPendingInputMiddleware(ctx, next) {
  const userId = ctx.from?.id;
  if (userId && (ctx.callbackQuery || ctx.message?.text?.startsWith('/'))) {
    clearPendingInput(userId);
  }
  return next();
}

