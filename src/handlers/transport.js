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
} from '../keyboards/transport.js';

export const transportComposer = new Composer();

// Шаг 1: Выбор транспорта (команда /transport, /bus или кнопка в главном меню)
transportComposer.command(['transport', 'bus', 'buses', 'raspisanie'], async (ctx) => {
  await ctx.reply('🚌 *Выберите транспорт:*', {
    parse_mode: 'Markdown',
    reply_markup: transportMenuKeyboard(),
  });
});

transportComposer.callbackQuery('transport:menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  const text = '🚌 *Выберите транспорт:*';
  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: transportMenuKeyboard(),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: transportMenuKeyboard(),
    });
  }
});

// Шаг 2: Выбор направления движения
transportComposer.callbackQuery(/^transport:route:([a-z0-9]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const routeId = ctx.match[1];
  const schedule = getTransportSchedule();
  const route = schedule.routes[routeId];

  if (!route) {
    return ctx.reply('⚠️ Маршрут не найден.', { reply_markup: transportMenuKeyboard() });
  }

  const text = (
    `${route.badge} *${route.title}*\n` +
    `Выберите направление движения:`
  );

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: routeDirectionKeyboard(routeId),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: routeDirectionKeyboard(routeId),
    });
  }
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
    return ctx.reply('⚠️ Направление не найдено.', { reply_markup: transportMenuKeyboard() });
  }

  const text = (
    `${route.badge} *${route.number}* → *${dir.title}*\n` +
    `Выберите вашу остановку посадки:`
  );

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: stopsSelectionKeyboard(routeId, directionId, null, dayType),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: stopsSelectionKeyboard(routeId, directionId, null, dayType),
    });
  }
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
    return ctx.reply('⚠️ Маршрут не найден.', { reply_markup: transportMenuKeyboard() });
  }

  const direction = route.directions[directionId];
  if (!direction) {
    return ctx.reply('⚠️ Направление не найдено.', { reply_markup: transportMenuKeyboard() });
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

  const text = (
    `${route.badge} *${route.number}* → *${direction.title}*\n` +
    `🚏 Остановка: *${stopName}*\n\n` +
    nextBlock +
    `*${dayTitle}:*\n` +
    `${scheduleText}\n\n` +
    `💳 *Проезд:* ${route.fare}\n` +
    `🕒 *Время сейчас:* ${minsk.timeString} (Минск)`
  );

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: scheduleKeyboard(routeId, directionId, stop?.id || stopId, dayType, route.yandexMapsUrl),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: scheduleKeyboard(routeId, directionId, stop?.id || stopId, dayType, route.yandexMapsUrl),
    });
  }
});
