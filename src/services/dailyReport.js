/**
 * Ежедневный отчёт заведения: выручка через бота, клиенты, топ блюд, потери.
 */
import { getPlaceDailyReport } from '../db/repositories/orders.js';
import { escapeMarkdown, formatPrice, plural } from '../utils/text.js';
import { minskDateStr } from '../utils/time.js';

const REASON_LABELS = {
  no_ingredients: 'нет ингредиентов',
  closing: 'закрывались',
  overloaded: 'перегружена кухня',
  staff: 'без причины',
  admin: 'отменил администратор',
};

function formatDateRu(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Собрать текст отчёта. Возвращает { text, total } — total нужен, чтобы не слать пустые отчёты.
 */
export function buildDailyReport(place, date = minskDateStr()) {
  const r = getPlaceDailyReport(place.id, date);

  let text = `📊 *Итоги дня* — ${escapeMarkdown(place.name)}\n`;
  text += `🗓 ${formatDateRu(date)}\n\n`;

  if (r.total === 0) {
    text += 'Заказов через бота сегодня не было.\n';
    text += `\n📈 *За 7 дней:* ${plural(r.week.total, ['заказ', 'заказа', 'заказов'])}, ${formatPrice(r.week.revenue)}`;
    return { text, total: 0 };
  }

  text += `✅ *Выдано:* ${r.issued} из ${r.total} на *${formatPrice(r.revenue)}*\n`;
  if (r.issued > 0) {
    text += `🧾 *Средний чек:* ${formatPrice(r.revenue / r.issued)}\n`;
  }
  text += `👥 *Клиентов:* ${r.customers} (новых: ${r.newCustomers})\n`;
  if (r.avgAcceptMinutes !== null && r.avgAcceptMinutes !== undefined) {
    text += `⚡ *Среднее время принятия:* ${Math.max(1, Math.round(r.avgAcceptMinutes))} мин\n`;
  }
  if (r.active > 0) {
    text += `⏳ *Ещё в работе:* ${r.active}\n`;
  }

  if (r.topItems.length > 0) {
    text += `\n🏆 *Топ:* ${r.topItems.map(i => `${escapeMarkdown(i.name)} ×${i.qty}`).join(', ')}\n`;
  }

  const losses = [];
  if (r.rejected > 0) {
    const reasons = r.rejectReasons.map(x => `${REASON_LABELS[x.reason] || x.reason} — ${x.c}`).join(', ');
    losses.push(`• Отклонено: ${r.rejected} (${reasons})`);
  }
  if (r.expired > 0) losses.push(`• Не успели принять: ${r.expired}`);
  if (r.cancelled_by_client > 0) losses.push(`• Отменили клиенты: ${r.cancelled_by_client}`);
  if (r.no_show > 0) losses.push(`• Не забрали: ${r.no_show} (${formatPrice(r.no_show_sum)})`);

  if (losses.length > 0) {
    text += `\n⚠️ *Потери:*\n${losses.join('\n')}\n`;
    const lost = r.rejected_sum + r.expired_sum + r.no_show_sum;
    if (lost > 0) {
      text += `💸 *Упущенная выручка:* ${formatPrice(lost)}\n`;
    }
  }

  text += `\n📈 *За 7 дней:* ${plural(r.week.total, ['заказ', 'заказа', 'заказов'])}, ${formatPrice(r.week.revenue)}`;
  return { text, total: r.total };
}
