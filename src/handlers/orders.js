import { Composer, InlineKeyboard } from 'grammy';
import { getUserOrders, getOrderById, cancelOrderByClient } from '../db/repositories/orders.js';
import { clientOrderKeyboard } from '../keyboards/client.js';

export const ordersComposer = new Composer();

// Словарь статусов на русском с эмодзи
export const STATUS_LABELS = {
  sent: '🟡 Ожидает подтверждения',
  accepted: '🔵 Принят в работу',
  ready: '🟢 Готов к выдаче',
  issued: '✅ Выдан',
  cancelled: '❌ Отменён',
  expired: '⚪ Просрочен',
};

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
  text += `🏪 *Заведение:* ${order.place_name}\n`;
  text += `📍 *Точка самовывоза:* ${order.pickup_point}\n`;
  text += `⏱ *Желаемое время:* ${order.desired_time}\n`;
  text += `📊 *Статус:* ${statusLabel}\n\n`;
  text += `*Состав:*\n`;

  for (const item of order.items) {
    text += `• ${item.item_name} × ${item.quantity} = ${item.price * item.quantity} ₽\n`;
  }

  text += `\n💵 *Итого:* *${order.total_price} ₽* (оплата на месте)\n`;

  if (order.status === 'ready') {
    text += `\n🎉 *Заказ готов!* Подойдите к точке выдачи и назовите код *${order.order_code}*.`;
  }

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: clientOrderKeyboard(order),
  });
});

// Отмена заказа жильцом (допустима строго в статусе 'sent')
ordersComposer.callbackQuery(/^order:client_cancel:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const order = getOrderById(orderId);

  if (!order || order.user_id !== ctx.from.id) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  // Атомарно пытаемся перевести заказ из 'sent' в 'cancelled'
  const isCancelled = cancelOrderByClient(orderId, ctx.from.id);

  if (!isCancelled) {
    return ctx.answerCallbackQuery({
      text: 'Невозможно отменить: заведение уже приняло заказ в работу!',
      show_alert: true,
    });
  }

  await ctx.answerCallbackQuery({ text: `Заказ ${order.order_code} отменён` });

  // Если в группе заведения есть сообщение с заказом, обновляем его
  if (order.group_chat_id && order.group_message_id) {
    try {
      await ctx.api.editMessageText(
        order.group_chat_id,
        order.group_message_id,
        `❌ *ЗАКАЗ ${order.order_code} ОТМЕНЁН КЛИЕНТОМ*\n\n` +
        `👤 Клиент: ${order.first_name || 'Жилец'}\n` +
        `Сумма: ${order.total_price} ₽`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error(`[Error] Не удалось обновить отмену заказа ${order.order_code} в группе:`, err);
    }
  }

  const updatedOrder = getOrderById(orderId);
  await ctx.editMessageText(
    `❌ *Заказ ${order.order_code} успешно отменён.*\n\n` +
    `Сумма заказа: ${order.total_price} ₽.\n` +
    `Вы можете оформить новый предзаказ в любое удобное время.`,
    {
      parse_mode: 'Markdown',
      reply_markup: clientOrderKeyboard(updatedOrder),
    }
  );
});
