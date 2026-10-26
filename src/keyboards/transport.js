import { InlineKeyboard } from 'grammy';

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
    .text('🏙 В Минск (из Зелёной Гавани)', `transport:view:${routeId}:to_minsk:auto`).row()
    .text('🏡 В Зелёную Гавань (из Минска)', `transport:view:${routeId}:to_gavan:auto`).row()
    .text('◀️ Назад ко всем маршрутам', 'transport:menu');
}

/**
 * Клавиатура подробного расписания конкретного маршрута
 */
export function routeScheduleKeyboard(routeId, direction, currentDayType, yandexMapsUrl = null) {
  const keyboard = new InlineKeyboard();

  // Переключение Будни / Выходные
  if (currentDayType === 'weekdays') {
    keyboard.text('📅 Показать расписание на ВЫХОДНЫЕ', `transport:view:${routeId}:${direction}:weekends`).row();
  } else {
    keyboard.text('📅 Показать расписание на БУДНИ', `transport:view:${routeId}:${direction}:weekdays`).row();
  }

  // Переключение направления
  const oppositeDir = direction === 'to_minsk' ? 'to_gavan' : 'to_minsk';
  const oppositeLabel = direction === 'to_minsk' ? '🔄 В Зелёную Гавань (обратно)' : '🔄 В Минск (обратно)';
  keyboard.text(oppositeLabel, `transport:view:${routeId}:${oppositeDir}:${currentDayType}`).row();

  // Ссылка на онлайн-карту движения в Яндекс Картах
  if (yandexMapsUrl) {
    keyboard.url('📍 Открыть Яндекс Карты (онлайн GPS)', yandexMapsUrl).row();
  }

  // Навигация
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
