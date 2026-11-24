/**
 * «Услуги и красота»: категории, разбор постов, форматирование горящих окон и ссылок записи.
 */
import { getMinskParts, formatMinskTime, parseDbUtc, minskDateAt } from '../utils/time.js';
import { parseMakerPost, formatWhen, contactUrl } from './makers.js';

export const SERVICE_SECTION_TITLE = '💅 Услуги и красота';

export const SERVICE_CATEGORIES = [
  { id: 'nails', title: '💅 Маникюр и педикюр' },
  { id: 'massage', title: '💆 Массаж и SPA' },
  { id: 'brows', title: '👁 Брови, ресницы, макияж' },
  { id: 'hair', title: '✂️ Волосы и барбер' },
  { id: 'cosmo', title: '✨ Косметология и депиляция' },
  { id: 'other', title: '🌟 Другие услуги' },
];

export const SERVICE_CATEGORY_BY_ID = Object.fromEntries(SERVICE_CATEGORIES.map(c => [c.id, c]));

// Не чаще одной рассылки о горящем окне раз в 2 часа
export const HOT_NOTIFY_COOLDOWN_MINUTES = 120;

export { parseMakerPost as parseServicePost, formatWhen, contactUrl };

export function offerButtonLabel(offer) {
  const parts = [offer.title];
  if (offer.price_text) parts.push(offer.price_text);
  if (offer.duration_text) parts.push(offer.duration_text);
  return parts.join(' · ');
}

/**
 * Ссылка в личку Telegram с предзаполненным сообщением (t.me/username?text=...).
 */
export function prefilledContactUrl(contact, messageText) {
  const base = contactUrl(contact);
  if (!base) return null;
  if (!messageText) return base;
  return `${base}?text=${encodeURIComponent(messageText)}`;
}

/**
 * Проверка и нормализация внешней ссылки онлайн-записи (Dikidi, Yclients, Instagram и т.п.).
 */
export function normalizeBookingUrl(raw) {
  const str = String(raw || '').trim();
  if (!str || str === '-') return null;
  const candidate = /^https?:\/\//i.test(str) ? str : `https://${str}`;
  try {
    const u = new URL(candidate);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')) {
      return u.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function hotNotifyCooldownLeftMinutes(provider, now = new Date()) {
  if (!provider?.last_hot_notified_at) return 0;
  const elapsedMin = (now - parseDbUtc(provider.last_hot_notified_at)) / 60000;
  return Math.max(0, Math.ceil(HOT_NOTIFY_COOLDOWN_MINUTES - elapsedMin));
}

/**
 * Построить UTC строку 'YYYY-MM-DD HH:MM:SS' для дня (0 = сегодня, 1 = завтра, 2 = послезавтра) и времени по Минску.
 */
export function buildHotSlotUtc(dayOffset, hours, minutes, now = new Date()) {
  const ref = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  const target = minskDateAt(hours, minutes, ref);
  return target.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Подпись дня для выбора даты горящего окна.
 */
export function dayOffsetLabel(dayOffset, now = new Date()) {
  const target = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  const p = getMinskParts(target);
  const ddmm = `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}`;
  if (dayOffset === 0) return `Сегодня (${ddmm})`;
  if (dayOffset === 1) return `Завтра (${ddmm})`;
  if (dayOffset === 2) return `Послезавтра (${ddmm})`;
  return ddmm;
}

/**
 * Человекопонятное время окна: «Сегодня в 17:30», «Завтра в 11:00», «26.11 в 14:00».
 */
export function formatHotSlotWhen(slotAtUtc, now = new Date()) {
  const date = parseDbUtc(slotAtUtc);
  const p = getMinskParts(date);
  const today = getMinskParts(now);
  const tomorrow = getMinskParts(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const afterTomorrow = getMinskParts(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000));
  const sameDay = (a, b) => a.year === b.year && a.month === b.month && a.day === b.day;
  const time = formatMinskTime(date);
  if (sameDay(p, today)) return `Сегодня в ${time}`;
  if (sameDay(p, tomorrow)) return `Завтра в ${time}`;
  if (sameDay(p, afterTomorrow)) return `Послезавтра в ${time}`;
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')} в ${time}`;
}

/**
 * Разобрать ввод времени вида «17:30», «17.30», «17 30», «17-30» или «18».
 */
export function parseSlotTimeInput(input) {
  const trimmed = String(input || '').trim();
  const full = trimmed.match(/^(\d{1,2})[:.\-\s](\d{2})$/);
  if (full) {
    const hh = Number(full[1]);
    const mm = Number(full[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return { ok: true, hh, mm };
    return { ok: false };
  }
  const hourOnly = trimmed.match(/^(\d{1,2})$/);
  if (hourOnly) {
    const hh = Number(hourOnly[1]);
    if (hh >= 0 && hh <= 23) return { ok: true, hh, mm: 0 };
  }
  return { ok: false };
}
