import { Composer } from 'grammy';
import {
  getTransportSchedule,
  getMinskTime,
  findNextDepartures,
  getAllNextDepartures,
  getStopSchedule,
  getDefaultStop,
  getRouteStops,
} from '../services/transportService.js';
import {
  transportMenuKeyboard,
  routeDirectionKeyboard,
  routeScheduleKeyboard,
  stopsSelectionKeyboard,
  nextDeparturesKeyboard,
} from '../keyboards/transport.js';

export const transportComposer = new Composer();

/**
 * Главный экран раздела транспорта
 */
function renderTransportMenuText() {
  const minsk = getMinskTime();
  const dayTypeLabel = minsk.isWeekend ? 'выходной день' : 'будний день';

  return (
    `🚌 *Расписание транспорта ЖК «Зелёная Гавань»*\n\n` +
    `Здесь вы можете посмотреть актуальное расписание автобусов и маршруток, ` +
    `выбрать конкретную остановку посадки и узнать ближайшие рейсы.\n\n` +
    `📍 *Доступные маршруты:*\n` +
    `• 🚌 *200С* — ст. м. Уручье ↔ Зелёная Гавань (скоростной, 12 остановок)\n` +
    `• 🚌 *200дС* — ст. м. Уручье ↔ Колодищи-2 ↔ Зелёная Гавань\n` +
    `• 🚐 *1222-ТК* — ст. м. Восток / Могилёвская ↔ Зелёная Гавань\n\n` +
    `🕒 *Минское время:* ${minsk.timeString} (${minsk.dayName.toLowerCase()}, ${dayTypeLabel})\n\n` +
    `Выберите действие:`
  );
}

// Команды вызова расписания
transportComposer.command(['transport', 'bus', 'buses', 'raspisanie'], async (ctx) => {
  await ctx.reply(renderTransportMenuText(), {
    parse_mode: 'Markdown',
    reply_markup: transportMenuKeyboard(),
  });
});

// Возврат в меню транспорта через callback
transportComposer.callbackQuery('transport:menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await ctx.editMessageText(renderTransportMenuText(), {
      parse_mode: 'Markdown',
      reply_markup: transportMenuKeyboard(),
    });
  } catch {
    await ctx.reply(renderTransportMenuText(), {
      parse_mode: 'Markdown',
      reply_markup: transportMenuKeyboard(),
    });
  }
});

// Экран "Ближайшие рейсы прямо сейчас"
transportComposer.callbackQuery('transport:next', async (ctx) => {
  await ctx.answerCallbackQuery({ text: 'Обновлено!' });
  const summary = getAllNextDepartures();
  const minsk = summary.now;
  const dayType = minsk.isWeekend ? 'выходной' : 'будний день';

  const formatList = (items) => {
    return items.map((item) => {
      let depText = '';
      if (item.nextDepartures.length > 0) {
        depText = item.nextDepartures
          .map((d) => `*${d.time}* (${d.label})`)
          .join(', ');
      } else if (item.allTimesCount === 0) {
        depText = '_сегодня нет рейсов_';
      } else {
        depText = item.intervalInfo ? `_${item.intervalInfo}_` : '_рейсов на сегодня больше нет_';
      }

      return `• ${item.routeBadge} *${item.routeNumber}* (от «${item.fromStation}»): ${depText}`;
    }).join('\n');
  };

  const text = (
    `⚡ *Ближайшие рейсы транспорта прямо сейчас*\n` +
    `🕒 *Время:* ${minsk.timeString} (${minsk.dayName}, ${dayType})\n\n` +
    `🏙 *В Минск (из Зелёной Гавани):*\n` +
    `${formatList(summary.to_minsk)}\n\n` +
    `🏡 *В Зелёную Гавань (из Минска):*\n` +
    `${formatList(summary.to_gavan)}\n\n` +
    `_Нажмите на любой маршрут ниже, чтобы выбрать остановку и открыть полное поминутное расписание._`
  );

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: nextDeparturesKeyboard(),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: nextDeparturesKeyboard(),
    });
  }
});

// Выбор направления движения маршрута
transportComposer.callbackQuery(/^transport:route:([a-z0-9]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const routeId = ctx.match[1];
  const schedule = getTransportSchedule();
  const route = schedule.routes[routeId];

  if (!route) {
    await ctx.reply('⚠️ Маршрут не найден.', { reply_markup: transportMenuKeyboard() });
    return;
  }

  const text = (
    `${route.badge} *${route.title}*\n\n` +
    `🛣 *Маршрут:* ${route.routeDescription}\n` +
    `🏢 *Перевозчик:* ${route.operator}\n` +
    `💳 *Оплата:* ${route.fare}\n\n` +
    `Куда планируете ехать? Выберите направление:`
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

// Экран выбора остановки посадки
transportComposer.callbackQuery(/^transport:stops:([a-z0-9]+):(to_minsk|to_gavan):([a-z0-9_]+):(weekdays|weekends)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const routeId = ctx.match[1];
  const directionId = ctx.match[2];
  const currentStopId = ctx.match[3];
  const dayType = ctx.match[4];

  const schedule = getTransportSchedule();
  const route = schedule.routes[routeId];
  const dir = route?.directions?.[directionId];

  if (!route || !dir) {
    await ctx.reply('⚠️ Маршрут не найден.', { reply_markup: transportMenuKeyboard() });
    return;
  }

  const text = (
    `🚏 *Выбор остановки посадки*\n` +
    `${route.badge} *${route.title}* (${dir.title})\n\n` +
    `Выберите нужную остановку из списка — расписание и ближайшие рейсы пересчитаются именно для неё:`
  );

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: stopsSelectionKeyboard(routeId, directionId, currentStopId, dayType),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: stopsSelectionKeyboard(routeId, directionId, currentStopId, dayType),
    });
  }
});

// Просмотр подробного расписания конкретного маршрута для выбранной остановки
transportComposer.callbackQuery(/^transport:view:([a-z0-9]+):(to_minsk|to_gavan):([a-z0-9_]+):(auto|weekdays|weekends)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const routeId = ctx.match[1];
  const directionId = ctx.match[2];
  let stopId = ctx.match[3];
  let dayType = ctx.match[4];

  const minsk = getMinskTime();
  if (dayType === 'auto') {
    dayType = minsk.isWeekend ? 'weekends' : 'weekdays';
  }

  const schedule = getTransportSchedule();
  const route = schedule.routes[routeId];
  if (!route) {
    await ctx.reply('⚠️ Маршрут не найден.', { reply_markup: transportMenuKeyboard() });
    return;
  }

  const direction = route.directions[directionId];
  if (!direction) {
    await ctx.reply('⚠️ Направление не найдено.', { reply_markup: transportMenuKeyboard() });
    return;
  }

  // Если stopId === 'default', подставляем остановку по умолчанию
  if (stopId === 'default') {
    const defStop = getDefaultStop(routeId, directionId);
    stopId = defStop ? defStop.id : 'default';
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

  // Блок ближайших рейсов с выбранной остановки
  let nextBlock = '';
  if (isViewingToday) {
    if (nextDepartures.length > 0) {
      const list = nextDepartures.map((d) => `• *${d.time}* (${d.label})`).join('\n');
      nextBlock = `⚡ *Ближайшие отправления с ост. «${stopName}»:*\n${list}\n\n`;
    } else if (times.length > 0) {
      nextBlock = `⚡ *Ближайшие отправления:* рейсов на сегодня больше нет\n\n`;
    }
  }

  const noteBlock = direction.note ? `ℹ️ _${direction.note}_\n\n` : '';

  const text = (
    `${route.badge} *${route.title}*\n` +
    `*${direction.title}*\n\n` +
    `🚏 *Остановка посадки:* *${stopName}*\n` +
    `🏁 *Конечная:* ${direction.toStation}\n\n` +
    noteBlock +
    nextBlock +
    `*${dayTitle} (от «${stopName}»):*\n` +
    `${scheduleText}\n\n` +
    `💳 *Проезд:* ${route.fare}\n` +
    `🕒 *Время сейчас:* ${minsk.timeString} (Минск)`
  );

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: routeScheduleKeyboard(routeId, directionId, dayType, stop?.id || stopId, route.yandexMapsUrl),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: routeScheduleKeyboard(routeId, directionId, dayType, stop?.id || stopId, route.yandexMapsUrl),
    });
  }
});
