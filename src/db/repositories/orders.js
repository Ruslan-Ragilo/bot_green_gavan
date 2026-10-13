import { db } from '../index.js';
import { getCart, clearCart } from './cart.js';
import { getPlaceById } from './places.js';

// Допустимые статусы заказа строго по ТЗ
export const ORDER_STATUSES = {
  SENT: 'sent',
  ACCEPTED: 'accepted',
  READY: 'ready',
  ISSUED: 'issued',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

// Создание заказа из корзины в единой атомарной транзакции
export function createOrderFromCart({ userId, placeId, desiredTime, comment = null }) {
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
        fulfillment_type, pickup_point, desired_time, comment,
        total_price, created_at, updated_at
      ) VALUES (
        'pending', @userId, @placeId, 'sent',
        'pickup', @pickupPoint, @desiredTime, @comment,
        @totalPrice, datetime('now'), datetime('now')
      )
    `);

    const orderResult = insertOrderStmt.run({
      userId,
      placeId,
      pickupPoint: place.pickup_point,
      desiredTime,
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
    JOIN users u ON u.telegram_id = o.user_id
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
export function atomicUpdateOrderStatus(orderId, expectedStatus, nextStatus, changedByUserId = null) {
  const updateStmt = db.prepare(`
    UPDATE orders
    SET status = ?, updated_at = datetime('now')
    WHERE id = ? AND status = ?
  `);

  const historyStmt = db.prepare(`
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const result = updateStmt.run(nextStatus, orderId, expectedStatus);
    if (result.changes > 0) {
      historyStmt.run(orderId, expectedStatus, nextStatus, changedByUserId);
      return true;
    }
    return false;
  });

  return transaction();
}

// Отмена заказа жильцом (строго только в статусе 'sent' — до принятия заведением)
export function cancelOrderByClient(orderId, clientUserId) {
  return atomicUpdateOrderStatus(orderId, ORDER_STATUSES.SENT, ORDER_STATUSES.CANCELLED, clientUserId);
}

// Отмена заказа персоналом заведения (если заказ ещё не выдан, не отменен и не просрочен)
export function cancelOrderByStaff(orderId, staffUserId) {
  const order = getOrderById(orderId);
  if (!order) return false;

  if (['issued', 'cancelled', 'expired'].includes(order.status)) {
    return false;
  }

  return atomicUpdateOrderStatus(orderId, order.status, ORDER_STATUSES.CANCELLED, staffUserId);
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
