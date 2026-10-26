import { Composer } from 'grammy';
import { upsertUser, deleteUserData } from '../db/repositories/users.js';
import { getCart } from '../db/repositories/cart.js';
import { getActivePlaces } from '../db/repositories/places.js';
import { mainMenuKeyboard } from '../keyboards/client.js';

export const startComposer = new Composer();

// Обработка команды /start
startComposer.command('start', async (ctx) => {
  const from = ctx.from;
  if (!from) return;

  // Сохраняем/обновляем пользователя в БД с фиксацией согласия на обработку данных
  upsertUser({
    telegram_id: from.id,
    first_name: from.first_name,
    last_name: from.last_name || null,
    username: from.username || null,
  });

  const cart = getCart(from.id);
  const activePlaces = getActivePlaces();
  const activePlaceName = activePlaces.length === 1 ? activePlaces[0].name : null;

  const text = (
    `👋 *Добро пожаловать в сервис для жителей Зелёной Гавани!*\n\n` +
    `Здесь вы можете:\n` +
    `🚌 *Посмотреть расписание транспорта:* автобусы 200С, 200дС и маршрутка 1222-ТК с поиском ближайших рейсов прямо сейчас.\n` +
    `🍽 *Оформить предзаказ еды и напитков:* в заведениях района навынос без очередей.\n\n` +
    `Выберите нужное действие в меню ниже:`
  );

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: mainMenuKeyboard(cart.totalQuantity, activePlaceName),
  });
});

// Возврат в главное меню через callback-кнопку
startComposer.callbackQuery('menu:main', async (ctx) => {
  await ctx.answerCallbackQuery();
  const cart = getCart(ctx.from.id);
  const activePlaces = getActivePlaces();
  const activePlaceName = activePlaces.length === 1 ? activePlaces[0].name : null;

  const text = (
    `🏡 *Главное меню сервиса «Зелёная Гавань»*\n\n` +
    `Выберите расписание транспорта или заведение для заказа навынос:`
  );

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(cart.totalQuantity, activePlaceName),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(cart.totalQuantity, activePlaceName),
    });
  }
});

// Заглушка для информационных кнопок (например, счётчик в корзине)
startComposer.callbackQuery('noop', async (ctx) => {
  await ctx.answerCallbackQuery();
});

// Удаление персональных данных по 152-ФЗ
startComposer.command('delete_me', async (ctx) => {
  deleteUserData(ctx.from.id);
  await ctx.reply(
    '🗑 *Ваши данные успешно удалены.*\n\n' +
    'Вся информация о вашем профиле и корзине очищена из базы данных согласно политике обработки данных. ' +
    'Чтобы начать пользоваться сервисом снова, отправьте /start.',
    { parse_mode: 'Markdown' }
  );
});
