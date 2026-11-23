/**
 * Репозиторий для раздела «🔔 Сигнал Гавани» (объявления, потеряшки и помощь соседей).
 */
import { db } from '../index.js';

const SIGNAL_TTL_DAYS = 7;

const toJson = (value) => (value && value.length ? JSON.stringify(value) : null);

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapSignal(row) {
  if (!row) return null;
  return {
    ...row,
    entities: parseJson(row.entities, []),
  };
}

export function getSignal(id) {
  return mapSignal(db.prepare('SELECT * FROM signals WHERE id = ?').get(id));
}

export function createSignal({
  userId,
  authorName = '',
  authorUsername = null,
  text,
  entities = [],
  photo = null,
  autoApprove = false,
}) {
  if (autoApprove) {
    const info = db.prepare(`
      INSERT INTO signals (user_id, author_name, author_username, text, entities, photo, status, published_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now', '+${SIGNAL_TTL_DAYS} days'))
    `).run(userId, authorName, authorUsername, text, toJson(entities), photo);
    return getSignal(info.lastInsertRowid);
  }

  const info = db.prepare(`
    INSERT INTO signals (user_id, author_name, author_username, text, entities, photo, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(userId, authorName, authorUsername, text, toJson(entities), photo);
  return getSignal(info.lastInsertRowid);
}

export function approveSignal(id) {
  db.prepare(`
    UPDATE signals
    SET status = 'active',
        published_at = datetime('now'),
        expires_at = datetime('now', '+${SIGNAL_TTL_DAYS} days')
    WHERE id = ?
  `).run(id);
  return getSignal(id);
}

export function rejectSignal(id) {
  db.prepare("UPDATE signals SET status = 'rejected' WHERE id = ?").run(id);
  return getSignal(id);
}

export function closeSignal(id) {
  db.prepare("UPDATE signals SET status = 'closed' WHERE id = ?").run(id);
  return getSignal(id);
}

export function getActiveSignals(limit = 20) {
  return db.prepare(`
    SELECT * FROM signals
    WHERE status = 'active'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY published_at DESC, id DESC
    LIMIT ?
  `).all(limit).map(mapSignal);
}

export function getPendingSignals() {
  return db.prepare(`
    SELECT * FROM signals
    WHERE status = 'pending'
    ORDER BY id ASC
  `).all().map(mapSignal);
}

export function hasPendingSignal(userId) {
  const row = db.prepare("SELECT 1 FROM signals WHERE user_id = ? AND status = 'pending' LIMIT 1").get(userId);
  return Boolean(row);
}

// ── Настройки уведомлений (подписаны все по умолчанию, храним только отписавшихся) ──

export function isSignalsMuted(userId) {
  const row = db.prepare('SELECT 1 FROM signal_mutes WHERE user_id = ?').get(userId);
  return Boolean(row);
}

export function setSignalsMuted(userId, muted) {
  if (muted) {
    db.prepare('INSERT OR IGNORE INTO signal_mutes (user_id) VALUES (?)').run(userId);
  } else {
    db.prepare('DELETE FROM signal_mutes WHERE user_id = ?').run(userId);
  }
}

export function getSignalRecipientIds(excludeUserId = null) {
  if (excludeUserId) {
    return db.prepare(`
      SELECT telegram_id FROM users
      WHERE telegram_id > 0
        AND telegram_id != ?
        AND telegram_id NOT IN (SELECT user_id FROM signal_mutes)
    `).all(excludeUserId).map(r => r.telegram_id);
  }
  return db.prepare(`
    SELECT telegram_id FROM users
    WHERE telegram_id > 0
      AND telegram_id NOT IN (SELECT user_id FROM signal_mutes)
  `).all().map(r => r.telegram_id);
}

export function getSignalSubscribersCount() {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM users
    WHERE telegram_id > 0
      AND telegram_id NOT IN (SELECT user_id FROM signal_mutes)
  `).get();
  return row?.count || 0;
}
