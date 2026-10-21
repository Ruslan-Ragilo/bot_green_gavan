/**
 * Экранирование специальных символов для Telegram Markdown v1:
 * _ * ` [
 */
export function escapeMarkdown(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[_*`\[]/g, '\\$&');
}
