import process from 'node:process';
import { validateConfig } from './config.js';
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

  // Корректное завершение работы при остановке процесса
  const shutdown = async (signal) => {
    console.log(`\n🛑 Получен сигнал ${signal}. Завершение работы бота...`);
    stopExpiredOrdersJob();
    await bot.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // Сбрасываем старый webhook (если бот ранее использовался с webhook)
  await bot.api.deleteWebhook({ drop_pending_updates: false });

  // Регистрируем быстрые команды в кнопке «Меню» Telegram (в инпуте)
  await setupBotCommands(bot);

  // Запуск получения сообщений
  console.log('✅ Бот успешно запущен и ожидает заказов.');
  await bot.start({
    onStart: (botInfo) => {
      console.log(`🤖 Бот авторизован как @${botInfo.username}`);
    },
  });
}

main().catch((err) => {
  if (err?.message === 'Aborted delay' || err?.name === 'AbortError') {
    // Штатное прерывание polling при перезапуске (SIGTERM/SIGINT)
    process.exit(0);
  }
  console.error('❌ Критическая ошибка при запуске бота:', err);
  process.exit(1);
});
