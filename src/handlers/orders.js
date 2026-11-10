import { Composer, InlineKeyboard } from 'grammy';
import { getUserOrders, getOrderById, cancelOrderByClient, updateOrderDesiredTime } from '../db/repositories/orders.js';
import { clientOrderKeyboard, orderEditTimeKeyboard } from '../keyboards/client.js';
import { escapeMarkdown, formatPrice } from '../utils/text.js';
import { parseCustomTimeInput, resolveTimeKey } from '../utils/time.js';
import { getPlaceById } from '../db/repositories/places.js';
import { checkOrderAllowed } from '../services/placeStatus.js';
import { refreshGroupCard } from '../services/groupCard.js';
import { setPendingInput, getPendingInput, clearPendingInput } from '../utils/pendingInput.js';

export const ordersComposer = new Composer();

// Словарь статусов на русском с эмодзи
export const STATUS_LABELS = {
  sent: '🟡 Ожидает подтверждения',
  accepted: '🔵 Принят в работу',
  ready: '🟢 Готов к выдаче',
  issued: '✅ Выдан',
  cancelled: '❌ Отменён',
  expired: '⚪ Просрочен',
  no_show: '🙅 Не забран',
};

/**
 * Перенос времени заказа жильцом: проверка паузы/часов/лимита, обновление заказа,
 * карточки на кухне и уведомление в группу. respond(text, options) — ответ жильцу (edit или reply).
 */
async function changeOrderTime(ctx, orderId, timeKey, respond) {
  const notAvailable = () => respond(
    '⚠️ Не удалось изменить время: заказ уже принят заведением или не найден.',
    { reply_markup: new InlineKeyboard().text('📋 Мои заказы', 'orders:my') }
  );

  const order = getOrderById(orderId);
  if (!order || order.user_id !== ctx.from.id || order.status !== 'sent') {
    return notAvailable();
  }

  const resolved = resolveTimeKey(timeKey);
  const check = checkOrderAllowed(getPlaceById(order.place_id), resolved, { excludeOrderId: orderId });
  if (!check.ok) {
    return respond(`${check.message}\n\nВыберите другое время:`, {
      parse_mode: 'Markdown',
      reply_markup: orderEditTimeKeyboard(orderId, check.suggestion),
    });
  }

  const updatedOrder = updateOrderDesiredTime(orderId, ctx.from.id, resolved.label, resolved.targetAt.toISOString());
  if (!updatedOrder) {
    return notAvailable();
  }

  // Карточка на кухне сразу показывает новое время и кнопку «Принять к …»
  await refreshGroupCard({ api: ctx.api, order: updatedOrder });

  if (updatedOrder.group_chat_id && updatedOrder.group_message_id) {
    try {
      await ctx.api.sendMessage(
        updatedOrder.group_chat_id,
        `✏️ *Клиент изменил время получения*\n\n` +
        `Заказ: *${updatedOrder.order_code}*\n` +
        `Новое время: ${escapeMarkdown(resolved.label)}`,
        {
          parse_mode: 'Markdown',
          reply_parameters: { message_id: updatedOrder.group_message_id },
        }
      );
    } catch (err) {
      console.error('[Error] Не удалось уведомить группу об изменении времени:', err);
    }
  }

  return respond(
    `✅ *Время получения изменено!*\n\n` +
    `Заказ: *${updatedOrder.order_code}*\n` +
    `🏪 Заведение: ${escapeMarkdown(updatedOrder.place_name)}\n` +
    `⏱ Новое время: ${escapeMarkdown(resolved.label)}\n\n` +
    `Заведение получило уведомление об изменении.`,
    { parse_mode: 'Markdown', reply_markup: clientOrderKeyboard(updatedOrder) }
  );
}

// Обработка команды /orders из меню быстрого доступа
ordersComposer.command('orders', async (ctx) => {
  const orders = getUserOrders(ctx.from.id, 10);

  if (orders.length === 0) {
    const emptyKeyboard = new InlineKeyboard()
      .text('🍽 Выбрать заведение', 'catalog:places').row()
      .text('◀️ В главное меню', 'menu:main');

    return ctx.reply('📋 *У вас пока нет заказов.*\n\nВыберите заведение и оформите первый заказ!', {
      parse_mode: 'Markdown',
      reply_markup: emptyKeyboard,
    });
  }

  const keyboard = new InlineKeyboard();
  for (const o of orders) {
    const statusLabel = STATUS_LABELS[o.status] || o.status;
    keyboard.text(`${o.order_code} — ${o.place_name} (${statusLabel})`, `order:client_view:${o.id}`).row();
  }
  keyboard.text('◀️ В главное меню', 'menu:main');

  const text = (
    `📋 *История ваших предзаказов*\n\n` +
    `Нажмите на заказ, чтобы посмотреть детали и статус готовности:`
  );

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Просмотр списка заказов жильца («Мои заказы»)
ordersComposer.callbackQuery('orders:my', async (ctx) => {
  await ctx.answerCallbackQuery();
  const orders = getUserOrders(ctx.from.id, 10);

  if (orders.length === 0) {
    const emptyKeyboard = new InlineKeyboard()
      .text('🍽 Выбрать заведение', 'catalog:places').row()
      .text('◀️ В главное меню', 'menu:main');

    return ctx.editMessageText('📋 *У вас пока нет заказов.*\n\nВыберите заведение и оформите первый заказ!', {
      parse_mode: 'Markdown',
      reply_markup: emptyKeyboard,
    });
  }

  const keyboard = new InlineKeyboard();
  for (const o of orders) {
    const statusLabel = STATUS_LABELS[o.status] || o.status;
    keyboard.text(`${o.order_code} — ${o.place_name} (${statusLabel})`, `order:client_view:${o.id}`).row();
  }
  keyboard.text('◀️ В главное меню', 'menu:main');

  const text = (
    `📋 *История ваших предзаказов*\n\n` +
    `Нажмите на заказ, чтобы посмотреть детали и статус готовности:`
  );

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Просмотр деталей конкретного заказа жильцом
ordersComposer.callbackQuery(/^order:client_view:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const orderId = Number(ctx.match[1]);
  const order = getOrderById(orderId);

  if (!order || order.user_id !== ctx.from.id) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  const statusLabel = STATUS_LABELS[order.status] || order.status;

  let text = `📦 *Заказ ${order.order_code}*\n\n`;
  text += `🏪 *Заведение:* ${escapeMarkdown(order.place_name)}\n`;
  text += `📍 *Точка самовывоза:* ${escapeMarkdown(order.pickup_point)}\n`;
  text += `⏱ *Желаемое время:* ${escapeMarkdown(order.desired_time)}\n`;
  text += `📊 *Статус:* ${statusLabel}\n\n`;
  text += `*Состав:*\n`;

  for (const item of order.items) {
    text += `• ${escapeMarkdown(item.item_name)} × ${item.quantity} = ${formatPrice(item.price * item.quantity)}\n`;
  }

  if (order.comment) {
    text += `\n💬 *Пожелание к заказу:* ${escapeMarkdown(order.comment)}\n`;
  }

  text += `\n💵 *Итого:* *${formatPrice(order.total_price)}* (оплата на месте)\n`;

  if (order.status === 'ready') {
    text += `\n🎉 *Заказ готов!* Подойдите к точке выдачи и назовите код *${order.order_code}*.`;
  }

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: clientOrderKeyboard(order),
  });
});

// Жилец подтвердил согласие на ожидание при задержке на кухне
ordersComposer.callbackQuery(/^order:delay_ack:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const order = getOrderById(orderId);
  await ctx.answerCallbackQuery({ text: 'Спасибо за понимание! Сообщим, как только блюда будут готовы.' });

  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (_) {}

  // Оповещаем кухню в группе, что клиент подтвердил задержку
  if (order?.group_chat_id) {
    try {
      await ctx.api.sendMessage(
        order.group_chat_id,
        `👌 *Клиент подтвердил ожидание* по заказу ${order.order_code}! Заказ в работе.`,
        {
          parse_mode: 'Markdown',
          reply_parameters: order.group_message_id ? { message_id: order.group_message_id } : undefined,
        }
      );
    } catch (err) {
      console.error(`[Error] Не удалось отправить подтверждение ожидания в группу:`, err);
    }
  }
});

// Отмена заказа жильцом (в статусе 'sent' или при задержке)
ordersComposer.callbackQuery(/^order:client_cancel:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const order = getOrderById(orderId);

  if (!order || order.user_id !== ctx.from.id) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  // Атомарно пытаемся перевести заказ из 'sent' или 'accepted' в 'cancelled'
  const isCancelled = cancelOrderByClient(orderId, ctx.from.id);

  if (!isCancelled) {
    return ctx.answerCallbackQuery({
      text: 'Невозможно отменить: заказ уже выдан или отменён!',
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery({ text: `Заказ ${order.order_code} отменён` });

  // 1. Обновляем карточку заказа в группе (убираем кнопки, меняем статус)
  if (order.group_chat_id && order.group_message_id) {
    try {
      await ctx.api.editMessageText(
        order.group_chat_id,
        order.group_message_id,
        `❌ *ЗАКАЗ ${order.order_code} ОТМЕНЁН КЛИЕНТОМ*\n\n` +
        `👤 Клиент: ${escapeMarkdown(order.first_name || 'Жилец')}\n` +
        `Сумма: ${formatPrice(order.total_price)}\n` +
        `Статус: ❌ *Отменён жильцом (долго ждать)*`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error(`[Error] Не удалось обновить карточку заказа ${order.order_code} в группе:`, err);
    }
  }

  // 2. Отправляем звуковое отдельное сообщение в группу, чтобы кухня ТОЧНО увидела отмену!
  if (order.group_chat_id) {
    try {
      await ctx.api.sendMessage(
        order.group_chat_id,
        `🚫 *ВНИМАНИЕ КУХНЯ: ОТМЕНА ЗАКАЗА ${order.order_code}!*\n\n` +
        `Клиент ${escapeMarkdown(order.first_name || 'Жилец')} отказался от ожидания и отменил заказ.\n` +
        `Готовить НЕ нужно! 🛑`,
        {
          parse_mode: 'Markdown',
          reply_parameters: order.group_message_id ? { message_id: order.group_message_id } : undefined,
        }
      );
    } catch (err) {
      console.error(`[Error] Не удалось отправить оповещение об отмене в группу:`, err);
    }
  }

  const updatedOrder = getOrderById(orderId);
  await ctx.editMessageText(
    `❌ *Заказ ${order.order_code} успешно отменён.*\n\n` +
    `Сумма заказа: ${formatPrice(order.total_price)}.\n` +
    `Вы можете оформить новый предзаказ в любое удобное время.`,
    {
      parse_mode: 'Markdown',
      reply_markup: clientOrderKeyboard(updatedOrder),
    }
  );
});

// Экран выбора нового времени для редактирования заказа
ordersComposer.callbackQuery(/^order:change_time:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const orderId = Number(ctx.match[1]);
  const order = getOrderById(orderId);

  if (!order || order.user_id !== ctx.from.id) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  if (order.status !== 'sent') {
    return ctx.answerCallbackQuery({
      text: 'Изменить время можно только пока заведение не приняло заказ',
      show_alert: true,
    });
  }

  await ctx.editMessageText(
    `✏️ *Изменение времени получения*\n\n` +
    `Заказ: *${order.order_code}*\n` +
    `Текущее время: ${escapeMarkdown(order.desired_time)}\n\n` +
    `Выберите новое время:`,
    { parse_mode: 'Markdown', reply_markup: orderEditTimeKeyboard(orderId) }
  );
});

// Выбор нового времени из пресетов (asap, 30m, 45m, 60m)
ordersComposer.callbackQuery(/^order:edit_time:(\d+):([a-z0-9_]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const orderId = Number(ctx.match[1]);
  const timeKey = ctx.match[2];

  await changeOrderTime(ctx, orderId, timeKey, (text, options) => ctx.editMessageText(text, options));
});

// Запрос ввода точного нового времени
ordersComposer.callbackQuery(/^order:edit_time_custom:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const orderId = Number(ctx.match[1]);
  const order = getOrderById(orderId);

  if (!order || order.user_id !== ctx.from.id || order.status !== 'sent') {
    return ctx.answerCallbackQuery({ text: 'Недоступно: заказ уже принят или не найден', show_alert: true });
  }

  setPendingInput(ctx.from.id, 'edit_time', { orderId });

  await ctx.editMessageText(
    `🕒 *Введите новое время самовывоза*\n\n` +
    `Напишите время следующим сообщением (например: \`19:00\`, \`18:30\`):\n\n` +
    `⚠️ _Минимум за 15 минут от текущего времени._`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('◀️ Назад', `order:change_time:${orderId}`),
    }
  );
});

// Перехват текстового сообщения: ввод нового точного времени для редактирования заказа
ordersComposer.on('message:text', async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || ctx.chat?.type !== 'private') return next();

  const editState = getPendingInput(userId, 'edit_time');
  if (!editState) return next();

  const { orderId } = editState;
  const input = ctx.message.text.trim();
  const result = parseCustomTimeInput(input);

  if (!result.ok) {
    const backKeyboard = new InlineKeyboard().text('◀️ Назад', `order:change_time:${orderId}`);
    if (result.error === 'too_soon_or_past') {
      return ctx.reply(
        `⚠️ Время «${input}» уже прошло или слишком близко.\n\n` +
        `Сейчас: *${result.currentStr}*, минимальное: *${result.minAllowedStr}*`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard }
      );
    }
    return ctx.reply(
      `⚠️ Неверный формат. Укажите время вида \`19:00\` или \`18:30\`:`,
      { parse_mode: 'Markdown', reply_markup: backKeyboard }
    );
  }

  clearPendingInput(userId);
  await changeOrderTime(ctx, orderId, result.timeKey, (text, options) => ctx.reply(text, options));
});
