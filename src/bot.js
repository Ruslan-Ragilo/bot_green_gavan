import { Bot, InlineKeyboard } from 'grammy';
import { config, isAdmin } from '../config.js';
import { startComposer } from './handlers/start.js';
import { catalogComposer } from './handlers/catalog.js';
import { cartComposer } from './handlers/cart.js';
import { ordersComposer } from './handlers/orders.js';
import { staffComposer } from './handlers/staff.js';
import { setupComposer } from './handlers/setup.js';
import { adminComposer } from './handlers/admin.js';
import { transportComposer } from './handlers/transport.js';
import { supportComposer } from './handlers/support.js';
import { kitchenComposer } from './handlers/kitchen.js';
import { makersComposer } from './handlers/makers.js';
import { makerPanelComposer } from './handlers/makerPanel.js';
import { signalsComposer } from './handlers/signals.js';
import { resetPendingInputMiddleware } from './utils/pendingInput.js';
import { reportError } from './services/errorReporter.js';
import { USER_COMMANDS, ADMIN_COMMANDS, syncMakerCommands } from './services/botCommands.js';
import { getAllMakers } from './db/repositories/makers.js';

export function createBot() {
  const botOptions = {
    client: {
      timeoutSeconds: 30,
      canUseWebhookReply: (method) => method === 'answerCallbackQuery',
    },
  };

  if (config.telegramApiRoot) {
    botOptions.client.apiRoot = config.telegramApiRoot;
  }

  const bot = new Bot(config.botToken, botOptions);

  // Централизованный перехват ошибок
  bot.catch((err) => {
    const desc = err.error?.description || err.error?.message || err.message || '';
    if (desc.includes('message is not modified')) {
      return;
    }
    const ctx = err.ctx;
    console.error(`[Bot Error] Ошибка при обработке апдейта ${ctx.update.update_id}:`, err.error);
    reportError(err.error, { where: 'Ошибка обработчика', ctx });
  });

  // Замер времени сетевых вызовов к Telegram API через Cloudflare
  bot.api.config.use(async (prev, method, payload, signal) => {
    const apiStart = performance.now();
    try {
      const res = await prev(method, payload, signal);
      const apiDuration = (performance.now() - apiStart).toFixed(0);
      if (method !== 'getUpdates') {
        console.log(`📡 [API ${method}] Ответ за ${apiDuration} мс`);
      }
      return res;
    } catch (apiErr) {
      // Игнорируем штатный 400 при повторном клике на ту же кнопку (содержимое не изменилось)
      if (apiErr?.description?.includes('message is not modified')) {
        return true;
      }
      throw apiErr;
    }
  });

  // Логирование входящих событий и точного времени выполнения в миллисекундах
  bot.use(async (ctx, next) => {
    const start = performance.now();
    const from = ctx.from ? `${ctx.from.first_name} (id: ${ctx.from.id})` : 'unknown';
    const action = ctx.message?.text || ctx.callbackQuery?.data || 'other update';
    console.log(`📥 [Update ${ctx.update.update_id}] От ${from}: ${action}`);

    try {
      await next();
    } finally {
      const duration = (performance.now() - start).toFixed(0);
      console.log(`⏱️ [Update ${ctx.update.update_id}] Обработан за ${duration} мс (${action})`);
    }
  });

  // Сброс ожидания текстового ввода при навигации кнопками/командами
  bot.use(resetPendingInputMiddleware);

  // Подключаем модули обработчиков
  bot.use(adminComposer);
  if (config.preordersEnabled) bot.use(setupComposer);
  bot.use(startComposer);
  bot.use(transportComposer);
  bot.use(supportComposer);
  bot.use(makersComposer);
  bot.use(makerPanelComposer);
  bot.use(signalsComposer);

  // Предзаказы в кафе: подключаются только при FEATURE_PREORDERS=true
  if (config.preordersEnabled) {
    bot.use(catalogComposer);
    bot.use(cartComposer);
    bot.use(ordersComposer);
    bot.use(staffComposer);
    bot.use(kitchenComposer);
  }

  // Кнопки, которые никто не обработал (например, на старых сообщениях выключенных предзаказов),
  // иначе у пользователя бесконечно крутятся часики на кнопке
  bot.on('callback_query:data', async (ctx, next) => {
    await ctx.answerCallbackQuery({ text: 'Эта функция сейчас недоступна' }).catch(() => {});
    return next();
  });

  // Пересылка входящих текстовых сообщений и ответов жильцов администратору
  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    if (isAdmin(ctx.from?.id)) return;
    if (ctx.chat.type !== 'private') return;

    const senderName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || 'Жилец';
    const username = ctx.from?.username ? `@${ctx.from.username}` : 'нет username';
    const userId = ctx.from?.id;

    console.log(`📩 [Feedback] Получен ответ от ${senderName} (${userId}): ${ctx.message.text}`);

    const escapeHtml = (str) =>
      String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const adminText = (
      `📩 <b>Новое сообщение / ответ от жильца:</b>\n\n` +
      `👤 <b>От:</b> ${escapeHtml(senderName)} (${escapeHtml(username)})\n` +
      `🆔 <b>ID:</b> <code>${userId}</code>\n\n` +
      `💬 <b>Текст:</b>\n${escapeHtml(ctx.message.text)}`
    );

    const keyboard = ctx.from?.username
      ? new InlineKeyboard().url('💬 Ответить в ЛС', `https://t.me/${ctx.from.username}`)
      : undefined;

    for (const adminId of config.adminIds) {
      try {
        await ctx.api.sendMessage(adminId, adminText, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } catch (err) {
        console.error('[Feedback] Не удалось переслать админу:', err.message);
      }
    }

    await ctx.reply(
      `Спасибо за обратную связь! 🙏\nЯ передал ваше сообщение автору бота (@${config.creatorUsername.replace('@', '')}).`,
      {
        reply_markup: new InlineKeyboard().text('🚌 Расписание транспорта', 'transport:menu'),
      }
    );
  });

  return bot;
}

// Регистрация быстрых команд в кнопке «Меню» Telegram (возле поля ввода)
const GROUP_COMMANDS = [
  { command: 'panel', description: '🎛 Пульт кухни: пауза, стоп-лист, лимит' },
  { command: 'report', description: '📊 Отчёт за сегодня' },
  { command: 'hours', description: '🕘 Часы работы (/hours 9:00-22:00)' },
  { command: 'setup_place', description: '⚙️ Настройка заведения' },
  { command: 'menu_items', description: '📋 Меню заведения' },
  { command: 'add_item', description: '🍕 Добавить блюдо в меню' },
  { command: 'del_item', description: '🗑 Удалить блюдо из меню' },
  { command: 'iam_staff', description: '👨‍🍳 Доступ к заказам (я сотрудник)' },
  { command: 'staff_list', description: '👥 Список персонала' },
  { command: 'edit_place', description: '✏️ Изменить адрес/название' },
];

export async function setupBotCommands(bot) {
  try {
    // 1. Команды для обычных пользователей в личных сообщениях
    await bot.api.setMyCommands(USER_COMMANDS, {
      scope: { type: 'all_private_chats' },
    });

    // 2. Команды для групп (кухня, заведения) — только когда включены предзаказы
    if (config.preordersEnabled) {
      await bot.api.setMyCommands(GROUP_COMMANDS, { scope: { type: 'all_group_chats' } });
    } else {
      await bot.api.deleteMyCommands({ scope: { type: 'all_group_chats' } });
    }

    // 3. Персональное меню в инпуте для администратора бота
    for (const adminId of config.adminIds) {
      try {
        await bot.api.setMyCommands(ADMIN_COMMANDS, {
          scope: { type: 'chat', chat_id: adminId },
        });
      } catch (e) {
        console.warn(`[Commands] Не удалось зарегистрировать меню админа для ${adminId}:`, e.message);
      }
    }
    // 4. Мастерам — меню с кабинетом мастера
    for (const maker of getAllMakers()) {
      if (maker.status === 'active') await syncMakerCommands(bot.api, maker.user_id, true);
    }
    console.log('🔘 Быстрые команды в кнопке «Меню» успешно зарегистрированы.');
  } catch (err) {
    console.error('⚠️ Ошибка при регистрации команд бота:', err);
  }
}

