import { db } from '../index.js';

// Получение ID заведения, для которого сейчас собрана корзина жильца
export function getCartPlaceId(userId) {
  const stmt = db.prepare('SELECT place_id FROM cart_items WHERE user_id = ? LIMIT 1');
  const row = stmt.get(userId);
  return row ? row.place_id : null;
}

// Получение подробного содержимого корзины жильца
export function getCart(userId) {
  const stmt = db.prepare(`
    SELECT
      c.id AS cart_item_id,
      c.place_id,
      c.item_id,
      c.quantity,
      i.name AS item_name,
      i.price,
      i.is_available,
      (i.price * c.quantity) AS subtotal,
      p.name AS place_name,
      p.pickup_point,
      p.group_chat_id
    FROM cart_items c
    JOIN items i ON i.id = c.item_id
    JOIN places p ON p.id = c.place_id
    WHERE c.user_id = ?
    ORDER BY c.id ASC
  `);

  const items = stmt.all(userId);
  const totalPrice = items.reduce((sum, item) => sum + item.subtotal, 0);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const place = items.length > 0 ? {
    id: items[0].place_id,
    name: items[0].place_name,
    pickup_point: items[0].pickup_point,
    group_chat_id: items[0].group_chat_id,
  } : null;

  return {
    items,
    place,
    totalPrice,
    totalQuantity,
    isEmpty: items.length === 0,
  };
}

// Добавление позиции в корзину (или увеличение количества на delta)
// Если в корзине уже были товары из другого заведения — корзина автоматически сбрасывается под новое заведение
export function addToCart(userId, placeId, itemId, delta = 1) {
  const clearOtherPlace = db.prepare('DELETE FROM cart_items WHERE user_id = ? AND place_id != ?');
  const upsertItem = db.prepare(`
    INSERT INTO cart_items (user_id, place_id, item_id, quantity, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, place_id, item_id) DO UPDATE SET
      quantity = cart_items.quantity + excluded.quantity,
      updated_at = datetime('now')
  `);

  const transaction = db.transaction(() => {
    clearOtherPlace.run(userId, placeId);
    upsertItem.run(userId, placeId, itemId, delta);
  });

  transaction();
  return getCart(userId);
}

// Изменение точного количества конкретного товара в корзине
export function setCartItemQuantity(userId, itemId, quantity) {
  if (quantity <= 0) {
    return removeCartItem(userId, itemId);
  }

  const stmt = db.prepare(`
    UPDATE cart_items
    SET quantity = ?, updated_at = datetime('now')
    WHERE user_id = ? AND item_id = ?
  `);
  stmt.run(quantity, userId, itemId);
  return getCart(userId);
}

// Удаление одной позиции из корзины
export function removeCartItem(userId, itemId) {
  const stmt = db.prepare('DELETE FROM cart_items WHERE user_id = ? AND item_id = ?');
  stmt.run(userId, itemId);
  return getCart(userId);
}

// Полная очистка корзины жильца
export function clearCart(userId, placeId = null) {
  if (placeId) {
    const stmt = db.prepare('DELETE FROM cart_items WHERE user_id = ? AND place_id = ?');
    return stmt.run(userId, placeId);
  }
  const stmt = db.prepare('DELETE FROM cart_items WHERE user_id = ?');
  return stmt.run(userId);
}
