import { InlineKeyboard } from 'grammy';

// Главное меню жильца
export function mainMenuKeyboard(cartTotalQuantity = 0, activePlaceName = null) {
  const cartLabel = cartTotalQuantity > 0 ? `🛒 Корзина (${cartTotalQuantity})` : '🛒 Корзина';
  const menuLabel = activePlaceName ? `🍽 Меню «${activePlaceName}»` : '🍽 Выбрать заведение';

  return new InlineKeyboard()
    .text('🚌 Расписание транспорта', 'transport:menu').row()
    .text(menuLabel, 'catalog:places').row()
    .text(cartLabel, 'cart:view')
    .text('📋 Мои заказы', 'orders:my');
}

// Список активных заведений ЖК
export function placesKeyboard(places) {
  const keyboard = new InlineKeyboard();

  for (const place of places) {
    keyboard.text(`🏪 ${place.name}`, `place:${place.id}`).row();
  }

  keyboard.text('◀️ В главное меню', 'menu:main');
  return keyboard;
}

// Меню блюд выбранного заведения
export function placeMenuKeyboard(placeId, items, cartTotalQuantity = 0) {
  const keyboard = new InlineKeyboard();

  for (const item of items) {
    keyboard.text(`${item.name} — ${item.price} ₽`, `item:${item.id}`).row();
  }

  const cartLabel = cartTotalQuantity > 0 ? `🛒 В корзину (${cartTotalQuantity} шт.)` : '🛒 Корзина';
  keyboard.text(cartLabel, 'cart:view').row();
  keyboard.text('◀️ В главное меню', 'menu:main');

  return keyboard;
}

// Карточка отдельного блюда с добавлением в корзину
export function itemDetailKeyboard(item, currentQuantityInCart = 0) {
  const keyboard = new InlineKeyboard();

  if (item.is_available) {
    keyboard.text(`➕ Добавить за ${item.price} ₽`, `cart:add:${item.id}:1`).row();
  } else {
    keyboard.text('⛔ Временно нет в наличии', 'noop').row();
  }

  if (currentQuantityInCart > 0) {
    keyboard.text(`🛒 В корзине: ${currentQuantityInCart} шт.`, 'cart:view').row();
  }

  keyboard.text('◀️ Назад в меню', `place:${item.place_id}`);
  return keyboard;
}

// Клавиатура корзины с управлением количеством позиций
export function cartKeyboard(cart) {
  const keyboard = new InlineKeyboard();

  for (const item of cart.items) {
    keyboard
      .text('➖', `cart:dec:${item.item_id}`)
      .text(`${item.quantity} шт.`, 'noop')
      .text('➕', `cart:inc:${item.item_id}`)
      .text('🗑', `cart:del:${item.item_id}`)
      .row();
  }

  keyboard.text('⏱ Выбрать время получения', 'cart:checkout:time').row();
  keyboard.text('🧹 Очистить корзину', 'cart:clear')
    .text('➕ Добавить ещё', `place:${cart.place.id}`).row();
  keyboard.text('◀️ В главное меню', 'menu:main');

  return keyboard;
}

// Клавиатура пустой корзины
export function emptyCartKeyboard() {
  return new InlineKeyboard()
    .text('🍽 Выбрать заведение', 'catalog:places').row()
    .text('◀️ В главное меню', 'menu:main');
}

// Выбор времени готовности заказа
export function timeSelectionKeyboard() {
  return new InlineKeyboard()
    .text('⚡ Как можно скорее (~15–20 мин)', 'time:asap').row()
    .text('🕒 Через 30 минут', 'time:30m')
    .text('🕓 Через 45 минут', 'time:45m').row()
    .text('🕔 Через 1 час', 'time:60m')
    .text('✍️ Указать точное время', 'time:custom_prompt').row()
    .text('◀️ Назад в корзину', 'cart:view');
}

// Подтверждение оформления заказа
export function orderConfirmKeyboard(timeKey, hasComment = false) {
  const commentBtn = hasComment ? '✏️ Изменить пожелание' : '💬 Добавить пожелание к заказу';
  return new InlineKeyboard()
    .text('✅ Подтвердить предзаказ', `order:confirm:${timeKey}`).row()
    .text(commentBtn, `order:comment_prompt:${timeKey}`).row()
    .text('◀️ Изменить время', 'cart:checkout:time');
}

// Карточка активного заказа для жильца
export function clientOrderKeyboard(order) {
  const keyboard = new InlineKeyboard();

  // Жилец может отменить заказ ТОЛЬКО в статусе 'sent' (до принятия заведением)
  if (order.status === 'sent') {
    keyboard.text('❌ Отменить заказ', `order:client_cancel:${order.id}`).row();
  }

  keyboard.text('📋 Мои заказы', 'orders:my').row();
  keyboard.text('◀️ В главное меню', 'menu:main');
  return keyboard;
}
