import { config } from '../../config.js';
import { getExpiredSentOrders, atomicUpdateOrderStatus, ORDER_STATUSES } from '../db/repositories/orders.js';

let intervalId = null;

/**
 * Проверка и перевод неподтверждённых заказов из 'sent' в 'expired'.
 * Запускается раз в минуту по таймеру через setInterval.
 */
export async function checkExpiredOrders(bot) {
  try {
    const expiredOrders = getExpiredSentOrders(config.orderExpiryMinutes);

    for (const order of expiredOrders) {
      // Атомарно переводим статус из 'sent' в 'expired'
      const updated = atomicUpdateOrderStatus(
        order.id,
        ORDER_STATUSES.SENT,
        ORDER_STATUSES.EXPIRED,
        null // системный процесс
      );

      if (!updated) {
        // Статус уже успели изменить (например, сотрудник принял заказ прямо сейчас)
        continue;
      }

      console.log(`[Job] Заказ ${order.order_code} (id: ${order.id}) переведён в статус 'expired' по таймауту.`);

      // 1. Обновляем сообщение в группе заведения, если оно было отправлено
      if (order.group_chat_id && order.group_message_id) {
        try {
          await bot.api.editMessageText(
            order.group_chat_id,
            order.group_message_id,
            `⚪ *ЗАКАЗ ${order.order_code} ПРОСРОЧЕН*\n\n` +
            `Заказ не был принят сотрудниками в течение ${config.orderExpiryMinutes} минут и автоматически отменён.`,
            { parse_mode: 'Markdown' }
          );
        } catch (err) {
          console.error(`[Job Error] Не удалось обновить карточку просроченного заказа ${order.order_code} в группе:`, err);
        }
      }

      // 2. Уведомляем жильца об истечении времени ожидания
      try {
        await bot.api.sendMessage(
          order.user_id,
          `⚪ *Ваш заказ ${order.order_code} был отменён.*\n\n` +
          `К сожалению, заведение «${order.place_name}» не успело принять его в течение ${config.orderExpiryMinutes} минут. ` +
          `Пожалуйста, попробуйте оформить заказ позже или выберите другое заведение.`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        console.error(`[Job Error] Не удалось уведомить жильца ${order.user_id} о просрочке заказа:`, err);
      }
    }
  } catch (error) {
    console.error('[Job Error] Ошибка при проверке просроченных заказов:', error);
  }
}

export function startExpiredOrdersJob(bot) {
  if (intervalId) return;

  // Первый запуск сразу после старта бота
  checkExpiredOrders(bot);

  // Периодический запуск раз в минуту
  intervalId = setInterval(() => {
    checkExpiredOrders(bot);
  }, config.expiryCheckIntervalMs);

  console.log(`[Job] Фоновая проверка просроченных заказов запущена (интервал: ${config.expiryCheckIntervalMs / 1000} сек, таймаут: ${config.orderExpiryMinutes} мин).`);
}

/**
 * Остановка таймера при завершении работы приложения
 */
export function stopExpiredOrdersJob() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Job] Фоновая проверка просроченных заказов остановлена.');
  }
}
