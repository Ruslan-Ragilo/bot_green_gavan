import process from 'node:process';

export const config = {
  // Токен Telegram-бота
  botToken: process.env.BOT_TOKEN || '',

  // Путь к файлу базы данных SQLite
  dbPath: process.env.DATABASE_PATH || './bot.db',

  // Таймаут в минутах, после которого неподтверждённый заказ (статус sent) переходит в expired
  orderExpiryMinutes: Number(process.env.ORDER_EXPIRY_MINUTES) || 15,

  // Интервал проверки просроченных заказов в миллисекундах (по умолчанию 60 секунд)
  expiryCheckIntervalMs: 60 * 1000,
};

// Базовая валидация конфигурации при старте приложения
export function validateConfig() {
  if (!config.botToken) {
    throw new Error('Критическая ошибка: переменная окружения BOT_TOKEN не задана в .env');
  }
}
