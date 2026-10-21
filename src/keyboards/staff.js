import { InlineKeyboard } from 'grammy';
import { parseDesiredTime } from '../utils/time.js';

/**
 * Клавиатура управления заказом для сотрудников в Telegram-группе заведения.
 * Синхронизирована с выбором времени жильца (как можно скорее / отложенный заказ / точное время).
 */
export function staffOrderKeyboard(order) {
  const keyboard = new InlineKeyboard();

  if (order.status === 'sent') {
    const timeInfo = parseDesiredTime(order.desired_time, order.created_at);

    if (timeInfo.isAsap) {
      // Заказ «Как можно скорее»
      keyboard
        .text('⚡ 15–20 мин', `staff:accept_time:${order.id}:20`)
        .text('⏱ 30 мин', `staff:accept_time:${order.id}:30`)
        .text('🔥 45 мин', `staff:accept_time:${order.id}:45`)
        .row()
        .text('❌ Отклонить (Запара)', `staff:cancel:${order.id}`);
    } else {
      // Заказ ко времени (отложенный слот или точное время жильца, например «К 18:30»)
      keyboard
        .text(`✅ Принять к ${timeInfo.targetTimeStr}`, `staff:accept_target:${order.id}`)
        .row()
        .text('🔥 Задержка (+15 мин)', `staff:accept_delay:${order.id}:15`)
        .text('❌ Отклонить', `staff:cancel:${order.id}`);
    }
  } else if (order.status === 'accepted') {
    keyboard
      .text('🔔 Готов к выдаче', `staff:ready:${order.id}`)
      .text('❌ Отменить', `staff:cancel:${order.id}`);
  } else if (order.status === 'ready') {
    keyboard
      .text('📦 Заказ выдан', `staff:issued:${order.id}`);
  }

  // Для финальных статусов (issued, cancelled, expired) кнопок нет
  return keyboard;
}
