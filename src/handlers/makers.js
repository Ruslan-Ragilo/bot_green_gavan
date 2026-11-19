/**
 * «Домашнее и ручное» — экраны покупателя:
 * раздел → «Что есть сейчас» / мастер → меню → карточка позиции со слайдером фото.
 * Заказов через бота нет: кнопка «Написать» ведёт в личку мастера.
 */
import { Composer, InlineKeyboard } from 'grammy';
import { isAdmin } from '../../config.js';
import {
  getActiveMakers, getMaker, getMakerItems as getAllMakerItems, getMakerItem, getInStockItems, getSectionCover,
  getVisibleCollections, getCollection, getCollectionItems,
  isSubscribed, subscribe, unsubscribe,
} from '../db/repositories/makers.js';
import {
  MAKER_CATEGORIES, CATEGORY_BY_ID, SECTION_TITLE, isStockFresh, formatWhen, staleBoundaryUtc,
  itemButtonLabel, contactUrl, variantsSummary, variantNameInline,
} from '../services/makers.js';
import { rich } from '../utils/richText.js';
import { logMakerEvent, EVENT } from '../db/repositories/makerStats.js';
import { renderScreen } from '../utils/cleanChat.js';

export const makersComposer = new Composer();

// Покупатель видит только опубликованные позиции (скрытые мастер держит у себя, например сезонные)
const getMakerItems = (makerId) => getAllMakerItems(makerId).filter(i => i.published);

const MAX_LIST_BUTTONS = 60;

function show(ctx, built, keyboard, options = {}) {
  return renderScreen(ctx, built.text, { entities: built.entities, reply_markup: keyboard }, options);
}

/*
 * Фото показываются только у позиций (их собственные). Раздел и «Что есть сейчас» могут быть с обложкой,
 * которую задаёт админ; страница мастера — текстом. Листание позиций с фото правит одно сообщение,
 * переход между списком (текст) и позицией (фото) Telegram делает заменой сообщения.
 */
const CAPTION_LIMIT = 1024;

function showWithCover(ctx, r, keyboard, cover) {
  if (cover) return show(ctx, r.build(CAPTION_LIMIT), keyboard, { photo: cover });
  return show(ctx, r.build(4096), keyboard);
}

// Аналитика: действия самого мастера и администратора не считаем
function track(ctx, maker, type, itemId = null) {
  const userId = ctx.from?.id;
  if (!userId || userId === maker.user_id || isAdmin(userId)) return;
  logMakerEvent({ makerId: maker.id, itemId, userId, type });
}

// «Написать мастеру» — сначала кнопка бота (чтобы посчитать переход), она превращается в ссылку на личку
function writeButton(keyboard, maker, itemId = 0) {
  if (contactUrl(maker.contact)) keyboard.text('✉️ Написать мастеру', `mk:w:${maker.id}:${itemId}`).row();
}

// ── Раздел ────────────────────────────────────────────────

export async function showSection(ctx) {
  const makers = getActiveMakers();
  const r = rich()
    .bold(SECTION_TITLE).nl(2)
    .plain('Домашняя еда, выпечка и вещи ручной работы от местных мастеров.').nl()
    .plain('Заказ и оплата — напрямую у мастера: кнопка «Написать» откроет личные сообщения.');

  const kb = new InlineKeyboard();
  // Тематические подборки — сверху, пока администратор их показывает
  for (const c of getVisibleCollections().filter(c => c.items_count > 0)) {
    kb.text(`${c.title} · ${c.items_count}`, `mk:col:${c.id}`).row();
  }
  if (makers.length === 0) {
    r.nl(2).italic('Мастера скоро появятся.');
  } else {
    kb.text('✅ Что есть сейчас', 'mk:now').row();
    for (const m of makers) {
      const stock = isStockFresh(m) && m.stock_count > 0 ? ` · ✅ ${m.stock_count}` : '';
      kb.text(`👩‍🍳 ${m.name}${stock}`, `mk:m:${m.id}`).row();
    }
  }
  kb.text('🧑‍🍳 Я мастер — разместить свои изделия', 'mkp:home').row();
  kb.text('◀️ В главное меню', 'menu:main');
  return showWithCover(ctx, r, kb, getSectionCover());
}

makersComposer.callbackQuery('mk:home', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showSection(ctx);
});

// ── Что есть сейчас (сводка наличия у всех мастеров) ──────

makersComposer.callbackQuery('mk:now', async (ctx) => {
  await ctx.answerCallbackQuery();
  const items = getInStockItems(staleBoundaryUtc());
  const r = rich().bold('✅ Что есть сейчас').nl(2);
  const kb = new InlineKeyboard();

  if (items.length === 0) {
    r.plain('Сейчас никто не отметил наличие.').nl()
      .plain('Загляните к мастерам — многое делают под заказ.');
  } else {
    let shown = 0;
    for (const cat of MAKER_CATEGORIES) {
      const inCat = items.filter(i => (CATEGORY_BY_ID[i.category] ? i.category : 'other') === cat.id);
      if (inCat.length === 0) continue;
      r.bold(cat.title).nl();
      for (const item of inCat) {
        const variants = item.variants.length ? `: ${variantsSummary(item)}` : '';
        r.plain(`• ${item.title}${variants}`).italic(` — ${item.maker_name}`).nl();
        if (shown < MAX_LIST_BUTTONS) {
          kb.text(`${item.title} · ${item.maker_name}`, `mk:i:${item.id}:0:n`).row();
          shown += 1;
        }
      }
      r.nl();
    }
    r.italic('Нажмите на позицию — покажу фото, состав и цену.');
  }

  kb.text('◀️ Назад', 'mk:home');
  await showWithCover(ctx, r, kb, getSectionCover());
});

// ── Страница мастера ──────────────────────────────────────

export async function showMaker(ctx, makerId, { full = false } = {}) {
  const maker = getMaker(makerId);
  if (!maker || maker.status !== 'active') {
    await ctx.answerCallbackQuery?.({ text: 'Мастер сейчас недоступен' }).catch(() => {});
    return showSection(ctx);
  }

  const items = getMakerItems(maker.id);
  const fresh = isStockFresh(maker);
  const inStock = fresh ? items.filter(i => i.in_stock) : [];
  const back = full ? 'a' : 'm';

  const r = rich().bold(`👩‍🍳 ${maker.name}`).nl(2);
  if (maker.about) r.rich(maker.about, maker.about_entities).nl(2);
  if (maker.contact && !contactUrl(maker.contact)) r.plain(`📞 Связь: ${maker.contact}`).nl(2);

  if (!maker.stock_updated_at) {
    r.italic('Наличие уточняйте у мастера.');
  } else if (fresh) {
    r.plain(`🕒 Наличие обновлено ${formatWhen(maker.stock_updated_at)}`);
  } else {
    r.plain(`⚠️ Наличие давно не обновлялось (${formatWhen(maker.stock_updated_at)}) — уточняйте у мастера.`);
  }

  const kb = new InlineKeyboard();
  if (full) {
    r.nl(2).bold('📋 Всё меню').nl()
      .italic(fresh ? '✅ — есть в наличии, остальное под заказ.' : 'Нажмите на позицию, чтобы посмотреть фото и состав.');
    const sorted = sortByCategory(items);
    for (const item of sorted.slice(0, MAX_LIST_BUTTONS)) {
      kb.text(itemButtonLabel(item, { withStock: fresh }), `mk:i:${item.id}:0:${back}`).row();
    }
  } else {
    if (inStock.length > 0) {
      r.nl(2).bold('✅ Сейчас в наличии:');
      for (const item of inStock.slice(0, MAX_LIST_BUTTONS)) {
        kb.text(itemButtonLabel(item), `mk:i:${item.id}:0:${back}`).row();
      }
    }
    if (items.length > inStock.length || items.length === 0) {
      if (items.length > 0) kb.text(`📋 Всё меню (${items.length})`, `mk:all:${maker.id}`).row();
    }
  }

  const subscribed = isSubscribed(ctx.from.id, maker.id);
  writeButton(kb, maker);
  kb.text(subscribed ? '🔕 Отписаться от мастера' : '🔔 Подписаться на мастера', `mk:sub:${maker.id}:${full ? 'a' : 'm'}`).row();
  kb.text('◀️ Назад', full ? `mk:m:${maker.id}` : 'mk:home');
  return show(ctx, r.build(4096), kb);
}

// Порядок как в списках: по разделам, внутри раздела — как пришло (стабильная сортировка)
function sortByCategory(items) {
  return [...items].sort((a, b) => categoryIndex(a) - categoryIndex(b));
}

// Список, по которому листаются позиции, — тот, из которого покупатель открыл карточку
function browseList(back, maker) {
  if (back === 'n') return sortByCategory(getInStockItems(staleBoundaryUtc()));
  if (back.startsWith('c')) return getCollectionItems(Number(back.slice(1)));
  const items = getMakerItems(maker.id);
  if (back === 'a') return sortByCategory(items);
  const inStock = isStockFresh(maker) ? items.filter(i => i.in_stock) : [];
  return inStock.length > 0 ? inStock : items;
}

function categoryIndex(item) {
  const idx = MAKER_CATEGORIES.findIndex(c => c.id === item.category);
  return idx === -1 ? MAKER_CATEGORIES.length : idx;
}

makersComposer.callbackQuery(/^mk:m:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const maker = getMaker(Number(ctx.match[1]));
  if (maker?.status === 'active') track(ctx, maker, EVENT.VIEW_MAKER);
  await showMaker(ctx, Number(ctx.match[1]));
});

makersComposer.callbackQuery(/^mk:all:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const maker = getMaker(Number(ctx.match[1]));
  if (maker?.status === 'active') track(ctx, maker, EVENT.VIEW_MAKER);
  await showMaker(ctx, Number(ctx.match[1]), { full: true });
});

// Нажали «Написать мастеру»: считаем переход и меняем кнопку на ссылку в личку (без нового сообщения)
makersComposer.callbackQuery(/^mk:w:(\d+):(\d+)$/, async (ctx) => {
  const maker = getMaker(Number(ctx.match[1]));
  const url = maker && maker.status === 'active' ? contactUrl(maker.contact) : null;
  if (!url) {
    await ctx.answerCallbackQuery({ text: 'Контакт мастера сейчас недоступен' });
    return;
  }
  track(ctx, maker, EVENT.CONTACT, Number(ctx.match[2]) || null);
  await ctx.answerCallbackQuery({ text: '👇 Нажмите «Открыть чат» — откроется личка мастера' });
  const rows = ctx.callbackQuery.message?.reply_markup?.inline_keyboard;
  if (rows) {
    const updated = rows.map(row => row.map(b => (b.callback_data === ctx.callbackQuery.data
      ? { text: '💬 Открыть чат с мастером', url }
      : b)));
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: updated } }).catch(() => {});
  }
});

makersComposer.callbackQuery(/^mk:sub:(\d+):([ma])$/, async (ctx) => {
  const makerId = Number(ctx.match[1]);
  const maker = getMaker(makerId);
  if (!maker || maker.status !== 'active') {
    await ctx.answerCallbackQuery({ text: 'Мастер сейчас недоступен' });
    return;
  }
  if (isSubscribed(ctx.from.id, makerId)) {
    unsubscribe(ctx.from.id, makerId);
    await ctx.answerCallbackQuery({ text: 'Вы отписались от новостей мастера' });
  } else {
    subscribe(ctx.from.id, makerId);
    await ctx.answerCallbackQuery({
      text: `🔔 Вы подписаны на «${maker.name}». Пришлю, когда появится что-то свежее, — с фото и кнопкой к позиции.`,
      show_alert: true,
    });
  }
  await showMaker(ctx, makerId, { full: ctx.match[2] === 'a' });
});

// Отписка прямо из уведомления (сообщение уведомления не превращаем в экран)
makersComposer.callbackQuery(/^mk:unsub:(\d+)$/, async (ctx) => {
  unsubscribe(ctx.from.id, Number(ctx.match[1]));
  await ctx.answerCallbackQuery({ text: 'Вы отписались от новостей мастера' });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
});

// ── Карточка позиции: фото-слайдер + пост мастера ─────────

// back: m — страница мастера, a — всё меню, n — «Что есть сейчас», c<id> — подборка
function backTarget(back, makerId) {
  if (back === 'n') return 'mk:now';
  if (back.startsWith('c')) return `mk:col:${back.slice(1)}`;
  if (back === 'a') return `mk:all:${makerId}`;
  return `mk:m:${makerId}`;
}

export function buildItemCard(item, maker, { photoIndex = 0, back = 'm', preview = false } = {}) {
  const fresh = isStockFresh(maker);
  const photos = item.photos || [];
  const idx = photos.length ? ((photoIndex % photos.length) + photos.length) % photos.length : 0;

  const r = rich();
  if (item.body) r.rich(item.body, item.body_entities).nl(2);
  else r.bold(item.title).nl(2);

  if (!fresh) {
    r.plain('ℹ️ Наличие уточняйте у мастера');
  } else if (item.variants.length) {
    // Варианты в одном посте: что есть сейчас, остальное — под заказ
    const yes = item.variants.filter(v => v.in_stock).map(v => variantNameInline(v.name));
    const no = item.variants.filter(v => !v.in_stock).map(v => variantNameInline(v.name));
    if (yes.length === item.variants.length) {
      r.plain('✅ Все варианты в наличии');
    } else if (yes.length === 0) {
      r.plain('📝 Все варианты под заказ');
    } else {
      if (yes.length) r.plain('✅ Сейчас есть: ').bold(yes.join(', '));
      if (yes.length && no.length) r.nl();
      if (no.length) r.plain(`📝 Под заказ: ${no.join(', ')}`);
    }
  } else if (item.in_stock) {
    r.plain('✅ Есть в наличии');
  } else {
    r.plain('📝 Под заказ');
  }
  r.nl().plain(`👩‍🍳 ${maker.name}`);

  const kb = new InlineKeyboard();
  if (photos.length > 1) {
    const base = preview ? `mkp:pv:${item.id}` : `mk:i:${item.id}`;
    const suffix = preview ? '' : `:${back}`;
    kb.text('◀️ фото', `${base}:${idx - 1 < 0 ? photos.length - 1 : idx - 1}${suffix}`)
      .text(`${idx + 1} / ${photos.length}`, 'noop')
      .text('фото ▶️', `${base}:${(idx + 1) % photos.length}${suffix}`)
      .row();
  }

  // Только собственные фото позиции; без фото — обычная текстовая карточка
  const photo = photos[idx] || null;
  return {
    built: r.build(photo ? CAPTION_LIMIT : 4096),
    photo,
    keyboard: kb,
  };
}

makersComposer.callbackQuery(/^mk:i:(\d+):(\d+):([man]|c\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const item = getMakerItem(Number(ctx.match[1]));
  const maker = item && getMaker(item.maker_id);
  if (!item || !maker || maker.status !== 'active') {
    return showSection(ctx);
  }
  if (!item.published) return showMaker(ctx, maker.id); // мастер скрыл позицию
  if (Number(ctx.match[2]) === 0) track(ctx, maker, EVENT.VIEW_ITEM, item.id); // листание фото не считаем
  const back = ctx.match[3];
  const { built, photo, keyboard } = buildItemCard(item, maker, {
    photoIndex: Number(ctx.match[2]), back,
  });

  // Листание позиций по кругу внутри текущего списка
  const list = browseList(back, maker);
  const pos = list.findIndex(i => i.id === item.id);
  if (pos !== -1 && list.length > 1) {
    const prev = list[(pos - 1 + list.length) % list.length];
    const next = list[(pos + 1) % list.length];
    keyboard
      .text('⬅️ Пред.', `mk:i:${prev.id}:0:${back}`)
      .text(`${pos + 1} из ${list.length}`, 'noop')
      .text('След. ➡️', `mk:i:${next.id}:0:${back}`)
      .row();
  }
  writeButton(keyboard, maker, item.id);
  if (back !== 'm') keyboard.text(`👩‍🍳 Все позиции мастера`, `mk:m:${maker.id}`).row();
  keyboard.text('◀️ К списку', backTarget(back, maker.id));
  await show(ctx, built, keyboard, photo ? { photo } : {});
});

// ── Тематическая подборка ─────────────────────────────────

makersComposer.callbackQuery(/^mk:col:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const collection = getCollection(Number(ctx.match[1]));
  // Скрытую подборку видит только администратор (предпросмотр перед показом)
  if (!collection || (!collection.visible && !isAdmin(ctx.from.id))) return showSection(ctx);

  const items = getCollectionItems(collection.id);
  const r = rich().bold(collection.title).nl(2);
  if (collection.description) r.rich(collection.description, collection.description_entities).nl(2);
  if (!collection.visible) r.italic('Подборка скрыта — её видите только вы.').nl(2);

  const kb = new InlineKeyboard();
  if (items.length === 0) {
    r.plain('Мастера ещё не добавили сюда позиции.');
  } else {
    // Перечень по мастерам, кнопки — сразу к позициям
    const byMaker = new Map();
    for (const item of items) {
      if (!byMaker.has(item.maker_name)) byMaker.set(item.maker_name, []);
      byMaker.get(item.maker_name).push(item);
    }
    for (const [makerName, list] of byMaker) {
      r.bold(`👩‍🍳 ${makerName}`).nl();
      for (const item of list) r.plain(`• ${itemButtonLabel(item)}`).nl();
      r.nl();
    }
    r.italic('Нажмите на позицию — покажу фото и описание. Заказ — напрямую у мастера.');
    for (const item of items.slice(0, MAX_LIST_BUTTONS)) {
      kb.text(`${item.title} · ${item.maker_name}`, `mk:i:${item.id}:0:c${collection.id}`).row();
    }
  }
  kb.text('◀️ Назад', 'mk:home');
  await show(ctx, r.build(4096), kb);
});
