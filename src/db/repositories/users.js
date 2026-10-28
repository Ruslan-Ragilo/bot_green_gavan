import { db } from '../index.js';

// Добавление или обновление данных жильца при взаимодействии с ботом
export function upsertUser({ telegram_id, first_name, last_name = null, username = null, phone = null }) {
  const stmt = db.prepare(`
    INSERT INTO users (telegram_id, first_name, last_name, username, phone, consent_given_at)
    VALUES (@telegram_id, @first_name, @last_name, @username, @phone, datetime('now'))
    ON CONFLICT(telegram_id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      username = excluded.username,
      phone = COALESCE(excluded.phone, users.phone)
  `);

  stmt.run({ telegram_id, first_name, last_name, username, phone });
  return getUser(telegram_id);
}

// Получение профиля жильца
export function getUser(telegramId) {
  const stmt = db.prepare('SELECT * FROM users WHERE telegram_id = ?');
  return stmt.get(telegramId);
}

// Обновление номера телефона
export function updateUserPhone(telegramId, phone) {
  const stmt = db.prepare('UPDATE users SET phone = ? WHERE telegram_id = ?');
  return stmt.run(phone, telegramId);
}

// Удаление персональных данных по 152-ФЗ (/delete_me)
export function deleteUserData(telegramId) {
  const clearCart = db.prepare('DELETE FROM cart_items WHERE user_id = ?');
  const deleteUser = db.prepare('DELETE FROM users WHERE telegram_id = ?');

  const transaction = db.transaction((id) => {
    clearCart.run(id);
    return deleteUser.run(id);
  });

  return transaction(telegramId);
}

// Получение общего количества зарегистрированных пользователей
export function getTotalUsersCount() {
  const stmt = db.prepare('SELECT count(*) as count FROM users');
  return stmt.get().count;
}

// Получение списка всех Telegram ID для рассылки
export function getAllUserIds() {
  const stmt = db.prepare('SELECT telegram_id FROM users WHERE telegram_id > 0');
  return stmt.all().map(r => r.telegram_id);
}

// Получение закрепленного расписания пользователя
export function getUserPin(userId) {
  try {
    const stmt = db.prepare('SELECT * FROM user_pins WHERE user_id = ?');
    return stmt.get(userId) || null;
  } catch {
    return null;
  }
}

// Сохранение закрепленного расписания
export function setUserPin(userId, messageId, routeId, directionId, stopId) {
  const stmt = db.prepare(`
    INSERT INTO user_pins (user_id, message_id, route_id, direction_id, stop_id, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      message_id = excluded.message_id,
      route_id = excluded.route_id,
      direction_id = excluded.direction_id,
      stop_id = excluded.stop_id,
      created_at = excluded.created_at
  `);
  return stmt.run(userId, messageId, routeId, directionId, stopId);
}

// Удаление закрепленного расписания
export function deleteUserPin(userId) {
  const stmt = db.prepare('DELETE FROM user_pins WHERE user_id = ?');
  return stmt.run(userId);
}

// Подробная статистика пользователей для панели администратора
export function getUsersStatistics() {
  const total = db.prepare('SELECT count(*) as count FROM users').get()?.count || 0;
  const today = db.prepare("SELECT count(*) as count FROM users WHERE date(created_at) = date('now')").get()?.count || 0;
  const week = db.prepare("SELECT count(*) as count FROM users WHERE created_at >= datetime('now', '-7 days')").get()?.count || 0;
  const active24h = db.prepare("SELECT count(*) as count FROM user_screens WHERE updated_at >= datetime('now', '-1 day')").get()?.count || 0;

  let totalPins = 0;
  let pinsByRoute = [];
  try {
    totalPins = db.prepare('SELECT count(*) as count FROM user_pins').get()?.count || 0;
    pinsByRoute = db.prepare('SELECT route_id, count(*) as count FROM user_pins GROUP BY route_id').all() || [];
  } catch {}

  return { total, today, week, active24h, totalPins, pinsByRoute };
}



