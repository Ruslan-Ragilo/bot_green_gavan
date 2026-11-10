import { db } from '../index.js';
import { getCart, clearCart } from './cart.js';
import { getPlaceById, getPlaceItems } from './places.js';

// Допустимые статусы заказа строго по ТЗ
export const ORDER_STATUSES = {
  SENT: 'sent',
  ACCEPTED: 'accepted',
  READY: 'ready',
  ISSUED: 'issued',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  NO_SHOW: 'no_show',
};

// Статусы, при которых заказ ещё «живой» и занимает слот кухни
export const ACTIVE_STATUSES = ['sent', 'accepted', 'ready'];
// Финальные статусы — с заказом больше ничего нельзя сделать
export const FINAL_STATUSES = ['issued', 'cancelled', 'expired', 'no_show'];

// Создание заказа из корзины в единой атомарной транзакции
export function createOrderFromCart({ userId, placeId, desiredTime, targetAt = null, comment = null }) {
  const transaction = db.transaction(() => {
    const cart = getCart(userId);

    if (cart.isEmpty) {
      throw new Error('Корзина пуста');
    }

    if (cart.place.id !== placeId) {
      throw new Error('Несоответствие заведения в корзине');
    }

    // Проверяем, доступны ли все позиции (стоп-лист)
    const unavailableItem = cart.items.find(i => !i.is_available);
    if (unavailableItem) {
      throw new Error(`Позиция "${unavailableItem.item_name}" временно недоступна для заказа`);
    }

    const place = getPlaceById(placeId);
    if (!place || !place.is_active) {
      throw new Error('Заведение временно не принимает заказы');
    }

    // 1. Создаем запись заказа с временным кодом
    const insertOrderStmt = db.prepare(`
      INSERT INTO orders (
        order_code, user_id, place_id, status,
        fulfillment_type, pickup_point, desired_time, target_at, comment,
        total_price, created_at, updated_at
      ) VALUES (
        'pending', @userId, @placeId, 'sent',
        'pickup', @pickupPoint, @desiredTime, @targetAt, @comment,
        @totalPrice, datetime('now'), datetime('now')
      )
    `);

    const orderResult = insertOrderStmt.run({
      userId,
      placeId,
      pickupPoint: place.pickup_point,
      desiredTime,
      targetAt,
      comment,
      totalPrice: cart.totalPrice,
    });

    const orderId = Number(orderResult.lastInsertRowid);
    // Короткий код выдачи для жильца и заведения (например, #042)
    const orderCode = `#${String(orderId).padStart(3, '0')}`;

    db.prepare('UPDATE orders SET order_code = ? WHERE id = ?').run(orderCode, orderId);

    // 2. Копируем позиции корзины в снимок order_items
    const insertItemStmt = db.prepare(`
      INSERT INTO order_items (order_id, item_id, item_name, price, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of cart.items) {
      insertItemStmt.run(orderId, item.item_id, item.item_name, item.price, item.quantity);
    }

    // 3. Фиксируем первый статус в истории
    db.prepare(`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id)
      VALUES (?, NULL, 'sent', ?)
    `).run(orderId, userId);

    // 4. Очищаем корзину жильца
    clearCart(userId, placeId);

    return orderId;
  });

  const orderId = transaction();
  return getOrderById(orderId);
}

// Получение заказа по ID с позициями, данными заведения и клиента
export function getOrderById(orderId) {
  const orderStmt = db.prepare(`
    SELECT
      o.*,
      p.name AS place_name,
      p.group_chat_id,
      u.first_name,
      u.last_name,
      u.username,
      u.phone
    FROM orders o
    JOIN places p ON p.id = o.place_id
    LEFT JOIN users u ON u.telegram_id = o.user_id
    WHERE o.id = ?
  `);

  const order = orderStmt.get(orderId);
  if (!order) return null;

  const itemsStmt = db.prepare(`
    SELECT id, item_id, item_name, price, quantity, (price * quantity) AS subtotal
    FROM order_items
    WHERE order_id = ?
    ORDER BY id ASC
  `);
  order.items = itemsStmt.all(orderId);

  return order;
}

// Сохранение ID сообщения заказа в Telegram-группе заведения
export function setOrderGroupMessageId(orderId, groupMessageId) {
  const stmt = db.prepare('UPDATE orders SET group_message_id = ? WHERE id = ?');
  return stmt.run(groupMessageId, orderId);
}

/**
 * Атомарная смена статуса заказа: UPDATE ... WHERE id = ? AND status = <expected>
 * Возвращает true, если статус был успешно обновлен, и false, если статус уже изменился (race condition)
 */
export function atomicUpdateOrderStatus(orderId, expectedStatus, nextStatus, changedByUserId = null, extraFields = {}) {
  let extraSql = '';
  const params = [nextStatus];

  if (extraFields.cooking_minutes !== undefined) {
    extraSql += ', cooking_minutes = ?';
    params.push(extraFields.cooking_minutes);
  }
  if (extraFields.ready_at !== undefined) {
    extraSql += ', ready_at = ?';
    params.push(extraFields.ready_at);
  }
  if (extraFields.cancel_reason !== undefined) {
    extraSql += ', cancel_reason = ?';
    params.push(extraFields.cancel_reason);
  }

  params.push(orderId, expectedStatus);

  const updateStmt = db.prepare(`
    UPDATE orders
    SET status = ?, updated_at = datetime('now')${extraSql}
    WHERE id = ? AND status = ?
  `);

  const historyStmt = db.prepare(`
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const result = updateStmt.run(...params);
    if (result.changes > 0) {
      historyStmt.run(orderId, expectedStatus, nextStatus, changedByUserId);
      return true;
    }
    return false;
  });

  return transaction();
}

// Получение всех активных заказов для экрана WebApp монитора
export function getActiveOrdersForStaff(placeId = null) {
  let query = `
    SELECT
      o.*,
      p.name AS place_name,
      u.first_name,
      u.last_name,
      u.username,
      u.phone
    FROM orders o
    JOIN places p ON p.id = o.place_id
    LEFT JOIN users u ON u.telegram_id = o.user_id
    WHERE o.status IN ('sent', 'accepted', 'ready')
  `;
  const params = [];

  if (placeId) {
    query += ' AND o.place_id = ?';
    params.push(placeId);
  }

  query += ' ORDER BY o.id DESC';

  const orders = db.prepare(query).all(...params);

  const itemsStmt = db.prepare(`
    SELECT item_id, item_name, price, quantity
    FROM order_items
    WHERE order_id = ?
    ORDER BY id ASC
  `);

  for (const order of orders) {
    order.items = itemsStmt.all(order.id);
  }

  return orders;
}

// Отмена заказа жильцом (в статусе 'sent' до принятия, либо 'accepted' при согласовании задержки)
export function cancelOrderByClient(orderId, clientUserId, allowAccepted = true) {
  const order = getOrderById(orderId);
  if (!order || order.user_id !== clientUserId) return false;
  const allowed = allowAccepted ? [ORDER_STATUSES.SENT, ORDER_STATUSES.ACCEPTED] : [ORDER_STATUSES.SENT];
  if (!allowed.includes(order.status)) return false;
  return atomicUpdateOrderStatus(orderId, order.status, ORDER_STATUSES.CANCELLED, clientUserId, { cancel_reason: 'client' });
}

// Отмена заказа персоналом заведения (если заказ ещё не выдан, не отменен и не просрочен)
export function cancelOrderByStaff(orderId, staffUserId, reason = 'staff') {
  const order = getOrderById(orderId);
  if (!order) return false;

  if (FINAL_STATUSES.includes(order.status)) {
    return false;
  }

  return atomicUpdateOrderStatus(orderId, order.status, ORDER_STATUSES.CANCELLED, staffUserId, { cancel_reason: reason });
}

// Получение просроченных заказов в статусе 'sent', ожидающих дольше заданного таймаута
export function getExpiredSentOrders(expiryMinutes) {
  const stmt = db.prepare(`
    SELECT o.id, o.order_code, o.user_id, o.place_id, o.group_message_id, p.group_chat_id, p.name AS place_name
    FROM orders o
    JOIN places p ON p.id = o.place_id
    WHERE o.status = 'sent'
      AND datetime(o.created_at, '+' || ? || ' minutes') <= datetime('now')
  `);
  return stmt.all(expiryMinutes);
}

// Получение истории заказов жильца
export function getUserOrders(userId, limit = 10) {
  const stmt = db.prepare(`
    SELECT
      o.id, o.order_code, o.status, o.total_price, o.desired_time,
      o.pickup_point, o.created_at, p.name AS place_name
    FROM orders o
    JOIN places p ON p.id = o.place_id
    WHERE o.user_id = ?
    ORDER BY o.id DESC
    LIMIT ?
  `);
  return stmt.all(userId, limit);
}

// Создание тестового заказа для быстрой проверки группы персоналом
export function createTestOrder({ placeId, user }) {
  const transaction = db.transaction(() => {
    // 1. Убедимся, что пользователь есть в таблице users
    db.prepare(`
      INSERT INTO users (telegram_id, first_name, last_name, username, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(telegram_id) DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        username = excluded.username
    `).run(user.id, user.first_name || 'Тест', user.last_name || null, user.username || null);

    const place = getPlaceById(placeId);
    if (!place) throw new Error('Заведение не найдено');

    // 2. Получаем позицию меню для тестового заказа
    const items = getPlaceItems(placeId, { onlyAvailable: false });
    const sampleItem = items.length > 0 ? items[0] : { id: null, name: 'Фирменная пицца / блюдо', price: 25 };

    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const orderCode = `TEST-${randomSuffix}`;

    const insertOrderStmt = db.prepare(`
      INSERT INTO orders (
        order_code, user_id, place_id, status,
        fulfillment_type, pickup_point, desired_time, comment,
        total_price, created_at, updated_at
      ) VALUES (
        ?, ?, ?, 'sent',
        'pickup', ?, 'через 15-20 мин (ТЕСТ)', 'Проверка уведомлений и кнопок',
        ?, datetime('now'), datetime('now')
      )
    `);

    const orderResult = insertOrderStmt.run(
      orderCode,
      user.id,
      placeId,
      place.pickup_point,
      sampleItem.price
    );
    const orderId = orderResult.lastInsertRowid;

    // Вставляем позицию заказа
    db.prepare(`
      INSERT INTO order_items (order_id, item_id, item_name, price, quantity)
      VALUES (?, ?, ?, ?, 1)
    `).run(orderId, sampleItem.id, sampleItem.name, sampleItem.price);

    // Логируем в историю
    db.prepare(`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id)
      VALUES (?, NULL, 'sent', ?)
    `).run(orderId, user.id);

    return orderId;
  });

  const orderId = transaction();
  return getOrderById(orderId);
}

// Статистика заказов для панели администратора
export function getOrdersStatistics() {
  const todayStmt = db.prepare(`
    SELECT
      count(*) as total_count,
      COALESCE(sum(CASE WHEN status NOT IN ('cancelled', 'expired', 'no_show') THEN total_price ELSE 0 END), 0) as total_revenue,
      sum(CASE WHEN status = 'issued' THEN 1 ELSE 0 END) as issued_count,
      sum(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count
    FROM orders
    WHERE date(created_at, 'localtime') = date('now', 'localtime')
  `);
  const today = todayStmt.get();

  const weekStmt = db.prepare(`
    SELECT
      count(*) as total_count,
      COALESCE(sum(CASE WHEN status NOT IN ('cancelled', 'expired', 'no_show') THEN total_price ELSE 0 END), 0) as total_revenue
    FROM orders
    WHERE created_at >= datetime('now', '-7 days')
  `);
  const week = weekStmt.get();

  const allTimeStmt = db.prepare(`
    SELECT
      count(*) as total_count,
      COALESCE(sum(CASE WHEN status NOT IN ('cancelled', 'expired', 'no_show') THEN total_price ELSE 0 END), 0) as total_revenue,
      sum(CASE WHEN status = 'issued' THEN 1 ELSE 0 END) as issued_count
    FROM orders
  `);
  const allTime = allTimeStmt.get();

  const activeStmt = db.prepare(`
    SELECT
      sum(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent_count,
      sum(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted_count,
      sum(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready_count
    FROM orders
  `);
  const active = activeStmt.get();

  return { today, week, allTime, active };
}

// Поиск заказа по коду или ID
export function getOrderByCodeOrId(query) {
  const clean = String(query).trim().toUpperCase();
  const code = clean.startsWith('#') ? clean.slice(1) : clean;

  const stmt = db.prepare(`
    SELECT id FROM orders
    WHERE UPPER(order_code) = ? OR order_code = ? OR id = ?
    LIMIT 1
  `);
  const numId = Number(clean);
  const row = stmt.get(code, clean, isNaN(numId) ? -1 : numId);
  if (!row) return null;
  return getOrderById(row.id);
}

// Принудительная отмена заказа суперадминистратором
export function cancelOrderByAdmin(orderId, adminId) {
  const transaction = db.transaction(() => {
    const order = getOrderById(orderId);
    if (!order) return false;
    if (FINAL_STATUSES.includes(order.status)) return false;

    db.prepare(`
      UPDATE orders
      SET status = 'cancelled', cancel_reason = 'admin', updated_at = datetime('now')
      WHERE id = ?
    `).run(orderId);

    db.prepare(`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id)
      VALUES (?, ?, 'cancelled', ?)
    `).run(orderId, order.status, adminId);

    return true;
  });
  return transaction();
}

// Обновление желаемого времени получения жильцом (только пока статус 'sent')
export function updateOrderDesiredTime(orderId, userId, newDesiredTime, targetAt = null) {
  const order = getOrderById(orderId);
  if (!order || order.user_id !== userId) return null;
  if (order.status !== ORDER_STATUSES.SENT) return null;

  const result = db.prepare(
    `UPDATE orders SET desired_time = ?, target_at = ?, updated_at = datetime('now') WHERE id = ? AND status = 'sent'`
  ).run(newDesiredTime, targetAt, orderId);

  return result.changes > 0 ? getOrderById(orderId) : null;
}

// Сдвиг времени готовности персоналом (только в статусе 'accepted')
export function setOrderReadyAt(orderId, newReadyAt) {
  const result = db.prepare(
    `UPDATE orders SET ready_at = ?, ready_reminded_at = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'accepted'`
  ).run(newReadyAt, orderId);

  return result.changes > 0 ? getOrderById(orderId) : null;
}

// --- Лимит слотов ---

// Количество «живых» заказов заведения с целевым временем в интервале [from, to)
export function countActiveOrdersInRange(placeId, from, to, excludeOrderId = null) {
  return db.prepare(`
    SELECT count(*) AS c FROM orders
    WHERE place_id = ?
      AND status IN ('sent', 'accepted', 'ready')
      AND target_at >= ? AND target_at < ?
      AND id != ?
  `).get(placeId, from.toISOString(), to.toISOString(), excludeOrderId ?? -1).c;
}

// --- Напоминания ---

// Заказы, не принятые дольше minutes (напоминание ещё не отправлялось)
export function getOrdersAwaitingAcceptReminder(minutes) {
  return db.prepare(`
    SELECT o.id FROM orders o
    WHERE o.status = 'sent' AND o.accept_reminded_at IS NULL
      AND datetime(o.created_at, '+' || ? || ' minutes') <= datetime('now')
  `).all(minutes).map(r => getOrderById(r.id));
}

// Принятые заказы, по которым ещё не напоминали о времени готовности
export function getAcceptedOrdersWithoutReadyReminder() {
  return db.prepare(`
    SELECT id FROM orders WHERE status = 'accepted' AND ready_reminded_at IS NULL AND ready_at IS NOT NULL
  `).all().map(r => getOrderById(r.id));
}

// Готовые заказы, ожидающие выдачи дольше minutes; column — какая отметка напоминания проверяется
export function getReadyOrdersWaitingSince(minutes, column) {
  if (!['client_pickup_reminded_at', 'staff_pickup_reminded_at'].includes(column)) {
    throw new Error(`Недопустимая колонка напоминания: ${column}`);
  }
  return db.prepare(`
    SELECT id FROM orders
    WHERE status = 'ready' AND ${column} IS NULL
      AND datetime(updated_at, '+' || ? || ' minutes') <= datetime('now')
  `).all(minutes).map(r => getOrderById(r.id));
}

const REMINDER_COLUMNS = ['accept_reminded_at', 'ready_reminded_at', 'client_pickup_reminded_at', 'staff_pickup_reminded_at'];

// Отметить напоминание отправленным (не меняет updated_at — от него считается время ожидания)
export function markOrderReminded(orderId, column) {
  if (!REMINDER_COLUMNS.includes(column)) throw new Error(`Недопустимая колонка напоминания: ${column}`);
  db.prepare(`UPDATE orders SET ${column} = datetime('now') WHERE id = ?`).run(orderId);
}

// --- Ежедневный отчёт заведения (date — YYYY-MM-DD по Минску, UTC+3) ---

const REPORT_DAY_FILTER = `place_id = @placeId AND date(created_at, '+3 hours') = @date AND order_code NOT LIKE 'TEST-%'`;

export function getPlaceDailyReport(placeId, date) {
  const params = { placeId, date };

  const summary = db.prepare(`
    SELECT
      count(*) AS total,
      COALESCE(sum(status = 'issued'), 0) AS issued,
      COALESCE(sum(CASE WHEN status = 'issued' THEN total_price END), 0) AS revenue,
      COALESCE(sum(status IN ('sent', 'accepted', 'ready')), 0) AS active,
      COALESCE(sum(status = 'cancelled' AND cancel_reason = 'client'), 0) AS cancelled_by_client,
      COALESCE(sum(status = 'expired'), 0) AS expired,
      COALESCE(sum(CASE WHEN status = 'expired' THEN total_price END), 0) AS expired_sum,
      COALESCE(sum(status = 'cancelled' AND COALESCE(cancel_reason, '') != 'client'), 0) AS rejected,
      COALESCE(sum(CASE WHEN status = 'cancelled' AND COALESCE(cancel_reason, '') != 'client' THEN total_price END), 0) AS rejected_sum,
      COALESCE(sum(status = 'no_show'), 0) AS no_show,
      COALESCE(sum(CASE WHEN status = 'no_show' THEN total_price END), 0) AS no_show_sum,
      count(DISTINCT user_id) AS customers
    FROM orders
    WHERE ${REPORT_DAY_FILTER}
  `).get(params);

  const rejectReasons = db.prepare(`
    SELECT COALESCE(cancel_reason, 'staff') AS reason, count(*) AS c
    FROM orders
    WHERE ${REPORT_DAY_FILTER} AND status = 'cancelled' AND COALESCE(cancel_reason, '') != 'client'
    GROUP BY 1 ORDER BY c DESC
  `).all(params);

  const newCustomers = db.prepare(`
    SELECT count(DISTINCT o.user_id) AS c
    FROM orders o
    WHERE o.place_id = @placeId AND date(o.created_at, '+3 hours') = @date AND o.order_code NOT LIKE 'TEST-%'
      AND NOT EXISTS (
        SELECT 1 FROM orders p
        WHERE p.place_id = o.place_id AND p.user_id = o.user_id
          AND date(p.created_at, '+3 hours') < @date AND p.order_code NOT LIKE 'TEST-%'
      )
  `).get(params).c;

  const topItems = db.prepare(`
    SELECT oi.item_name AS name, sum(oi.quantity) AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.place_id = @placeId AND date(o.created_at, '+3 hours') = @date
      AND o.order_code NOT LIKE 'TEST-%' AND o.status = 'issued'
    GROUP BY oi.item_name
    ORDER BY qty DESC, name ASC
    LIMIT 3
  `).all(params);

  // Среднее время от оформления до принятия кухней (в минутах)
  const avgAccept = db.prepare(`
    SELECT avg((julianday(h.changed_at) - julianday(o.created_at)) * 1440) AS minutes
    FROM orders o
    JOIN order_status_history h ON h.order_id = o.id AND h.to_status = 'accepted'
    WHERE o.place_id = @placeId AND date(o.created_at, '+3 hours') = @date AND o.order_code NOT LIKE 'TEST-%'
  `).get(params).minutes;

  const week = db.prepare(`
    SELECT
      count(*) AS total,
      COALESCE(sum(CASE WHEN status = 'issued' THEN total_price END), 0) AS revenue
    FROM orders
    WHERE place_id = @placeId AND order_code NOT LIKE 'TEST-%'
      AND date(created_at, '+3 hours') > date(@date, '-7 days')
      AND date(created_at, '+3 hours') <= @date
  `).get(params);

  return { ...summary, rejectReasons, newCustomers, topItems, avgAcceptMinutes: avgAccept, week };
}
