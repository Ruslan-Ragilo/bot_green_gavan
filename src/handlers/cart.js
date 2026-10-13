import { Composer } from 'grammy';
import { getCart, setCartItemQuantity, removeCartItem, clearCart } from '../db/repositories/cart.js';
import { createOrderFromCart, setOrderGroupMessageId } from '../db/repositories/orders.js';
import {
  cartKeyboard,
  emptyCartKeyboard,
  timeSelectionKeyboard,
  orderConfirmKeyboard,
  clientOrderKeyboard,
} from '../keyboards/client.js';
import { staffOrderKeyboard } from '../keyboards/staff.js';

export const cartComposer = new Composer();

// Словарь понятных названий временных слотов
export const TIME_LABELS = {
  asap: 'Как можно скорее (~15 мин)',
  '30m': 'Через 30 минут',
  '45m': 'Через 45 минут',
  '60m': 'Через 1 час',
};

// Функция отрисовки текста корзины
function renderCartText(cart) {
  if (cart.isEmpty) {
    return '🛒 *Ваша корзина пуста.*\n\nПерейдите в меню заведений, чтобы выбрать блюда.';
  }

  let text = `🛒 *Корзина заказа в «${cart.place.name}»*\n`;
  text += `📍 *Точка самовывоза:* ${cart.place.pickup_point}\n\n`;

  for (let i = 0; i < cart.items.length; i++) {
    const item = cart.items[i];
    text += `${i + 1}. *${item.item_name}* — ${item.quantity} шт. × ${item.price} ₽ = *${item.subtotal} ₽*\n`;
  }

  text += `\n💵 *Итого к оплате при получении:* ${cart.totalPrice} ₽\n`;
  text += `\nНажмите «Выбрать время получения», чтобы завершить предзаказ.`;
  return text;
}

// Просмотр корзины
cartComposer.callbackQuery('cart:view', async (ctx) => {
  await ctx.answerCallbackQuery();
  const cart = getCart(ctx.from.id);

  if (cart.isEmpty) {
    return ctx.editMessageText(renderCartText(cart), {
      parse_mode: 'Markdown',
      reply_markup: emptyCartKeyboard(),
    });
  }

  await ctx.editMessageText(renderCartText(cart), {
    parse_mode: 'Markdown',
    reply_markup: cartKeyboard(cart),
  });
});

// Увеличение количества позиции (+1)
cartComposer.callbackQuery(/^cart:inc:(\d+)$/, async (ctx) => {
  const itemId = Number(ctx.match[1]);
  const cart = getCart(ctx.from.id);
  const item = cart.items.find(i => i.item_id === itemId);

  if (!item) {
    return ctx.answerCallbackQuery({ text: 'Позиция не найдена в корзине' });
  }

  const updatedCart = setCartItemQuantity(ctx.from.id, itemId, item.quantity + 1);
  await ctx.answerCallbackQuery();

  await ctx.editMessageText(renderCartText(updatedCart), {
    parse_mode: 'Markdown',
    reply_markup: cartKeyboard(updatedCart),
  });
});

// Уменьшение количества позиции (-1)
cartComposer.callbackQuery(/^cart:dec:(\d+)$/, async (ctx) => {
  const itemId = Number(ctx.match[1]);
  const cart = getCart(ctx.from.id);
  const item = cart.items.find(i => i.item_id === itemId);

  if (!item) {
    return ctx.answerCallbackQuery({ text: 'Позиция не найдена в корзине' });
  }

  const updatedCart = setCartItemQuantity(ctx.from.id, itemId, item.quantity - 1);
  await ctx.answerCallbackQuery();

  if (updatedCart.isEmpty) {
    return ctx.editMessageText(renderCartText(updatedCart), {
      parse_mode: 'Markdown',
      reply_markup: emptyCartKeyboard(),
    });
  }

  await ctx.editMessageText(renderCartText(updatedCart), {
    parse_mode: 'Markdown',
    reply_markup: cartKeyboard(updatedCart),
  });
});

// Удаление позиции из корзины (🗑)
cartComposer.callbackQuery(/^cart:del:(\d+)$/, async (ctx) => {
  const itemId = Number(ctx.match[1]);
  const updatedCart = removeCartItem(ctx.from.id, itemId);
  await ctx.answerCallbackQuery({ text: 'Позиция удалена из корзины' });

  if (updatedCart.isEmpty) {
    return ctx.editMessageText(renderCartText(updatedCart), {
      parse_mode: 'Markdown',
      reply_markup: emptyCartKeyboard(),
    });
  }

  await ctx.editMessageText(renderCartText(updatedCart), {
    parse_mode: 'Markdown',
    reply_markup: cartKeyboard(updatedCart),
  });
});

// Полная очистка корзины
cartComposer.callbackQuery('cart:clear', async (ctx) => {
  clearCart(ctx.from.id);
  await ctx.answerCallbackQuery({ text: 'Корзина очищена' });

  await ctx.editMessageText('🛒 *Корзина пуста.*', {
    parse_mode: 'Markdown',
    reply_markup: emptyCartKeyboard(),
  });
});

// Шаг оформления: выбор времени получения
cartComposer.callbackQuery('cart:checkout:time', async (ctx) => {
  await ctx.answerCallbackQuery();
  const cart = getCart(ctx.from.id);

  if (cart.isEmpty) {
    return ctx.editMessageText('Корзина пуста. Нечего оформлять.', {
      reply_markup: emptyCartKeyboard(),
    });
  }

  const text = (
    `⏱ *К какому времени приготовить заказ в «${cart.place.name}»?*\n\n` +
    `Выберите подходящее время самовывоза:`
  );

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: timeSelectionKeyboard(),
  });
});

// Экран подтверждения заказа с выбранным временем
cartComposer.callbackQuery(/^time:([a-z0-9_]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const timeKey = ctx.match[1];
  const desiredTimeLabel = TIME_LABELS[timeKey] || timeKey;
  const cart = getCart(ctx.from.id);

  if (cart.isEmpty) {
    return ctx.editMessageText('Корзина пуста.', { reply_markup: emptyCartKeyboard() });
  }

  let text = `📋 *Подтверждение предзаказа*\n\n`;
  text += `🏪 *Заведение:* ${cart.place.name}\n`;
  text += `📍 *Точка самовывоза:* ${cart.place.pickup_point}\n`;
  text += `⏱ *Желаемое время:* ${desiredTimeLabel}\n\n`;
  text += `*Состав заказа:*\n`;

  for (const item of cart.items) {
    text += `• ${item.item_name} × ${item.quantity} = ${item.subtotal} ₽\n`;
  }

  text += `\n💵 *Сумма к оплате при получении:* *${cart.totalPrice} ₽*\n\n`;
  text += `Нажмите «Подтвердить предзаказ», чтобы отправить заказ в заведение:`;

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: orderConfirmKeyboard(timeKey),
  });
});

// Финальное подтверждение: создание заказа и отправка в группу заведения
cartComposer.callbackQuery(/^order:confirm:([a-z0-9_]+)$/, async (ctx) => {
  const timeKey = ctx.match[1];
  const desiredTimeLabel = TIME_LABELS[timeKey] || timeKey;
  const userId = ctx.from.id;

  let order;
  try {
    const cart = getCart(userId);
    order = createOrderFromCart({
      userId,
      placeId: cart.place.id,
      desiredTime: desiredTimeLabel,
    });
  } catch (error) {
    return ctx.answerCallbackQuery({
      text: `Ошибка: ${error.message}`,
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery({ text: `Заказ ${order.order_code} успешно оформлен!` });

  // 1. Формируем карточку заказа для группы заведения
  const staffCardText = (
    `🔔 *НОВЫЙ ЗАКАЗ ${order.order_code}*\n\n` +
    `👤 *Клиент:* ${order.first_name || 'Жилец'} ${order.username ? `(@${order.username})` : ''}\n` +
    `⏱ *Время получения:* ${order.desired_time}\n` +
    `📍 *Точка выдачи:* ${order.pickup_point}\n\n` +
    `*Позиции:*\n` +
    order.items.map(i => `• ${i.item_name} × ${i.quantity} = ${i.price * i.quantity} ₽`).join('\n') +
    `\n\n💵 *Итого:* *${order.total_price} ₽*\n` +
    `Статус: 🟡 *Отправлен (ожидает принятия)*`
  );

  // 2. Отправляем карточку в группу заведения (если group_chat_id настроен)
  if (order.group_chat_id) {
    try {
      const groupMsg = await ctx.api.sendMessage(order.group_chat_id, staffCardText, {
        parse_mode: 'Markdown',
        reply_markup: staffOrderKeyboard(order),
      });
      // Сохраняем ID сообщения для дальнейших обновлений статусов сотрудниками
      setOrderGroupMessageId(order.id, groupMsg.message_id);
    } catch (err) {
      console.error(`[Error] Не удалось отправить заказ ${order.order_code} в группу заведения:`, err);
    }
  }

  // 3. Отправляем подтверждение жильцу в личные сообщения
  const clientConfirmationText = (
    `✅ *Заказ ${order.order_code} отправлен в заведение!*\n\n` +
    `🏪 *Заведение:* ${order.place_name}\n` +
    `📍 *Точка самовывоза:* ${order.pickup_point}\n` +
    `⏱ *Ожидаемое время:* ${order.desired_time}\n` +
    `💵 *Сумма:* ${order.total_price} ₽ (оплата при получении)\n\n` +
    `Мы пришлем уведомление, когда заведение примет заказ в работу и когда он будет готов.`
  );

  await ctx.editMessageText(clientConfirmationText, {
    parse_mode: 'Markdown',
    reply_markup: clientOrderKeyboard(order),
  });
});
