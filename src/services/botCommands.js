/**
 * Меню команд Telegram (кнопка «Меню» возле поля ввода) по ролям:
 *  - все личные чаты — жилец;
 *  - мастер — плюс кабинет мастера (ставится на его чат при одобрении);
 *  - администратор — всё, включая управление мастерами.
 * Команды на конкретный чат перекрывают общие, поэтому у админа — полный список.
 */
import { config } from '../../config.js';
import { getMakerByUser } from '../db/repositories/makers.js';
import { getProviderByUser } from '../db/repositories/servicesCatalog.js';

export const USER_COMMANDS = [
  { command: 'start', description: '🏠 Главное меню' },
  { command: 'transport', description: '🚌 Расписание транспорта' },
  { command: 'services', description: '💅 Услуги и красота' },
  { command: 'support', description: '❤️ Поддержка проекта и связь' },
];

export const MAKER_COMMANDS = [
  { command: 'start', description: '🏠 Главное меню' },
  { command: 'master', description: '🧑‍🍳 Кабинет мастера: наличие и позиции' },
  { command: 'stats', description: '📊 Моя статистика: просмотры и переходы' },
  { command: 'transport', description: '🚌 Расписание транспорта' },
  { command: 'services', description: '💅 Услуги и красота' },
  { command: 'support', description: '❤️ Поддержка проекта и связь' },
];

// Админу в меню — только входы; остальное (/makers, /analytics, /broadcast) работает, но доступно кнопками в /admin
export const ADMIN_COMMANDS = [
  { command: 'admin', description: '👑 Админ-панель' },
  { command: 'start', description: '🏠 Главное меню' },
  { command: 'master', description: '🧑‍🍳 Кабинет мастера' },
  { command: 'services_cabinet', description: '✨ Кабинет услуг' },
  { command: 'transport', description: '🚌 Расписание транспорта' },
];

const isAdminId = (userId) => config.adminIds.includes(Number(userId));

async function syncUserRoleCommands(api, userId) {
  if (isAdminId(userId)) return;
  const isActiveMaker = getMakerByUser(userId)?.status === 'active';
  const isActiveProvider = getProviderByUser(userId)?.status === 'active';
  const scope = { type: 'chat', chat_id: userId };

  try {
    if (!isActiveMaker && !isActiveProvider) {
      await api.deleteMyCommands({ scope });
      return;
    }
    const commands = [{ command: 'start', description: '🏠 Главное меню' }];
    if (isActiveMaker) {
      commands.push(
        { command: 'master', description: '🧑‍🍳 Кабинет мастера: наличие и позиции' },
        { command: 'stats', description: '📊 Статистика: домашнее и ручное' },
      );
    }
    if (isActiveProvider) {
      commands.push({ command: 'services_cabinet', description: '✨ Кабинет услуг и горящих окон' });
    }
    commands.push(
      { command: 'transport', description: '🚌 Расписание транспорта' },
      { command: 'services', description: '💅 Услуги и красота' },
      { command: 'support', description: '❤️ Поддержка проекта и связь' },
    );
    await api.setMyCommands(commands, { scope });
  } catch (err) {
    console.warn(`[Commands] Не удалось обновить меню пользователя ${userId}:`, err.message);
  }
}

/**
 * Привести меню команд чата пользователя к его роли мастера.
 * Администраторов не трогаем — у них своё полное меню.
 */
export async function syncMakerCommands(api, userId) {
  await syncUserRoleCommands(api, userId);
}

/**
 * Привести меню команд чата пользователя к его роли специалиста услуг.
 */
export async function syncServiceProviderCommands(api, userId) {
  await syncUserRoleCommands(api, userId);
}
