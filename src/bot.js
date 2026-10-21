import { Bot } from 'grammy';
import { config } from '../config.js';
import { startComposer } from './handlers/start.js';
import { catalogComposer } from './handlers/catalog.js';
import { cartComposer } from './handlers/cart.js';
import { ordersComposer } from './handlers/orders.js';
import { staffComposer } from './handlers/staff.js';
import { setupComposer } from './handlers/setup.js';
import { adminComposer } from './handlers/admin.js';

export function createBot() {
  const botOptions = {};
  if (config.telegramApiRoot) {
    botOptions.client = {
      apiRoot: config.telegramApiRoot,
      timeoutSeconds: 30,
    };
  }

  const bot = new Bot(config.botToken, botOptions);

  // Централизованный перехват ошибок
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`[Bot Error] Ошибка при обработке апдейта ${ctx.update.update_id}:`, err.error);
  });

  // Безопасный вызов answerCallbackQuery (не роняет обработчики при сетевом таймауте)
  bot.use(async (ctx, next) => {
    if (ctx.callbackQuery) {
      const originalAnswer = ctx.answerCallbackQuery.bind(ctx);
      ctx.answerCallbackQuery = (...args) => originalAnswer(...args).catch(() => {});
    }
    return next();
  });

  // Логирование входящих событий
  bot.use(async (ctx, next) => {
    const from = ctx.from ? `${ctx.from.first_name} (id: ${ctx.from.id})` : 'unknown';
    const action = ctx.message?.text || ctx.callbackQuery?.data || 'other update';
    console.log(`📥 [Update ${ctx.update.update_id}] От ${from}: ${action}`);
    return next();
  });

  // Подключаем модули обработчиков
  bot.use(adminComposer);
  bot.use(setupComposer);
  bot.use(startComposer);
  bot.use(catalogComposer);
  bot.use(cartComposer);
  bot.use(ordersComposer);
  bot.use(staffComposer);

  return bot;
}

// Регистрация быстрых команд в кнопке «Меню» Telegram (возле поля ввода)
export async function setupBotCommands(bot) {
  try {
    // 1. Команды для обычных пользователей в личных сообщениях
    await bot.api.setMyCommands([
      { command: 'start', description: '🏠 Главное меню' },
      { command: 'orders', description: '📋 Мои заказы' },
      { command: 'cart', description: '🛒 Корзина' },
    ], {
      scope: { type: 'all_private_chats' },
    });

    // 2. Команды для групп (кухня, заведения)
    await bot.api.setMyCommands([
      { command: 'setup_place', description: '⚙️ Настройка заведения' },
      { command: 'menu_items', description: '📋 Меню заведения' },
      { command: 'add_item', description: '🍕 Добавить блюдо в меню' },
      { command: 'del_item', description: '🗑 Удалить блюдо из меню' },
      { command: 'iam_staff', description: '👨‍🍳 Доступ к заказам (я сотрудник)' },
      { command: 'staff_list', description: '👥 Список персонала' },
      { command: 'edit_place', description: '✏️ Изменить адрес/название' },
    ], {
      scope: { type: 'all_group_chats' },
    });

    // 3. Персональное меню в инпуте для администратора бота
    for (const adminId of config.adminIds) {
      try {
        await bot.api.setMyCommands([
          { command: 'admin', description: '👑 Панель администратора' },
          { command: 'start', description: '🏠 Главное меню' },
          { command: 'order', description: '🔍 Найти заказ по коду' },
          { command: 'broadcast', description: '📢 Рассылка жильцам ЖК' },
          { command: 'orders', description: '📋 Мои заказы' },
          { command: 'cart', description: '🛒 Корзина' },
        ], {
          scope: { type: 'chat', chat_id: adminId },
        });
      } catch (e) {
        console.warn(`[Commands] Не удалось зарегистрировать меню админа для ${adminId}:`, e.message);
      }
    }
    console.log('🔘 Быстрые команды в кнопке «Меню» успешно зарегистрированы.');
  } catch (err) {
    console.error('⚠️ Ошибка при регистрации команд бота:', err);
  }
}

