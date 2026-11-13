import { InlineKeyboard } from 'grammy';
import { getDirectionStops, DIRECTION_TITLES } from '../services/transportService.js';

// Короткие коды направлений в callback_data (лимит Telegram — 64 байта)
export const DIR_CODES = { to_minsk: 'm', to_gavan: 'g' };
export const DIR_BY_CODE = { m: 'to_minsk', g: 'to_gavan' };

/**
 * Главное меню бота
 */
export function transportMenuKeyboard(cartTotalQuantity = 0) {
  const keyboard = new InlineKeyboard();

  // 1. Общественный транспорт (главный приоритет)
  keyboard.text('🚌 Общественный транспорт', 'transport:menu').row();

  // 2. Локальные сервисы и предзаказ (в один аккуратный ряд)
  keyboard
    .text('🍕 Пицца', 'catalog:place:kava_la_pechi')
    .text('☕️ Varka (Кофе)', 'catalog:place:varka')
    .row();

  if (cartTotalQuantity > 0) {
    keyboard.text(`🛒 Оформить заказ (${cartTotalQuantity} шт.)`, 'cart:view').row();
  }

  // 3. Поддержка и обратная связь
  keyboard.text('❤️ Поддержка проекта / Связь', 'support:menu');

  return keyboard;
}

/**
 * Шаг 1: направление. pins — закреплённые расписания пользователя для быстрого перехода к табло.
 */
export function directionKeyboard(pins = []) {
  const keyboard = new InlineKeyboard()
    .text(DIRECTION_TITLES.to_minsk.title, 'tr:d:m').row()
    .text(DIRECTION_TITLES.to_gavan.title, 'tr:d:g').row();

  for (const pin of pins) {
    keyboard.text(`📌 ${pin.label}`, `tr:b:${DIR_CODES[pin.direction_id]}:${pin.stop_id}:a:r`).row();
  }

  keyboard.text('◀️ В главное меню', 'menu:main');
  return keyboard;
}

/**
 * Шаг 2: остановка посадки (все маршруты направления)
 */
export function stopsKeyboard(directionId) {
  const keyboard = new InlineKeyboard();
  const code = DIR_CODES[directionId];

  for (const stop of getDirectionStops(directionId)) {
    const routes = stop.routes.map((r) => r.number).join(', ');
    keyboard.text(`🚏 ${stop.name} · ${routes}`, `tr:b:${code}:${stop.id}:a:r`).row();
  }

  keyboard.text('◀️ Назад к направлениям', 'transport:menu');
  return keyboard;
}

/**
 * Табло остановки.
 * day: a (сегодня) | wd (будни) | we (выходные); mode: r (оставшиеся рейсы) | f (весь день)
 * pinnedRouteIds — маршруты этой остановки, уже закреплённые пользователем
 */
export function boardKeyboard({ directionId, stopId, day, mode, routes, pinnedRouteIds, showingToday, isWeekendView }) {
  const keyboard = new InlineKeyboard();
  const code = DIR_CODES[directionId];
  const base = `tr:b:${code}:${stopId}`;

  // 1. Обновить и режим показа
  keyboard.text('🔄 Обновить', `${base}:${day}:${mode}`);
  if (showingToday) {
    keyboard.text(mode === 'r' ? '📋 Весь день' : '⏩ Только оставшиеся', `${base}:${day}:${mode === 'r' ? 'f' : 'r'}`);
  }
  keyboard.row();

  // 2. Будни / выходные
  if (showingToday) {
    keyboard.text(isWeekendView ? '📅 Расписание на будни' : '📅 Расписание на выходные', `${base}:${isWeekendView ? 'wd' : 'we'}:f`);
  } else {
    keyboard.text('⏱ Сегодня', `${base}:a:r`);
    keyboard.text(isWeekendView ? '📅 Будни' : '📅 Выходные', `${base}:${isWeekendView ? 'wd' : 'we'}:f`);
  }
  keyboard.row();

  // 3. Закрепить расписание каждого маршрута отдельно
  for (const route of routes) {
    const pinned = pinnedRouteIds.includes(route.id);
    keyboard
      .text(
        pinned ? `📍 Открепить ${route.number}` : `📌 Закрепить ${route.number}`,
        `tr:pin:${route.id}:${code}:${stopId}:${day}:${mode}`
      )
      .row();
  }

  // 4. Навигация
  const opposite = directionId === 'to_minsk' ? 'g' : 'm';
  keyboard
    .text('🚏 Другая остановка', `tr:d:${code}`)
    .text(directionId === 'to_minsk' ? '🔁 В Гавань' : '🔁 В Минск', `tr:d:${opposite}`)
    .row()
    .text('◀️ В главное меню', 'menu:main');

  return keyboard;
}

/**
 * Клавиатура закреплённого сообщения
 */
export function pinnedScheduleKeyboard(directionId, stopId) {
  return new InlineKeyboard()
    .text('🚏 Табло остановки', `tr:b:${DIR_CODES[directionId]}:${stopId}:a:r`)
    .text('📍 Открепить', 'transport:unpin_direct');
}
