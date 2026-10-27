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

// Лок от параллельных одновременных кликов (защита от race condition)
const pendingUsers = new Set();

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
 * Единый экран без мусора в чате:
 * 1. Удаляет входящую команду пользователя (/start, /transport), чтобы не засорять переписку
 * 2. Если нажал кнопку — бесшовно редактирует сообщение на месте (без мигания и без новых сообщений)
 * 3. Если ввёл команду заново — удаляет старое сообщение бота (даже после перезапуска сервера) и присылает ровно 1 актуальное
 * 4. Предотвращает дубли при сбоях или двойных быстрых кликах
 */
export async function renderScreen(ctx, text, extra = {}) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) return;

  // Защита от параллельных дублирующих запросов по одному пользователю
  if (pendingUsers.has(userId)) {
    // Небольшая задержка, чтобы дождаться завершения первого запроса
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  pendingUsers.add(userId);

  try {
    // 1. Если пользователь прислал команду (/start, /transport) — удаляем её текст из чата
    if (ctx.message) {
      try {
        await ctx.deleteMessage();
      } catch (_) {}
    }

    // 2. Если это callback от инлайн-кнопки — редактируем сообщение на месте
    if (ctx.callbackQuery) {
      const clickedMsgId = ctx.callbackQuery.message?.message_id;

      try {
        await ctx.editMessageText(text, extra);
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
        console.warn(`[CleanChat] editMessageText fallback для user ${userId}:`, desc);
        // Если отредактировать не удалось — удаляем старое сообщение (и по кнопке, и сохраненное в БД)
        if (clickedMsgId) {
          await safeDeleteMessage(ctx, chatId, clickedMsgId);
        }
      }
    }

    // 3. Удаляем предыдущее сохраненное сообщение бота (из БД)
    const prevMsgId = getLastMessageId(userId);
    if (prevMsgId) {
      await safeDeleteMessage(ctx, chatId, prevMsgId);
    }

    // 4. Отправляем ровно одно свежее сообщение и сохраняем его ID в базу данных
    const sent = await ctx.reply(text, extra);
    setLastMessageId(userId, sent.message_id);
    return sent;
  } catch (err) {
    console.error('[CleanChat] Критическая ошибка отправки экрана:', err.message);
  } finally {
    pendingUsers.delete(userId);
  }
}
