/**
 * Экранирование специальных символов для Telegram Markdown v1:
 * _ * ` [
 */
export function escapeMarkdown(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[_*`\[]/g, '\\$&');
}

/**
 * Форматирование цены в белорусских рублях (BYN)
 */
export function formatPrice(price) {
  const num = Number(price) || 0;
  return `${num.toFixed(2).replace(/\.00$/, '')} BYN`;
}

