import { Composer } from 'grammy';
import { upsertUser, deleteUserData } from '../db/repositories/users.js';
import { transportMenuKeyboard } from '../keyboards/transport.js';
import { renderScreen } from '../utils/cleanChat.js';

export const startComposer = new Composer();

const WELCOME_TEXT = (
  `🚌 *Транспорт ЖК «Зелёная Гавань»*\n\n` +
  `Выберите транспорт:`
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

  await renderScreen(ctx, WELCOME_TEXT, {
    parse_mode: 'Markdown',
    reply_markup: transportMenuKeyboard(),
  });
});

// Возврат в главное меню
startComposer.callbackQuery('menu:main', async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderScreen(ctx, WELCOME_TEXT, {
    parse_mode: 'Markdown',
    reply_markup: transportMenuKeyboard(),
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
