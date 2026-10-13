import { Composer } from 'grammy';
import { getOrderById, atomicUpdateOrderStatus, cancelOrderByStaff, ORDER_STATUSES } from '../db/repositories/orders.js';
import { isStaffMember } from '../db/repositories/staff.js';
import { staffOrderKeyboard } from '../keyboards/staff.js';

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

  return (
    `📦 *ЗАКАЗ ${order.order_code}*\n\n` +
    `👤 *Клиент:* ${order.first_name || 'Жилец'} ${order.username ? `(@${order.username})` : ''}\n` +
    `⏱ *Время получения:* ${order.desired_time}\n` +
    `📍 *Точка выдачи:* ${order.pickup_point}\n\n` +
    `*Позиции:*\n` +
    order.items.map(i => `• ${i.item_name} × ${i.quantity} = ${i.price * i.quantity} ₽`).join('\n') +
    `\n\n💵 *Итого:* *${order.total_price} ₽*\n` +
    `Статус: ${statusEmoji} *${statusName}*`
  );
}

// Принятие заказа в работу: sent -> accepted
staffComposer.callbackQuery(/^staff:accept:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const order = getOrderById(orderId);

  if (!order) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  // Проверка прав сотрудника в таблице place_staff
  if (!isStaffMember(ctx.from.id, order.place_id)) {
    return ctx.answerCallbackQuery({
      text: '⛔ У вас нет прав для управления заказами этого заведения',
      show_alert: true,
    });
  }

  const staffName = ctx.from.first_name || 'Сотрудник';
  // Атомарный UPDATE ... WHERE id = ? AND status = 'sent'
  const success = atomicUpdateOrderStatus(orderId, ORDER_STATUSES.SENT, ORDER_STATUSES.ACCEPTED, ctx.from.id);

  if (!success) {
    return ctx.answerCallbackQuery({
      text: 'Статус заказа уже был изменён другим сотрудником или клиентом',
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery({ text: `Заказ ${order.order_code} принят` });

  const updatedOrder = getOrderById(orderId);

  // Обновляем сообщение в группе заведения
  try {
    await ctx.editMessageText(formatGroupCardText(updatedOrder, staffName), {
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
      `🔵 *Ваш заказ ${order.order_code} принят заведением «${order.place_name}»!*\n\n` +
      `⏱ Время готовности: ${order.desired_time}\n` +
      `📍 Точка самовывоза: ${order.pickup_point}\n\n` +
      `Мы сообщим, как только блюда будут готовы.`,
      { parse_mode: 'Markdown' }
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
      `Спасибо, что пользуетесь предзаказом в ЖК «Зелёная Гавань»! Приятного аппетита!`,
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
