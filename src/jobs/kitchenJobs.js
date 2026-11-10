/**
 * Фоновые задачи кухни (раз в минуту):
 *  1. Заказ не принят N минут → напоминание в группу (до автоотмены).
 *  2. Наступило время готовности, а заказ не отмечен готовым → напоминание с кнопками.
 *  3. Заказ готов, жилец не пришёл → напоминание жильцу.
 *  4. Заказ готов давно → спросить кухню «выдан или не забрали?».
 *  5. Ежедневный отчёт заведению после закрытия.
 * Каждое напоминание отправляется один раз (отметки в orders.*_reminded_at).
 */
import { InlineKeyboard } from 'grammy';
import { config } from '../../config.js';
import {
  getOrdersAwaitingAcceptReminder,
  getAcceptedOrdersWithoutReadyReminder,
  getReadyOrdersWaitingSince,
  markOrderReminded,
} from '../db/repositories/orders.js';
import { getPlacesWithGroups, setPlaceLastReportDate } from '../db/repositories/places.js';
import { buildDailyReport } from '../services/dailyReport.js';
import { hasHours } from '../services/placeStatus.js';
import { escapeMarkdown } from '../utils/text.js';
import { minskDateStr, minskMinutesOfDay, nearestMinskTime, parseDbUtc } from '../utils/time.js';

let intervalId = null;

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

// Ответ на карточку заказа в группе кухни
async function replyToCard(api, order, text, keyboard = undefined) {
  if (!order.group_chat_id) return;
  await api.sendMessage(order.group_chat_id, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
    reply_parameters: order.group_message_id
      ? { message_id: order.group_message_id, allow_sending_without_reply: true }
      : undefined,
  });
}

// Отметку ставим до отправки: при сбое Telegram лучше пропустить напоминание, чем слать его каждую минуту
async function remindOnce(order, column, send) {
  markOrderReminded(order.id, column);
  try {
    await send();
  } catch (err) {
    console.error(`[Job Error] Напоминание ${column} по заказу ${order.order_code} не отправлено:`, err.message);
  }
}

async function acceptReminders(api) {
  const minutes = config.acceptReminderMinutes;
  const left = Math.max(1, config.orderExpiryMinutes - minutes);
  for (const order of getOrdersAwaitingAcceptReminder(minutes)) {
    await remindOnce(order, 'accept_reminded_at', () => replyToCard(api, order,
      `⏰ *Заказ ${order.order_code} ждёт принятия уже ${minutes} мин!*\n` +
      `Если его не принять, примерно через ${left} мин он автоматически отменится.`
    ));
  }
}

async function readyDueReminders(api, now) {
  for (const order of getAcceptedOrdersWithoutReadyReminder()) {
    const due = nearestMinskTime(order.ready_at, parseDbUtc(order.updated_at));
    if (!due || due > now) continue;

    await remindOnce(order, 'ready_reminded_at', () => replyToCard(api, order,
      `🔔 *Наступило время готовности заказа ${order.order_code}* (${order.ready_at}).\n` +
      `Готов — отметьте, и клиент сразу получит уведомление. Не успеваете — сдвиньте время.`,
      new InlineKeyboard()
        .text('🔔 Готов к выдаче', `staff:ready:${order.id}`)
        .text('⏱ +10 мин', `staff:shift_time:${order.id}:10`)
    ));
  }
}

async function clientPickupReminders(api) {
  const minutes = config.clientPickupReminderMinutes;
  for (const order of getReadyOrdersWaitingSince(minutes, 'client_pickup_reminded_at')) {
    await remindOnce(order, 'client_pickup_reminded_at', () => api.sendMessage(
      order.user_id,
      `⏳ *Ваш заказ ${order.order_code} ждёт вас!*\n\n` +
      `Он готов уже ${minutes} мин.\n` +
      `📍 *Точка выдачи:* ${escapeMarkdown(order.pickup_point)}\n` +
      `🔢 *Код выдачи:* *${order.order_code}*`,
      { parse_mode: 'Markdown' }
    ));
  }
}

async function staffPickupChecks(api) {
  const minutes = config.staffPickupCheckMinutes;
  for (const order of getReadyOrdersWaitingSince(minutes, 'staff_pickup_reminded_at')) {
    await remindOnce(order, 'staff_pickup_reminded_at', () => replyToCard(api, order,
      `❓ *Заказ ${order.order_code} готов уже ${minutes} мин и не отмечен выданным.*\nКлиент его забрал?`,
      new InlineKeyboard()
        .text('📦 Выдан', `staff:issued:${order.id}`)
        .text('🙅 Не забрали', `staff:no_show:${order.id}`)
    ));
  }
}

// Время отчёта: через 15 минут после закрытия (если часы заданы и не переходят через полночь), иначе по умолчанию
export function reportDueMinutes(place) {
  if (hasHours(place)) {
    const open = toMinutes(place.open_time);
    const close = toMinutes(place.close_time);
    if (close > open) return Math.min(close + 15, 23 * 60 + 55);
  }
  return toMinutes(config.defaultReportTime);
}

async function dailyReports(api, now) {
  const today = minskDateStr(now);
  const nowMinutes = minskMinutesOfDay(now);

  for (const place of getPlacesWithGroups()) {
    if (place.last_report_date === today || nowMinutes < reportDueMinutes(place)) continue;

    setPlaceLastReportDate(place.id, today);
    const { text, total } = buildDailyReport(place, today);
    if (total === 0) continue; // пустые отчёты не шлём, чтобы не спамить группу

    try {
      await api.sendMessage(place.group_chat_id, text, { parse_mode: 'Markdown' });
      console.log(`[Job] Ежедневный отчёт отправлен в группу «${place.name}» (${total} заказов).`);
    } catch (err) {
      console.error(`[Job Error] Не удалось отправить отчёт в группу «${place.name}»:`, err.message);
    }
  }
}

export async function runKitchenJobs(bot, now = new Date()) {
  const steps = [
    () => acceptReminders(bot.api),
    () => readyDueReminders(bot.api, now),
    () => clientPickupReminders(bot.api),
    () => staffPickupChecks(bot.api),
    () => dailyReports(bot.api, now),
  ];
  // Сбой одного шага не должен останавливать остальные
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      console.error('[Job Error] Ошибка фоновой задачи кухни:', err);
    }
  }
}

let running = false;

export function startKitchenJobs(bot) {
  if (intervalId) return;
  const tick = async () => {
    if (running) return; // предыдущий проход ещё не закончился
    running = true;
    try {
      await runKitchenJobs(bot);
    } finally {
      running = false;
    }
  };
  tick();
  intervalId = setInterval(tick, 60 * 1000);
  console.log('[Job] Напоминания кухне и ежедневные отчёты запущены (интервал: 60 сек).');
}

export function stopKitchenJobs() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
