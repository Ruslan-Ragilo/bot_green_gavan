import http from 'node:http';
import process from 'node:process';
import { webhookCallback } from 'grammy';
import { config, validateConfig } from './config.js';
import { createBot, setupBotCommands } from './src/bot.js';
import { startExpiredOrdersJob, stopExpiredOrdersJob } from './src/jobs/expiredOrders.js';

async function main() {
  console.log('🚀 Инициализация Telegram-бота предзаказа для ЖК «Зелёная Гавань»...');

  // Проверяем обязательные переменные окружения
  validateConfig();

  // Создаем экземпляр бота с подключенными хэндлерами
  const bot = createBot();

  // Запускаем фоновую проверку просроченных заказов (setInterval раз в минуту)
  startExpiredOrdersJob(bot);

  let server = null;

  // Корректное завершение работы при остановке процесса
  const shutdown = async (signal) => {
    console.log(`\n🛑 Получен сигнал ${signal}. Завершение работы бота...`);
    stopExpiredOrdersJob();

    if (server) {
      server.close();
    }

    try {
      if (bot.isInited() && bot.isRunning()) {
        await bot.stop();
      }
    } catch (_) {
      // Игнорируем штатные ошибки при остановке
    }

    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // Инициализируем бота и кэшируем данные о боте
  await bot.init();
  console.log(`🤖 Бот авторизован как @${bot.botInfo.username} (ID: ${bot.botInfo.id})`);

  // Регистрируем быстрые команды в кнопке «Меню» Telegram (в инпуте)
  await setupBotCommands(bot);

  if (config.webhookUrl) {
    // === РЕЖИМ WEBHOOK (мгновенная доставка апдейтов без задержек polling) ===
    console.log(`🌐 Режим Webhook активен: ${config.webhookUrl}`);

    const webhookHandler = webhookCallback(bot, 'http');

    server = http.createServer((req, res) => {
      // Все входящие POST-запросы отправляются в grammY обработчик
      if (req.method === 'POST') {
        return webhookHandler(req, res);
      }

      // Health-check для проверки доступности сервера снаружи
      if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', bot: bot.botInfo.username }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    const host = config.webhookHost;
    const port = config.webhookPort;

    await new Promise((resolve, reject) => {
      server.listen(port, host, () => {
        console.log(`📡 HTTP-сервер ожидает обновления на http://${host}:${port}/webhook`);
        resolve();
      });
      server.on('error', reject);
    });

    // Регистрируем Webhook в Telegram API
    await bot.api.setWebhook(config.webhookUrl, {
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      drop_pending_updates: false,
    });

    console.log('✅ Webhook успешно зарегистрирован в Telegram Bot API.');
    console.log('⚡ Бот работает через Webhook и готов принимать заказы мгновенно!');
  } else {
    // === РЕЖИМ LONG POLLING (fallback при отсутствии WEBHOOK_URL) ===
    console.log('🔄 Режим Webhook не настроен (WEBHOOK_URL пуст). Запуск через Long Polling...');

    // Сбрасываем старый webhook перед началом polling
    await bot.api.deleteWebhook({ drop_pending_updates: false });

    console.log('✅ Бот успешно запущен и ожидает заказов (Long Polling).');
    await bot.start({
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      drop_pending_updates: false,
      timeout: 10,
    });
  }
}

main().catch((err) => {
  if (err?.message === 'Aborted delay' || err?.name === 'AbortError') {
    // Штатное прерывание polling при перезапуске (SIGTERM/SIGINT)
    process.exit(0);
  }
  console.error('❌ Критическая ошибка при запуске бота:', err);
  process.exit(1);
});
