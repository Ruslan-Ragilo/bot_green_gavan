import { db } from '../index.js';

// Проверка: является ли пользователь сотрудником данного заведения
export function isStaffMember(userId, placeId) {
  const stmt = db.prepare(`
    SELECT id, role, name
    FROM place_staff
    WHERE user_id = ? AND place_id = ?
  `);
  const staff = stmt.get(userId, placeId);
  return Boolean(staff);
}

// Получение информации о сотруднике
export function getStaffRecord(userId, placeId) {
  const stmt = db.prepare(`
    SELECT id, place_id, user_id, role, name
    FROM place_staff
    WHERE user_id = ? AND place_id = ?
  `);
  return stmt.get(userId, placeId);
}

// Добавление сотрудника заведения
export function addStaffMember(placeId, userId, name = null, role = 'staff') {
  const stmt = db.prepare(`
    INSERT INTO place_staff (place_id, user_id, name, role, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(place_id, user_id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role
  `);
  return stmt.run(placeId, userId, name, role);
}

// Удаление сотрудника из заведения
export function removeStaffMember(placeId, userId) {
  const stmt = db.prepare('DELETE FROM place_staff WHERE place_id = ? AND user_id = ?');
  return stmt.run(placeId, userId);
}

// Список всех сотрудников заведения
export function getPlaceStaffList(placeId) {
  const stmt = db.prepare('SELECT id, place_id, user_id, role, name FROM place_staff WHERE place_id = ?');
  return stmt.all(placeId);
}
