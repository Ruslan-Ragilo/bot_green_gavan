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

/**
 * Склонение по числу: plural(5, ['заказ', 'заказа', 'заказов']) → «5 заказов»
 */
export function plural(n, [one, few, many]) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  const word = abs > 10 && abs < 20 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return `${n} ${word}`;
}
