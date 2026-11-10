import process from 'node:process';

// Автоматически загружаем .env в Node.js >= 20.6, если запуск без флага --env-file
try {
  process.loadEnvFile?.();
} catch {
  // Файл .env может отсутствовать, если переменные заданы системно
}

export const config = {
  // Токен Telegram-бота
  botToken: process.env.BOT_TOKEN || '',

  // Кастомный адрес Bot API (реверс-прокси, например Cloudflare Worker)
  telegramApiRoot: process.env.TELEGRAM_API_ROOT || null,

  // Webhook-настройки (для мгновенной доставки без polling)
  webhookUrl: process.env.WEBHOOK_URL || null,
  webhookIp: process.env.WEBHOOK_IP || null,
  webhookHost: process.env.WEBHOOK_HOST || '0.0.0.0',
  webhookPort: Number(process.env.WEBHOOK_PORT) || 80,

  // Путь к файлу базы данных SQLite
  dbPath: process.env.DATABASE_PATH || './data/bot.db',

  // Таймаут в минутах, после которого неподтверждённый заказ (статус sent) переходит в expired
  orderExpiryMinutes: Number(process.env.ORDER_EXPIRY_MINUTES) || 15,

  // Интервал проверки просроченных заказов в миллисекундах (по умолчанию 60 секунд)
  expiryCheckIntervalMs: 60 * 1000,

  // Пульт кухни и напоминания (в минутах)
  acceptReminderMinutes: Number(process.env.ACCEPT_REMINDER_MINUTES) || 5,      // заказ не принят → пинг в группу
  clientPickupReminderMinutes: Number(process.env.CLIENT_PICKUP_REMINDER_MINUTES) || 15, // заказ готов, жилец не пришёл → напоминание жильцу
  staffPickupCheckMinutes: Number(process.env.STAFF_PICKUP_CHECK_MINUTES) || 45, // заказ готов давно → спросить кухню «забрали?»
  slotMinutes: 15,                 // размер слота для лимита заказов
  defaultReportTime: '23:30',      // время ежедневного отчёта, если у заведения не заданы часы работы

  // Telegram ID администраторов бота (строго только они имеют доступ к /admin)
  adminIds: (process.env.ADMIN_IDS || process.env.STAFF_TELEGRAM_ID || '528985165')
    .split(',')
    .map(id => Number(id.trim()))
    .filter(Boolean),

  // Реквизиты для добровольной поддержки проекта и контакты
  donateCard: process.env.DONATE_CARD || '',
  donatePhone: process.env.DONATE_PHONE || '',
  donateRecipient: process.env.DONATE_RECIPIENT || 'Руслан Р.',
  creatorUsername: process.env.CREATOR_USERNAME || 'RuslanR93',
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
