/**
 * Ожидание текстового ввода от жильца (точное время, пожелание, новое время заказа).
 *
 * Одно состояние на пользователя: новый запрос ввода заменяет предыдущий.
 * Состояние сбрасывается при любом нажатии кнопки или команде (см. middleware в bot.js),
 * поэтому если жилец ушёл с экрана ввода, его следующее сообщение не будет «съедено».
 * Обработчики кнопок, которые запрашивают ввод, выставляют состояние уже после сброса.
 */

const pending = new Map(); // userId -> { type, ...data }

// Состояние устаревает, если жилец так ничего и не написал
const TTL_MS = 30 * 60 * 1000;

export function setPendingInput(userId, type, data = {}) {
  pending.set(userId, { type, ...data, createdAt: Date.now() });
}

export function getPendingInput(userId, type) {
  const state = pending.get(userId);
  if (!state) return null;
  if (Date.now() - state.createdAt > TTL_MS) {
    pending.delete(userId);
    return null;
  }
  return state.type === type ? state : null;
}

export function clearPendingInput(userId) {
  pending.delete(userId);
}

// Middleware: любая кнопка или команда означает, что жилец ушёл с экрана ввода
export function resetPendingInputMiddleware(ctx, next) {
  const userId = ctx.from?.id;
  if (userId && (ctx.callbackQuery || ctx.message?.text?.startsWith('/'))) {
    pending.delete(userId);
  }
  return next();
}
