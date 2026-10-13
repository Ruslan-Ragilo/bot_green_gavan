import { Composer } from 'grammy';
import { upsertUser, deleteUserData } from '../db/repositories/users.js';
import { getCart } from '../db/repositories/cart.js';
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
  const text = (
    `👋 *Добро пожаловать в сервис предзаказа ЖК «Зелёная Гавань»!*\n\n` +
    `Здесь вы можете заранее заказать еду и напитки в заведениях нашего жилого комплекса и забрать заказ точно ко времени без очереди.\n\n` +
    `📍 *Формат:* только самовывоз в точке выдачи заведения.\n` +
    `💳 *Оплата:* на месте при получении заказа.\n\n` +
    `Выберите действие в меню ниже:`
  );

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: mainMenuKeyboard(cart.totalQuantity),
  });
});

// Возврат в главное меню через callback-кнопку
startComposer.callbackQuery('menu:main', async (ctx) => {
  await ctx.answerCallbackQuery();
  const cart = getCart(ctx.from.id);

  const text = (
    `🏡 *Главное меню сервиса предзаказа ЖК «Зелёная Гавань»*\n\n` +
    `Выберите заведение, чтобы посмотреть меню, или перейдите в корзину.`
  );

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(cart.totalQuantity),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(cart.totalQuantity),
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
