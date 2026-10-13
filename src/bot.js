import { Bot } from 'grammy';
import { config } from '../config.js';
import { startComposer } from './handlers/start.js';
import { catalogComposer } from './handlers/catalog.js';
import { cartComposer } from './handlers/cart.js';
import { ordersComposer } from './handlers/orders.js';
import { staffComposer } from './handlers/staff.js';

export function createBot() {
  const bot = new Bot(config.botToken);

  // Централизованный перехват ошибок
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`[Bot Error] Ошибка при обработке апдейта ${ctx.update.update_id}:`, err.error);
  });

  // Логирование входящих событий
  bot.use(async (ctx, next) => {
    const from = ctx.from ? `${ctx.from.first_name} (id: ${ctx.from.id})` : 'unknown';
    const action = ctx.message?.text || ctx.callbackQuery?.data || 'other update';
    console.log(`📥 [Update ${ctx.update.update_id}] От ${from}: ${action}`);
    return next();
  });

  // Подключаем модули обработчиков
  bot.use(startComposer);
  bot.use(catalogComposer);
  bot.use(cartComposer);
  bot.use(ordersComposer);
  bot.use(staffComposer);

  return bot;
}
