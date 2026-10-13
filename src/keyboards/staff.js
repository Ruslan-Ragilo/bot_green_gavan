import { InlineKeyboard } from 'grammy';

/**
 * Клавиатура управления заказом для сотрудников в Telegram-группе заведения.
 * Доступные кнопки строго соответствуют жизненному циклу статусов:
 * sent -> accepted -> ready -> issued (а также cancelled/expired).
 */
export function staffOrderKeyboard(order) {
  const keyboard = new InlineKeyboard();

  if (order.status === 'sent') {
    keyboard
      .text('✅ Принять в работу', `staff:accept:${order.id}`)
      .text('❌ Отклонить', `staff:cancel:${order.id}`);
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
