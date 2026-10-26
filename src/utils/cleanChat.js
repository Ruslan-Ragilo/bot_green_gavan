// Хранилище ID последнего активного сообщения бота для каждого пользователя
const userActiveMessageMap = new Map();

/**
 * Единый экран без мусора в чате:
 * 1. Удаляет входящую команду пользователя (/start, /transport), чтобы не засорять переписку
 * 2. Если нажал кнопку — бесшовно редактирует сообщение на месте
 * 3. Если ввёл команду заново — удаляет старое сообщение бота и присылает ровно 1 актуальное
 */
export async function renderScreen(ctx, text, extra = {}) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) return;

  // 1. Если пользователь прислал команду (/start, /transport) — удаляем её текст из чата
  if (ctx.message) {
    try {
      await ctx.deleteMessage();
    } catch (_) {
      // Игнорируем, если нет прав или сообщение уже удалено
    }
  }

  // 2. Если это callback от инлайн-кнопки — редактируем сообщение на месте
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, extra);
      if (ctx.callbackQuery.message?.message_id) {
        userActiveMessageMap.set(userId, ctx.callbackQuery.message.message_id);
      }
      return;
    } catch (err) {
      const desc = err.description || err.message || '';
      // Если контент не изменился — выходим без ошибок
      if (desc.includes('message is not modified')) {
        return;
      }
      // Если не удалось отредактировать (сообщение старое/удалено) — переходим к удалению и переотправке
    }
  }

  // 3. Удаляем предыдущее сообщение бота в этом чате, если оно есть
  const prevMsgId = userActiveMessageMap.get(userId);
  if (prevMsgId) {
    try {
      await ctx.api.deleteMessage(chatId, prevMsgId);
    } catch (_) {
      // Игнорируем, если сообщение уже удалено
    }
  }

  // 4. Отправляем ровно одно свежее сообщение и запоминаем его ID
  try {
    const sent = await ctx.reply(text, extra);
    userActiveMessageMap.set(userId, sent.message_id);
    return sent;
  } catch (err) {
    console.error('[CleanChat] Ошибка отправки экрана:', err.message);
  }
}
