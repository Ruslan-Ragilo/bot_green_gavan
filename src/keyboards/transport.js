import { InlineKeyboard } from 'grammy';
import { getRouteStops } from '../services/transportService.js';

/**
 * Шаг 1: Выбор транспорта
 */
export function transportMenuKeyboard() {
  return new InlineKeyboard()
    .text('🚌 Автобус 200С', 'transport:route:200c').row()
    .text('🚌 Автобус 200дС (через Колодищи-2)', 'transport:route:200dc').row()
    .text('🚐 Маршрутка 1222-ТК', 'transport:route:1222tk').row()
    .text('☕️ Поддержать проект / Связь', 'support:menu');
}

/**
 * Шаг 2: Выбор направления
 */
export function routeDirectionKeyboard(routeId) {
  return new InlineKeyboard()
    .text('🏙 В Минск', `transport:dir:${routeId}:to_minsk`).row()
    .text('🏡 В Зелёную Гавань', `transport:dir:${routeId}:to_gavan`).row()
    .text('◀️ Назад к выбору транспорта', 'transport:menu');
}

/**
 * Шаг 3: Выбор остановки
 */
export function stopsSelectionKeyboard(routeId, directionId, currentStopId = null, dayType = 'auto') {
  const keyboard = new InlineKeyboard();
  const stops = getRouteStops(routeId, directionId);

  // Для компактности отображаем кнопки остановок
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const isSelected = s.id === currentStopId;
    const prefix = isSelected ? '✅ ' : '🚏 ';
    const label = `${prefix}${i + 1}. ${s.name}`;

    keyboard.text(label, `transport:view:${routeId}:${directionId}:${s.id}:${dayType}`).row();
  }

  keyboard.text('◀️ Назад к выбору направления', `transport:route:${routeId}`);
  return keyboard;
}

/**
 * Экран расписания для выбранной остановки
 */
export function scheduleKeyboard(routeId, directionId, stopId, currentDayType, isPinned = false) {
  const keyboard = new InlineKeyboard();

  // 1. Переключение Будни / Выходные
  if (currentDayType === 'weekdays') {
    keyboard.text('📅 Расписание на ВЫХОДНЫЕ', `transport:view:${routeId}:${directionId}:${stopId}:weekends`).row();
  } else {
    keyboard.text('📅 Расписание на БУДНИ', `transport:view:${routeId}:${directionId}:${stopId}:weekdays`).row();
  }

  // 2. Смена остановки
  keyboard.text('🚏 Сменить остановку', `transport:dir:${routeId}:${directionId}:${currentDayType}`).row();

  // 3. Смена направления
  const oppositeDir = directionId === 'to_minsk' ? 'to_gavan' : 'to_minsk';
  const oppositeLabel = directionId === 'to_minsk' ? '🔄 В обратную сторону (в Гавань)' : '🔄 В обратную сторону (в Минск)';
  keyboard.text(oppositeLabel, `transport:dir:${routeId}:${oppositeDir}`).row();

  // 4. Закрепление расписания в шапке чата
  if (isPinned) {
    keyboard.text('📍 Открепить из шапки чата', `transport:unpin:${routeId}:${directionId}:${stopId}:${currentDayType}`).row();
  } else {
    keyboard.text('📌 Закрепить в шапке чата', `transport:pin:${routeId}:${directionId}:${stopId}:${currentDayType}`).row();
  }

  // 5. Навигация
  keyboard.text('🚌 К выбору транспорта', 'transport:menu');

  return keyboard;
}

/**
 * Клавиатура для самого закреплённого сообщения вверху чата
 */
export function pinnedScheduleKeyboard() {
  return new InlineKeyboard()
    .text('📍 Открепить расписание', 'transport:unpin_direct')
    .text('🚌 Меню транспорта', 'transport:menu');
}

