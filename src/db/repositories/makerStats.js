/**
 * Аналитика раздела «Домашнее и ручное».
 * События пишутся при действиях покупателя; в отчётах считаем и уникальных людей, и общее число раз.
 */
import { db } from '../index.js';

export const EVENT = { VIEW_MAKER: 'view_maker', VIEW_ITEM: 'view_item', CONTACT: 'contact' };

const insertStmt = db.prepare('INSERT INTO maker_events (maker_id, item_id, user_id, type) VALUES (?, ?, ?, ?)');

export function logMakerEvent({ makerId, itemId = null, userId, type }) {
  try {
    insertStmt.run(makerId, itemId, userId, type);
  } catch (err) {
    console.error('[MakerStats] Не удалось записать событие:', err.message);
  }
}

// Периоды отчёта: ключ → граница в формате SQLite datetime (UTC) или null (всё время)
export const PERIODS = {
  d1: { title: 'Сегодня', days: 1 },
  d7: { title: '7 дней', days: 7 },
  d30: { title: '30 дней', days: 30 },
  all: { title: 'Всё время', days: null },
};

export function periodSince(key, now = new Date()) {
  const days = PERIODS[key]?.days;
  if (!days) return '1970-01-01 00:00:00';
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

const countsStmt = db.prepare(`
  SELECT type, COUNT(*) AS total, COUNT(DISTINCT user_id) AS people
  FROM maker_events WHERE maker_id = ? AND created_at >= ?
  GROUP BY type
`);

export function getMakerCounts(makerId, since) {
  const out = {};
  for (const t of Object.values(EVENT)) out[t] = { total: 0, people: 0 };
  for (const row of countsStmt.all(makerId, since)) out[row.type] = { total: row.total, people: row.people };
  return out;
}

export function getMakerTopItems(makerId, since, limit = 5) {
  return db.prepare(`
    SELECT e.item_id, i.title, COUNT(DISTINCT e.user_id) AS people, COUNT(*) AS total
    FROM maker_events e JOIN maker_items i ON i.id = e.item_id
    WHERE e.maker_id = ? AND e.type = 'view_item' AND e.created_at >= ?
    GROUP BY e.item_id ORDER BY people DESC, total DESC LIMIT ?
  `).all(makerId, since, limit);
}

export function getNewSubscribers(makerId, since) {
  return db.prepare('SELECT COUNT(*) AS c FROM maker_subscriptions WHERE maker_id = ? AND created_at >= ?').get(makerId, since).c;
}

// Итог по разделу: уникальные люди по каждому действию (человек считается один раз, даже у разных мастеров)
export function getTotalCounts(since) {
  const out = {};
  for (const t of Object.values(EVENT)) out[t] = { total: 0, people: 0 };
  const rows = db.prepare(`
    SELECT type, COUNT(*) AS total, COUNT(DISTINCT user_id) AS people
    FROM maker_events WHERE created_at >= ? GROUP BY type
  `).all(since);
  for (const row of rows) out[row.type] = { total: row.total, people: row.people };
  return out;
}
