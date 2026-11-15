/**
 * Мастера раздела «Домашнее и ручное», их позиции и подписки жильцов.
 */
import { db } from '../index.js';

const toJson = (value) => (value && value.length ? JSON.stringify(value) : null);

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapMaker(row) {
  if (!row) return null;
  return { ...row, about_entities: parseJson(row.about_entities, []) };
}

function mapItem(row) {
  if (!row) return null;
  return {
    ...row,
    body_entities: parseJson(row.body_entities, []),
    photos: parseJson(row.photos, []),
    in_stock: Boolean(row.in_stock),
  };
}

// ── Мастера ───────────────────────────────────────────────

export function getMaker(id) {
  return mapMaker(db.prepare('SELECT * FROM makers WHERE id = ?').get(id));
}

export function getMakerByUser(userId) {
  return mapMaker(db.prepare('SELECT * FROM makers WHERE user_id = ?').get(userId));
}

// Активные мастера: сверху те, кто недавно обновлял наличие
export function getActiveMakers() {
  return db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM maker_items i WHERE i.maker_id = m.id) AS items_count,
      (SELECT COUNT(*) FROM maker_items i WHERE i.maker_id = m.id AND i.in_stock = 1) AS stock_count
    FROM makers m
    WHERE m.status = 'active'
    ORDER BY m.stock_updated_at IS NULL, m.stock_updated_at DESC, m.id
  `).all().map(mapMaker);
}

export function getAllMakers() {
  return db.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM maker_items i WHERE i.maker_id = m.id) AS items_count
    FROM makers m ORDER BY m.id
  `).all().map(mapMaker);
}

export function createMaker({ userId, name, about = '', aboutEntities = [], contact = null }) {
  const info = db.prepare(`
    INSERT INTO makers (user_id, name, about, about_entities, contact)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, name, about, toJson(aboutEntities), contact);
  return getMaker(info.lastInsertRowid);
}

export function updateMakerProfile(id, { name, about, aboutEntities, contact }) {
  const current = getMaker(id);
  if (!current) return null;
  db.prepare('UPDATE makers SET name = ?, about = ?, about_entities = ?, contact = ? WHERE id = ?').run(
    name ?? current.name,
    about ?? current.about,
    aboutEntities !== undefined ? toJson(aboutEntities) : toJson(current.about_entities),
    contact !== undefined ? contact : current.contact,
    id
  );
  return getMaker(id);
}

export function setMakerStatus(id, status) {
  db.prepare('UPDATE makers SET status = ? WHERE id = ?').run(status, id);
}

// Повторная заявка после отказа
export function resubmitMaker(id, { name, about, aboutEntities, contact }) {
  updateMakerProfile(id, { name, about, aboutEntities, contact });
  setMakerStatus(id, 'pending');
  return getMaker(id);
}

// Позиции и подписки удаляются каскадом (ON DELETE CASCADE); на всякий случай чистим их явно
export const deleteMaker = db.transaction((id) => {
  db.prepare('DELETE FROM maker_items WHERE maker_id = ?').run(id);
  db.prepare('DELETE FROM maker_subscriptions WHERE maker_id = ?').run(id);
  db.prepare('DELETE FROM makers WHERE id = ?').run(id);
});

export function setMakerOwner(id, userId) {
  db.prepare('UPDATE makers SET user_id = ? WHERE id = ?').run(userId, id);
}

export function touchMakerStock(id) {
  db.prepare(`UPDATE makers SET stock_updated_at = datetime('now') WHERE id = ?`).run(id);
}

export function markMakerNotified(id) {
  db.prepare(`UPDATE makers SET last_notified_at = datetime('now') WHERE id = ?`).run(id);
}

// ── Позиции ───────────────────────────────────────────────

export function getMakerItem(id) {
  return mapItem(db.prepare('SELECT * FROM maker_items WHERE id = ?').get(id));
}

export function getMakerItems(makerId) {
  return db.prepare('SELECT * FROM maker_items WHERE maker_id = ? ORDER BY id').all(makerId).map(mapItem);
}

// Всё, что сейчас в наличии у активных мастеров, обновлявших наличие не раньше sinceUtc
export function getInStockItems(sinceUtc) {
  return db.prepare(`
    SELECT i.*, m.name AS maker_name
    FROM maker_items i
    JOIN makers m ON m.id = i.maker_id
    WHERE m.status = 'active' AND i.in_stock = 1
      AND m.stock_updated_at IS NOT NULL AND m.stock_updated_at >= ?
    ORDER BY m.stock_updated_at DESC, i.id
  `).all(sinceUtc).map(mapItem);
}

// Обложка раздела: первое фото у мастера, который свежее всех обновлял наличие
export function getSectionCover() {
  const row = db.prepare(`
    SELECT i.photos FROM maker_items i
    JOIN makers m ON m.id = i.maker_id
    WHERE m.status = 'active' AND i.photos <> '[]'
    ORDER BY m.stock_updated_at IS NULL, m.stock_updated_at DESC, i.id
    LIMIT 1
  `).get();
  return row ? parseJson(row.photos, [])[0] || null : null;
}

export function createMakerItem(makerId, { title, priceText, body, bodyEntities, photos, category = 'other' }) {
  const info = db.prepare(`
    INSERT INTO maker_items (maker_id, title, price_text, category, body, body_entities, photos)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(makerId, title, priceText, category, body, toJson(bodyEntities), JSON.stringify(photos || []));
  return getMakerItem(info.lastInsertRowid);
}

// Заменить пост позиции (категория и наличие сохраняются)
export function replaceMakerItemPost(id, { title, priceText, body, bodyEntities, photos }) {
  db.prepare(`
    UPDATE maker_items
    SET title = ?, price_text = ?, body = ?, body_entities = ?, photos = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, priceText, body, toJson(bodyEntities), JSON.stringify(photos || []), id);
  return getMakerItem(id);
}

const ITEM_FIELDS = new Set(['title', 'price_text', 'category']);

export function updateMakerItemField(id, field, value) {
  if (!ITEM_FIELDS.has(field)) throw new Error(`Нельзя менять поле ${field}`);
  db.prepare(`UPDATE maker_items SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`).run(value, id);
  return getMakerItem(id);
}

export function toggleMakerItemStock(id) {
  db.prepare(`UPDATE maker_items SET in_stock = 1 - in_stock, updated_at = datetime('now') WHERE id = ?`).run(id);
  return getMakerItem(id);
}

export function deleteMakerItem(id) {
  db.prepare('DELETE FROM maker_items WHERE id = ?').run(id);
}

// ── Подписки ──────────────────────────────────────────────

export function isSubscribed(userId, makerId) {
  return Boolean(db.prepare('SELECT 1 FROM maker_subscriptions WHERE user_id = ? AND maker_id = ?').get(userId, makerId));
}

export function subscribe(userId, makerId) {
  db.prepare('INSERT OR IGNORE INTO maker_subscriptions (user_id, maker_id) VALUES (?, ?)').run(userId, makerId);
}

export function unsubscribe(userId, makerId) {
  db.prepare('DELETE FROM maker_subscriptions WHERE user_id = ? AND maker_id = ?').run(userId, makerId);
}

export function getSubscriberIds(makerId) {
  return db.prepare('SELECT user_id FROM maker_subscriptions WHERE maker_id = ?').all(makerId).map(r => r.user_id);
}

export function countSubscribers(makerId) {
  return db.prepare('SELECT COUNT(*) AS c FROM maker_subscriptions WHERE maker_id = ?').get(makerId).c;
}

export function findUserIdByUsername(username) {
  const row = db.prepare('SELECT telegram_id FROM users WHERE lower(username) = lower(?)').get(username.replace(/^@/, ''));
  return row?.telegram_id || null;
}
