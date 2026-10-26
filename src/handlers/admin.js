import { Composer, InlineKeyboard } from 'grammy';
import { isAdmin } from '../../config.js';
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
import { getTotalUsersCount, getAllUserIds } from '../db/repositories/users.js';
import { escapeMarkdown } from '../utils/text.js';
import { checkAndUpdateTransportSchedules } from '../jobs/transportUpdater.js';

export const adminComposer = new Composer();

// Временное хранилище черновиков рассылок перед подтверждением
const broadcastDrafts = new Map();

// Главная клавиатура панели администратора
function adminMenuKeyboard() {
  return new InlineKeyboard()
    .text('📊 Статистика и заказы', 'admin:stats').row()
    .text('⏸ Приём заказов (Пауза/Пуск)', 'admin:places_pause').row()
    .text('🚫 Стоп-лист меню', 'admin:stop_list').row()
    .text('🚌 Обновить расписание транспорта', 'admin:update_transport').row()
    .text('📢 Рассылка жильцам ЖК', 'admin:broadcast_prompt').row()
    .text('🔍 Найти заказ по номеру', 'admin:find_prompt');
}

// 1. Главная команда /admin — доступна ТОЛЬКО администраторам
adminComposer.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) {
    // Для не-админов ничего не выдаем, команда словно не существует
    return;
  }

  const usersCount = getTotalUsersCount();
  const activePlaces = getActivePlaces();

  const text = (
    `👑 *Панель администратора сервиса предзаказов*\n\n` +
    `👤 *Администратор:* ${ctx.from.first_name} (ID: \`${ctx.from.id}\`)\n` +
    `👥 *Пользователей в базе:* ${usersCount} чел.\n` +
    `🏪 *Активных точек:* ${activePlaces.length > 0 ? activePlaces.map(p => p.name).join(', ') : 'Все на паузе'}\n\n` +
    `Выберите раздел управления:`
  );

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: adminMenuKeyboard(),
  });
});

// Возврат в главное меню админки через кнопку
adminComposer.callbackQuery('admin:main', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  await ctx.answerCallbackQuery();

  const usersCount = getTotalUsersCount();
  const activePlaces = getActivePlaces();

  const text = (
    `👑 *Панель администратора сервиса предзаказов*\n\n` +
    `👤 *Администратор:* ${ctx.from.first_name} (ID: \`${ctx.from.id}\`)\n` +
    `👥 *Пользователей в базе:* ${usersCount} чел.\n` +
    `🏪 *Активных точек:* ${activePlaces.length > 0 ? activePlaces.map(p => p.name).join(', ') : 'Все на паузе'}\n\n` +
    `Выберите раздел управления:`
  );

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: adminMenuKeyboard(),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: adminMenuKeyboard(),
    });
  }
});

// 2. Раздел: 📊 Статистика
adminComposer.callbackQuery('admin:stats', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  await ctx.answerCallbackQuery();

  const stats = getOrdersStatistics();
  const usersCount = getTotalUsersCount();

  const text = (
    `📊 *Сводка сервиса предзаказов (Зелёная Гавань)*\n\n` +
    `👥 *Жильцов в боте:* ${usersCount} чел.\n\n` +
    `📅 *Сегодня:*\n` +
    `• Оформлено заказов: *${stats.today.total_count}*\n` +
    `• Выручка: *${stats.today.total_revenue} ₽*\n` +
    `• Успешно выдано: ${stats.today.issued_count}\n` +
    `• Отменено: ${stats.today.cancelled_count}\n\n` +
    `📈 *За последние 7 дней:*\n` +
    `• Заказов: *${stats.week.total_count}*\n` +
    `• Выручка: *${stats.week.total_revenue} ₽*\n\n` +
    `🏆 *За всё время:*\n` +
    `• Всего предзаказов: *${stats.allTime.total_count}*\n` +
    `• Суммарный оборот: *${stats.allTime.total_revenue} ₽*\n` +
    `• Завершено (выдано): ${stats.allTime.issued_count}\n\n` +
    `⚡️ *Сейчас в процессе:*\n` +
    `• Ожидают принятия кухней: ${stats.active.sent_count || 0}\n` +
    `• Готовятся: ${stats.active.accepted_count || 0}\n` +
    `• Ждут выдачи жильцу: ${stats.active.ready_count || 0}`
  );

  const keyboard = new InlineKeyboard()
    .text('🔄 Обновить цифры', 'admin:stats').row()
    .text('◀️ В админ-меню', 'admin:main');

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

  keyboard.text('◀️ В админ-меню', 'admin:main');

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
  keyboard.text('◀️ В админ-меню', 'admin:main');

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
      reply_markup: new InlineKeyboard().text('◀️ В админ-меню', 'admin:main'),
    });
  }

  // Если заведение одно, сразу открываем его стоп-лист
  const activePlace = places.find(p => p.is_active) || places[0];
  const items = getPlaceItems(activePlace.id, { onlyAvailable: false });

  const keyboard = new InlineKeyboard();
  for (const item of items) {
    const icon = item.is_available ? '🟢' : '🔴 СТОП:';
    keyboard.text(`${icon} ${item.name} (${item.price} ₽)`, `admin:toggle_item:${item.id}`).row();
  }
  keyboard.text('◀️ В админ-меню', 'admin:main');

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
    keyboard.text(`${icon} ${item.name} (${item.price} ₽)`, `admin:toggle_item:${item.id}`).row();
  }
  keyboard.text('◀️ В админ-меню', 'admin:main');

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

  const text = (
    `📢 *Рассылка сообщений жителям ЖК*\n\n` +
    `👥 Всего получателей в базе: *${usersCount} чел.*\n\n` +
    `Чтобы создать рассылку, отправьте команду:\n` +
    `\`/broadcast Текст вашего объявления\`\n\n` +
    `*Пример:*\n` +
    `\`/broadcast 🍕 Привет! Сегодня в пиццерии «Кава ля печы» свежая римская пицца из печи. Заказывайте к ужину без очереди!\`\n\n` +
    `💡 *Бот НЕ отправит сообщение сразу!* Сначала он покажет вам *Предпросмотр* с кнопками «Отправить» и «Отмена».`
  );

  const keyboard = new InlineKeyboard().text('◀️ В админ-меню', 'admin:main');

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
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

  const usersCount = getTotalUsersCount();
  const draftId = `draft_${Date.now()}`;
  broadcastDrafts.set(draftId, { text: messageText, createdAt: Date.now() });

  const previewCard = (
    `📢 *ПРЕДПРОСМОТР РАССЫЛКИ*\n\n` +
    `👥 *Получателей:* ${usersCount} чел. (все запустившие бота)\n\n` +
    `*Текст сообщения для жильцов:*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${messageText}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Отправить это сообщение всем жильцам?`
  );

  const keyboard = new InlineKeyboard()
    .text(`🚀 Отправить всем (${usersCount} чел.)`, `admin:broadcast_send:${draftId}`).row()
    .text('❌ Отменить', `admin:broadcast_cancel:${draftId}`);

  await ctx.reply(previewCard, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
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

  for (const uid of userIds) {
    try {
      await ctx.api.sendMessage(uid, draft.text, { parse_mode: 'Markdown' });
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

  const keyboard = new InlineKeyboard().text('◀️ В админ-меню', 'admin:main');
  await ctx.reply(resultText, { parse_mode: 'Markdown', reply_markup: keyboard });
});

// Отмена рассылки
adminComposer.callbackQuery(/^admin:broadcast_cancel:(draft_\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  const draftId = ctx.match[1];
  broadcastDrafts.delete(draftId);

  await ctx.answerCallbackQuery({ text: 'Рассылка отменена' });
  await ctx.editMessageText('❌ *Рассылка отменена.* Сообщение не было отправлено.', {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard().text('◀️ В админ-меню', 'admin:main'),
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

  const keyboard = new InlineKeyboard().text('◀️ В админ-меню', 'admin:main');

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
    text += `• ${item.item_name} × ${item.quantity} = ${item.subtotal} ₽\n`;
  }
  text += `\n💵 *Итого:* *${order.total_price} ₽*`;

  const keyboard = new InlineKeyboard();
  if (order.status !== 'issued' && order.status !== 'cancelled') {
    keyboard.text('❌ Принудительно отменить заказ', `admin:cancel_order:${order.id}`).row();
  }
  keyboard.text('◀️ В админ-меню', 'admin:main');

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
    reply_markup: new InlineKeyboard().text('◀️ В админ-меню', 'admin:main'),
  });
});

// Ручной запуск проверки и обновления расписания транспорта
adminComposer.callbackQuery('admin:update_transport', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  await ctx.answerCallbackQuery({ text: 'Проверяем расписание на портале...' });

  const waitMsg = await ctx.reply('⏳ *Выполняется синхронизация расписания с порталом Колодищи/Минсктранс...*', {
    parse_mode: 'Markdown',
  });

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

  try {
    await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id);
  } catch {}

  await ctx.reply(replyText, {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard()
      .text('🚌 Посмотреть расписание', 'transport:menu').row()
      .text('◀️ В админ-меню', 'admin:main'),
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

