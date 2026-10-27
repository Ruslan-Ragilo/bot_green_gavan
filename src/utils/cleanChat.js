import { db } from '../db/index.js';

// Подготовленные выражения SQLite: сохранение экрана в БД переживает любые перезапуски сервера
const getScreenStmt = db.prepare('SELECT message_id FROM user_screens WHERE user_id = ?');
const saveScreenStmt = db.prepare(`
  INSERT INTO user_screens (user_id, message_id, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    message_id = excluded.message_id,
    updated_at = excluded.updated_at
`);
const deleteScreenStmt = db.prepare('DELETE FROM user_screens WHERE user_id = ?');

// Счётчик версий запросов пользователя для отмены устаревших гонок (race conditions)
const userRequestSeq = new Map();

// Последовательная очередь промисов на каждого пользователя (гарантирует строгий порядок FIFO)
const userQueues = new Map();

/**
 * Получение ID последнего активного сообщения пользователя
 */
function getLastMessageId(userId) {
  try {
    const row = getScreenStmt.get(userId);
    return row?.message_id || null;
  } catch (err) {
    return null;
  }
}

/**
 * Сохранение ID активного сообщения пользователя в БД
 */
function setLastMessageId(userId, messageId) {
  try {
    saveScreenStmt.run(userId, messageId);
  } catch (err) {
    console.error('[CleanChat] Ошибка сохранения message_id в БД:', err.message);
  }
}

/**
 * Удаление сообщения с перехватом ошибок
 */
async function safeDeleteMessage(ctx, chatId, messageId) {
  if (!messageId || !chatId) return;
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch (_) {
    // Игнорируем: сообщение уже удалено пользователем или прошло > 48 часов
  }
}

/**
 * Внутренняя функция отрисовки экрана с проверкой на актуальность запроса
 */
async function executeRenderScreen(ctx, text, extra, seq, userId, chatId) {
  const isStale = () => userRequestSeq.get(userId) !== seq;

  // 1. Если пользователь прислал команду (/start, /transport) — удаляем её текст из чата
  if (ctx.message) {
    try {
      await ctx.deleteMessage();
    } catch (_) {}
  }

  // Если за время удаления команды пришел более новый запрос — прерываемся
  if (isStale()) return;

  // 2. Если это callback от инлайн-кнопки — редактируем сообщение на месте
  if (ctx.callbackQuery) {
    const clickedMsgId = ctx.callbackQuery.message?.message_id;

    try {
      await ctx.editMessageText(text, extra);
      if (isStale()) return;

      if (clickedMsgId) {
        setLastMessageId(userId, clickedMsgId);
      }
      return;
    } catch (err) {
      const desc = err.description || err.message || '';
      // Если контент не изменился (повторный клик) — просто выходим
      if (desc.includes('message is not modified')) {
        return;
      }
      if (isStale()) return;

      console.warn(`[CleanChat] editMessageText fallback для user ${userId}:`, desc);
      if (clickedMsgId) {
        await safeDeleteMessage(ctx, chatId, clickedMsgId);
      }
    }
  }

  if (isStale()) return;

  // 3. Удаляем предыдущее сохраненное сообщение бота (из БД)
  const prevMsgId = getLastMessageId(userId);
  if (prevMsgId) {
    await safeDeleteMessage(ctx, chatId, prevMsgId);
  }

  if (isStale()) return;

  // 4. Отправляем ровно одно свежее сообщение и сохраняем его ID в базу данных
  const sent = await ctx.reply(text, extra);
  if (isStale()) {
    // Если пока сообщение летело по сети, пользователь уже нажал другую кнопку — удаляем устаревший ответ
    await safeDeleteMessage(ctx, chatId, sent.message_id);
    return;
  }

  setLastMessageId(userId, sent.message_id);
  return sent;
}

/**
 * Единый экран без мусора в чате:
 * 1. Защищает от состояния гонки (race conditions) при множественных или быстрых кликах
 * 2. Автоматически отменяет устаревшие запросы, не давая старому экрану перезаписать новый
 * 3. Выстраивает запросы одного пользователя в строгую последовательную цепочку (FIFO)
 * 4. Сохраняет ID сообщения в SQLite для защиты от дублей при перезапусках
 */
export async function renderScreen(ctx, text, extra = {}) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) return;

  // Инкрементируем номер версии запроса для пользователя
  const seq = (userRequestSeq.get(userId) || 0) + 1;
  userRequestSeq.set(userId, seq);

  // Получаем текущую очередь пользователя и добавляем задачу в конец
  const previousPromise = userQueues.get(userId) || Promise.resolve();

  const currentPromise = previousPromise
    .then(() => executeRenderScreen(ctx, text, extra, seq, userId, chatId))
    .catch((err) => {
      console.error('[CleanChat] Ошибка в очереди отрисовки экрана:', err.message);
    })
    .finally(() => {
      // Очищаем ссылку на очередь, если это был последний запрос в цепочке
      if (userQueues.get(userId) === currentPromise) {
        userQueues.delete(userId);
      }
    });

  userQueues.set(userId, currentPromise);
  return currentPromise;
}
