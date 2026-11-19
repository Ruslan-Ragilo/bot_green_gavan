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
  return { ...row, about_entities: parseJson(row.about_entities, []), notified_stock: parseJson(row.notified_stock, []) };
}

function mapItem(row) {
  if (!row) return null;
  return {
    ...row,
    body_entities: parseJson(row.body_entities, []),
    photos: parseJson(row.photos, []),
    variants: parseJson(row.variants, []).map(v => ({ ...v, in_stock: Boolean(v.in_stock) })),
    in_stock: Boolean(row.in_stock),
    published: row.published === undefined ? true : Boolean(row.published),
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
      (SELECT COUNT(*) FROM maker_items i WHERE i.maker_id = m.id AND i.published = 1) AS items_count,
      (SELECT COUNT(*) FROM maker_items i WHERE i.maker_id = m.id AND i.published = 1 AND i.in_stock = 1) AS stock_count
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
  db.prepare('DELETE FROM maker_collection_items WHERE item_id IN (SELECT id FROM maker_items WHERE maker_id = ?)').run(id);
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

// Запоминаем, что было в наличии на момент рассылки, — в следующий раз бот предложит только новое
export function markMakerNotified(id, inStockIds = []) {
  db.prepare(`UPDATE makers SET last_notified_at = datetime('now'), notified_stock = ? WHERE id = ?`)
    .run(JSON.stringify(inStockIds), id);
}

// ── Позиции ───────────────────────────────────────────────

export function getMakerItem(id) {
  return mapItem(db.prepare('SELECT * FROM maker_items WHERE id = ?').get(id));
}

export function getMakerItems(makerId) {
  return db.prepare('SELECT * FROM maker_items WHERE maker_id = ? ORDER BY sort_order, id').all(makerId).map(mapItem);
}

// Всё, что сейчас в наличии у активных мастеров, обновлявших наличие не раньше sinceUtc
export function getInStockItems(sinceUtc) {
  return db.prepare(`
    SELECT i.*, m.name AS maker_name
    FROM maker_items i
    JOIN makers m ON m.id = i.maker_id
    WHERE m.status = 'active' AND i.in_stock = 1 AND i.published = 1
      AND m.stock_updated_at IS NOT NULL AND m.stock_updated_at >= ?
    ORDER BY m.stock_updated_at DESC, i.sort_order, i.id
  `).all(sinceUtc).map(mapItem);
}

// Обложка раздела задаётся администратором; без неё раздел показывается текстом
export function getSectionCover() {
  return db.prepare(`SELECT value FROM app_settings WHERE key = 'makers_cover'`).get()?.value || null;
}

export function setSectionCover(fileId) {
  if (fileId) {
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('makers_cover', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(fileId);
  } else {
    db.prepare(`DELETE FROM app_settings WHERE key = 'makers_cover'`).run();
  }
}

const variantsJson = (variants) => (variants && variants.length
  ? JSON.stringify(variants.map(v => ({ name: v.name, price: v.price || null, in_stock: v.in_stock ? 1 : 0 })))
  : null);

export function createMakerItem(makerId, { title, priceText, body, bodyEntities, photos, variants = [], category = 'other' }) {
  const info = db.prepare(`
    INSERT INTO maker_items (maker_id, title, price_text, category, body, body_entities, photos, variants, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM maker_items WHERE maker_id = ?))
  `).run(makerId, title, priceText, category, body, toJson(bodyEntities), JSON.stringify(photos || []),
    variantsJson(variants.map(v => ({ ...v, in_stock: true }))), makerId);
  return getMakerItem(info.lastInsertRowid);
}

// Заменить пост позиции (категория и наличие сохраняются; у вариантов с тем же названием — тоже)
export function replaceMakerItemPost(id, { title, priceText, body, bodyEntities, photos, variants = [] }) {
  const current = getMakerItem(id);
  const known = new Map((current?.variants || []).map(v => [v.name.toLowerCase(), v.in_stock]));
  const merged = variants.map(v => ({ ...v, in_stock: known.get(v.name.toLowerCase()) ?? current?.in_stock ?? true }));
  db.prepare(`
    UPDATE maker_items
    SET title = ?, price_text = ?, body = ?, body_entities = ?, photos = ?, variants = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, priceText, body, toJson(bodyEntities), JSON.stringify(photos || []), variantsJson(merged), id);
  if (merged.length) syncItemStockFromVariants(id);
  return getMakerItem(id);
}

// Позиция с вариантами «в наличии», если есть хотя бы один вариант
function syncItemStockFromVariants(id) {
  const item = getMakerItem(id);
  if (!item?.variants.length) return;
  db.prepare('UPDATE maker_items SET in_stock = ? WHERE id = ?').run(item.variants.some(v => v.in_stock) ? 1 : 0, id);
}

// mode: index варианта — переключить; 'all' — все в наличии; 'none' — ничего нет
export function setVariantStock(id, mode) {
  const item = getMakerItem(id);
  if (!item?.variants.length) return item;
  const variants = item.variants.map((v, i) => ({
    ...v,
    in_stock: mode === 'all' ? true : mode === 'none' ? false : (i === mode ? !v.in_stock : v.in_stock),
  }));
  db.prepare(`UPDATE maker_items SET variants = ?, updated_at = datetime('now') WHERE id = ?`).run(variantsJson(variants), id);
  syncItemStockFromVariants(id);
  return getMakerItem(id);
}

export function clearVariants(id) {
  db.prepare(`UPDATE maker_items SET variants = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
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

// ── Публикация позиции ────────────────────────────────────

export function toggleMakerItemPublished(id) {
  db.prepare(`UPDATE maker_items SET published = 1 - published, updated_at = datetime('now') WHERE id = ?`).run(id);
  return getMakerItem(id);
}

// ── Тематические подборки ─────────────────────────────────

function mapCollection(row) {
  if (!row) return null;
  return { ...row, description_entities: parseJson(row.description_entities, []), visible: Boolean(row.visible) };
}

// Позиции подборки, которые видят покупатели: опубликованные, у активных мастеров
const VISIBLE_ITEMS_SQL = `
  FROM maker_collection_items ci
  JOIN maker_items i ON i.id = ci.item_id
  JOIN makers m ON m.id = i.maker_id
  WHERE ci.collection_id = c.id AND i.published = 1 AND m.status = 'active'`;

export function getCollection(id) {
  return mapCollection(db.prepare(`
    SELECT c.*, (SELECT COUNT(*) ${VISIBLE_ITEMS_SQL}) AS items_count FROM maker_collections c WHERE c.id = ?
  `).get(id));
}

export function getAllCollections() {
  return db.prepare(`
    SELECT c.*, (SELECT COUNT(*) ${VISIBLE_ITEMS_SQL}) AS items_count FROM maker_collections c ORDER BY c.id DESC
  `).all().map(mapCollection);
}

export function getVisibleCollections() {
  return getAllCollections().filter(c => c.visible);
}

export function createCollection({ title, description = '', descriptionEntities = [] }) {
  const info = db.prepare('INSERT INTO maker_collections (title, description, description_entities) VALUES (?, ?, ?)')
    .run(title, description, toJson(descriptionEntities));
  return getCollection(info.lastInsertRowid);
}

export function updateCollection(id, { title, description, descriptionEntities }) {
  const current = getCollection(id);
  if (!current) return null;
  db.prepare('UPDATE maker_collections SET title = ?, description = ?, description_entities = ? WHERE id = ?').run(
    title ?? current.title,
    description ?? current.description,
    descriptionEntities !== undefined ? toJson(descriptionEntities) : toJson(current.description_entities),
    id
  );
  return getCollection(id);
}

export function toggleCollectionVisible(id) {
  db.prepare('UPDATE maker_collections SET visible = 1 - visible WHERE id = ?').run(id);
  return getCollection(id);
}

export function deleteCollection(id) {
  db.prepare('DELETE FROM maker_collection_items WHERE collection_id = ?').run(id);
  db.prepare('DELETE FROM maker_collections WHERE id = ?').run(id);
}

// Позиции подборки для покупателя: по мастерам, внутри — по порядку добавления позиций
export function getCollectionItems(collectionId) {
  return db.prepare(`
    SELECT i.*, m.name AS maker_name
    FROM maker_collection_items ci
    JOIN maker_items i ON i.id = ci.item_id
    JOIN makers m ON m.id = i.maker_id
    WHERE ci.collection_id = ? AND i.published = 1 AND m.status = 'active'
    ORDER BY m.stock_updated_at IS NULL, m.stock_updated_at DESC, m.id, i.sort_order, i.id
  `).all(collectionId).map(mapItem);
}

export function getItemCollectionIds(itemId) {
  return db.prepare('SELECT collection_id FROM maker_collection_items WHERE item_id = ?').all(itemId).map(r => r.collection_id);
}

export function toggleItemInCollection(itemId, collectionId) {
  const exists = db.prepare('SELECT 1 FROM maker_collection_items WHERE item_id = ? AND collection_id = ?').get(itemId, collectionId);
  if (exists) {
    db.prepare('DELETE FROM maker_collection_items WHERE item_id = ? AND collection_id = ?').run(itemId, collectionId);
  } else {
    db.prepare('INSERT INTO maker_collection_items (collection_id, item_id) VALUES (?, ?)').run(collectionId, itemId);
  }
  return !exists;
}

// Сколько позиций мастера уже в подборке (для подсказки в кабинете)
export function countMakerItemsInCollection(makerId, collectionId) {
  return db.prepare(`
    SELECT COUNT(*) AS c FROM maker_collection_items ci JOIN maker_items i ON i.id = ci.item_id
    WHERE ci.collection_id = ? AND i.maker_id = ?
  `).get(collectionId, makerId).c;
}

// ── Порядок позиций ───────────────────────────────────────

// Сдвинуть позицию на одно место вверх (-1) или вниз (+1) в меню мастера
export const moveMakerItem = db.transaction((id, delta) => {
  const item = getMakerItem(id);
  if (!item) return false;
  const ids = getMakerItems(item.maker_id).map(i => i.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return false;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  // Перенумеровываем подряд — так порядок всегда однозначный, даже если раньше были одинаковые значения
  const upd = db.prepare('UPDATE maker_items SET sort_order = ? WHERE id = ?');
  ids.forEach((itemId, idx) => upd.run(idx + 1, itemId));
  return true;
});
