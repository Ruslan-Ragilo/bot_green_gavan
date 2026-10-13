import { db } from '../index.js';

// Получение всех активных заведений ЖК
export function getActivePlaces() {
  const stmt = db.prepare(`
    SELECT id, name, slug, description, pickup_point, group_chat_id
    FROM places
    WHERE is_active = 1
    ORDER BY id ASC
  `);
  return stmt.all();
}

// Получение заведения по ID
export function getPlaceById(id) {
  const stmt = db.prepare(`
    SELECT id, name, slug, description, pickup_point, group_chat_id, is_active
    FROM places
    WHERE id = ?
  `);
  return stmt.get(id);
}

// Получение заведения по текстовому идентификатору (slug)
export function getPlaceBySlug(slug) {
  const stmt = db.prepare(`
    SELECT id, name, slug, description, pickup_point, group_chat_id, is_active
    FROM places
    WHERE slug = ?
  `);
  return stmt.get(slug);
}

// Получение меню заведения (по умолчанию только доступные позиции)
export function getPlaceItems(placeId, { onlyAvailable = true } = {}) {
  let sql = `
    SELECT id, place_id, name, description, price, is_available, category, sort_order
    FROM items
    WHERE place_id = ?
  `;

  if (onlyAvailable) {
    sql += ' AND is_available = 1';
  }

  sql += ' ORDER BY sort_order ASC, id ASC';

  const stmt = db.prepare(sql);
  return stmt.all(placeId);
}

// Получение конкретной позиции меню по ID
export function getItemById(itemId) {
  const stmt = db.prepare(`
    SELECT i.*, p.name AS place_name, p.pickup_point
    FROM items i
    JOIN places p ON p.id = i.place_id
    WHERE i.id = ?
  `);
  return stmt.get(itemId);
}

// Переключение доступности позиции (для управления стоп-листом персоналом)
export function setItemAvailability(itemId, isAvailable) {
  const stmt = db.prepare(`
    UPDATE items
    SET is_available = ?
    WHERE id = ?
  `);
  return stmt.run(isAvailable ? 1 : 0, itemId);
}
