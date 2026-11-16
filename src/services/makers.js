/**
 * «Домашнее и ручное»: разбор постов мастеров, разделы, свежесть наличия.
 */
import { getMinskParts, parseDbUtc, formatMinskTime } from '../utils/time.js';
import { cleanEntities } from '../utils/richText.js';

// Разделы для сводки «Что есть сейчас». Порядок — порядок показа.
export const MAKER_CATEGORIES = [
  { id: 'meals', title: '🍲 Готовая еда' },
  { id: 'blini', title: '🥟 Полуфабрикаты' },
  { id: 'bake', title: '🥐 Выпечка' },
  { id: 'dessert', title: '🍰 Торты и десерты' },
  { id: 'drinks', title: '🍵 Напитки' },
  { id: 'craft', title: '🧶 Ручная работа' },
  { id: 'other', title: '📦 Другое' },
];

export const CATEGORY_BY_ID = Object.fromEntries(MAKER_CATEGORIES.map(c => [c.id, c]));

// Наличие считается устаревшим, если мастер не обновлял его дольше этого срока
export const STOCK_STALE_DAYS = 3;
// Не чаще одной рассылки подписчикам за этот интервал
export const NOTIFY_COOLDOWN_HOURS = 4;

export const SECTION_TITLE = '🧺 Домашнее и ручное';

// Граница «свежести» наличия в формате SQLite datetime (UTC)
export function staleBoundaryUtc(now = new Date()) {
  const d = new Date(now.getTime() - STOCK_STALE_DAYS * 24 * 60 * 60 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function isStockFresh(maker, now = new Date()) {
  if (!maker?.stock_updated_at) return false;
  return now - parseDbUtc(maker.stock_updated_at) <= STOCK_STALE_DAYS * 24 * 60 * 60 * 1000;
}

// «сегодня в 19:40» / «вчера в 19:40» / «12.11 в 19:40»
export function formatWhen(dbValue, now = new Date()) {
  const date = parseDbUtc(dbValue);
  const p = getMinskParts(date);
  const today = getMinskParts(now);
  const yesterday = getMinskParts(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const time = formatMinskTime(date);
  const same = (a, b) => a.year === b.year && a.month === b.month && a.day === b.day;
  if (same(p, today)) return `сегодня в ${time}`;
  if (same(p, yesterday)) return `вчера в ${time}`;
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')} в ${time}`;
}

export function notifyCooldownLeftMinutes(maker, now = new Date()) {
  if (!maker?.last_notified_at) return 0;
  const left = NOTIFY_COOLDOWN_HOURS * 60 - (now - parseDbUtc(maker.last_notified_at)) / 60000;
  return Math.max(0, Math.ceil(left));
}

// Цена в посте: «0,5кг - 14р», «0,4кг (4шт) - 15р», «1 кубик - 5р.»
const PRICE_RE = /(\d+(?:[.,]\d+)?\s*(?:кг|гр|г|шт|мл|л|кубик[а-я]*|порци[а-я]*)?\.?(?:\s*\([^)\n]*\))?)\s*[-–—=:]\s*(\d+(?:[.,]\d+)?)\s*(?:руб(?:лей|ля|\.)?|р\.?|byn)(?![а-яёa-z])/giu;

function parsePrice(text) {
  const matches = [...text.matchAll(PRICE_RE)];
  if (matches.length === 0) return null;
  if (matches.length === 1) {
    const [, unit, price] = matches[0];
    return `${price} р / ${unit.replace(/\s+/g, ' ').replace(/\.$/, '').trim()}`;
  }
  // Несколько вариантов в одном посте (например, блины с разными начинками) — «от N р»
  const min = Math.min(...matches.map(m => Number(m[2].replace(',', '.'))));
  return `от ${String(min).replace('.', ',')} р`;
}

// Строка-вариант: «▪️С печенью», «• С ветчиной и сыром», «- Рафаэло»
const VARIANT_LINE_RE = /^\s*(?:▪️|▪|▫️|▫|◾️|◾|◽️|◽|•|·|🔸|🔹|🔺|✔️|➖|[-–—*])\s*(.+?)\s*$/u;

/**
 * Найти варианты внутри поста (несколько начинок под одним фото).
 * Цена варианта — первая строка с ценой после него и до следующего варианта.
 * Вариантами считаем, только если их хотя бы два.
 */
export function parseVariants(text) {
  const variants = [];
  for (const line of text.split('\n')) {
    const m = line.match(VARIANT_LINE_RE);
    if (m) {
      const name = m[1].replace(/[\s.:;,]+$/u, '').trim();
      if (name && name.length <= 60) variants.push({ name, price: null });
      continue;
    }
    const current = variants[variants.length - 1];
    if (current && !current.price) {
      const price = [...line.matchAll(PRICE_RE)][0];
      if (price) current.price = `${price[2]} р`;
    }
  }
  return variants.length >= 2 ? variants : [];
}

// «С печенью» → «с печенью» для перечислений внутри фразы
export function variantNameInline(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

export function variantsSummary(item) {
  return item.variants.filter(v => v.in_stock).map(v => variantNameInline(v.name)).join(', ');
}

function parseTitle(text) {
  const firstLine = text.split('\n').map(l => l.trim()).find(Boolean) || '';
  let title = firstLine
    .replace(/^[^\p{L}\p{N}]+/u, '')   // эмодзи и маркеры в начале
    .replace(/[\s.:;,!]+$/u, '')       // точка/двоеточие в конце
    .trim();
  if (title.length > 48) title = `${title.slice(0, 47).trim()}…`;
  return title || 'Без названия';
}

/**
 * Разобрать пост мастера: название — первая строка, цена — строка вида «0,5кг - 14р».
 * Текст и форматирование сохраняются целиком, как прислал мастер.
 */
export function parseMakerPost({ text = '', entities = [], photos = [] }) {
  const body = text.trim() ? text : '';
  // trim в начале сдвинул бы смещения entities, поэтому убираем только хвостовые пробелы
  const trimmedBody = body.replace(/\s+$/u, '');
  return {
    title: parseTitle(trimmedBody),
    priceText: parsePrice(trimmedBody),
    body: trimmedBody,
    bodyEntities: cleanEntities(entities).filter(e => e.offset < trimmedBody.length)
      .map(e => ({ ...e, length: Math.min(e.length, trimmedBody.length - e.offset) })),
    photos,
    variants: parseVariants(trimmedBody),
  };
}

export function itemButtonLabel(item, { withStock = false } = {}) {
  const mark = withStock && item.in_stock ? '✅ ' : '';
  return `${mark}${item.title}${item.price_text ? ` · ${item.price_text}` : ''}`;
}

// Контакт мастера → ссылка для кнопки «Написать» (только @username; телефон показываем текстом)
export function contactUrl(contact) {
  const m = String(contact || '').trim().match(/^@?([A-Za-z][A-Za-z0-9_]{4,31})$/);
  return m ? `https://t.me/${m[1]}` : null;
}
