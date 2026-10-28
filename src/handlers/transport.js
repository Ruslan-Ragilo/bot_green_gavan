import { Composer } from 'grammy';
import {
  getTransportSchedule,
  getMinskTime,
  findNextDepartures,
  getStopSchedule,
} from '../services/transportService.js';
import {
  transportMenuKeyboard,
  routeDirectionKeyboard,
  stopsSelectionKeyboard,
  scheduleKeyboard,
  pinnedScheduleKeyboard,
} from '../keyboards/transport.js';
import { renderScreen } from '../utils/cleanChat.js';
import { getUserPin, setUserPin, deleteUserPin } from '../db/repositories/users.js';

export const transportComposer = new Composer();

const MENU_TEXT = '🚌 *Выберите транспорт:*';

// Шаг 1: Выбор транспорта (команда /transport, /bus или возврат в меню)
transportComposer.command(['transport', 'bus', 'buses', 'raspisanie'], async (ctx) => {
  await renderScreen(ctx, MENU_TEXT, {
    parse_mode: 'Markdown',
    reply_markup: transportMenuKeyboard(),
  });
});

transportComposer.callbackQuery('transport:menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderScreen(ctx, MENU_TEXT, {
    parse_mode: 'Markdown',
    reply_markup: transportMenuKeyboard(),
  });
});

// Шаг 2: Выбор направления движения
transportComposer.callbackQuery(/^transport:route:([a-z0-9]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const routeId = ctx.match[1];
  const schedule = getTransportSchedule();
  const route = schedule.routes[routeId];

  if (!route) {
    return renderScreen(ctx, '⚠️ Маршрут не найден.', { reply_markup: transportMenuKeyboard() });
  }

  const text = (
    `${route.badge} *${route.title}*\n` +
    `Выберите направление движения:`
  );

  await renderScreen(ctx, text, {
    parse_mode: 'Markdown',
    reply_markup: routeDirectionKeyboard(routeId),
  });
});

// Шаг 3: Выбор остановки посадки
transportComposer.callbackQuery(/^transport:dir:([a-z0-9]+):(to_minsk|to_gavan)(?::(weekdays|weekends|auto))?$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const routeId = ctx.match[1];
  const directionId = ctx.match[2];
  const dayType = ctx.match[3] || 'auto';

  const schedule = getTransportSchedule();
  const route = schedule.routes[routeId];
  const dir = route?.directions?.[directionId];

  if (!route || !dir) {
    return renderScreen(ctx, '⚠️ Направление не найдено.', { reply_markup: transportMenuKeyboard() });
  }

  const text = (
    `${route.badge} *${route.number}* → *${dir.title}*\n` +
    `Выберите вашу остановку посадки:`
  );

  await renderScreen(ctx, text, {
    parse_mode: 'Markdown',
    reply_markup: stopsSelectionKeyboard(routeId, directionId, null, dayType),
  });
});

// Итоговый экран: Расписание для конкретной выбранной остановки
transportComposer.callbackQuery(/^transport:view:([a-z0-9]+):(to_minsk|to_gavan):([a-z0-9_]+):(auto|weekdays|weekends)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const routeId = ctx.match[1];
  const directionId = ctx.match[2];
  const stopId = ctx.match[3];
  let dayType = ctx.match[4];

  const minsk = getMinskTime();
  if (dayType === 'auto') {
    dayType = minsk.isWeekend ? 'weekends' : 'weekdays';
  }

  const schedule = getTransportSchedule();
  const route = schedule.routes[routeId];
  if (!route) {
    return renderScreen(ctx, '⚠️ Маршрут не найден.', { reply_markup: transportMenuKeyboard() });
  }

  const direction = route.directions[directionId];
  if (!direction) {
    return renderScreen(ctx, '⚠️ Направление не найдено.', { reply_markup: transportMenuKeyboard() });
  }

  const { stop, times } = getStopSchedule(routeId, directionId, stopId, dayType);
  const stopName = stop ? stop.name : direction.fromStation;

  const isViewingToday = (dayType === 'weekends' && minsk.isWeekend) || (dayType === 'weekdays' && !minsk.isWeekend);
  const nextDepartures = isViewingToday ? findNextDepartures(times, minsk.totalMinutes, 3) : [];

  const dayTitle = dayType === 'weekdays' ? '📅 Расписание на БУДНИЕ дни' : '📅 Расписание на ВЫХОДНЫЕ дни';

  // Форматирование сетки времени (по 4 в строке)
  let scheduleText = '';
  if (times.length > 0) {
    const rows = [];
    for (let i = 0; i < times.length; i += 4) {
      const chunk = times.slice(i, i + 4).map((t) => `\`${t}\``).join('  ');
      rows.push(chunk);
    }
    scheduleText = rows.join('\n');
  } else {
    scheduleText = '_В этот день рейсов по данному маршруту нет._';
  }

  // Блок ближайших рейсов
  let nextBlock = '';
  if (isViewingToday) {
    if (nextDepartures.length > 0) {
      const list = nextDepartures.map((d) => `• *${d.time}* (${d.label})`).join('\n');
      nextBlock = `⚡ *Ближайшие отправления:*\n${list}\n\n`;
    } else if (times.length > 0) {
      nextBlock = `⚡ *Ближайшие отправления:* рейсов на сегодня больше нет\n\n`;
    }
  }

  const userPin = getUserPin(ctx.from?.id);
  const targetStopId = stop?.id || stopId;
  const isPinned = Boolean(
    userPin &&
    userPin.route_id === routeId &&
    userPin.direction_id === directionId &&
    userPin.stop_id === targetStopId
  );

  const text = (
    `${route.badge} *${route.number}* → *${direction.title}*\n` +
    `🚏 Остановка: *${stopName}*\n\n` +
    nextBlock +
    `*${dayTitle}:*\n` +
    `${scheduleText}\n\n` +
    `💳 *Проезд:* ${route.fare}`
  );

  await renderScreen(ctx, text, {
    parse_mode: 'Markdown',
    reply_markup: scheduleKeyboard(routeId, directionId, targetStopId, dayType, isPinned),
  });
});

// Форматирование карточки для закрепления вверху чата
function formatPinnedScheduleCard(route, direction, stopName, stopSchedule) {
  const formatRows = (arr) => {
    if (!arr || arr.length === 0) return '_Рейсов нет_';
    const rows = [];
    for (let i = 0; i < arr.length; i += 4) {
      rows.push(arr.slice(i, i + 4).map((t) => `\`${t}\``).join('  '));
    }
    return rows.join('\n');
  };

  const weekdaysText = formatRows(stopSchedule.weekdays);
  const weekendsText = formatRows(stopSchedule.weekends);

  return (
    `📌 *Избранное расписание: ${route.badge} ${route.number}*\n` +
    `🚏 *Остановка:* ${stopName}\n` +
    `🏙 *Направление:* ${direction.title}\n\n` +
    `📅 *Будние дни:*\n` +
    `${weekdaysText}\n\n` +
    `🎉 *Выходные дни:*\n` +
    `${weekendsText}\n\n` +
    `💳 *Проезд:* ${route.fare}\n` +
    `_Закреплено вверху чата. Нажмите /transport, чтобы открыть меню._`
  );
}

// 1. Закрепление расписания в шапке чата
transportComposer.callbackQuery(/^transport:pin:([a-z0-9]+):(to_minsk|to_gavan):([a-z0-9_]+):(weekdays|weekends|auto)$/, async (ctx) => {
  const routeId = ctx.match[1];
  const directionId = ctx.match[2];
  const stopId = ctx.match[3];
  const dayType = ctx.match[4];
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) return;

  const schedule = getTransportSchedule();
  const route = schedule.routes[routeId];
  const direction = route?.directions?.[directionId];
  if (!route || !direction) {
    return ctx.answerCallbackQuery({ text: 'Ошибка: маршрут не найден' });
  }

  const stopSchedule = getStopSchedule(routeId, directionId, stopId);
  const stopName = stopSchedule.stop?.name || 'Остановка';

  // 1. Открепляем и удаляем предыдущее закрепленное сообщение, если было
  const existingPin = getUserPin(userId);
  if (existingPin) {
    await ctx.api.unpinChatMessage(chatId, existingPin.message_id).catch(() => {});
    await ctx.api.deleteMessage(chatId, existingPin.message_id).catch(() => {});
    deleteUserPin(userId);
  }

  // 2. Отправляем карточку расписания
  const pinText = formatPinnedScheduleCard(route, direction, stopName, stopSchedule);
  try {
    const sent = await ctx.api.sendMessage(chatId, pinText, {
      parse_mode: 'Markdown',
      reply_markup: pinnedScheduleKeyboard(),
    });

    // 3. Тихо закрепляем вверху чата
    await ctx.api.pinChatMessage(chatId, sent.message_id, { disable_notification: true });

    // 4. Сохраняем в БД
    setUserPin(userId, sent.message_id, routeId, directionId, stopId);

    await ctx.answerCallbackQuery({
      text: '📌 Расписание закреплено вверху чата!',
      show_alert: true,
    });

    // 5. Обновляем клавиатуру экрана
    await ctx.editMessageReplyMarkup({
      reply_markup: scheduleKeyboard(routeId, directionId, stopId, dayType, true),
    }).catch(() => {});
  } catch (err) {
    console.error('[Transport] Ошибка закрепления расписания:', err.message);
    await ctx.answerCallbackQuery({ text: 'Не удалось закрепить расписание', show_alert: true });
  }
});

// 2. Открепление расписания со страницы остановки
transportComposer.callbackQuery(/^transport:unpin:([a-z0-9]+):(to_minsk|to_gavan):([a-z0-9_]+):(weekdays|weekends|auto)$/, async (ctx) => {
  const routeId = ctx.match[1];
  const directionId = ctx.match[2];
  const stopId = ctx.match[3];
  const dayType = ctx.match[4];
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  const existingPin = getUserPin(userId);
  if (existingPin) {
    await ctx.api.unpinChatMessage(chatId, existingPin.message_id).catch(() => {});
    await ctx.api.deleteMessage(chatId, existingPin.message_id).catch(() => {});
    deleteUserPin(userId);
  }

  await ctx.answerCallbackQuery({ text: 'Расписание откреплено' });

  await ctx.editMessageReplyMarkup({
    reply_markup: scheduleKeyboard(routeId, directionId, stopId, dayType, false),
  }).catch(() => {});
});

// 3. Открепление прямо с кнопки на самом закреплённом сообщении
transportComposer.callbackQuery('transport:unpin_direct', async (ctx) => {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const msgId = ctx.callbackQuery.message?.message_id;

  if (chatId && msgId) {
    await ctx.api.unpinChatMessage(chatId, msgId).catch(() => {});
    await ctx.api.deleteMessage(chatId, msgId).catch(() => {});
  }
  deleteUserPin(userId);

  await ctx.answerCallbackQuery({ text: 'Расписание откреплено' });
});

