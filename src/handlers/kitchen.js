/**
 * Пульт кухни в группе заведения: пауза приёма, стоп-лист, часы работы, лимит заказов на слот, отчёт.
 * Управлять могут сотрудники заведения (/iam_staff) и администраторы бота.
 */
import { Composer, InlineKeyboard } from 'grammy';
import { isAdmin, config } from '../../config.js';
import {
  getPlaceById,
  getPlaceByGroupId,
  getPlaceItems,
  getItemById,
  toggleItemAvailability,
  setPlacePause,
  setPlaceHours,
  setPlaceSlotCapacity,
  countUnavailableItems,
} from '../db/repositories/places.js';
import { isStaffMember } from '../db/repositories/staff.js';
import { getPlaceDailyReport } from '../db/repositories/orders.js';
import { getAcceptanceState, getPausedUntil, endOfWorkday, formatHours, parseHoursInput } from '../services/placeStatus.js';
import { buildDailyReport } from '../services/dailyReport.js';
import { escapeMarkdown, formatPrice, plural } from '../utils/text.js';
import { formatMinskTime, minskDateStr } from '../utils/time.js';

export const kitchenComposer = new Composer();

const LIMIT_PRESETS = [0, 3, 5, 8];
const HOURS_PRESETS = [
  ['08:00', '22:00'],
  ['09:00', '21:00'],
  ['10:00', '23:00'],
  ['11:00', '23:00'],
];

function canManage(userId, place) {
  return isAdmin(userId) || isStaffMember(userId, place.id);
}

function statusLine(place) {
  const state = getAcceptanceState(place);
  if (state.accepting) return '🟢 *Принимаем заказы*';
  if (state.reason === 'paused') return `⏸ *Пауза до ${formatMinskTime(state.until)}*`;
  if (state.reason === 'closed') return `🌙 *Закрыто* (откроемся в ${place.open_time})`;
  return '🔴 *Заведение скрыто администратором*';
}

export function renderPanelText(place) {
  const stopped = countUnavailableItems(place.id);
  const today = getPlaceDailyReport(place.id, minskDateStr());
  const limit = Number(place.slot_capacity) || 0;

  return (
    `🎛 *Пульт кухни* — ${escapeMarkdown(place.name)}\n\n` +
    `Приём заказов: ${statusLine(place)}\n` +
    `🕘 Часы работы: ${formatHours(place)}\n` +
    `📦 Лимит: ${limit ? `до ${plural(limit, ['заказа', 'заказов', 'заказов'])} на ${config.slotMinutes} мин` : 'без лимита'}\n` +
    `🚫 В стоп-листе: ${stopped ? `${stopped} поз.` : 'пусто'}\n\n` +
    `📋 Сегодня: ${plural(today.total, ['заказ', 'заказа', 'заказов'])}, выдано на ${formatPrice(today.revenue)}` +
    (today.active ? `, в работе: ${today.active}` : '') +
    `\n\n_Совет: закрепите это сообщение в группе._`
  );
}

export function panelKeyboard(place) {
  const kb = new InlineKeyboard();

  if (getPausedUntil(place)) {
    kb.text('▶️ Возобновить приём', `kp:resume:${place.id}`).row();
  } else {
    kb.text('⏸ 30 мин', `kp:pause:${place.id}:30`)
      .text('⏸ 1 час', `kp:pause:${place.id}:60`)
      .text('⏸ До конца дня', `kp:pause:${place.id}:eod`)
      .row();
  }

  const stopped = countUnavailableItems(place.id);
  kb.text(`🚫 Стоп-лист${stopped ? ` (${stopped})` : ''}`, `kp:stop:${place.id}`)
    .text('🕘 Часы работы', `kp:hours:${place.id}`)
    .row();

  const limit = Number(place.slot_capacity) || 0;
  const presets = LIMIT_PRESETS.includes(limit) ? LIMIT_PRESETS : [...LIMIT_PRESETS, limit];
  for (const value of presets) {
    const label = value === 0 ? 'Без лимита' : `${value}/${config.slotMinutes}м`;
    kb.text(`${value === limit ? '✓ ' : ''}${label}`, `kp:limit:${place.id}:${value}`);
  }
  kb.row();

  kb.text('📊 Отчёт за сегодня', `kp:report:${place.id}`)
    .text('🔄 Обновить', `kp:open:${place.id}`);
  return kb;
}

function stopListKeyboard(place) {
  const kb = new InlineKeyboard();
  for (const item of getPlaceItems(place.id, { onlyAvailable: false })) {
    kb.text(`${item.is_available ? '🟢' : '🔴'} ${item.name}`, `kp:item:${item.id}`).row();
  }
  kb.text('◀️ К пульту', `kp:open:${place.id}`);
  return kb;
}

function hoursKeyboard(place) {
  const kb = new InlineKeyboard();
  HOURS_PRESETS.forEach(([open, close], i) => {
    const current = place.open_time === open && place.close_time === close;
    kb.text(`${current ? '✓ ' : ''}${open}–${close}`, `kp:sethours:${place.id}:${open.replace(':', '')}-${close.replace(':', '')}`);
    if (i % 2 === 1) kb.row();
  });
  kb.text(`${place.open_time ? '' : '✓ '}Круглосуточно`, `kp:sethours:${place.id}:24`).row();
  kb.text('◀️ К пульту', `kp:open:${place.id}`);
  return kb;
}

async function showPanel(ctx, place, { edit = true } = {}) {
  const options = { parse_mode: 'Markdown', reply_markup: panelKeyboard(place) };
  if (edit && ctx.callbackQuery) {
    return ctx.editMessageText(renderPanelText(place), options);
  }
  return ctx.reply(renderPanelText(place), options);
}

// Достаём заведение из callback и проверяем права
async function guardPlace(ctx, placeId) {
  const place = getPlaceById(placeId);
  if (!place) {
    await ctx.answerCallbackQuery({ text: 'Заведение не найдено', show_alert: true });
    return null;
  }
  if (!canManage(ctx.from.id, place)) {
    await ctx.answerCallbackQuery({
      text: '⛔ Управлять пультом могут только сотрудники заведения (команда /iam_staff)',
      show_alert: true,
    });
    return null;
  }
  return place;
}

// Заведение группы для команд
async function groupPlaceForCommand(ctx) {
  const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  if (!isGroup) {
    await ctx.reply('ℹ️ Пульт кухни работает в группе заведения. Откройте группу кухни и отправьте команду там.');
    return null;
  }
  const place = getPlaceByGroupId(ctx.chat.id);
  if (!place) {
    await ctx.reply('Эта группа ещё не привязана к заведению. Отправьте /setup_place.');
    return null;
  }
  if (!canManage(ctx.from.id, place)) {
    await ctx.reply('⛔ Управлять пультом могут только сотрудники заведения. Получить доступ: /iam_staff');
    return null;
  }
  return place;
}

// --- Команды ---

kitchenComposer.command(['panel', 'kitchen'], async (ctx) => {
  const place = await groupPlaceForCommand(ctx);
  if (place) await showPanel(ctx, place, { edit: false });
});

kitchenComposer.command('report', async (ctx) => {
  const place = await groupPlaceForCommand(ctx);
  if (!place) return;
  const { text } = buildDailyReport(place);
  await ctx.reply(text, { parse_mode: 'Markdown' });
});

kitchenComposer.command('hours', async (ctx) => {
  const place = await groupPlaceForCommand(ctx);
  if (!place) return;

  const arg = (ctx.match || '').trim();
  if (!arg) {
    return ctx.reply(
      `🕘 *Часы работы:* ${formatHours(place)}\n\n` +
      `Изменить: \`/hours 9:00-22:00\`\nСнять ограничение: \`/hours 24\``,
      { parse_mode: 'Markdown', reply_markup: hoursKeyboard(place) }
    );
  }

  if (/^(24|off|нет|круглосуточно)$/i.test(arg)) {
    const updated = setPlaceHours(place.id, null, null);
    return ctx.reply(`✅ Часы работы сняты — заказы принимаются круглосуточно.`, { reply_markup: panelKeyboard(updated) });
  }

  const hours = parseHoursInput(arg);
  if (!hours) {
    return ctx.reply('⚠️ Не понял формат. Пример: `/hours 9:00-22:00` или `/hours 24`', { parse_mode: 'Markdown' });
  }

  const updated = setPlaceHours(place.id, hours.open, hours.close);
  await ctx.reply(
    `✅ Часы работы: *${hours.open}–${hours.close}*.\nВне этого времени бот не примет заказ и подскажет жильцу, когда вы откроетесь.`,
    { parse_mode: 'Markdown', reply_markup: panelKeyboard(updated) }
  );
});

// --- Кнопки пульта ---

kitchenComposer.callbackQuery(/^kp:open:(\d+)$/, async (ctx) => {
  const place = await guardPlace(ctx, Number(ctx.match[1]));
  if (!place) return;
  await ctx.answerCallbackQuery();
  await showPanel(ctx, place);
});

kitchenComposer.callbackQuery(/^kp:pause:(\d+):(30|60|eod)$/, async (ctx) => {
  const place = await guardPlace(ctx, Number(ctx.match[1]));
  if (!place) return;

  const now = new Date();
  const until = ctx.match[2] === 'eod'
    ? endOfWorkday(place, now)
    : new Date(now.getTime() + Number(ctx.match[2]) * 60000);

  const updated = setPlacePause(place.id, until);
  await ctx.answerCallbackQuery({ text: `⏸ Приём новых заказов на паузе до ${formatMinskTime(until)}` });
  await showPanel(ctx, updated);
  console.log(`[Kitchen] ${ctx.from.first_name} (${ctx.from.id}) поставил «${place.name}» на паузу до ${until.toISOString()}`);
});

kitchenComposer.callbackQuery(/^kp:resume:(\d+)$/, async (ctx) => {
  const place = await guardPlace(ctx, Number(ctx.match[1]));
  if (!place) return;
  const updated = setPlacePause(place.id, null);
  await ctx.answerCallbackQuery({ text: '▶️ Приём заказов возобновлён' });
  await showPanel(ctx, updated);
});

kitchenComposer.callbackQuery(/^kp:limit:(\d+):(\d+)$/, async (ctx) => {
  const place = await guardPlace(ctx, Number(ctx.match[1]));
  if (!place) return;
  const value = Number(ctx.match[2]);
  const updated = setPlaceSlotCapacity(place.id, value);
  await ctx.answerCallbackQuery({
    text: value ? `📦 Не больше ${value} заказов на ${config.slotMinutes} минут` : '📦 Лимит снят',
  });
  await showPanel(ctx, updated);
});

kitchenComposer.callbackQuery(/^kp:stop:(\d+)$/, async (ctx) => {
  const place = await guardPlace(ctx, Number(ctx.match[1]));
  if (!place) return;
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `🚫 *Стоп-лист* — ${escapeMarkdown(place.name)}\n\n` +
    `Нажмите на позицию, чтобы скрыть её из меню (🔴) или вернуть (🟢). Жильцы сразу перестанут её видеть.`,
    { parse_mode: 'Markdown', reply_markup: stopListKeyboard(place) }
  );
});

kitchenComposer.callbackQuery(/^kp:item:(\d+)$/, async (ctx) => {
  const item = getItemById(Number(ctx.match[1]));
  if (!item) return ctx.answerCallbackQuery({ text: 'Позиция не найдена', show_alert: true });
  const place = await guardPlace(ctx, item.place_id);
  if (!place) return;

  const updated = toggleItemAvailability(item.id);
  await ctx.answerCallbackQuery({
    text: updated.is_available ? `🟢 «${item.name}» снова в меню` : `🔴 «${item.name}» скрыта из меню`,
  });
  await ctx.editMessageReplyMarkup({ reply_markup: stopListKeyboard(place) });
});

kitchenComposer.callbackQuery(/^kp:hours:(\d+)$/, async (ctx) => {
  const place = await guardPlace(ctx, Number(ctx.match[1]));
  if (!place) return;
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `🕘 *Часы работы* — ${escapeMarkdown(place.name)}\n\n` +
    `Сейчас: *${formatHours(place)}*\n\n` +
    `Вне часов работы бот не примет заказ и подскажет жильцу, когда вы откроетесь. ` +
    `Время получения заказа тоже должно попадать в часы работы.\n\n` +
    `Выберите вариант или задайте свои часы командой \`/hours 9:30-21:30\``,
    { parse_mode: 'Markdown', reply_markup: hoursKeyboard(place) }
  );
});

kitchenComposer.callbackQuery(/^kp:sethours:(\d+):(24|\d{4}-\d{4})$/, async (ctx) => {
  const place = await guardPlace(ctx, Number(ctx.match[1]));
  if (!place) return;

  let updated;
  if (ctx.match[2] === '24') {
    updated = setPlaceHours(place.id, null, null);
    await ctx.answerCallbackQuery({ text: '🕘 Круглосуточно' });
  } else {
    const [o, c] = ctx.match[2].split('-');
    const open = `${o.slice(0, 2)}:${o.slice(2)}`;
    const close = `${c.slice(0, 2)}:${c.slice(2)}`;
    updated = setPlaceHours(place.id, open, close);
    await ctx.answerCallbackQuery({ text: `🕘 Часы работы: ${open}–${close}` });
  }
  await showPanel(ctx, updated);
});

kitchenComposer.callbackQuery(/^kp:report:(\d+)$/, async (ctx) => {
  const place = await guardPlace(ctx, Number(ctx.match[1]));
  if (!place) return;
  await ctx.answerCallbackQuery();
  const { text } = buildDailyReport(place);
  // Отчёт — отдельным сообщением, чтобы пульт оставался на месте
  await ctx.reply(text, { parse_mode: 'Markdown' });
});
