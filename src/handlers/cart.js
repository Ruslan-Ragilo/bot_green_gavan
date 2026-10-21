import { Composer, InlineKeyboard } from 'grammy';
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
import { getDesiredTimeLabel, parseCustomTimeInput } from '../utils/time.js';

export const cartComposer = new Composer();

// Временное хранение данных оформления заказа
const userComments = new Map(); // userId -> commentText
const pendingCommentUsers = new Map(); // userId -> timeKey
const pendingCustomTimeUsers = new Map(); // userId -> true

// Словарь понятных названий временных слотов
export const TIME_LABELS = {
  asap: 'Как можно скорее (~15–20 мин)',
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

// Обработка команды /cart из меню быстрого доступа
cartComposer.command('cart', async (ctx) => {
  const cart = getCart(ctx.from.id);
  const text = renderCartText(cart);
  const keyboard = cart.isEmpty ? emptyCartKeyboard() : cartKeyboard(cart);

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

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
  pendingCustomTimeUsers.delete(ctx.from.id);
  const cart = getCart(ctx.from.id);

  if (cart.isEmpty) {
    return ctx.editMessageText('Корзина пуста. Нечего оформлять.', {
      reply_markup: emptyCartKeyboard(),
    });
  }

  const text = (
    `⏱ *К какому времени приготовить заказ в «${cart.place.name}»?*\n\n` +
    `Выберите подходящее время самовывоза или укажите своё:`
  );

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: timeSelectionKeyboard(),
  });
});

// Запрос ввода точного времени от жильца
cartComposer.callbackQuery('time:custom_prompt', async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from.id;
  pendingCustomTimeUsers.set(userId, true);

  const text = (
    `🕒 *Введите желаемое время самовывоза*\n\n` +
    `Напишите точное время следующим сообщением (например: \`14:30\`, \`18:00\` или \`19:15\`):\n\n` +
    `⚠️ _Заказ оформляется на сегодня, минимум за 15 минут до получения._`
  );

  const keyboard = new InlineKeyboard()
    .text('◀️ Назад к выбору времени', 'cart:checkout:time');

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Экран подтверждения заказа с выбранным временем
cartComposer.callbackQuery(/^time:([a-z0-9_]+)$/, async (ctx) => {
  const timeKey = ctx.match[1];
  if (timeKey === 'custom_prompt') return;

  await ctx.answerCallbackQuery();
  pendingCustomTimeUsers.delete(ctx.from.id);
  const desiredTimeLabel = getDesiredTimeLabel(timeKey);
  const cart = getCart(ctx.from.id);

  if (cart.isEmpty) {
    return ctx.editMessageText('Корзина пуста.', { reply_markup: emptyCartKeyboard() });
  }

  const comment = userComments.get(ctx.from.id);

  let text = `📋 *Подтверждение предзаказа*\n\n`;
  text += `🏪 *Заведение:* ${cart.place.name}\n`;
  text += `📍 *Точка самовывоза:* ${cart.place.pickup_point}\n`;
  text += `⏱ *Желаемое время:* ${desiredTimeLabel}\n\n`;
  text += `*Состав заказа:*\n`;

  for (const item of cart.items) {
    text += `• ${item.item_name} × ${item.quantity} = ${item.subtotal} ₽\n`;
  }

  if (comment) {
    text += `\n💬 *Пожелание к заказу:* _${comment}_\n`;
  } else {
    text += `\n💬 *Пожелание к заказу:* _не указано_\n`;
  }

  text += `\n💵 *Сумма к оплате при получении:* *${cart.totalPrice} ₽*\n\n`;
  text += `Нажмите «Подтвердить предзаказ», чтобы отправить заказ в заведение:`;

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: orderConfirmKeyboard(timeKey, Boolean(comment)),
  });
});

// Запрос комментария / пожелания к заказу от жильца
cartComposer.callbackQuery(/^order:comment_prompt:([a-z0-9_]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const timeKey = ctx.match[1];
  const userId = ctx.from.id;
  pendingCommentUsers.set(userId, timeKey);

  const text = (
    `💬 *Пожелание к заказу*\n\n` +
    `Напишите любые пожелания или уточнения для кухни следующим сообщением:\n\n` +
    `_(Например: «без лука», «аллергия на орехи», «побольше салфеток», «сделать поострее» или «без оливок».)_`
  );

  const keyboard = new InlineKeyboard()
    .text('◀️ Назад / Без изменений', `time:${timeKey}`);

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Перехват текстового сообщения (ввод точного времени или комментария)
cartComposer.on('message:text', async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) {
    return next();
  }

  // 1. Проверяем ввод точного времени самовывоза
  if (pendingCustomTimeUsers.has(userId)) {
    const input = ctx.message.text.trim();
    const result = parseCustomTimeInput(input);

    if (!result.ok) {
      if (result.error === 'too_soon_or_past') {
        return ctx.reply(
          `⚠️ *Время «${input}» уже прошло или слишком близко.*\n\n` +
          `Сейчас в Минске: *${result.currentStr}*.\n` +
          `Минимальное доступное время: *${result.minAllowedStr}* (нужно минимум 15 минут на готовку).\n\n` +
          `Пожалуйста, укажите время позже (например: \`${result.minAllowedStr}\`):`,
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard().text('◀️ Назад к выбору времени', 'cart:checkout:time'),
          }
        );
      }

      return ctx.reply(
        `⚠️ *Неверный формат времени.*\n\n` +
        `Пожалуйста, укажите время в формате ЧЧ:ММ (например: \`14:30\`, \`18:00\` или \`19:15\`):`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('◀️ Назад к выбору времени', 'cart:checkout:time'),
        }
      );
    }

    pendingCustomTimeUsers.delete(userId);
    const timeKey = result.timeKey;
    const desiredTimeLabel = result.label;
    const cart = getCart(userId);

    if (cart.isEmpty) {
      return ctx.reply('Корзина пуста.', { reply_markup: emptyCartKeyboard() });
    }

    const comment = userComments.get(userId);

    let text = `📋 *Подтверждение предзаказа*\n\n`;
    text += `🏪 *Заведение:* ${cart.place.name}\n`;
    text += `📍 *Точка самовывоза:* ${cart.place.pickup_point}\n`;
    text += `⏱ *Желаемое время:* ${desiredTimeLabel}\n\n`;
    text += `*Состав заказа:*\n`;

    for (const item of cart.items) {
      text += `• ${item.item_name} × ${item.quantity} = ${item.subtotal} ₽\n`;
    }

    if (comment) {
      text += `\n💬 *Пожелание к заказу:* _${comment}_\n`;
    } else {
      text += `\n💬 *Пожелание к заказу:* _не указано_\n`;
    }

    text += `\n💵 *Сумма к оплате при получении:* *${cart.totalPrice} ₽*\n\n`;
    text += `Нажмите «Подтвердить предзаказ», чтобы отправить заказ в заведение:`;

    return ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: orderConfirmKeyboard(timeKey, Boolean(comment)),
    });
  }

  // 2. Проверяем ввод комментария к заказу
  if (pendingCommentUsers.has(userId)) {
    const timeKey = pendingCommentUsers.get(userId);
    pendingCommentUsers.delete(userId);
    const comment = ctx.message.text.trim();
    userComments.set(userId, comment);

    const desiredTimeLabel = getDesiredTimeLabel(timeKey);
    const cart = getCart(userId);

    if (cart.isEmpty) {
      return ctx.reply('Корзина пуста.', { reply_markup: emptyCartKeyboard() });
    }

    let text = `📋 *Подтверждение предзаказа*\n\n`;
    text += `🏪 *Заведение:* ${cart.place.name}\n`;
    text += `📍 *Точка самовывоза:* ${cart.place.pickup_point}\n`;
    text += `⏱ *Желаемое время:* ${desiredTimeLabel}\n\n`;
    text += `*Состав заказа:*\n`;

    for (const item of cart.items) {
      text += `• ${item.item_name} × ${item.quantity} = ${item.subtotal} ₽\n`;
    }

    text += `\n💬 *Пожелание к заказу:* _${comment}_\n`;
    text += `\n💵 *Сумма к оплате при получении:* *${cart.totalPrice} ₽*\n\n`;
    text += `Пожелание сохранено! Нажмите «Подтвердить предзаказ»:`;

    return ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: orderConfirmKeyboard(timeKey, true),
    });
  }

  return next();
});

// Финальное подтверждение: создание заказа и отправка в группу заведения
cartComposer.callbackQuery(/^order:confirm:([a-z0-9_]+)$/, async (ctx) => {
  const timeKey = ctx.match[1];
  const desiredTimeLabel = getDesiredTimeLabel(timeKey);
  const userId = ctx.from.id;

  const comment = userComments.get(userId) || null;
  userComments.delete(userId);
  pendingCommentUsers.delete(userId);
  pendingCustomTimeUsers.delete(userId);

  let order;
  try {
    const cart = getCart(userId);
    order = createOrderFromCart({
      userId,
      placeId: cart.place.id,
      desiredTime: desiredTimeLabel,
      comment,
    });
  } catch (error) {
    return ctx.answerCallbackQuery({
      text: `Ошибка: ${error.message}`,
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery({ text: `Заказ ${order.order_code} успешно оформлен!` });

  // 1. Формируем карточку заказа для группы заведения с выделенным блоком пожелания
  const commentBlock = order.comment ? `\n💬 *Пожелание клиента:* *${order.comment}*\n` : '';

  const staffCardText = (
    `🔔 *НОВЫЙ ЗАКАЗ ${order.order_code}*\n\n` +
    `👤 *Клиент:* ${order.first_name || 'Жилец'} ${order.username ? `(@${order.username})` : ''}\n` +
    `⏱ *Время получения:* ${order.desired_time}\n` +
    `📍 *Точка выдачи:* ${order.pickup_point}\n\n` +
    `*Позиции:*\n` +
    order.items.map(i => `• ${i.item_name} × ${i.quantity} = ${i.price * i.quantity} ₽`).join('\n') +
    `\n` +
    commentBlock +
    `\n💵 *Итого:* *${order.total_price} ₽*\n` +
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
  let clientConfirmationText = (
    `✅ *Заказ ${order.order_code} отправлен в заведение!*\n\n` +
    `🏪 *Заведение:* ${order.place_name}\n` +
    `📍 *Точка самовывоза:* ${order.pickup_point}\n` +
    `⏱ *Ожидаемое время:* ${order.desired_time}\n`
  );

  if (order.comment) {
    clientConfirmationText += `💬 *Ваше пожелание:* _${order.comment}_\n`;
  }

  clientConfirmationText += (
    `💵 *Сумма:* ${order.total_price} ₽ (оплата при получении)\n\n` +
    `Мы пришлем уведомление, когда заведение примет заказ в работу и когда он будет готов.`
  );

  await ctx.editMessageText(clientConfirmationText, {
    parse_mode: 'Markdown',
    reply_markup: clientOrderKeyboard(order),
  });
});

