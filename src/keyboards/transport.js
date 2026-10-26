import { InlineKeyboard } from 'grammy';
import { getRouteStops, getDefaultStop } from '../services/transportService.js';

/**
 * Главное меню раздела транспорта
 */
export function transportMenuKeyboard() {
  return new InlineKeyboard()
    .text('⚡ Ближайшие рейсы прямо сейчас', 'transport:next').row()
    .text('🚌 Автобус 200С (ст. м. Уручье)', 'transport:route:200c').row()
    .text('🚌 Автобус 200дС (Колодищи-2 / Уручье)', 'transport:route:200dc').row()
    .text('🚐 Маршрутка 1222-ТК (Восток / Могилёвская)', 'transport:route:1222tk').row()
    .text('◀️ В главное меню', 'menu:main');
}

/**
 * Клавиатура выбора направления движения для маршрута
 */
export function routeDirectionKeyboard(routeId) {
  return new InlineKeyboard()
    .text('🏙 В Минск (из Зелёной Гавани)', `transport:view:${routeId}:to_minsk:default:auto`).row()
    .text('🏡 В Зелёную Гавань (из Минска)', `transport:view:${routeId}:to_gavan:default:auto`).row()
    .text('◀️ Назад ко всем маршрутам', 'transport:menu');
}

/**
 * Клавиатура выбора конкретной остановки посадки
 */
export function stopsSelectionKeyboard(routeId, directionId, currentStopId, dayType) {
  const keyboard = new InlineKeyboard();
  const stops = getRouteStops(routeId, directionId);

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const isSelected = s.id === currentStopId;
    const prefix = isSelected ? '✅ ' : '🚏 ';
    const label = `${prefix}${i + 1}. ${s.name}`;

    keyboard.text(label, `transport:view:${routeId}:${directionId}:${s.id}:${dayType}`).row();
  }

  keyboard.text('◀️ Назад к расписанию', `transport:view:${routeId}:${directionId}:${currentStopId}:${dayType}`);
  return keyboard;
}

/**
 * Клавиатура подробного расписания конкретного маршрута для выбранной остановки
 */
export function routeScheduleKeyboard(routeId, directionId, currentDayType, currentStopId, yandexMapsUrl = null) {
  const keyboard = new InlineKeyboard();

  // 1. Кнопка смены остановки
  keyboard.text('🚏 Выбрать другую остановку', `transport:stops:${routeId}:${directionId}:${currentStopId}:${currentDayType}`).row();

  // 2. Переключение Будни / Выходные
  if (currentDayType === 'weekdays') {
    keyboard.text('📅 Показать расписание на ВЫХОДНЫЕ', `transport:view:${routeId}:${directionId}:${currentStopId}:weekends`).row();
  } else {
    keyboard.text('📅 Показать расписание на БУДНИ', `transport:view:${routeId}:${directionId}:${currentStopId}:weekdays`).row();
  }

  // 3. Переключение направления (с остановкой по умолчанию)
  const oppositeDir = directionId === 'to_minsk' ? 'to_gavan' : 'to_minsk';
  const oppositeLabel = directionId === 'to_minsk' ? '🔄 В Зелёную Гавань (обратно)' : '🔄 В Минск (обратно)';
  keyboard.text(oppositeLabel, `transport:view:${routeId}:${oppositeDir}:default:${currentDayType}`).row();

  // 4. Ссылка на онлайн-карту движения в Яндекс Картах
  if (yandexMapsUrl) {
    keyboard.url('📍 Открыть Яндекс Карты (онлайн GPS)', yandexMapsUrl).row();
  }

  // 5. Навигация
  keyboard
    .text('◀️ Маршруты', 'transport:menu')
    .text('🏠 Меню', 'menu:main');

  return keyboard;
}

/**
 * Клавиатура экрана "Ближайшие рейсы"
 */
export function nextDeparturesKeyboard() {
  return new InlineKeyboard()
    .text('🔄 Обновить время', 'transport:next').row()
    .text('🚌 200С', 'transport:route:200c')
    .text('🚌 200дС', 'transport:route:200dc')
    .text('🚐 1222-ТК', 'transport:route:1222tk').row()
    .text('◀️ Все маршруты', 'transport:menu')
    .text('🏠 В главное меню', 'menu:main');
}
