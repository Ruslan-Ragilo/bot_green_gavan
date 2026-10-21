import { Composer, InlineKeyboard } from 'grammy';
import { getOrderById, atomicUpdateOrderStatus, cancelOrderByStaff, ORDER_STATUSES } from '../db/repositories/orders.js';
import { isStaffMember } from '../db/repositories/staff.js';
import { staffOrderKeyboard } from '../keyboards/staff.js';
import { formatMinskTime, parseDesiredTime } from '../utils/time.js';
import { escapeMarkdown } from '../utils/text.js';

export const staffComposer = new Composer();

// Вспомогательная функция для сборки обновлённого текста карточки заказа в группе
function formatGroupCardText(order, staffName) {
  let statusEmoji = '🟡';
  let statusName = 'Отправлен';

  if (order.status === 'accepted') {
    statusEmoji = '🔵';
    statusName = `Принят в работу (${staffName || 'сотрудник'})`;
  } else if (order.status === 'ready') {
    statusEmoji = '🟢';
    statusName = `Готов к выдаче (${staffName || 'сотрудник'})`;
  } else if (order.status === 'issued') {
    statusEmoji = '✅';
    statusName = `Выдан (${staffName || 'сотрудник'})`;
  } else if (order.status === 'cancelled') {
    statusEmoji = '❌';
    statusName = `Отменён (${staffName || 'сотрудник'})`;
  }

  const clientName = escapeMarkdown(order.first_name || 'Жилец');
  const clientUsername = order.username ? `(@${escapeMarkdown(order.username)})` : '';
  const commentBlock = order.comment ? `\n💬 *Пожелание клиента:* _${escapeMarkdown(order.comment)}_\n` : '';
  const readyBlock = (order.ready_at && ['accepted', 'ready'].includes(order.status))
    ? `\n⏱ *Ориентир готовности:* ~${order.ready_at}`
    : '';

  return (
    `📦 *ЗАКАЗ ${order.order_code}*\n\n` +
    `👤 *Клиент:* ${clientName} ${clientUsername}\n` +
    `⏱ *Время получения:* ${escapeMarkdown(order.desired_time)}\n` +
    `📍 *Точка выдачи:* ${escapeMarkdown(order.pickup_point)}\n\n` +
    `*Позиции:*\n` +
    order.items.map(i => `• ${escapeMarkdown(i.item_name)} × ${i.quantity} = ${i.price * i.quantity} ₽`).join('\n') +
    `\n` +
    commentBlock +
    readyBlock +
    `\n💵 *Итого:* *${order.total_price} ₽*\n` +
    `Статус: ${statusEmoji} *${statusName}*`
  );
}

// 1. Принятие заказа «Как можно скорее» с выбором времени приготовления (15-20, 30, 45 мин)
staffComposer.callbackQuery(/^staff:accept(?:_time)?:(\d+)(?::(\d+))?$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const cookingMinutes = ctx.match[2] ? Number(ctx.match[2]) : 20;
  const order = getOrderById(orderId);

  if (!order) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  if (!isStaffMember(ctx.from.id, order.place_id)) {
    return ctx.answerCallbackQuery({
      text: '⛔ У вас нет прав для управления заказами этого заведения',
      show_alert: true,
    });
  }

  const staffName = ctx.from.first_name || 'Сотрудник';
  const readyDate = new Date(Date.now() + cookingMinutes * 60 * 1000);
  const readyTimeStr = formatMinskTime(readyDate);

  const success = atomicUpdateOrderStatus(
    orderId,
    ORDER_STATUSES.SENT,
    ORDER_STATUSES.ACCEPTED,
    ctx.from.id,
    { cooking_minutes: cookingMinutes, ready_at: readyTimeStr }
  );

  if (!success) {
    return ctx.answerCallbackQuery({
      text: 'Статус заказа уже был изменён другим сотрудником или клиентом',
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery({ text: `Принято! Готовность ~${readyTimeStr} (${cookingMinutes} мин)` });

  const updatedOrder = getOrderById(orderId);

  // Обновляем карточку заказа в группе заведения
  try {
    const cardText = formatGroupCardText(updatedOrder, staffName);
    await ctx.editMessageText(cardText, {
      parse_mode: 'Markdown',
      reply_markup: staffOrderKeyboard(updatedOrder),
    });
  } catch (err) {
    console.error(`[Error] Не удалось обновить карточку заказа ${order.order_code} в группе:`, err);
  }

  // Отправляем уведомление жильцу
  try {
    const queueNote = cookingMinutes > 20 ? ' (на кухне небольшая очередь)' : '';
    await ctx.api.sendMessage(
      order.user_id,
      `🔵 *Ваш заказ ${order.order_code} принят в работу!*\n\n` +
      `🏪 Заведение: «${order.place_name}»\n` +
      `⏱ *Время готовности:* *~${readyTimeStr}* (через ${cookingMinutes} мин${queueNote})\n` +
      `📍 Точка самовывоза: ${order.pickup_point}\n\n` +
      `Мы сразу пришлем уведомление, когда заказ будет готов к выдаче!`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error(`[Error] Не удалось отправить уведомление жильцу ${order.user_id}:`, err);
  }
});

// 2. Принятие отложенного заказа или заказа к точному времени жильца (ровно к назначенному часу)
staffComposer.callbackQuery(/^staff:accept_target:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const order = getOrderById(orderId);

  if (!order) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  if (!isStaffMember(ctx.from.id, order.place_id)) {
    return ctx.answerCallbackQuery({
      text: '⛔ У вас нет прав для управления заказами этого заведения',
      show_alert: true,
    });
  }

  const staffName = ctx.from.first_name || 'Сотрудник';
  const timeInfo = parseDesiredTime(order.desired_time, order.created_at);
  const targetTimeStr = timeInfo.targetTimeStr || formatMinskTime(new Date(Date.now() + 20 * 60 * 1000));

  const success = atomicUpdateOrderStatus(
    orderId,
    ORDER_STATUSES.SENT,
    ORDER_STATUSES.ACCEPTED,
    ctx.from.id,
    { ready_at: targetTimeStr }
  );

  if (!success) {
    return ctx.answerCallbackQuery({
      text: 'Статус заказа уже был изменён другим сотрудником или клиентом',
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery({ text: `Принято к ~${targetTimeStr}!` });

  const updatedOrder = getOrderById(orderId);

  // Обновляем карточку заказа в группе заведения
  try {
    const cardText = formatGroupCardText(updatedOrder, staffName);
    await ctx.editMessageText(cardText, {
      parse_mode: 'Markdown',
      reply_markup: staffOrderKeyboard(updatedOrder),
    });
  } catch (err) {
    console.error(`[Error] Не удалось обновить карточку заказа ${order.order_code} в группе:`, err);
  }

  // Отправляем уведомление жильцу
  try {
    await ctx.api.sendMessage(
      order.user_id,
      `🔵 *Ваш заказ ${order.order_code} принят в работу!*\n\n` +
      `🏪 Заведение: «${order.place_name}»\n` +
      `⏱ *Время готовности:* *к ~${targetTimeStr}*\n` +
      `📍 Точка самовывоза: ${order.pickup_point}\n\n` +
      `Кухня приготовит всё ровно к назначенному времени. Мы пришлем уведомление, когда заказ будет готов к выдаче!`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error(`[Error] Не удалось отправить уведомление жильцу ${order.user_id}:`, err);
  }
});

// 3. Принятие заказа с задержкой (например +15 мин при повышенной загрузке кухни)
staffComposer.callbackQuery(/^staff:accept_delay:(\d+):(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const delayMinutes = Number(ctx.match[2]) || 15;
  const order = getOrderById(orderId);

  if (!order) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  if (!isStaffMember(ctx.from.id, order.place_id)) {
    return ctx.answerCallbackQuery({
      text: '⛔ У вас нет прав для управления заказами этого заведения',
      show_alert: true,
    });
  }

  const staffName = ctx.from.first_name || 'Сотрудник';
  const timeInfo = parseDesiredTime(order.desired_time, order.created_at);

  let newTargetStr;
  if (timeInfo.targetTimeStr) {
    const [hh, mm] = timeInfo.targetTimeStr.split(':').map(Number);
    const totalMin = hh * 60 + mm + delayMinutes;
    const newH = Math.floor(totalMin / 60) % 24;
    const newM = totalMin % 60;
    newTargetStr = `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  } else {
    const readyDate = new Date(Date.now() + (20 + delayMinutes) * 60 * 1000);
    newTargetStr = formatMinskTime(readyDate);
  }

  const success = atomicUpdateOrderStatus(
    orderId,
    ORDER_STATUSES.SENT,
    ORDER_STATUSES.ACCEPTED,
    ctx.from.id,
    { ready_at: newTargetStr, cooking_minutes: 20 + delayMinutes }
  );

  if (!success) {
    return ctx.answerCallbackQuery({
      text: 'Статус заказа уже был изменён другим сотрудником или клиентом',
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery({ text: `Принято с задержкой: ~${newTargetStr} (+${delayMinutes} мин)` });

  const updatedOrder = getOrderById(orderId);

  // Обновляем карточку заказа в группе
  try {
    const cardText = formatGroupCardText(updatedOrder, staffName);
    await ctx.editMessageText(cardText, {
      parse_mode: 'Markdown',
      reply_markup: staffOrderKeyboard(updatedOrder),
    });
  } catch (err) {
    console.error(`[Error] Не удалось обновить карточку заказа ${order.order_code} в группе:`, err);
  }

  // Отправляем уведомление жильцу с кнопками подтверждения или отмены
  try {
    const delayKeyboard = new InlineKeyboard()
      .text('👌 Подожду', `order:delay_ack:${order.id}`)
      .text('❌ Долго ждать (отменить)', `order:client_cancel:${order.id}`);

    await ctx.api.sendMessage(
      order.user_id,
      `⚠️ *Внимание: задержка на кухне!*\n\n` +
      `Заведение «${order.place_name}» приняло ваш заказ ${order.order_code}, но из-за загрузки кухни время увеличено на *+${delayMinutes} мин*.\n\n` +
      `⏱ *Новое время готовности:* *~${newTargetStr}*\n` +
      `📍 Точка самовывоза: ${order.pickup_point}\n\n` +
      `Если вам подходит это время — нажмите «Подожду». Если не готовы ждать — можете сразу отменить заказ:`,
      {
        parse_mode: 'Markdown',
        reply_markup: delayKeyboard,
      }
    );
  } catch (err) {
    console.error(`[Error] Не удалось отправить уведомление жильцу ${order.user_id}:`, err);
  }
});

// Отметка «Готов к выдаче»: accepted -> ready
staffComposer.callbackQuery(/^staff:ready:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const order = getOrderById(orderId);

  if (!order) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  if (!isStaffMember(ctx.from.id, order.place_id)) {
    return ctx.answerCallbackQuery({
      text: '⛔ У вас нет прав для управления заказами этого заведения',
      show_alert: true,
    });
  }

  const staffName = ctx.from.first_name || 'Сотрудник';
  const success = atomicUpdateOrderStatus(orderId, ORDER_STATUSES.ACCEPTED, ORDER_STATUSES.READY, ctx.from.id);

  if (!success) {
    return ctx.answerCallbackQuery({
      text: 'Статус заказа уже был изменён',
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery({ text: `Заказ ${order.order_code} готов` });

  const updatedOrder = getOrderById(orderId);

  // Обновляем сообщение в группе
  try {
    await ctx.editMessageText(formatGroupCardText(updatedOrder, staffName), {
      parse_mode: 'Markdown',
      reply_markup: staffOrderKeyboard(updatedOrder),
    });
  } catch (err) {
    console.error(`[Error] Ошибка обновления сообщения в группе:`, err);
  }

  // Отправляем уведомление жильцу с точкой выдачи и кодом заказа
  try {
    await ctx.api.sendMessage(
      order.user_id,
      `🎉 *Ваш заказ ${order.order_code} готов!*\n\n` +
      `📍 *Точка выдачи:* ${order.pickup_point}\n` +
      `🔢 *Код выдачи:* *${order.order_code}*\n` +
      `💵 *Сумма к оплате:* ${order.total_price} ₽\n\n` +
      `Подойдите к точке выдачи и назовите код заказа сотруднику.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error(`[Error] Не удалось отправить уведомление о готовности жильцу ${order.user_id}:`, err);
  }
});

// Отметка «Заказ выдан»: ready -> issued
staffComposer.callbackQuery(/^staff:issued:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const order = getOrderById(orderId);

  if (!order) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  if (!isStaffMember(ctx.from.id, order.place_id)) {
    return ctx.answerCallbackQuery({
      text: '⛔ У вас нет прав для управления заказами этого заведения',
      show_alert: true,
    });
  }

  const staffName = ctx.from.first_name || 'Сотрудник';
  const success = atomicUpdateOrderStatus(orderId, ORDER_STATUSES.READY, ORDER_STATUSES.ISSUED, ctx.from.id);

  if (!success) {
    return ctx.answerCallbackQuery({
      text: 'Статус заказа уже был изменён',
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery({ text: `Заказ ${order.order_code} выдан` });

  const updatedOrder = getOrderById(orderId);

  // Обновляем сообщение в группе (кнопки убираются)
  try {
    await ctx.editMessageText(formatGroupCardText(updatedOrder, staffName), {
      parse_mode: 'Markdown',
      reply_markup: staffOrderKeyboard(updatedOrder),
    });
  } catch (err) {
    console.error(`[Error] Ошибка обновления сообщения в группе:`, err);
  }

  // Уведомление жильцу
  try {
    await ctx.api.sendMessage(
      order.user_id,
      `✅ *Заказ ${order.order_code} выдан.*\n\n` +
      `Спасибо, что пользуетесь нашим ботом! Приятного аппетита! 🍕`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error(`[Error] Не удалось отправить уведомление о выдаче жильцу ${order.user_id}:`, err);
  }
});

// Отмена/отклонение заказа персоналом заведения
staffComposer.callbackQuery(/^staff:cancel:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const order = getOrderById(orderId);

  if (!order) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  if (!isStaffMember(ctx.from.id, order.place_id)) {
    return ctx.answerCallbackQuery({
      text: '⛔ У вас нет прав для управления заказами этого заведения',
      show_alert: true,
    });
  }

  const staffName = ctx.from.first_name || 'Сотрудник';
  const success = cancelOrderByStaff(orderId, ctx.from.id);

  if (!success) {
    return ctx.answerCallbackQuery({
      text: 'Не удалось отменить заказ: возможно, он уже выдан или отменён',
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery({ text: `Заказ ${order.order_code} отклонён` });

  const updatedOrder = getOrderById(orderId);

  // Обновляем сообщение в группе
  try {
    await ctx.editMessageText(formatGroupCardText(updatedOrder, staffName), {
      parse_mode: 'Markdown',
      reply_markup: staffOrderKeyboard(updatedOrder),
    });
  } catch (err) {
    console.error(`[Error] Ошибка обновления сообщения в группе:`, err);
  }

  // Уведомление жильцу
  try {
    await ctx.api.sendMessage(
      order.user_id,
      `❌ *К сожалению, ваш заказ ${order.order_code} был отклонён заведением «${order.place_name}».*\n\n` +
      `Возможно, закончились ингредиенты или заведение перегружено. Приносим извинения!`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error(`[Error] Не удалось отправить уведомление об отмене жильцу ${order.user_id}:`, err);
  }
});
