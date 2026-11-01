import { Composer } from 'grammy';
import { upsertUser, deleteUserData } from '../db/repositories/users.js';
import { transportMenuKeyboard } from '../keyboards/transport.js';
import { getCart } from '../db/repositories/cart.js';
import { renderScreen } from '../utils/cleanChat.js';

export const startComposer = new Composer();

const WELCOME_TEXT = (
  `🌲 *Бот ЖК «Зелёная Гавань»*\n\n` +
  `Выберите нужный сервис:`
);

// Обработка команды /start
startComposer.command('start', async (ctx) => {
  const from = ctx.from;
  if (!from) return;

  // Сохраняем/обновляем пользователя в БД
  upsertUser({
    telegram_id: from.id,
    first_name: from.first_name,
    last_name: from.last_name || null,
    username: from.username || null,
  });

  const cart = getCart(from.id);

  await renderScreen(ctx, WELCOME_TEXT, {
    parse_mode: 'Markdown',
    reply_markup: transportMenuKeyboard(cart.totalQuantity),
  });
});

// Возврат в главное меню
startComposer.callbackQuery('menu:main', async (ctx) => {
  await ctx.answerCallbackQuery();
  const cart = getCart(ctx.from.id);
  await renderScreen(ctx, WELCOME_TEXT, {
    parse_mode: 'Markdown',
    reply_markup: transportMenuKeyboard(cart.totalQuantity),
  });
});

// Заглушка для информационных кнопок
startComposer.callbackQuery('noop', async (ctx) => {
  await ctx.answerCallbackQuery();
});

// Удаление персональных данных по 152-ФЗ
startComposer.command('delete_me', async (ctx) => {
  deleteUserData(ctx.from.id);
  await ctx.reply(
    '🗑 *Ваши данные успешно удалены.*\n\n' +
    'Чтобы начать пользоваться ботом снова, отправьте /start.',
    { parse_mode: 'Markdown' }
  );
});
