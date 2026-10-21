import process from 'node:process';

export const config = {
  // Токен Telegram-бота
  botToken: process.env.BOT_TOKEN || '',

  // Путь к файлу базы данных SQLite
  dbPath: process.env.DATABASE_PATH || './data/bot.db',

  // Таймаут в минутах, после которого неподтверждённый заказ (статус sent) переходит в expired
  orderExpiryMinutes: Number(process.env.ORDER_EXPIRY_MINUTES) || 15,

  // Интервал проверки просроченных заказов в миллисекундах (по умолчанию 60 секунд)
  expiryCheckIntervalMs: 60 * 1000,

  // Telegram ID администраторов бота (строго только они имеют доступ к /admin)
  adminIds: (process.env.ADMIN_IDS || process.env.STAFF_TELEGRAM_ID || '528985165')
    .split(',')
    .map(id => Number(id.trim()))
    .filter(Boolean),
};

// Проверка, является ли пользователь суперадминистратором бота
export function isAdmin(userId) {
  if (!userId) return false;
  return config.adminIds.includes(Number(userId));
}

// Базовая валидация конфигурации при старте приложения
export function validateConfig() {
  if (!config.botToken) {
    throw new Error('Критическая ошибка: переменная окружения BOT_TOKEN не задана в .env');
  }
}
