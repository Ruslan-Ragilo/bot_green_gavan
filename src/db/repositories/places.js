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

// Получение ВСЕХ заведений (включая неактивные)
export function getAllPlaces() {
  const stmt = db.prepare(`
    SELECT id, name, slug, description, pickup_point, group_chat_id, is_active
    FROM places
    ORDER BY id ASC
  `);
  return stmt.all();
}

// Поиск заведения по group_chat_id
export function getPlaceByGroupId(groupId) {
  const stmt = db.prepare(`
    SELECT id, name, slug, description, pickup_point, group_chat_id, is_active
    FROM places
    WHERE group_chat_id = ?
    LIMIT 1
  `);
  return stmt.get(groupId);
}

// Привязка заведения к группе Telegram и активация
export function linkPlaceToGroup(placeId, groupChatId, { makeExclusive = true } = {}) {
  const transaction = db.transaction(() => {
    if (makeExclusive) {
      db.prepare('UPDATE places SET is_active = 0 WHERE id != ?').run(placeId);
    }
    db.prepare(`
      UPDATE places
      SET group_chat_id = ?, is_active = 1
      WHERE id = ?
    `).run(groupChatId, placeId);
  });
  transaction();
  return getPlaceById(placeId);
}

// Создание нового заведения
export function createPlace({ name, slug = null, description = '', pickup_point, group_chat_id = null, is_active = 1 }) {
  if (!slug) {
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'place';
    let candidate = baseSlug;
    let counter = 1;
    while (db.prepare('SELECT id FROM places WHERE slug = ?').get(candidate)) {
      candidate = `${baseSlug}-${counter++}`;
    }
    slug = candidate;
  }

  const transaction = db.transaction(() => {
    if (is_active) {
      db.prepare('UPDATE places SET is_active = 0').run();
    }
    const stmt = db.prepare(`
      INSERT INTO places (name, slug, description, pickup_point, group_chat_id, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(name, slug, description, pickup_point, group_chat_id, is_active ? 1 : 0);
    const newPlaceId = info.lastInsertRowid;

    // Добавляем 2 базовые позиции по умолчанию, чтобы меню не было пустым
    const itemStmt = db.prepare(`
      INSERT INTO items (place_id, name, description, price, category, is_available, sort_order)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    itemStmt.run(newPlaceId, 'Фирменная позиция №1', 'Популярное блюдо заведения', 25, 'Основное меню', 1);
    itemStmt.run(newPlaceId, 'Фирменный напиток', 'Свежий напиток', 8, 'Напитки', 2);

    return newPlaceId;
  });

  const newId = transaction();
  return getPlaceById(newId);
}

// Обновление контактных данных / названия заведения
export function updatePlaceInfo(placeId, { name, pickup_point, description }) {
  const fields = [];
  const params = [];
  if (name !== undefined) { fields.push('name = ?'); params.push(name); }
  if (pickup_point !== undefined) { fields.push('pickup_point = ?'); params.push(pickup_point); }
  if (description !== undefined) { fields.push('description = ?'); params.push(description); }
  if (fields.length === 0) return getPlaceById(placeId);

  params.push(placeId);
  db.prepare(`UPDATE places SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getPlaceById(placeId);
}

// Включение / выключение заведения
export function setPlaceActive(placeId, isActive) {
  db.prepare('UPDATE places SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, placeId);
  return getPlaceById(placeId);
}

// Переключение активности заведения (пауза / возобновление приёма)
export function togglePlaceActive(placeId) {
  const place = getPlaceById(placeId);
  if (!place) return null;
  const newActive = place.is_active ? 0 : 1;
  return setPlaceActive(placeId, newActive);
}

// Переключение доступности позиции меню (стоп-лист)
export function toggleItemAvailability(itemId) {
  const item = getItemById(itemId);
  if (!item) return null;
  const newStatus = item.is_available ? 0 : 1;
  setItemAvailability(itemId, newStatus);
  return { ...item, is_available: newStatus };
}

// Добавление новой позиции в меню заведения
export function addItem({ placeId, name, price, category = 'Основное', description = '', sortOrder = 0 }) {
  const stmt = db.prepare(`
    INSERT INTO items (place_id, name, price, category, description, is_available, sort_order)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  const info = stmt.run(placeId, name, Number(price), category, description, sortOrder);
  return getItemById(info.lastInsertRowid);
}

// Удаление позиции из меню по ID
export function deleteItem(itemId) {
  const item = getItemById(itemId);
  if (!item) return null;
  db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
  return item;
}

// Поиск позиции по названию или ID внутри заведения
export function findItemInPlace(placeId, query) {
  const clean = String(query).trim();
  const numId = Number(clean);
  if (!isNaN(numId) && numId > 0) {
    const item = getItemById(numId);
    if (item && item.place_id === placeId) return item;
  }
  const stmt = db.prepare(`
    SELECT i.*, p.name AS place_name, p.pickup_point
    FROM items i
    JOIN places p ON p.id = i.place_id
    WHERE i.place_id = ? AND LOWER(i.name) LIKE LOWER(?)
    LIMIT 1
  `);
  return stmt.get(placeId, `%${clean}%`);
}



