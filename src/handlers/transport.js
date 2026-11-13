/**
 * Общественный транспорт: направление → остановка → табло всех маршрутов остановки.
 * На табло вверху ближайшие рейсы («через N мин»), ниже расписание каждого маршрута.
 * Расписание каждого маршрута на остановке можно закрепить в шапке чата отдельно.
 */
import { Composer } from 'grammy';
import {
  getTransportSchedule,
  getMinskTime,
  getStopSchedule,
  getDirectionStops,
  getStopBoard,
  getNearestFromBoard,
  getFirstDepartureFromBoard,
  splitRemaining,
  formatWait,
  DIRECTION_TITLES,
} from '../services/transportService.js';
import {
  directionKeyboard,
  stopsKeyboard,
  boardKeyboard,
  pinnedScheduleKeyboard,
  DIR_BY_CODE,
} from '../keyboards/transport.js';
import { renderScreen } from '../utils/cleanChat.js';
import { escapeMarkdown } from '../utils/text.js';
import {
  getUserPins,
  findUserPin,
  findUserPinByMessage,
  addUserPin,
  deleteUserPinById,
} from '../db/repositories/users.js';

export const transportComposer = new Composer();

const MAX_PINS = 6;
const md = escapeMarkdown;

// Экран без затирания закреплённой карточки: если нажали кнопку на закреплённом сообщении — шлём новый экран
function screen(ctx, text, extra) {
  const clickedId = ctx.callbackQuery?.message?.message_id;
  const fromPinned = Boolean(clickedId && ctx.from && findUserPinByMessage(ctx.from.id, clickedId));
  return renderScreen(ctx, text, extra, { forceNew: fromPinned });
}

function formatItemRows(items, perRow = 5) {
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow).join('  '));
  }
  return rows.join('\n');
}

function formatTimeRows(times, perRow = 5) {
  const rows = [];
  for (let i = 0; i < times.length; i += perRow) {
    rows.push(times.slice(i, i + perRow).map((t) => `\`${t}\``).join('  '));
  }
  return rows.join('\n');
}

// --- Шаг 1: направление ---

function pinShortcuts(userId) {
  // Одна кнопка на остановку (табло показывает все маршруты остановки)
  const seen = new Map();
  for (const pin of getUserPins(userId)) {
    const key = `${pin.direction_id}:${pin.stop_id}`;
    const stop = getDirectionStops(pin.direction_id).find((s) => s.id === pin.stop_id);
    if (!stop) continue;
    if (!seen.has(key)) {
      seen.set(key, { direction_id: pin.direction_id, stop_id: pin.stop_id, stopName: stop.name, numbers: [] });
    }
    const route = getTransportSchedule().routes[pin.route_id];
    if (route) seen.get(key).numbers.push(route.number);
  }
  return [...seen.values()].map((p) => ({
    ...p,
    label: `${p.stopName} → ${DIRECTION_TITLES[p.direction_id].short} (${p.numbers.join(', ')})`,
  }));
}

async function showDirections(ctx) {
  const shortcuts = ctx.from ? pinShortcuts(ctx.from.id) : [];
  const text = (
    `🚌 *Общественный транспорт*\n\n` +
    `Куда едем?` +
    (shortcuts.length ? `\n\n📌 Ниже — ваши закреплённые остановки, табло открывается в одно нажатие.` : '')
  );
  await screen(ctx, text, { parse_mode: 'Markdown', reply_markup: directionKeyboard(shortcuts) });
}

transportComposer.command(['transport', 'bus', 'buses', 'raspisanie'], showDirections);

transportComposer.callbackQuery('transport:menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showDirections(ctx);
});

// --- Шаг 2: остановка ---

async function showStops(ctx, directionId) {
  const text = (
    `${DIRECTION_TITLES[directionId].title}\n\n` +
    `🚏 *Выберите остановку посадки.*\n` +
    `Рядом с названием — маршруты, которые через неё идут.`
  );
  await screen(ctx, text, { parse_mode: 'Markdown', reply_markup: stopsKeyboard(directionId) });
}

transportComposer.callbackQuery(/^tr:d:([mg])$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showStops(ctx, DIR_BY_CODE[ctx.match[1]]);
});

// --- Шаг 3: табло ---

/**
 * Текст и клавиатура табло. day: a | wd | we, mode: r | f
 */
export function buildBoard(userId, directionId, stopId, day, mode) {
  const minsk = getMinskTime();
  const showingToday = day === 'a';
  const isWeekendView = showingToday ? minsk.isWeekend : day === 'we';
  const dayType = isWeekendView ? 'weekends' : 'weekdays';
  const board = getStopBoard(directionId, stopId, dayType);
  if (!board) return null;

  let text = `🚏 *${md(board.stop.name)}*\n${DIRECTION_TITLES[directionId].title}\n`;
  text += showingToday
    ? `🕐 Сейчас ${minsk.timeString} · ${isWeekendView ? 'выходной' : 'будний день'}\n\n`
    : `📅 *Расписание на ${isWeekendView ? 'выходные' : 'будни'}*\n\n`;

  // Ближайшие рейсы по всем маршрутам
  if (showingToday) {
    const nearest = getNearestFromBoard(board, minsk.totalMinutes, 4);
    if (nearest.length > 0) {
      text += `⚡ *Ближайшие:*\n`;
      text += nearest
        .map((n) => `${n.route.badge} *${n.route.number}* — ${n.time} · ${formatWait(n.diffMinutes)}`)
        .join('\n');
      text += '\n\n';
    } else {
      const tomorrowIsWeekend = [0, 6].includes((minsk.dayOfWeek + 1) % 7);
      const tomorrow = getFirstDepartureFromBoard(getStopBoard(directionId, stopId, tomorrowIsWeekend ? 'weekends' : 'weekdays'));
      text += `⚡ *Сегодня рейсов больше нет.*`;
      text += tomorrow ? ` Первый завтра: ${tomorrow.route.badge} ${tomorrow.route.number} в ${tomorrow.time}` : '';
      text += '\n\n';
    }
  }

  // Расписание каждого маршрута
  for (const r of board.routes) {
    text += `${r.route.badge} *${r.route.number}* → ${md(r.direction.toStation)}\n`;
    if (r.times.length === 0) {
      text += `_в ${isWeekendView ? 'выходные' : 'будни'} не ходит_\n\n`;
      continue;
    }
    if (showingToday && mode === 'r') {
      const { remaining, passed } = splitRemaining(r, minsk.totalMinutes);
      text += remaining.length ? formatTimeRows(remaining) : '_на сегодня рейсов больше нет_';
      text += passed ? `\n_уже ушли: ${passed}_` : '';
      text += '\n\n';
    } else if (showingToday) {
      // Весь день: ушедшие рейсы обычным текстом, предстоящие — моноширинным
      const items = r.times.map((t, i) => (r.minutes[i] >= minsk.totalMinutes ? `\`${t}\`` : t));
      text += `${formatItemRows(items)}\n\n`;
    } else {
      text += `${formatTimeRows(r.times)}\n\n`;
    }
  }

  // Проезд (одинаковые тарифы объединяем)
  const fares = new Map();
  for (const r of board.routes) {
    if (!fares.has(r.route.fare)) fares.set(r.route.fare, []);
    fares.get(r.route.fare).push(r.route.number);
  }
  text += [...fares.entries()].map(([fare, numbers]) => `💳 *${numbers.join(', ')}:* ${md(fare)}`).join('\n');

  const pinnedRouteIds = getUserPins(userId)
    .filter((p) => p.direction_id === directionId && p.stop_id === stopId)
    .map((p) => p.route_id);

  const keyboard = boardKeyboard({
    directionId,
    stopId,
    day,
    mode,
    routes: board.routes.map((r) => r.route),
    pinnedRouteIds,
    showingToday,
    isWeekendView,
  });

  return { text, keyboard };
}

async function showBoard(ctx, directionId, stopId, day = 'a', mode = 'f') {
  const result = buildBoard(ctx.from.id, directionId, stopId, day, mode);
  if (!result) {
    return showStops(ctx, directionId);
  }
  await screen(ctx, result.text, { parse_mode: 'Markdown', reply_markup: result.keyboard });
}

transportComposer.callbackQuery(/^tr:b:([mg]):([a-z0-9_]+):(a|wd|we):([rf])$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showBoard(ctx, DIR_BY_CODE[ctx.match[1]], ctx.match[2], ctx.match[3], ctx.match[4]);
});

// --- Закрепление расписания отдельного маршрута ---

function formatPinnedScheduleCard(route, direction, stopName, routeId, directionId, stopId) {
  const weekdays = getStopSchedule(routeId, directionId, stopId, 'weekdays').times;
  const weekends = getStopSchedule(routeId, directionId, stopId, 'weekends').times;
  const rows = (arr) => (arr.length ? formatTimeRows(arr, 4) : '_Рейсов нет_');

  return (
    `📌 *${route.badge} ${route.number}* → ${md(direction.toStation)}\n` +
    `🚏 *Остановка:* ${md(stopName)}\n\n` +
    `📅 *Будни:*\n${rows(weekdays)}\n\n` +
    `🎉 *Выходные:*\n${rows(weekends)}\n\n` +
    `💳 *Проезд:* ${md(route.fare)}\n` +
    `_Ближайшие рейсы — на табло остановки (кнопка ниже)._`
  );
}

async function removePin(ctx, pin) {
  const chatId = ctx.chat?.id;
  if (chatId) {
    await ctx.api.unpinChatMessage(chatId, pin.message_id).catch(() => {});
    await ctx.api.deleteMessage(chatId, pin.message_id).catch(() => {});
  }
  deleteUserPinById(pin.id);
}

transportComposer.callbackQuery(/^tr:pin:([a-z0-9]+):([mg]):([a-z0-9_]+):(a|wd|we):([rf])$/, async (ctx) => {
  const [, routeId, code, stopId, day, mode] = ctx.match;
  const directionId = DIR_BY_CODE[code];
  const userId = ctx.from.id;
  const chatId = ctx.chat?.id;

  const route = getTransportSchedule().routes[routeId];
  const direction = route?.directions?.[directionId];
  const stop = getDirectionStops(directionId).find((s) => s.id === stopId);
  if (!route || !direction || !stop || !stop.routes.some((r) => r.id === routeId)) {
    return ctx.answerCallbackQuery({ text: 'Маршрут не найден', show_alert: true });
  }

  const existing = findUserPin(userId, routeId, directionId, stopId);
  if (existing) {
    await removePin(ctx, existing);
    await ctx.answerCallbackQuery({ text: `Расписание ${route.number} откреплено` });
  } else {
    if (getUserPins(userId).length >= MAX_PINS) {
      return ctx.answerCallbackQuery({
        text: `Можно закрепить до ${MAX_PINS} расписаний. Открепите ненужное (кнопка «📍 Открепить» на закреплённом сообщении).`,
        show_alert: true,
      });
    }
    try {
      const sent = await ctx.api.sendMessage(
        chatId,
        formatPinnedScheduleCard(route, direction, stop.name, routeId, directionId, stopId),
        { parse_mode: 'Markdown', reply_markup: pinnedScheduleKeyboard(directionId, stopId) }
      );
      await ctx.api.pinChatMessage(chatId, sent.message_id, { disable_notification: true });
      addUserPin(userId, sent.message_id, routeId, directionId, stopId);
      await ctx.answerCallbackQuery({ text: `📌 Расписание ${route.number} закреплено вверху чата` });
    } catch (err) {
      console.error('[Transport] Ошибка закрепления расписания:', err.message);
      return ctx.answerCallbackQuery({ text: 'Не удалось закрепить расписание', show_alert: true });
    }
  }

  // Обновляем кнопки табло (📌 ↔ 📍)
  const result = buildBoard(userId, directionId, stopId, day, mode);
  if (result) {
    await ctx.editMessageReplyMarkup({ reply_markup: result.keyboard }).catch(() => {});
  }
});

// Открепление кнопкой на самом закреплённом сообщении (работает и для старых карточек)
transportComposer.callbackQuery('transport:unpin_direct', async (ctx) => {
  const msgId = ctx.callbackQuery.message?.message_id;
  const pin = msgId ? findUserPinByMessage(ctx.from.id, msgId) : null;

  if (pin) {
    await removePin(ctx, pin);
  } else if (msgId) {
    await ctx.api.unpinChatMessage(ctx.chat.id, msgId).catch(() => {});
    await ctx.api.deleteMessage(ctx.chat.id, msgId).catch(() => {});
  }

  await ctx.answerCallbackQuery({ text: 'Расписание откреплено' });
});

// --- Совместимость со старыми кнопками (сообщения, отправленные до обновления) ---

transportComposer.callbackQuery(/^transport:route:/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showDirections(ctx);
});

transportComposer.callbackQuery(/^transport:dir:[a-z0-9]+:(to_minsk|to_gavan)/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showStops(ctx, ctx.match[1]);
});

transportComposer.callbackQuery(/^transport:(?:view|pin|unpin):[a-z0-9]+:(to_minsk|to_gavan):([a-z0-9_]+):/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showBoard(ctx, ctx.match[1], ctx.match[2]);
});
