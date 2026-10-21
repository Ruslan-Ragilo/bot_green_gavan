import { Composer, InlineKeyboard } from 'grammy';
import {
  getAllPlaces,
  getActivePlaces,
  getPlaceById,
  getPlaceByGroupId,
  linkPlaceToGroup,
  createPlace,
  updatePlaceInfo,
  addItem,
  deleteItem,
  findItemInPlace,
  getPlaceItems,
} from '../db/repositories/places.js';
import { addStaffMember, isStaffMember, getPlaceStaffList } from '../db/repositories/staff.js';
import { createTestOrder, setOrderGroupMessageId } from '../db/repositories/orders.js';
import { staffOrderKeyboard } from '../keyboards/staff.js';
import { isAdmin } from '../../config.js';
import { escapeMarkdown } from '../utils/text.js';

export const setupComposer = new Composer();

// Вспомогательная функция сборки клавиатуры выбора заведений для группы
function buildSetupKeyboard(chatId) {
  const places = getAllPlaces();
  const linkedPlace = getPlaceByGroupId(chatId);
  const keyboard = new InlineKeyboard();

  for (const p of places) {
    if (linkedPlace && linkedPlace.id === p.id) {
      keyboard.text(`✅ ${p.name} (подключено)`, `setup:manage:${p.id}`).row();
    } else {
      keyboard.text(`🔗 Подключить: ${p.name}`, `setup:link:${p.id}`).row();
    }
  }

  keyboard.text('➕ Создать новое заведение', 'setup:new_prompt').row();

  if (linkedPlace) {
    keyboard.text('🧪 Отправить тестовый заказ', `setup:test_order:${linkedPlace.id}`).row();
    keyboard.text('👨‍🍳 Я сотрудник (получить доступ)', `setup:join_staff:${linkedPlace.id}`).row();
  }

  return { keyboard, linkedPlace, places };
}

// 1. Приветствие при добавлении бота в новую группу
setupComposer.on('my_chat_member', async (ctx) => {
  const status = ctx.myChatMember?.new_chat_member?.status;
  if (status === 'member' || status === 'administrator') {
    await ctx.reply(
      `👋 *Привет! Я бот предзаказов для жителей Зелёной Гавани.*\n\n` +
      `Чтобы эта группа начала принимать заказы от жильцов в 1 клик, отправьте команду:\n` +
      `/setup_place`,
      { parse_mode: 'Markdown' }
    );
  }
});

setupComposer.on(':new_chat_members', async (ctx) => {
  const newMembers = ctx.message?.new_chat_members || [];
  const isBotAdded = newMembers.some((m) => m.id === ctx.me.id);
  if (isBotAdded) {
    await ctx.reply(
      `👋 *Привет! Я бот предзаказов для жителей Зелёной Гавани.*\n\n` +
      `Чтобы эта группа начала принимать заказы от жильцов в 1 клик, отправьте команду:\n` +
      `/setup_place`,
      { parse_mode: 'Markdown' }
    );
  }
});

// 2. Команда /setup_place и /setup
setupComposer.command(['setup_place', 'setup'], async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';

  if (!isGroup) {
    return ctx.reply(
      `ℹ️ *Подключение рабочего чата заведения к боту*\n\n` +
      `1. Создайте группу в Telegram для кухни / администратора (или откройте существующую).\n` +
      `2. Добавьте в неё этого бота.\n` +
      `3. Напишите прямо в группе команду: `/setup_place`.\n\n` +
      `Бот предложит выбрать точку из списка или создать новую за 30 секунд.`,
      { parse_mode: 'Markdown' }
    );
  }

  const { keyboard, linkedPlace } = buildSetupKeyboard(ctx.chat.id);

  let text = `⚙️ *Настройка приёма заказов в этой группе*\n\n`;
  text += `🆔 *ID чата:* \`${ctx.chat.id}\`\n`;
  if (linkedPlace) {
    text += `📍 *Текущая привязка:* *«${linkedPlace.name}»* (${linkedPlace.is_active ? '🟢 активна' : '⚪ неактивна'})\n`;
    text += `🏢 *Точка выдачи:* ${linkedPlace.pickup_point}\n\n`;
    text += `Вы можете переключить группу на другое заведение или отправить тестовый заказ:`;
  } else {
    text += `📍 *Текущая привязка:* _Пока не подключено_\n\n`;
    text += `Выберите заведение из списка ниже или создайте новое:`;
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// 3. Меню возврата к списку заведений
setupComposer.callbackQuery('setup:menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  const { keyboard, linkedPlace } = buildSetupKeyboard(ctx.chat.id);

  let text = `⚙️ *Настройка приёма заказов в этой группе*\n\n`;
  text += `🆔 *ID чата:* \`${ctx.chat.id}\`\n`;
  if (linkedPlace) {
    text += `📍 *Текущая привязка:* *«${linkedPlace.name}»*\n\n`;
  }
  text += `Выберите заведение для привязки:`;

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
});

// 4. Привязка выбранного заведения к группе
setupComposer.callbackQuery(/^setup:link:(\d+)$/, async (ctx) => {
  const placeId = Number(ctx.match[1]);
  const place = getPlaceById(placeId);

  if (!place) {
    return ctx.answerCallbackQuery({ text: 'Заведение не найдено', show_alert: true });
  }

  // Привязываем группу и активируем заведение как основное
  const updatedPlace = linkPlaceToGroup(placeId, ctx.chat.id, { makeExclusive: true });

  // Автоматически добавляем пользователя, нажавшего кнопку, в персонал
  const userName = ctx.from.first_name || ctx.from.username || 'Администратор';
  addStaffMember(placeId, ctx.from.id, userName, 'admin');

  await ctx.answerCallbackQuery({ text: `Успешно подключено к «${place.name}»!` });

  const keyboard = new InlineKeyboard()
    .text('🧪 Отправить тестовый заказ', `setup:test_order:${place.id}`).row()
    .text('👨‍🍳 Я сотрудник (получить доступ)', `setup:join_staff:${place.id}`).row()
    .text('👥 Список сотрудников', `setup:staff_list:${place.id}`).row()
    .text('◀️ Меню заведений', 'setup:menu');

  const text = (
    `🎉 *Группа успешно подключена к заведению!*\n\n` +
    `🏪 *Заведение:* «${updatedPlace.name}»\n` +
    `📍 *Точка выдачи:* ${updatedPlace.pickup_point}\n` +
    `🆔 *ID чата:* \`${ctx.chat.id}\`\n` +
    `👤 *Администратор:* ${ctx.from.first_name} ${ctx.from.username ? `(@${ctx.from.username})` : ''}\n\n` +
    `⚡️ *Что теперь работает:*\n` +
    `• Все новые заказы жильцов на «${updatedPlace.name}» будут мгновенно приходить в этот чат.\n` +
    `• Сотрудники смогут менять статус заказов кнопками прямо в группе («Принять», «Готов», «Выдан»).\n\n` +
    `👇 *Проверьте работу:* нажмите кнопку ниже, чтобы отправить тестовый заказ!`
  );

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
});

// 5. Управление уже привязанным заведением
setupComposer.callbackQuery(/^setup:manage:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const placeId = Number(ctx.match[1]);
  const place = getPlaceById(placeId);

  if (!place) {
    return ctx.answerCallbackQuery({ text: 'Заведение не найдено', show_alert: true });
  }

  const keyboard = new InlineKeyboard()
    .text('🧪 Отправить тестовый заказ', `setup:test_order:${place.id}`).row()
    .text('👨‍🍳 Я сотрудник (получить доступ)', `setup:join_staff:${place.id}`).row()
    .text('👥 Список сотрудников', `setup:staff_list:${place.id}`).row()
    .text('◀️ Назад', 'setup:menu');

  const text = (
    `🏪 *Управление заведением «${place.name}»*\n\n` +
    `📍 *Точка выдачи:* ${place.pickup_point}\n` +
    `🆔 *ID чата:* \`${ctx.chat.id}\`\n` +
    `📊 *Статус:* ${place.is_active ? '🟢 Активно (принимает заказы)' : '⚪ Неактивно'}\n\n` +
    `Команды для изменения текстом:\n` +
    `• \`/edit_place address Новый адрес точки выдачи\`\n` +
    `• \`/edit_place name Новое название точки\``
  );

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
});

// 6. Отправка реального тестового заказа в чат
setupComposer.callbackQuery(/^setup:test_order:(\d+)$/, async (ctx) => {
  const placeId = Number(ctx.match[1]);
  const place = getPlaceById(placeId);

  if (!place) {
    return ctx.answerCallbackQuery({ text: 'Заведение не найдено', show_alert: true });
  }

  // Создаем тестовый заказ
  const order = createTestOrder({ placeId, user: ctx.from });

  const clientName = escapeMarkdown(order.first_name || 'Жилец');
  const clientUsername = order.username ? `(@${escapeMarkdown(order.username)})` : '';
  const staffCardText = (
    `🔔 *ТЕСТОВЫЙ ЗАКАЗ ${order.order_code}*\n\n` +
    `👤 *Клиент:* ${clientName} ${clientUsername}\n` +
    `⏱ *Время получения:* ${escapeMarkdown(order.desired_time)}\n` +
    `📍 *Точка выдачи:* ${escapeMarkdown(order.pickup_point)}\n\n` +
    `*Позиции:*\n` +
    order.items.map(i => `• ${escapeMarkdown(i.item_name)} × ${i.quantity} = ${i.price * i.quantity} ₽`).join('\n') +
    `\n\n💵 *Итого:* *${order.total_price} ₽*\n` +
    `Статус: 🟡 *Отправлен (ожидает принятия)*`
  );

  try {
    const groupMsg = await ctx.reply(staffCardText, {
      parse_mode: 'Markdown',
      reply_markup: staffOrderKeyboard(order),
    });
    setOrderGroupMessageId(order.id, groupMsg.message_id);
    await ctx.answerCallbackQuery({ text: '🧪 Тестовый заказ отправлен ниже! Нажмите «Принять», чтобы проверить работу.' });
  } catch (err) {
    console.error('[Error] Ошибка отправки тестового заказа:', err);
    await ctx.answerCallbackQuery({ text: 'Ошибка отправки тестового заказа', show_alert: true });
  }
});

// 7. Быстрое добавление сотрудника через кнопку
setupComposer.callbackQuery(/^setup:join_staff:(\d+)$/, async (ctx) => {
  const placeId = Number(ctx.match[1]);
  const place = getPlaceById(placeId);

  if (!place) {
    return ctx.answerCallbackQuery({ text: 'Заведение не найдено', show_alert: true });
  }

  const userId = ctx.from.id;
  const userName = ctx.from.first_name || ctx.from.username || 'Сотрудник';

  if (isStaffMember(userId, placeId)) {
    return ctx.answerCallbackQuery({
      text: `Вы уже зарегистрированы в персонале «${place.name}»!`,
      show_alert: true,
    });
  }

  addStaffMember(placeId, userId, userName, 'staff');

  await ctx.answerCallbackQuery({
    text: `✅ ${userName}, вы добавлены в персонал «${place.name}»! Теперь вы можете управлять заказами.`,
    show_alert: true,
  });

  await ctx.reply(
    `👋 *${userName}* добавлен в персонал заведения «${place.name}»!`,
    { parse_mode: 'Markdown' }
  );
});

// 8. Команда /iam_staff для быстрой регистрации любого члена группы
setupComposer.command('iam_staff', async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  if (!isGroup) {
    return ctx.reply('Команда /iam_staff работает только в рабочем чате заведения.');
  }

  const place = getPlaceByGroupId(ctx.chat.id);
  if (!place) {
    return ctx.reply(
      'Эта группа пока не привязана ни к одному заведению. Сначала выполните /setup_place.',
      { parse_mode: 'Markdown' }
    );
  }

  const userId = ctx.from.id;
  const userName = ctx.from.first_name || ctx.from.username || 'Сотрудник';

  addStaffMember(place.id, userId, userName, 'staff');
  await ctx.reply(
    `✅ *${userName}*, вы успешно зарегистрированы как сотрудник заведения «${place.name}»!\n` +
    `Теперь кнопки принятия и смены статуса заказов активны для вас.`,
    { parse_mode: 'Markdown' }
  );
});

// 9. Список персонала группы /staff_list
setupComposer.command('staff_list', async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  const place = isGroup ? getPlaceByGroupId(ctx.chat.id) : null;

  if (!place) {
    return ctx.reply('Группа не привязана к заведению. Выполните /setup_place.');
  }

  const staff = getPlaceStaffList(place.id);
  if (staff.length === 0) {
    return ctx.reply(`В заведении «${place.name}» пока нет зарегистрированных сотрудников.`);
  }

  let text = `👥 *Персонал заведения «${place.name}»:*\n\n`;
  for (const s of staff) {
    text += `• ${s.name || 'Сотрудник'} (ID: \`${s.user_id}\`, роль: ${s.role})\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// Callback для списка персонала из инлайн-кнопок
setupComposer.callbackQuery(/^setup:staff_list:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const placeId = Number(ctx.match[1]);
  const place = getPlaceById(placeId);
  if (!place) return;

  const staff = getPlaceStaffList(place.id);
  let text = `👥 *Персонал заведения «${place.name}»:*\n\n`;
  if (staff.length === 0) {
    text += `_Пока никто не зарегистрирован._`;
  } else {
    for (const s of staff) {
      text += `• ${s.name || 'Сотрудник'} (ID: \`${s.user_id}\`, роль: ${s.role})\n`;
    }
  }

  const keyboard = new InlineKeyboard()
    .text('👨‍🍳 Я сотрудник (добавиться)', `setup:join_staff:${place.id}`).row()
    .text('◀️ Назад', `setup:manage:${place.id}`);

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
});

// 10. Подсказка для создания нового заведения
setupComposer.callbackQuery('setup:new_prompt', async (ctx) => {
  await ctx.answerCallbackQuery();
  const text = (
    `✍️ *Создание нового заведения прямо из Telegram*\n\n` +
    `Отправьте в этот чат команду по шаблону:\n\n` +
    `\`/new_place Название | Точка выдачи | Описание\`\n\n` +
    `*Пример:*\n` +
    `\`/new_place Кава ля печы | ул. Центральная, 4 (выдача у печи) | Римская пицца из дровяной печи\`\n\n` +
    `Бот сразу создаст заведение, активирует его для жителей и привяжет к этой группе!`
  );

  const keyboard = new InlineKeyboard().text('◀️ Назад', 'setup:menu');
  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
});

// 11. Команда /new_place для создания заведения
setupComposer.command('new_place', async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  const rawText = ctx.match?.trim();

  if (!rawText || !rawText.includes('|')) {
    return ctx.reply(
      `✍️ *Как создать заведение:*\n\n` +
      `Отправьте команду со структурой:\n` +
      `\`/new_place Название | Точка выдачи | Описание\`\n\n` +
      `*Пример:*\n` +
      `\`/new_place Кава ля печы | ул. Центральная, 4 (выдача у печи) | Римская пицца и напитки\``,
      { parse_mode: 'Markdown' }
    );
  }

  const parts = rawText.split('|').map(p => p.trim());
  const name = parts[0];
  const pickupPoint = parts[1] || 'Точка выдачи заведения';
  const description = parts[2] || '';

  if (!name) {
    return ctx.reply('❌ Ошибка: укажите название заведения.');
  }

  const newPlace = createPlace({
    name,
    pickup_point: pickupPoint,
    description,
    group_chat_id: isGroup ? ctx.chat.id : null,
    is_active: 1,
  });

  if (isGroup) {
    addStaffMember(newPlace.id, ctx.from.id, ctx.from.first_name || 'Администратор', 'admin');
  }

  const keyboard = new InlineKeyboard();
  if (isGroup) {
    keyboard.text('🧪 Отправить тестовый заказ', `setup:test_order:${newPlace.id}`).row();
    keyboard.text('👨‍🍳 Я сотрудник (получить доступ)', `setup:join_staff:${newPlace.id}`).row();
  }

  await ctx.reply(
    `🎉 *Заведение «${newPlace.name}» успешно создано!*\n\n` +
    `📍 *Точка самовывоза:* ${newPlace.pickup_point}\n` +
    (newPlace.description ? `📝 *Описание:* ${newPlace.description}\n` : '') +
    (isGroup ? `🆔 *Привязанная группа:* \`${ctx.chat.id}\`\n\n` : '\n') +
    `🟢 Заведение активировано в меню бота для всех жильцов!\n` +
    `В меню добавлены 2 стартовые позиции для теста.`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
});

// 12. Команда /edit_place для редактирования данных точки
setupComposer.command('edit_place', async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  if (!isGroup) {
    return ctx.reply('Команда /edit_place работает только в рабочем чате заведения.');
  }

  const place = getPlaceByGroupId(ctx.chat.id);
  if (!place) {
    return ctx.reply('Эта группа не привязана к заведению. Сначала выполните /setup_place.');
  }

  const text = ctx.match?.trim() || '';
  if (!text) {
    return ctx.reply(
      `✏️ *Изменение данных заведения «${place.name}»*\n\n` +
      `Команды:\n` +
      `• \`/edit_place address Новый адрес выдачи\`\n` +
      `• \`/edit_place name Новое название\`\n\n` +
      `*Текущий адрес выдачи:* ${place.pickup_point}`,
      { parse_mode: 'Markdown' }
    );
  }

  if (text.startsWith('address ')) {
    const newAddress = text.replace('address ', '').trim();
    if (!newAddress) return ctx.reply('Укажите адрес.');
    updatePlaceInfo(place.id, { pickup_point: newAddress });
    return ctx.reply(`✅ Адрес точки выдачи обновлен:\n*${newAddress}*`, { parse_mode: 'Markdown' });
  }

  if (text.startsWith('name ')) {
    const newName = text.replace('name ', '').trim();
    if (!newName) return ctx.reply('Укажите название.');
    updatePlaceInfo(place.id, { name: newName });
    return ctx.reply(`✅ Название заведения обновлено:\n*${newName}*`, { parse_mode: 'Markdown' });
  }

  return ctx.reply(
    `Используйте:\n\`/edit_place address Новый адрес\`\nили\n\`/edit_place name Новое название\``,
    { parse_mode: 'Markdown' }
  );
});

// 13. Команда /add_item для добавления блюд в меню заведения
setupComposer.command(['add_item', 'additem'], async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  let place = isGroup ? getPlaceByGroupId(ctx.chat.id) : null;

  // Если вызвано в ЛС администратором, привязываемся к первому активному заведению
  if (!isGroup && isAdmin(ctx.from?.id)) {
    const active = getActivePlaces();
    place = active.length > 0 ? active[0] : null;
  }

  if (!place) {
    return ctx.reply(
      'Сначала привяжите эту группу к заведению с помощью `/setup_place`.',
      { parse_mode: 'Markdown' }
    );
  }

  // Проверка прав: сотрудник точки или суперадминистратор
  if (isGroup && !isStaffMember(ctx.from.id, place.id) && !isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ У вас нет прав на редактирование меню этого заведения.');
  }

  const rawText = ctx.match?.trim();
  if (!rawText || !rawText.includes('|')) {
    return ctx.reply(
      `🍕 *Добавление блюда в меню «${place.name}»*\n\n` +
      `Формат команды:\n` +
      `\`/add_item Название | Цена | Категория | Описание\`\n\n` +
      `*Примеры:*\n` +
      `\`/add_item Пицца Карбонара 30 см | 27 | Пицца | Сливочный соус, моцарелла, бекон, пармезан\`\n` +
      `\`/add_item Морс облепиховый 0.5 л | 6 | Напитки\``,
      { parse_mode: 'Markdown' }
    );
  }

  const parts = rawText.split('|').map(p => p.trim());
  const name = parts[0];
  const price = Number(parts[1]);
  const category = parts[2] || 'Основное меню';
  const description = parts[3] || '';

  if (!name || isNaN(price) || price < 0) {
    return ctx.reply('❌ Ошибка: укажите корректное название и цену числом.\nПример: `/add_item Пицца Пепперони | 25 | Пицца`', { parse_mode: 'Markdown' });
  }

  const newItem = addItem({
    placeId: place.id,
    name,
    price,
    category,
    description,
  });

  await ctx.reply(
    `✅ *Позиция успешно добавлена в меню «${place.name}»!*\n\n` +
    `🍕 *${newItem.name}*\n` +
    `💵 Цена: *${newItem.price} руб.*\n` +
    `📁 Категория: *${newItem.category}*\n` +
    (newItem.description ? `📝 Описание: _${newItem.description}_\n` : '') +
    `🆔 ID позиции: \`#${newItem.id}\`\n\n` +
    `Блюдо уже доступно жильцам для предзаказа в боте!`,
    { parse_mode: 'Markdown' }
  );
});

// 14. Команда /del_item для удаления блюда из меню
setupComposer.command(['del_item', 'delitem', 'delete_item'], async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  let place = isGroup ? getPlaceByGroupId(ctx.chat.id) : null;

  if (!isGroup && isAdmin(ctx.from?.id)) {
    const active = getActivePlaces();
    place = active.length > 0 ? active[0] : null;
  }

  if (!place) {
    return ctx.reply('Группа не привязана к заведению. Выполните `/setup_place`.');
  }

  if (isGroup && !isStaffMember(ctx.from.id, place.id) && !isAdmin(ctx.from.id)) {
    return ctx.reply('⛔ У вас нет прав на редактирование меню этого заведения.');
  }

  const query = ctx.match?.trim();
  if (!query) {
    return ctx.reply(
      `🗑 *Удаление блюда из меню «${place.name}»*\n\n` +
      `Укажите ID или название позиции:\n` +
      `\`/del_item 82\`\n` +
      `или\n` +
      `\`/del_item Пицца Карбонара\`\n\n` +
      `💡 Посмотреть все ID можно командой: \`/menu_items\``,
      { parse_mode: 'Markdown' }
    );
  }

  const item = findItemInPlace(place.id, query);
  if (!item) {
    return ctx.reply(`❌ Позиция «${query}» не найдена в меню заведения «${place.name}».`);
  }

  deleteItem(item.id);

  await ctx.reply(
    `🗑 *Позиция удалена из меню!*\n\n` +
    `• Название: *«${item.name}»* (ID: #${item.id})\n` +
    `• Заведение: «${place.name}»\n\n` +
    `Она больше не отображается в каталоге для жильцов.`,
    { parse_mode: 'Markdown' }
  );
});

// 15. Команда /menu_items для просмотра всех позиций и их ID
setupComposer.command(['menu_items', 'menuitems'], async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  let place = isGroup ? getPlaceByGroupId(ctx.chat.id) : null;

  if (!isGroup && isAdmin(ctx.from?.id)) {
    const active = getActivePlaces();
    place = active.length > 0 ? active[0] : null;
  }

  if (!place) {
    return ctx.reply('Группа не привязана к заведению. Выполните `/setup_place`.');
  }

  const items = getPlaceItems(place.id, { onlyAvailable: false });
  if (items.length === 0) {
    return ctx.reply(
      `📋 Меню «${place.name}» пока пусто.\n\nДобавьте первое блюдо командой:\n\`/add_item Название | Цена | Категория\``,
      { parse_mode: 'Markdown' }
    );
  }

  let text = `📋 *Меню заведения «${place.name}» (${items.length} поз.):*\n\n`;
  for (const it of items) {
    const status = it.is_available ? '🟢' : '🔴 [СТОП]';
    text += `${status} \`#${it.id}\` *${it.name}* — ${it.price} руб. (${it.category || 'Общее'})\n`;
  }

  text += `\n*Команды управления:*\n`;
  text += `• Добавить: \`/add_item Название | Цена | Категория | Описание\`\n`;
  text += `• Удалить: \`/del_item ID\` (например: \`/del_item ${items[0].id}\`)\n`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

