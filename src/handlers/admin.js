import { Composer, InlineKeyboard } from 'grammy';
import { config, isAdmin } from '../../config.js';
import { getAllMakers, getVisibleCollections, getCollection } from '../db/repositories/makers.js';
import { getPendingSignals } from '../db/repositories/signals.js';
import {
  getAllPlaces,
  getActivePlaces,
  getPlaceItems,
  toggleItemAvailability,
  togglePlaceActive,
} from '../db/repositories/places.js';
import {
  getOrdersStatistics,
  getOrderByCodeOrId,
  cancelOrderByAdmin,
} from '../db/repositories/orders.js';
import { getTotalUsersCount, getAllUserIds, getUsersStatistics } from '../db/repositories/users.js';
import { escapeMarkdown, formatPrice } from '../utils/text.js';
import { checkAndUpdateTransportSchedules } from '../jobs/transportUpdater.js';
import { renderScreen } from '../utils/cleanChat.js';
import { setPendingInput, getPendingInput, clearPendingInput } from '../utils/pendingInput.js';

export const adminComposer = new Composer();

// Временное хранилище черновиков рассылок перед подтверждением
const broadcastDrafts = new Map();

// Главная клавиатура панели администратора: только разделы, редкое — внутри
function adminMenuKeyboard() {
  const pending = getAllMakers().filter(m => m.status === 'pending').length;
  const pendingSignals = getPendingSignals().length;
  const kb = new InlineKeyboard();
  if (pendingSignals) kb.text(`🔔 Сигналы на проверке · ${pendingSignals}`, 'siga:list').row();
  if (pending) kb.text(`⏳ Заявки мастеров · ${pending}`, 'mka:req').row();
  kb.text('🧺 Домашнее и ручное', 'mka:hub').row()
    .text('📊 Статистика бота', 'admin:stats').row()
    .text('📢 Рассылка', 'admin:broadcast_prompt').row()
    .text('🚌 Обновить расписание', 'admin:update_transport').row();
  if (config.preordersEnabled) {
    kb.text('⏸ Приём заказов', 'admin:places_pause').text('🚫 Стоп-лист', 'admin:stop_list').row()
      .text('🔍 Найти заказ', 'admin:find_prompt').row();
  }
  return kb;
}

function makersSummary() {
  const makers = getAllMakers();
  const active = makers.filter(m => m.status === 'active').length;
  const pending = makers.filter(m => m.status === 'pending').length;
  const items = makers.reduce((sum, m) => sum + (m.items_count || 0), 0);
  return `активных ${active}, на рассмотрении ${pending}, позиций ${items}`;
}

function adminMainText() {
  const userStats = getUsersStatistics();
  const makers = getAllMakers();
  const active = makers.filter(m => m.status === 'active').length;
  const pending = makers.filter(m => m.status === 'pending').length;
  let text = (
    `👑 *Админ-панель*\n\n` +
    `👥 Жильцов: *${userStats.total}* · активных за сутки: *${userStats.active24h}*\n` +
    `🧺 Мастеров: *${active}*` + (pending ? ` · ⏳ заявок: *${pending}*` : '') + '\n'
  );
  if (config.preordersEnabled) {
    const activePlaces = getActivePlaces();
    text += `🏪 Принимают заказы: ${activePlaces.length ? activePlaces.map(p => escapeMarkdown(p.name)).join(', ') : 'все на паузе'}\n`;
  }
  return text;
}

// Админка живёт в одном сообщении, как и остальной бот
async function showAdminMain(ctx) {
  await renderScreen(ctx, adminMainText(), { parse_mode: 'Markdown', reply_markup: adminMenuKeyboard() });
}

// 1. Главная команда /admin — доступна ТОЛЬКО администраторам
adminComposer.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return; // для остальных команды словно не существует
  await showAdminMain(ctx);
});

adminComposer.callbackQuery('admin:main', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  await ctx.answerCallbackQuery();
  await showAdminMain(ctx);
});

// 2. Раздел: 📊 Статистика
adminComposer.callbackQuery('admin:stats', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  await ctx.answerCallbackQuery();

  const userStats = getUsersStatistics();
  const orderStats = getOrdersStatistics();

  const routeNames = {
    '200c': '🚌 Автобус 200С',
    '200dc': '🚌 Автобус 200дС',
    '1222tk': '🚐 Маршрутка 1222-ТК',
  };

  let pinsBreakdown = '';
  if (userStats.pinsByRoute && userStats.pinsByRoute.length > 0) {
    const list = userStats.pinsByRoute
      .map(p => `  • ${routeNames[p.route_id] || p.route_id}: *${p.count}*`)
      .join('\n');
    pinsBreakdown = `\n${list}`;
  } else {
    pinsBreakdown = ' _(пока нет закрепов)_';
  }

  const text = (
    `📊 *Сводная аналитика (Зелёная Гавань)*\n\n` +
    `👥 *Жильцы (Пользователи бота):*\n` +
    `• Всего в базе: *${userStats.total}* чел.\n` +
    `• Новых за сегодня: *${userStats.today}*\n` +
    `• Новых за 7 дней: *${userStats.week}*\n` +
    `• Активных за последние 24ч: *${userStats.active24h}*\n\n` +
    `📌 *Закреплённые расписания в чатах:*\n` +
    `• Всего закреплено: *${userStats.totalPins}*${pinsBreakdown}\n\n` +
    (config.preordersEnabled ? (
    `☕️ *Сервис предзаказов:*\n` +
    `• Сегодня: заказов — *${orderStats.today.total_count}*, сумма — *${orderStats.today.total_revenue} BYN*\n` +
    `  _(выдано: ${orderStats.today.issued_count}, отменено: ${orderStats.today.cancelled_count})_\n` +
    `• За 7 дней: *${orderStats.week.total_count}* заказов (${orderStats.week.total_revenue} BYN)\n` +
    `• За всё время: *${orderStats.allTime.total_count}* заказов (${orderStats.allTime.total_revenue} BYN)\n\n` +
    `⚡️ *Сейчас в работе:*\n` +
    `• Ожидают принятия кухней: *${orderStats.active.sent_count || 0}*\n` +
    `• Готовятся: *${orderStats.active.accepted_count || 0}*\n` +
    `• Готовы к выдаче жильцу: *${orderStats.active.ready_count || 0}*`
    ) : `🧺 *Мастера:* ${makersSummary()}`)
  );

  const keyboard = new InlineKeyboard()
    .text('🔄 Обновить цифры', 'admin:stats').row()
    .text('◀️ Назад', 'admin:main');

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
});

// 3. Раздел: ⏸ Пауза / Приём заказов
adminComposer.callbackQuery('admin:places_pause', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  await ctx.answerCallbackQuery();

  const places = getAllPlaces();
  const keyboard = new InlineKeyboard();

  for (const p of places) {
    const statusEmoji = p.is_active ? '🟢 Принимает' : '🔴 На паузе';
    const actionLabel = p.is_active ? 'Поставить на паузу' : 'Возобновить';
    keyboard.text(`${statusEmoji} «${p.name}» — [${actionLabel}]`, `admin:toggle_place:${p.id}`).row();
  }

  keyboard.text('◀️ Назад', 'admin:main');

  const text = (
    `⏸ *Управление приёмом заказов (Panic Button)*\n\n` +
    `Если на кухне завал или форс-мажор, нажмите кнопку нужной точки, чтобы временно приостановить приём новых предзаказов.\n\n` +
    `*Текущий статус заведений:*`
  );

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
});

// Переключение паузы заведения
adminComposer.callbackQuery(/^admin:toggle_place:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  const placeId = Number(ctx.match[1]);

  const updatedPlace = togglePlaceActive(placeId);
  if (!updatedPlace) {
    return ctx.answerCallbackQuery({ text: 'Заведение не найдено', show_alert: true });
  }

  const alertText = updatedPlace.is_active
    ? `🟢 «${updatedPlace.name}» снова принимает заказы!`
    : `🔴 «${updatedPlace.name}» поставлена на паузу! Новые заказы заблокированы.`;

  await ctx.answerCallbackQuery({ text: alertText });

  // Перерисовываем список
  const places = getAllPlaces();
  const keyboard = new InlineKeyboard();

  for (const p of places) {
    const statusEmoji = p.is_active ? '🟢 Принимает' : '🔴 На паузе';
    const actionLabel = p.is_active ? 'Поставить на паузу' : 'Возобновить';
    keyboard.text(`${statusEmoji} «${p.name}» — [${actionLabel}]`, `admin:toggle_place:${p.id}`).row();
  }
  keyboard.text('◀️ Назад', 'admin:main');

  const text = (
    `⏸ *Управление приёмом заказов (Panic Button)*\n\n` +
    `Статус точки «${updatedPlace.name}» успешно изменён на: *${updatedPlace.is_active ? '🟢 Принимает' : '🔴 На паузе'}*.\n\n` +
    `*Текущий статус заведений:*`
  );

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
});

// 4. Раздел: 🚫 Стоп-лист меню
adminComposer.callbackQuery('admin:stop_list', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  await ctx.answerCallbackQuery();

  const places = getAllPlaces();
  if (places.length === 0) {
    return ctx.editMessageText('Заведений не найдено.', {
      reply_markup: new InlineKeyboard().text('◀️ Назад', 'admin:main'),
    });
  }

  // Если заведение одно, сразу открываем его стоп-лист
  const activePlace = places.find(p => p.is_active) || places[0];
  const items = getPlaceItems(activePlace.id, { onlyAvailable: false });

  const keyboard = new InlineKeyboard();
  for (const item of items) {
    const icon = item.is_available ? '🟢' : '🔴 СТОП:';
    keyboard.text(`${icon} ${item.name} (${formatPrice(item.price)})`, `admin:toggle_item:${item.id}`).row();
  }
  keyboard.text('◀️ Назад', 'admin:main');

  const text = (
    `🚫 *Стоп-лист меню: «${activePlace.name}»*\n\n` +
    `Нажмите на блюдо, чтобы моментально скрыть его из меню для жильцов (если закончились ингредиенты) или вернуть обратно:\n\n` +
    `🟢 — доступно для заказа\n` +
    `🔴 СТОП — скрыто из корзины`
  );

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
});

// Переключение блюда в стоп-листе
adminComposer.callbackQuery(/^admin:toggle_item:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  const itemId = Number(ctx.match[1]);

  const updatedItem = toggleItemAvailability(itemId);
  if (!updatedItem) {
    return ctx.answerCallbackQuery({ text: 'Позиция не найдена', show_alert: true });
  }

  const alertText = updatedItem.is_available
    ? `🟢 «${updatedItem.name}» снова доступна в меню!`
    : `🔴 «${updatedItem.name}» добавлена в стоп-лист (скрыта)!`;

  await ctx.answerCallbackQuery({ text: alertText });

  // Перерисовываем список
  const items = getPlaceItems(updatedItem.place_id, { onlyAvailable: false });
  const keyboard = new InlineKeyboard();
  for (const item of items) {
    const icon = item.is_available ? '🟢' : '🔴 СТОП:';
    keyboard.text(`${icon} ${item.name} (${formatPrice(item.price)})`, `admin:toggle_item:${item.id}`).row();
  }
  keyboard.text('◀️ Назад', 'admin:main');

  const text = (
    `🚫 *Стоп-лист меню: «${updatedItem.place_name}»*\n\n` +
    `Нажмите на блюдо, чтобы моментально переключить доступность:\n\n` +
    `🟢 — доступно для заказа\n` +
    `🔴 СТОП — скрыто из корзины`
  );

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
});

// 5. Раздел: 📢 Рассылка жильцам
adminComposer.callbackQuery('admin:broadcast_prompt', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  await ctx.answerCallbackQuery();

  const usersCount = getTotalUsersCount();
  setPendingInput(ctx.from.id, 'admin_broadcast');

  const text = (
    `📢 *Рассылка жильцам*\n\n` +
    `👥 Получателей: *${usersCount}*\n\n` +
    `Пришлите текст объявления следующим сообщением. Сразу ничего не отправится: сначала покажу предпросмотр, ` +
    `там же можно прикрепить кнопку подборки.`
  );
  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: new InlineKeyboard().text('✖️ Отмена', 'admin:main') });
});

// Текст рассылки, присланный после кнопки «📢 Рассылка»
adminComposer.on('message:text', async (ctx, next) => {
  if (ctx.chat?.type !== 'private' || !isAdmin(ctx.from?.id) || ctx.message.text.startsWith('/')) return next();
  if (!getPendingInput(ctx.from.id, 'admin_broadcast')) return next();
  clearPendingInput(ctx.from.id);
  const draftId = `draft_${Date.now()}`;
  broadcastDrafts.set(draftId, { text: ctx.message.text.trim(), collectionId: null, createdAt: Date.now() });
  const { text, keyboard } = broadcastPreview(draftId);
  await renderScreen(ctx, text, { parse_mode: 'Markdown', reply_markup: keyboard });
});

// Обработка команды /broadcast с текстом
adminComposer.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;

  const messageText = ctx.match?.trim();
  if (!messageText) {
    return ctx.reply(
      `✍️ *Как сделать рассылку:*\n\n` +
      `Напишите команду и через пробел текст:\n` +
      `\`/broadcast Привет, жильцы! Сегодня скидка 10% на всю выпечку.\``,
      { parse_mode: 'Markdown' }
    );
  }

  const draftId = `draft_${Date.now()}`;
  broadcastDrafts.set(draftId, { text: messageText, collectionId: null, createdAt: Date.now() });

  const { text, keyboard } = broadcastPreview(draftId);
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
});

// Предпросмотр рассылки: текст + по желанию кнопка «Открыть подборку» (выбирается из видимых подборок)
function broadcastPreview(draftId) {
  const draft = broadcastDrafts.get(draftId);
  const usersCount = getTotalUsersCount();
  const collection = draft.collectionId ? getCollection(draft.collectionId) : null;

  const text = (
    `📢 *ПРЕДПРОСМОТР РАССЫЛКИ*\n\n` +
    `👥 *Получателей:* ${usersCount} чел. (все запустившие бота)\n\n` +
    `*Текст сообщения для жильцов:*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${draft.text}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔘 *Кнопка под сообщением:* ${collection ? `«👀 Открыть подборку» → ${escapeMarkdown(collection.title)}` : 'без кнопки'}\n\n` +
    `Отправить это сообщение всем жильцам?`
  );

  const keyboard = new InlineKeyboard();
  const collections = getVisibleCollections();
  for (const c of collections) {
    const on = draft.collectionId === c.id;
    keyboard.text(`${on ? '☑️' : '⬜'} Кнопка: ${c.title}`, `admin:broadcast_col:${draftId}:${c.id}`).row();
  }
  if (collections.length && draft.collectionId) {
    keyboard.text('⬜ Без кнопки', `admin:broadcast_col:${draftId}:0`).row();
  }
  keyboard
    .text(`🚀 Отправить всем (${usersCount} чел.)`, `admin:broadcast_send:${draftId}`).row()
    .text('❌ Отменить', `admin:broadcast_cancel:${draftId}`);
  return { text, keyboard };
}

adminComposer.callbackQuery(/^admin:broadcast_col:(draft_\d+):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  const draft = broadcastDrafts.get(ctx.match[1]);
  if (!draft) return ctx.answerCallbackQuery({ text: 'Срок действия черновика истёк', show_alert: true });
  const id = Number(ctx.match[2]);
  draft.collectionId = id && getCollection(id) ? id : null;
  await ctx.answerCallbackQuery();
  const { text, keyboard } = broadcastPreview(ctx.match[1]);
  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {});
});

// Подтверждение отправки рассылки
adminComposer.callbackQuery(/^admin:broadcast_send:(draft_\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  const draftId = ctx.match[1];
  const draft = broadcastDrafts.get(draftId);

  if (!draft) {
    return ctx.answerCallbackQuery({ text: 'Срок действия черновика истёк', show_alert: true });
  }

  await ctx.answerCallbackQuery({ text: '🚀 Рассылка запущена...' });
  await ctx.editMessageText('⏳ *Идёт отправка сообщений жильцам...*', { parse_mode: 'Markdown' });

  const userIds = getAllUserIds();
  let successCount = 0;
  let failCount = 0;
  const collection = draft.collectionId ? getCollection(draft.collectionId) : null;
  const replyMarkup = collection
    ? new InlineKeyboard().text('👀 Открыть подборку', `mk:col:${collection.id}`)
    : undefined;

  for (const uid of userIds) {
    try {
      await ctx.api.sendMessage(uid, draft.text, { parse_mode: 'Markdown', reply_markup: replyMarkup });
      successCount++;
    } catch {
      failCount++;
    }
  }

  broadcastDrafts.delete(draftId);

  const resultText = (
    `✅ *Рассылка успешно завершена!*\n\n` +
    `📬 Доставлено: *${successCount}*\n` +
    `❌ Не доставлено (бот заблокирован): *${failCount}*\n` +
    `👥 Всего в базе: *${userIds.length}*`
  );

  const keyboard = new InlineKeyboard().text('◀️ Назад', 'admin:main');
  await renderScreen(ctx, resultText, { parse_mode: 'Markdown', reply_markup: keyboard });
});

// Отмена рассылки
adminComposer.callbackQuery(/^admin:broadcast_cancel:(draft_\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  const draftId = ctx.match[1];
  broadcastDrafts.delete(draftId);

  await ctx.answerCallbackQuery({ text: 'Рассылка отменена' });
  await ctx.editMessageText('❌ *Рассылка отменена.* Сообщение не было отправлено.', {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard().text('◀️ Назад', 'admin:main'),
  });
});

// 6. Раздел: 🔍 Поиск заказа
adminComposer.callbackQuery('admin:find_prompt', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  await ctx.answerCallbackQuery();

  const text = (
    `🔍 *Поиск и управление заказом*\n\n` +
    `Чтобы найти любой заказ и при необходимости отменить его, отправьте команду:\n` +
    `\`/order НомерЗаказа\`\n\n` +
    `*Примеры:*\n` +
    `\`/order 105\`\n` +
    `\`/order TEST-990\``
  );

  const keyboard = new InlineKeyboard().text('◀️ Назад', 'admin:main');

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
});

// Обработка команды /order <код>
adminComposer.command('order', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;

  const query = ctx.match?.trim();
  if (!query) {
    return ctx.reply('Укажите номер заказа: `/order 105`', { parse_mode: 'Markdown' });
  }

  const order = getOrderByCodeOrId(query);
  if (!order) {
    return ctx.reply(`❌ Заказ с номером *«${query}»* не найден в базе данных.`, { parse_mode: 'Markdown' });
  }

  const clientName = escapeMarkdown(order.first_name || 'Жилец');
  const clientUsername = order.username ? `(@${escapeMarkdown(order.username)})` : '';
  let text = `📦 *ДЕТАЛИ ЗАКАЗА ${order.order_code}*\n\n`;
  text += `🏪 *Заведение:* ${escapeMarkdown(order.place_name)}\n`;
  text += `👤 *Клиент:* ${clientName} ${clientUsername} (ID: \`${order.user_id}\`)\n`;
  text += `⏱ *Время выдачи:* ${order.desired_time}\n`;
  text += `📍 *Точка выдачи:* ${order.pickup_point}\n`;
  text += `📊 *Статус:* *${order.status.toUpperCase()}*\n`;
  text += `📅 *Создан:* ${order.created_at}\n\n`;
  text += `*Состав:*\n`;
  for (const item of order.items) {
    text += `• ${item.item_name} × ${item.quantity} = ${formatPrice(item.subtotal)}\n`;
  }
  text += `\n💵 *Итого:* *${formatPrice(order.total_price)}*`;

  const keyboard = new InlineKeyboard();
  if (!['issued', 'cancelled', 'expired', 'no_show'].includes(order.status)) {
    keyboard.text('❌ Принудительно отменить заказ', `admin:cancel_order:${order.id}`).row();
  }
  keyboard.text('◀️ Назад', 'admin:main');

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Принудительная отмена заказа администратором
adminComposer.callbackQuery(/^admin:cancel_order:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  const orderId = Number(ctx.match[1]);

  const order = getOrderByCodeOrId(orderId);
  if (!order) {
    return ctx.answerCallbackQuery({ text: 'Заказ не найден', show_alert: true });
  }

  const success = cancelOrderByAdmin(orderId, ctx.from.id);
  if (!success) {
    return ctx.answerCallbackQuery({ text: 'Заказ уже выдан или отменён', show_alert: true });
  }

  await ctx.answerCallbackQuery({ text: `Заказ ${order.order_code} успешно отменён!` });

  // Уведомляем клиента в личные сообщения
  try {
    await ctx.api.sendMessage(
      order.user_id,
      `❌ *Ваш заказ ${order.order_code} был отменён администратором.*\n\n` +
      `🏪 Заведение: «${order.place_name}»\n` +
      `Если у вас возникли вопросы, свяжитесь с поддержкой ЖК.`,
      { parse_mode: 'Markdown' }
    );
  } catch {
    // Клиент мог заблокировать бота
  }

  // Уведомляем группу заведения, если чат привязан
  if (order.group_chat_id) {
    try {
      await ctx.api.sendMessage(
        order.group_chat_id,
        `⚠️ *Заказ ${order.order_code} отменён администратором сервиса!* Готовить не требуется.`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      // Игнорируем ошибки чата
    }
  }

  await ctx.reply(`✅ *Заказ ${order.order_code} принудительно отменён.* Уведомления клиенту и заведению отправлены.`, {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard().text('◀️ Назад', 'admin:main'),
  });
});

// Ручной запуск проверки и обновления расписания транспорта
adminComposer.callbackQuery('admin:update_transport', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  await ctx.answerCallbackQuery({ text: 'Проверяем расписание на портале...' });

  await ctx.editMessageText('⏳ *Проверяю расписание на kogda.by (Минсктранс)...*', { parse_mode: 'Markdown' }).catch(() => {});

  const res = await checkAndUpdateTransportSchedules(ctx.api);

  let replyText = '';
  if (res.updated) {
    replyText = (
      `✅ *Расписание успешно обновлено!*\n\n` +
      `Обнаружены и внесены следующие изменения:\n\n` +
      res.changes.join('\n\n')
    );
  } else if (res.error) {
    replyText = `⚠️ *Ошибка при проверке:* ${res.error}\n_Прежнее расписание оставлено без изменений._`;
  } else {
    replyText = `✅ *Расписание актуально!* Изменений на портале не обнаружено. Все рейсы совпадают с текущими данными бота.`;
  }

  await renderScreen(ctx, replyText, {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard()
      .text('🚌 Посмотреть расписание', 'transport:menu').row()
      .text('◀️ Назад', 'admin:main'),
  });
});

adminComposer.command('update_transport', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;
  const res = await checkAndUpdateTransportSchedules(ctx.api);
  if (res.updated) {
    await ctx.reply(`✅ Расписание обновлено:\n\n${res.changes.join('\n')}`);
  } else if (res.error) {
    await ctx.reply(`⚠️ Ошибка: ${res.error}`);
  } else {
    await ctx.reply('✅ Расписание проверено: изменений нет, всё актуально.');
  }
});

