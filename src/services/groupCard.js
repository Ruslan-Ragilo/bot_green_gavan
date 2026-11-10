/**
 * Карточка заказа в группе кухни: текст и обновление по group_message_id.
 * Обновляем именно карточку (а не сообщение, где нажали кнопку) — кнопки бывают и в напоминаниях.
 */
import { staffOrderKeyboard } from '../keyboards/staff.js';
import { escapeMarkdown, formatPrice } from '../utils/text.js';
import { getOrderTimeInfo } from '../utils/time.js';

const STATUS_VIEW = {
  sent: { emoji: '🟡', name: () => 'Отправлен (ожидает принятия)' },
  accepted: { emoji: '🔵', name: (s) => `Принят в работу (${s})` },
  ready: { emoji: '🟢', name: (s) => `Готов к выдаче (${s})` },
  issued: { emoji: '✅', name: (s) => `Выдан (${s})` },
  cancelled: { emoji: '❌', name: (s) => `Отменён (${s})` },
  expired: { emoji: '⚪', name: () => 'Просрочен (не принят вовремя)' },
  no_show: { emoji: '🙅', name: (s) => `Не забрали (${s})` },
};

export function formatGroupCardText(order, staffName) {
  const view = STATUS_VIEW[order.status] || { emoji: '•', name: () => order.status };
  // Имя стоит внутри *жирного* — экранирование там не работает, поэтому просто убираем спецсимволы
  const who = String(staffName || 'сотрудник').replace(/[_*`\[\]]/g, '');

  const clientName = escapeMarkdown(order.first_name || 'Жилец');
  const clientUsername = order.username ? `(@${escapeMarkdown(order.username)})` : '';
  const commentBlock = order.comment ? `\n💬 *Пожелание клиента:* ${escapeMarkdown(order.comment)}\n` : '';
  const readyBlock = (order.ready_at && ['accepted', 'ready'].includes(order.status))
    ? `\n⏱ *Ориентир готовности:* ~${order.ready_at}`
    : '';

  const timeInfo = getOrderTimeInfo(order);
  const timeLine = timeInfo.isAsap
    ? escapeMarkdown(order.desired_time)
    : `${escapeMarkdown(order.desired_time)}${order.desired_time.includes(timeInfo.targetTimeStr) ? '' : ` → к ${timeInfo.targetTimeStr}`}`;

  return (
    `📦 *ЗАКАЗ ${order.order_code}*\n\n` +
    `👤 *Клиент:* ${clientName} ${clientUsername}\n` +
    `⏱ *Время получения:* ${timeLine}\n` +
    `📍 *Точка выдачи:* ${escapeMarkdown(order.pickup_point)}\n\n` +
    `*Позиции:*\n` +
    order.items.map(i => `• ${escapeMarkdown(i.item_name)} × ${i.quantity} = ${formatPrice(i.price * i.quantity)}`).join('\n') +
    `\n` +
    commentBlock +
    readyBlock +
    `\n💵 *Итого:* *${formatPrice(order.total_price)}*\n` +
    `Статус: ${view.emoji} *${view.name(who)}*`
  );
}

/**
 * Обновить карточку заказа. ctx — контекст нажатия (если есть): если кнопку нажали не на самой карточке
 * (например, в напоминании), карточку правим по group_message_id, а у напоминания убираем кнопки.
 */
export async function refreshGroupCard({ api, ctx = null, order, staffName = null }) {
  const text = formatGroupCardText(order, staffName);
  const options = { parse_mode: 'Markdown', reply_markup: staffOrderKeyboard(order) };
  const clicked = ctx?.callbackQuery?.message;
  const clickedIsCard = clicked
    && clicked.message_id === order.group_message_id
    && clicked.chat?.id === order.group_chat_id;

  try {
    if (order.group_chat_id && order.group_message_id && !clickedIsCard) {
      await api.editMessageText(order.group_chat_id, order.group_message_id, text, options);
      if (clicked) {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      }
    } else if (clicked) {
      // Карточка, на которой нажали кнопку (в т.ч. резервная карточка у администратора)
      await ctx.editMessageText(text, options);
    }
  } catch (err) {
    console.error(`[Error] Не удалось обновить карточку заказа ${order.order_code}:`, err);
  }
}
