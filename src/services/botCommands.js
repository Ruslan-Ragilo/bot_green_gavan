/**
 * Меню команд Telegram (кнопка «Меню» возле поля ввода) по ролям:
 *  - все личные чаты — жилец;
 *  - мастер — плюс кабинет мастера (ставится на его чат при одобрении);
 *  - администратор — всё, включая управление мастерами.
 * Команды на конкретный чат перекрывают общие, поэтому у админа — полный список.
 */
import { config } from '../../config.js';

export const USER_COMMANDS = [
  { command: 'start', description: '🏠 Главное меню' },
  { command: 'transport', description: '🚌 Расписание транспорта' },
  { command: 'support', description: '❤️ Поддержка проекта и связь' },
];

export const MAKER_COMMANDS = [
  { command: 'start', description: '🏠 Главное меню' },
  { command: 'master', description: '🧑‍🍳 Кабинет мастера: наличие и позиции' },
  { command: 'stats', description: '📊 Моя статистика: просмотры и переходы' },
  { command: 'transport', description: '🚌 Расписание транспорта' },
  { command: 'support', description: '❤️ Поддержка проекта и связь' },
];

export const ADMIN_COMMANDS = [
  { command: 'admin', description: '👑 Панель администратора' },
  { command: 'start', description: '🏠 Главное меню' },
  { command: 'makers', description: '🧺 Мастера: заявки, скрыть/показать' },
  { command: 'analytics', description: '📊 Аналитика мастеров' },
  { command: 'master', description: '🧑‍🍳 Кабинет мастера' },
  { command: 'transport', description: '🚌 Расписание транспорта' },
  { command: 'broadcast', description: '📢 Рассылка жильцам ЖК' },
];

const isAdminId = (userId) => config.adminIds.includes(Number(userId));

/**
 * Привести меню команд чата пользователя к его роли мастера.
 * Администраторов не трогаем — у них своё полное меню.
 */
export async function syncMakerCommands(api, userId, isActiveMaker) {
  if (isAdminId(userId)) return;
  const scope = { type: 'chat', chat_id: userId };
  try {
    if (isActiveMaker) {
      await api.setMyCommands(MAKER_COMMANDS, { scope });
    } else {
      await api.deleteMyCommands({ scope }); // вернётся общее меню жильца
    }
  } catch (err) {
    console.warn(`[Commands] Не удалось обновить меню мастера ${userId}:`, err.message);
  }
}
