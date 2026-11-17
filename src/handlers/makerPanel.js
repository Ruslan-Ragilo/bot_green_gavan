/**
 * Кабинет мастера (/master или кнопка в разделе «Домашнее и ручное»):
 *  - заявка на размещение → одобрение администратором;
 *  - добавление позиции: мастер присылает пост как в группу (фото/альбом + подпись), бот сохраняет его как есть;
 *  - наличие кнопками ✅/❌ и рассылка подписчикам;
 *  - администратор: одобрение заявок, /makers, /maker_owner (передать карточку мастеру).
 */
import { Composer, InlineKeyboard } from 'grammy';
import { config, isAdmin } from '../../config.js';
import {
  getMaker, getMakerByUser, createMaker, resubmitMaker, updateMakerProfile, setMakerStatus, setMakerOwner,
  getAllMakers, getMakerItems, getMakerItem, createMakerItem, replaceMakerItemPost, updateMakerItemField,
  toggleMakerItemStock, deleteMakerItem, touchMakerStock, markMakerNotified,
  getSubscriberIds, countSubscribers, unsubscribe, findUserIdByUsername, deleteMaker,
  getSectionCover, setSectionCover, setVariantStock, clearVariants,
} from '../db/repositories/makers.js';
import {
  MAKER_CATEGORIES, CATEGORY_BY_ID, parseMakerPost, formatWhen, isStockFresh, notifyCooldownLeftMinutes,
  itemButtonLabel, variantsSummary,
} from '../services/makers.js';
import { buildItemCard } from './makers.js';
import { syncMakerCommands } from '../services/botCommands.js';
import { rich, cleanEntities } from '../utils/richText.js';
import { renderScreen } from '../utils/cleanChat.js';
import { setPendingInput, getPendingInput, clearPendingInput } from '../utils/pendingInput.js';

export const makerPanelComposer = new Composer();

const MAX_ITEMS = 60;
const ALBUM_WAIT_MS = 1200;

function show(ctx, built, keyboard, options = {}) {
  return renderScreen(ctx, built.text, { entities: built.entities, reply_markup: keyboard }, options);
}

function ownMaker(ctx) {
  const maker = getMakerByUser(ctx.from.id);
  return maker && maker.status === 'active' ? maker : null;
}

// Позиция принадлежит этому мастеру?
function ownItem(ctx, itemId) {
  const maker = ownMaker(ctx);
  const item = maker && getMakerItem(itemId);
  return item && item.maker_id === maker.id ? { maker, item } : null;
}

// ── Главный экран кабинета ────────────────────────────────

export async function showPanel(ctx) {
  const maker = getMakerByUser(ctx.from.id);
  const r = rich();
  const kb = new InlineKeyboard();

  if (!maker || maker.status === 'rejected') {
    r.bold('🧑‍🍳 Кабинет мастера').nl(2)
      .plain('Готовите или делаете что-то своими руками? Разместите свои изделия в боте:').nl()
      .plain('• карточка с фото, составом и ценами;').nl()
      .plain('• отметка «что есть в наличии» — покупатели видят её сразу;').nl()
      .plain('• подписчики получают уведомление, когда вы обновляете наличие.').nl(2)
      .plain('Заказы и оплата — напрямую у вас в личке, бот в них не вмешивается. На старте всё бесплатно.');
    if (maker?.status === 'rejected') r.nl(2).italic('Прошлая заявка не была одобрена — можно отправить новую.');
    kb.text('📝 Отправить заявку', 'mkp:apply').row();
    kb.text('◀️ Назад', 'mk:home');
    return show(ctx, r.build(), kb);
  }

  if (maker.status === 'pending') {
    r.bold('⏳ Заявка на рассмотрении').nl(2)
      .plain(`«${maker.name}» — проверим и откроем доступ. Я пришлю сообщение, как только всё будет готово.`);
    if (!maker.contact) {
      r.nl(2).italic('У вас в Telegram не указан username, поэтому кнопка «Написать» не откроет вашу личку. После одобрения укажите контакт в кабинете: «Описание и контакт».');
    }
    kb.text('◀️ Назад', 'mk:home');
    return show(ctx, r.build(), kb);
  }

  if (maker.status === 'hidden') {
    r.bold('🙈 Карточка скрыта').nl(2).plain('Карточка временно скрыта администратором. Напишите автору бота, если это ошибка.');
    kb.text('◀️ Назад', 'mk:home');
    return show(ctx, r.build(), kb);
  }

  const items = getMakerItems(maker.id);
  const subs = countSubscribers(maker.id);
  const fresh = isStockFresh(maker);

  r.bold(`🧑‍🍳 Кабинет: ${maker.name}`).nl(2)
    .plain(`🔔 Подписчиков: ${subs}`).nl()
    .plain(maker.stock_updated_at ? `🕒 Наличие обновлено ${formatWhen(maker.stock_updated_at)}` : '🕒 Наличие ещё не отмечали');
  if (maker.stock_updated_at && !fresh) {
    r.nl().italic('Покупатели видят «наличие уточняйте» — подтвердите или обновите его.');
  }

  if (items.length === 0) {
    r.nl(2).plain('Добавьте первую позицию: пришлите пост, как публикуете в группе, — фото и описание.');
  } else {
    r.nl(2).bold('Наличие').plain(' — нажмите на позицию, чтобы переключить ✅ / ❌:');
    for (const item of items.slice(0, MAX_ITEMS)) {
      if (item.variants.length) {
        const on = item.variants.filter(v => v.in_stock).length;
        kb.text(`${on ? '✅' : '❌'} ${item.title} (${on} из ${item.variants.length}) ›`, `mkp:v:${item.id}`).row();
      } else {
        kb.text(`${item.in_stock ? '✅' : '❌'} ${item.title}`, `mkp:t:${item.id}`).row();
      }
    }
    kb.text('👍 Наличие актуально', 'mkp:fresh').text('📣 Сообщить подписчикам', 'mkp:notify').row();
  }

  kb.text('➕ Добавить позицию', 'mkp:add').text('📖 Как оформить', 'mkp:guide:h').row();
  if (items.length > 0) kb.text('✏️ Изменить позиции', 'mkp:items').row();
  kb.text('👤 Описание и контакт', 'mkp:profile').text('👀 Как видят', `mk:m:${maker.id}`).row();
  kb.text('◀️ Назад', 'mk:home');
  return show(ctx, r.build(), kb);
}

makerPanelComposer.command('master', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  await showPanel(ctx);
});

makerPanelComposer.callbackQuery('mkp:home', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPanel(ctx);
});

// ── Заявка ────────────────────────────────────────────────

makerPanelComposer.callbackQuery('mkp:apply', async (ctx) => {
  await ctx.answerCallbackQuery();
  const existing = getMakerByUser(ctx.from.id);
  if (existing && existing.status !== 'rejected') return showPanel(ctx);

  setPendingInput(ctx.from.id, 'maker_apply_name');
  await show(ctx, rich()
    .bold('📝 Заявка мастера — шаг 1 из 2').nl(2)
    .plain('Как вас подписать в боте? Имя или название, например: «Надежда — домашние полуфабрикаты».')
    .build(), new InlineKeyboard().text('✖️ Отмена', 'mkp:home'));
});

async function askAbout(ctx, step) {
  await show(ctx, rich()
    .bold(step).nl(2)
    .plain('Пара слов о себе и условиях: что готовите или делаете, как заказать, сроки, где забирать.').nl(2)
    .italic('Можно оформить текст жирным или курсивом прямо в Telegram — так он и будет показан.')
    .build(), new InlineKeyboard().text('✖️ Отмена', 'mkp:home'));
}

async function notifyAdminsAboutApplication(api, maker, from) {
  const r = rich().bold('🧑‍🍳 Новая заявка мастера').nl(2)
    .plain(`Имя: ${maker.name}`).nl()
    .plain(`Telegram: ${from.username ? `@${from.username}` : 'нет username'} (id ${from.id})`).nl(2)
    .rich(maker.about, maker.about_entities);
  const built = r.build();
  const kb = new InlineKeyboard().text('✅ Одобрить', `mka:ok:${maker.id}`).text('❌ Отклонить', `mka:no:${maker.id}`);
  for (const adminId of config.adminIds) {
    try {
      await api.sendMessage(adminId, built.text, { entities: built.entities, reply_markup: kb });
    } catch (err) {
      console.error('[Makers] Не удалось отправить заявку админу:', err.message);
    }
  }
}

// ── Профиль ───────────────────────────────────────────────

makerPanelComposer.callbackQuery('mkp:profile', async (ctx) => {
  await ctx.answerCallbackQuery();
  const maker = ownMaker(ctx);
  if (!maker) return showPanel(ctx);
  const r = rich().bold('👤 Описание и контакт').nl(2)
    .plain(`Имя: ${maker.name}`).nl()
    .plain(`Контакт для кнопки «Написать»: ${maker.contact || 'не указан'}`).nl(2)
    .rich(maker.about || '—', maker.about ? maker.about_entities : []);
  const kb = new InlineKeyboard()
    .text('✏️ Имя', 'mkp:pf:name').text('✏️ Описание', 'mkp:pf:about').row()
    .text('✏️ Контакт', 'mkp:pf:contact').row()
    .text('◀️ В кабинет', 'mkp:home');
  await show(ctx, r.build(), kb);
});

const PROFILE_PROMPTS = {
  name: 'Новое имя или название:',
  about: 'Новое описание (о себе, условия, сроки, где забирать). Форматирование Telegram сохранится.',
  contact: 'Контакт для кнопки «Написать»: ваш @username. Если username нет — телефон, он будет показан текстом.',
};

makerPanelComposer.callbackQuery(/^mkp:pf:(name|about|contact)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ownMaker(ctx)) return showPanel(ctx);
  setPendingInput(ctx.from.id, 'maker_profile', { field: ctx.match[1] });
  await show(ctx, rich().plain(PROFILE_PROMPTS[ctx.match[1]]).build(),
    new InlineKeyboard().text('✖️ Отмена', 'mkp:profile'));
});

// ── Наличие ───────────────────────────────────────────────

makerPanelComposer.callbackQuery(/^mkp:t:(\d+)$/, async (ctx) => {
  const own = ownItem(ctx, Number(ctx.match[1]));
  if (!own) {
    await ctx.answerCallbackQuery();
    return showPanel(ctx);
  }
  if (own.item.variants.length) {
    await ctx.answerCallbackQuery();
    return showVariants(ctx, own.item.id);
  }
  const item = toggleMakerItemStock(own.item.id);
  touchMakerStock(own.maker.id);
  await ctx.answerCallbackQuery({ text: item.in_stock ? `✅ ${item.title} — в наличии` : `❌ ${item.title} — нет в наличии` });
  await showPanel(ctx);
});

// Наличие вариантов внутри одного поста (начинки блинов и т. п.)
async function showVariants(ctx, itemId) {
  const own = ownItem(ctx, itemId);
  if (!own || !own.item.variants.length) return showPanel(ctx);
  const { item } = own;
  const r = rich().bold(`🧩 ${item.title}`).plain(' — что есть сейчас').nl(2)
    .plain('Нажмите на вариант, чтобы переключить ✅ / ❌. Покупатели увидят, что есть, а остальное — под заказ.');
  const kb = new InlineKeyboard();
  item.variants.forEach((v, i) => {
    kb.text(`${v.in_stock ? '✅' : '❌'} ${v.name}${v.price ? ` · ${v.price}` : ''}`, `mkp:vt:${item.id}:${i}`).row();
  });
  kb.text('✅ Всё есть', `mkp:vt:${item.id}:all`).text('❌ Ничего нет', `mkp:vt:${item.id}:none`).row();
  kb.text('◀️ В кабинет', 'mkp:home');
  return show(ctx, r.build(), kb);
}

makerPanelComposer.callbackQuery(/^mkp:v:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showVariants(ctx, Number(ctx.match[1]));
});

makerPanelComposer.callbackQuery(/^mkp:vt:(\d+):(\d+|all|none)$/, async (ctx) => {
  const own = ownItem(ctx, Number(ctx.match[1]));
  if (!own) {
    await ctx.answerCallbackQuery();
    return showPanel(ctx);
  }
  const mode = /^\d+$/.test(ctx.match[2]) ? Number(ctx.match[2]) : ctx.match[2];
  setVariantStock(own.item.id, mode);
  touchMakerStock(own.maker.id);
  await ctx.answerCallbackQuery();
  await showVariants(ctx, own.item.id);
});

makerPanelComposer.callbackQuery(/^mkp:vclr:(\d+)$/, async (ctx) => {
  const own = ownItem(ctx, Number(ctx.match[1]));
  if (own) clearVariants(own.item.id);
  await ctx.answerCallbackQuery({ text: own ? 'Теперь это одна позиция без вариантов' : '' });
  await showItemManage(ctx, Number(ctx.match[1]));
});

makerPanelComposer.callbackQuery('mkp:fresh', async (ctx) => {
  const maker = ownMaker(ctx);
  if (maker) touchMakerStock(maker.id);
  await ctx.answerCallbackQuery({ text: '👍 Отметил: наличие актуально' });
  await showPanel(ctx);
});

// ── Рассылка подписчикам ──────────────────────────────────
// Мастер выбирает, о каких позициях сообщить (бот сам отмечает то, что появилось с прошлой рассылки).
// Подписчик получает фото первой позиции, список «свежее в наличии» и кнопки сразу к этим позициям.

const notifySelections = new Map(); // userId -> { makerId, ids: Set<itemId> }
const MAX_HIGHLIGHT_BUTTONS = 5;

// «Блины: с печенью, с лисичками · от 15 р»
function itemLine(item) {
  const variants = item.variants.length ? `: ${variantsSummary(item)}` : '';
  return `${item.title}${variants}${item.price_text ? ` · ${item.price_text}` : ''}`;
}

function buildNotification(maker, items, highlightIds) {
  const inStock = items.filter(i => i.in_stock);
  const highlighted = inStock.filter(i => highlightIds.has(i.id));
  const others = inStock.filter(i => !highlightIds.has(i.id));

  const r = rich();
  if (highlighted.length > 0) {
    r.bold(`🔔 ${maker.name}`).plain(' — свежее в наличии:').nl();
    for (const item of highlighted) r.plain(`• ${itemLine(item)}`).nl();
    if (others.length > 0) {
      r.nl().italic(`Также есть: ${others.map(i => i.title).join(', ')}`);
    }
  } else {
    r.bold(`🔔 ${maker.name}`).plain(' — обновлено наличие').nl();
    if (inStock.length > 0) for (const item of inStock) r.plain(`• ${itemLine(item)}`).nl();
    else r.plain('Сейчас всё под заказ.');
  }

  const kb = new InlineKeyboard();
  for (const item of highlighted.slice(0, MAX_HIGHLIGHT_BUTTONS)) {
    kb.text(`👀 ${item.title}`, `mk:i:${item.id}:0:m`).row();
  }
  kb.text('👩‍🍳 Всё наличие', `mk:m:${maker.id}`).text('🔕 Отписаться', `mk:unsub:${maker.id}`);

  const photo = highlighted.find(i => i.photos.length)?.photos[0] || inStock.find(i => i.photos.length)?.photos[0] || null;
  return { built: r.build(photo ? 1024 : 4096), photo, kb };
}

function notifyBlocked(maker) {
  const subs = countSubscribers(maker.id);
  if (subs === 0) {
    return 'Пока нет подписчиков. Они появятся, когда покупатели нажмут «🔔 Подписаться на мастера» в вашей карточке.';
  }
  const left = notifyCooldownLeftMinutes(maker);
  if (left > 0) {
    const h = Math.floor(left / 60);
    return `Рассылка уже была недавно. Следующую можно отправить через ${h ? `${h} ч ` : ''}${left % 60} мин — чтобы подписчики не уставали от уведомлений.`;
  }
  return null;
}

async function showNotifyPicker(ctx, maker) {
  const blocked = notifyBlocked(maker);
  const r = rich().bold('📣 Сообщить подписчикам').nl(2);
  const kb = new InlineKeyboard();
  if (blocked) {
    r.plain(blocked);
    kb.text('◀️ В кабинет', 'mkp:home');
    return show(ctx, r.build(), kb);
  }

  const inStock = getMakerItems(maker.id).filter(i => i.in_stock);
  if (inStock.length === 0) {
    r.plain('Сейчас ничего не отмечено в наличии. Отметьте позиции ✅ в кабинете — и сообщите подписчикам.');
    kb.text('◀️ В кабинет', 'mkp:home');
    return show(ctx, r.build(), kb);
  }

  let sel = notifySelections.get(ctx.from.id);
  if (!sel || sel.makerId !== maker.id) {
    // По умолчанию — то, что появилось в наличии после прошлой рассылки
    const before = new Set(maker.notified_stock);
    sel = { makerId: maker.id, ids: new Set(inStock.filter(i => !before.has(i.id)).map(i => i.id)) };
    notifySelections.set(ctx.from.id, sel);
  }
  for (const id of [...sel.ids]) if (!inStock.some(i => i.id === id)) sel.ids.delete(id);

  r.plain(`Получат ${countSubscribers(maker.id)} подписчиков.`).nl()
    .plain('Отметьте, о чём рассказать — это будет вверху сообщения с фото и кнопками. Новое с прошлой рассылки уже отмечено.');
  for (const item of inStock.slice(0, MAX_ITEMS)) {
    kb.text(`${sel.ids.has(item.id) ? '☑️' : '⬜'} ${item.title}`, `mkp:ns:${item.id}`).row();
  }
  kb.text(sel.ids.size ? `👀 Предпросмотр (${sel.ids.size})` : '👀 Предпросмотр', 'mkp:npv').row();
  kb.text('◀️ В кабинет', 'mkp:home');
  return show(ctx, r.build(), kb);
}

makerPanelComposer.callbackQuery('mkp:notify', async (ctx) => {
  await ctx.answerCallbackQuery();
  const maker = ownMaker(ctx);
  if (!maker) return showPanel(ctx);
  notifySelections.delete(ctx.from.id); // каждый раз начинаем с «нового с прошлой рассылки»
  await showNotifyPicker(ctx, maker);
});

makerPanelComposer.callbackQuery(/^mkp:ns:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const maker = ownMaker(ctx);
  if (!maker) return showPanel(ctx);
  const sel = notifySelections.get(ctx.from.id);
  const id = Number(ctx.match[1]);
  if (sel && sel.makerId === maker.id) {
    if (sel.ids.has(id)) sel.ids.delete(id);
    else sel.ids.add(id);
  }
  await showNotifyPicker(ctx, maker);
});

// Предпросмотр: ровно то сообщение, которое получат подписчики
makerPanelComposer.callbackQuery('mkp:npv', async (ctx) => {
  await ctx.answerCallbackQuery();
  const maker = ownMaker(ctx);
  const sel = notifySelections.get(ctx.from.id);
  if (!maker || !sel || sel.makerId !== maker.id || notifyBlocked(maker)) return maker ? showNotifyPicker(ctx, maker) : showPanel(ctx);
  const { built, photo } = buildNotification(maker, getMakerItems(maker.id), sel.ids);
  const kb = new InlineKeyboard().text('📣 Отправить', 'mkp:notify_go').row().text('◀️ Изменить выбор', 'mkp:nback');
  await show(ctx, built, kb, photo ? { photo } : {});
});

makerPanelComposer.callbackQuery('mkp:nback', async (ctx) => {
  await ctx.answerCallbackQuery();
  const maker = ownMaker(ctx);
  if (!maker) return showPanel(ctx);
  await showNotifyPicker(ctx, maker);
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function sendMakerNotification(api, maker, highlightIds = new Set()) {
  const { built, photo, kb } = buildNotification(maker, getMakerItems(maker.id), highlightIds);
  let sent = 0;
  for (const userId of getSubscriberIds(maker.id)) {
    try {
      if (photo) {
        await api.sendPhoto(userId, photo, { caption: built.text, caption_entities: built.entities, reply_markup: kb });
      } else {
        await api.sendMessage(userId, built.text, { entities: built.entities, reply_markup: kb });
      }
      sent += 1;
    } catch (err) {
      // Пользователь заблокировал бота — убираем подписку, чтобы не слать в пустоту
      if (err.error_code === 403) unsubscribe(userId, maker.id);
      else console.error(`[Makers] Уведомление ${userId} не отправлено:`, err.message);
    }
    await sleep(50); // не упираться в лимиты Telegram
  }
  return sent;
}

makerPanelComposer.callbackQuery('mkp:notify_go', async (ctx) => {
  const maker = ownMaker(ctx);
  if (!maker || notifyBlocked(maker)) {
    await ctx.answerCallbackQuery();
    return showPanel(ctx);
  }
  const sel = notifySelections.get(ctx.from.id);
  const highlightIds = sel && sel.makerId === maker.id ? sel.ids : new Set();
  notifySelections.delete(ctx.from.id);

  const inStockIds = getMakerItems(maker.id).filter(i => i.in_stock).map(i => i.id);
  markMakerNotified(maker.id, inStockIds);
  touchMakerStock(maker.id);
  await ctx.answerCallbackQuery({ text: '📣 Рассылка запущена' });
  await showPanel(ctx);
  sendMakerNotification(ctx.api, maker, highlightIds)
    .then((sent) => console.log(`[Makers] «${maker.name}»: уведомление получили ${sent} подписчиков`))
    .catch((err) => console.error('[Makers] Ошибка рассылки:', err));
});

// ── Гайд «Как оформить пост» ──────────────────────────────

const pre = (r, text) => r.add(text, 'pre');

function buildGuide() {
  const r = rich().bold('📖 Как добавить позицию').nl(2);
  r.bold('1. Пришлите пост').nl()
    .plain('Нажмите «➕ Добавить позицию» и пришлите фото (можно до 10) с описанием в подписи. Можно переслать и старый пост из группы.').nl(2);
  r.bold('2. Как оформить подпись').nl();
  pre(r, 'Сырники с маком\n1 шт - 65 гр\nСостав: творог, желток, мак, мука.\n0,5кг - 14р');
  r.nl()
    .plain('• ').bold('Первая строка — название').plain(': коротко, 3–5 слов, оно будет на кнопке.').nl()
    .plain('• ').bold('Цена').plain(': сначала фасовка, потом цена с «р» — «0,5кг - 14р», «4шт - 15р», «1 кубик - 5р».').nl()
    .plain('• Вес и состав — как удобно. Жирный и курсив из Telegram сохранятся.').nl(2);
  r.bold('3. Несколько видов в одном посте').nl()
    .plain('Начинки, вкусы, цвета — начните каждый вид с ▪️ и укажите цену под ним:').nl();
  pre(r, 'Блины\n▪️С печенью\n0,5кг - 15р\n▪️С лисичками\n0,5кг - 16р');
  r.nl().plain('Наличие можно будет отмечать по каждому виду. Обычные строки не начинайте с ▪️, • или «-».').nl(2);
  r.bold('4. Проверьте черновик').nl()
    .plain('Бот покажет, как понял пост: название, цену, варианты. Поправьте, что не так, кнопками «✏️», выберите раздел и нажмите «✅ Сохранить». Посты у всех разные — черновик как раз для этого.').nl(2);
  r.bold('5. Отмечайте наличие').nl()
    .plain('В кабинете нажатие на позицию переключает ✅ есть / ❌ под заказ. Ничего не поменялось — «👍 Наличие актуально». Через 3 дня без обновления покупатели увидят «уточняйте у мастера».').nl(2);
  r.bold('6. Сообщите подписчикам').nl()
    .plain('«📣 Сообщить подписчикам» → отметьте, что появилось → «Отправить». Не чаще раза в 4 часа.').nl(2);
  r.bold('Изменить потом').nl()
    .plain('«✏️ Изменить позиции» → поправьте название или цену, или «🔁 Заменить пост». «👀 Как видят» — посмотреть глазами покупателя.').nl(2);
  r.italic('Подпись к фото — до 1024 символов (≈10–12 строк). Не помещается — разделите на два поста.');
  return r.build();
}

// back: h — в кабинет, a — к добавлению позиции
makerPanelComposer.callbackQuery(/^mkp:guide:([ha])$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard();
  if (ctx.match[1] === 'a') kb.text('➕ Прислать пост', 'mkp:add').row();
  kb.text('◀️ В кабинет', 'mkp:home');
  await show(ctx, buildGuide(), kb);
});

// ── Добавление и замена поста ─────────────────────────────

function askPost(ctx, { replaceItemId = null, error = null } = {}) {
  setPendingInput(ctx.from.id, 'maker_post', { replaceItemId });
  const r = rich().bold(replaceItemId ? '🔁 Заменить пост позиции' : '➕ Новая позиция').nl(2);
  if (error) r.plain(`⚠️ ${error}`).nl(2);
  r
    .plain('Пришлите пост так же, как публикуете в группе:').nl()
    .plain('• одно фото или альбом (до 10 фото);').nl()
    .plain('• в подписи — описание: первая строка станет названием, строка вида «0,5кг - 14р» — ценой.').nl(2)
    .italic('Жирный и курсив из Telegram сохранятся. Можно переслать старый пост из группы — перед сохранением бот покажет черновик, и название с ценой можно поправить.');
  const back = replaceItemId ? `mkp:it:${replaceItemId}` : 'mkp:home';
  return show(ctx, r.build(), new InlineKeyboard()
    .text('📖 Как оформить пост', 'mkp:guide:a').row()
    .text('✖️ Отмена', back));
}

makerPanelComposer.callbackQuery('mkp:add', async (ctx) => {
  await ctx.answerCallbackQuery();
  const maker = ownMaker(ctx);
  if (!maker) return showPanel(ctx);
  if (getMakerItems(maker.id).length >= MAX_ITEMS) {
    await ctx.answerCallbackQuery({ text: `Максимум ${MAX_ITEMS} позиций`, show_alert: true }).catch(() => {});
    return showPanel(ctx);
  }
  await askPost(ctx);
});

makerPanelComposer.callbackQuery(/^mkp:rep:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ownItem(ctx, Number(ctx.match[1]))) return showPanel(ctx);
  await askPost(ctx, { replaceItemId: Number(ctx.match[1]) });
});

// Альбом приходит отдельными сообщениями с общим media_group_id — собираем их и сохраняем разом
const albums = new Map(); // media_group_id -> { ctx, photos, text, entities, messageIds, timer, replaceItemId }

function messagePayload(msg) {
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  return {
    photo,
    text: msg.caption ?? msg.text ?? '',
    entities: msg.caption_entities ?? msg.entities ?? [],
  };
}

async function deleteUserMessages(ctx, ids) {
  for (const id of ids) {
    try { await ctx.api.deleteMessage(ctx.chat.id, id); } catch (_) {}
  }
}

async function savePost(ctx, { photos, text, entities, replaceItemId, messageIds }) {
  clearPendingInput(ctx.from.id);
  const maker = ownMaker(ctx);
  if (!maker) return;

  if (!text.trim() && photos.length === 0) {
    await askPost(ctx, { replaceItemId, error: 'Нужно фото с подписью или текст с описанием. Попробуйте ещё раз.' });
    return;
  }

  const parsed = parseMakerPost({ text, entities, photos });
  // Пост получен — убираем исходные сообщения, чтобы чат не засорялся (file_id фото остаются рабочими)
  await deleteUserMessages(ctx, messageIds.slice(0, -1));

  const existing = replaceItemId ? ownItem(ctx, replaceItemId)?.item : null;
  drafts.set(ctx.from.id, {
    makerId: maker.id,
    replaceItemId: existing ? existing.id : null,
    parsed,
    title: parsed.title,
    priceText: parsed.priceText,
    category: existing ? existing.category : null,
    // Варианты по умолчанию включаем, только если у каждого своя цена (как начинки блинов);
    // обычный список «- размер, - материал» вариантами не считаем
    useVariants: parsed.variants.length > 0 && parsed.variants.every(v => v.price),
    titleSuspicious: parsed.titleSuspicious,
  });
  await showDraft(ctx);
}

// ── Черновик: бот показывает, как понял пост, и ничего не сохраняет без подтверждения ──

const drafts = new Map(); // userId -> черновик позиции

function getDraft(ctx) {
  const draft = drafts.get(ctx.from.id);
  const maker = ownMaker(ctx);
  return draft && maker && draft.makerId === maker.id ? { draft, maker } : null;
}

function draftItem(draft) {
  return {
    id: 'd',
    title: draft.title,
    price_text: draft.priceText,
    body: draft.parsed.body,
    body_entities: draft.parsed.bodyEntities,
    photos: draft.parsed.photos,
    variants: draft.useVariants ? draft.parsed.variants.map(v => ({ ...v, in_stock: true })) : [],
    in_stock: true,
  };
}

async function showDraft(ctx, { error = null } = {}) {
  const found = getDraft(ctx);
  if (!found) return showPanel(ctx);
  const { draft } = found;
  const { parsed } = draft;

  const r = rich().bold('📝 Проверьте позицию').plain(' — я понял пост так:').nl(2);
  if (error) r.plain(`⚠️ ${error}`).nl(2);

  r.plain('📌 Название: ').bold(draft.title).nl();
  if (draft.titleSuspicious && !draft.titleEdited) {
    r.italic('   Похоже, первая строка — не название. Нажмите «✏️ Название» и напишите коротко.').nl();
  }
  r.plain(`💰 Цена: ${draft.priceText || '— не нашёл'}`).nl();
  if (!draft.priceText) r.italic('   Нажмите «✏️ Цена» и напишите, например «14 р / 0,5 кг», или оставьте без цены.').nl();
  r.plain(`🖼 Фото: ${parsed.photos.length}`).nl();

  if (parsed.variants.length) {
    r.nl().plain(`🧩 Нашёл ${parsed.variants.length} строки списком: ${parsed.variants.map(v => v.name).join(', ')}.`).nl()
      .plain('Это разные варианты (начинки, вкусы, цвета), у каждого своё наличие?').nl()
      .italic(draft.useVariants ? '   Сейчас: да, варианты.' : '   Сейчас: нет, просто текст.').nl();
  }

  const category = draft.category && CATEGORY_BY_ID[draft.category];
  r.nl().plain(`🗂 Раздел: ${category ? category.title : '— выберите ниже'}`);

  const kb = new InlineKeyboard();
  if (parsed.variants.length) {
    kb.text(draft.useVariants ? '• Да, варианты •' : 'Да, варианты', 'mkd:var:1')
      .text(draft.useVariants ? 'Нет, просто текст' : '• Нет, просто текст •', 'mkd:var:0').row();
  }
  MAKER_CATEGORIES.forEach((cat, i) => {
    kb.text(cat.id === draft.category ? `• ${cat.title} •` : cat.title, `mkd:cat:${cat.id}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row()
    .text('✏️ Название', 'mkd:f:title').text('✏️ Цена', 'mkd:f:price').row()
    .text('👀 Как увидят покупатели', 'mkp:pv:d:0').row()
    .text('✅ Сохранить', 'mkd:save').text('✖️ Отмена', 'mkd:cancel');
  return show(ctx, r.build(), kb);
}

makerPanelComposer.callbackQuery(/^mkd:var:([01])$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = getDraft(ctx);
  if (found) found.draft.useVariants = ctx.match[1] === '1';
  await showDraft(ctx);
});

makerPanelComposer.callbackQuery(/^mkd:cat:([a-z]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = getDraft(ctx);
  if (found && CATEGORY_BY_ID[ctx.match[1]]) found.draft.category = ctx.match[1];
  await showDraft(ctx);
});

makerPanelComposer.callbackQuery(/^mkd:f:(title|price)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!getDraft(ctx)) return showPanel(ctx);
  setPendingInput(ctx.from.id, 'maker_draft_field', { field: ctx.match[1] });
  const prompt = ctx.match[1] === 'title'
    ? 'Напишите короткое название позиции (3–5 слов) — оно будет на кнопке:'
    : 'Напишите цену, например «14 р / 0,5 кг» или «45 р». Отправьте «-», чтобы оставить без цены.';
  await show(ctx, rich().plain(prompt).build(), new InlineKeyboard().text('◀️ Назад к черновику', 'mkd:back'));
});

makerPanelComposer.callbackQuery('mkd:back', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showDraft(ctx);
});

makerPanelComposer.callbackQuery(/^mkp:pv:d:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = getDraft(ctx);
  if (!found) return showPanel(ctx);
  const { built, photo, keyboard } = buildItemCard(draftItem(found.draft), found.maker, { photoIndex: Number(ctx.match[1]), preview: true });
  keyboard.text('◀️ Назад к черновику', 'mkd:back');
  await show(ctx, built, keyboard, photo ? { photo } : {});
});

makerPanelComposer.callbackQuery('mkd:cancel', async (ctx) => {
  drafts.delete(ctx.from.id);
  await ctx.answerCallbackQuery({ text: 'Черновик удалён' });
  await showPanel(ctx);
});

makerPanelComposer.callbackQuery('mkd:save', async (ctx) => {
  const found = getDraft(ctx);
  if (!found) {
    await ctx.answerCallbackQuery();
    return showPanel(ctx);
  }
  const { draft, maker } = found;
  if (!draft.category) {
    await ctx.answerCallbackQuery({ text: 'Выберите раздел — по нему позицию находят в «Что есть сейчас»', show_alert: true });
    return;
  }
  const data = {
    ...draft.parsed,
    title: draft.title,
    priceText: draft.priceText,
    variants: draft.useVariants ? draft.parsed.variants : [],
  };
  let item;
  if (draft.replaceItemId && ownItem(ctx, draft.replaceItemId)) {
    item = replaceMakerItemPost(draft.replaceItemId, data);
    if (item.category !== draft.category) updateMakerItemField(item.id, 'category', draft.category);
  } else {
    if (getMakerItems(maker.id).length >= MAX_ITEMS) {
      await ctx.answerCallbackQuery({ text: `Максимум ${MAX_ITEMS} позиций`, show_alert: true });
      return;
    }
    item = createMakerItem(maker.id, { ...data, category: draft.category });
    touchMakerStock(maker.id);
  }
  drafts.delete(ctx.from.id);
  await ctx.answerCallbackQuery({ text: '✅ Сохранено' });
  await showItemManage(ctx, item.id, { justSaved: true });
});

makerPanelComposer.on(['message:photo', 'message:text'], async (ctx, next) => {
  if (ctx.chat.type !== 'private') return next();
  const msg = ctx.message;
  const userId = ctx.from.id;

  // Продолжение уже собираемого альбома
  if (msg.media_group_id && albums.has(msg.media_group_id)) {
    const album = albums.get(msg.media_group_id);
    const { photo, text, entities } = messagePayload(msg);
    if (photo && album.photos.length < 10) album.photos.push(photo);
    if (text && !album.text) { album.text = text; album.entities = entities; }
    album.messageIds.push(msg.message_id);
    album.ctx = ctx;
    clearTimeout(album.timer);
    album.timer = setTimeout(() => finishAlbum(msg.media_group_id), ALBUM_WAIT_MS);
    return;
  }

  // Обложка раздела (админ): одно фото
  if (msg.photo && !msg.media_group_id) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    if (getPendingInput(userId, 'makers_cover') && isAdmin(userId)) {
      clearPendingInput(userId);
      setSectionCover(fileId);
      const { built, kb } = makersAdminView();
      const done = rich().plain('✅ Обложка раздела сохранена.').nl(2).rich(built.text, built.entities).build();
      await ctx.reply(done.text, { entities: done.entities, reply_markup: kb });
      return;
    }
  }

  const postState = getPendingInput(userId, 'maker_post');
  if (postState) {
    if (msg.text?.startsWith('/')) return next();
    const { photo, text, entities } = messagePayload(msg);
    if (msg.media_group_id) {
      albums.set(msg.media_group_id, {
        ctx, photos: photo ? [photo] : [], text, entities, messageIds: [msg.message_id],
        replaceItemId: postState.replaceItemId,
        timer: setTimeout(() => finishAlbum(msg.media_group_id), ALBUM_WAIT_MS),
      });
      return;
    }
    await savePost(ctx, { photos: photo ? [photo] : [], text, entities, replaceItemId: postState.replaceItemId, messageIds: [msg.message_id] });
    return;
  }

  if (!msg.text || msg.text.startsWith('/')) return next();
  return handleTextInput(ctx, next);
});

async function finishAlbum(groupId) {
  const album = albums.get(groupId);
  albums.delete(groupId);
  if (!album) return;
  try {
    await savePost(album.ctx, album);
  } catch (err) {
    console.error('[Makers] Ошибка сохранения альбома:', err);
  }
}

// ── Текстовый ввод: заявка, профиль, название и цена ──────

async function handleTextInput(ctx, next) {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();
  const entities = cleanEntities(ctx.message.entities);

  const nameState = getPendingInput(userId, 'maker_apply_name');
  if (nameState) {
    if (text.length < 2 || text.length > 60) {
      return show(ctx, rich()
        .bold('📝 Заявка мастера — шаг 1 из 2').nl(2)
        .plain('⚠️ Название должно быть от 2 до 60 символов. Попробуйте ещё раз.')
        .build(), new InlineKeyboard().text('✖️ Отмена', 'mkp:home'));
    }
    setPendingInput(userId, 'maker_apply_about', { name: text });
    return askAbout(ctx, '📝 Заявка мастера — шаг 2 из 2');
  }

  const aboutState = getPendingInput(userId, 'maker_apply_about');
  if (aboutState) {
    clearPendingInput(userId);
    const contact = ctx.from.username ? `@${ctx.from.username}` : null;
    const data = { name: aboutState.name, about: ctx.message.text, aboutEntities: entities, contact };
    const existing = getMakerByUser(userId);
    const maker = existing ? resubmitMaker(existing.id, data) : createMaker({ userId, ...data });
    await notifyAdminsAboutApplication(ctx.api, maker, ctx.from);
    return showPanel(ctx);
  }

  const profileState = getPendingInput(userId, 'maker_profile');
  if (profileState) {
    const maker = ownMaker(ctx);
    clearPendingInput(userId);
    if (!maker) return showPanel(ctx);
    if (profileState.field === 'name') updateMakerProfile(maker.id, { name: text.slice(0, 60) });
    if (profileState.field === 'about') updateMakerProfile(maker.id, { about: ctx.message.text, aboutEntities: entities });
    if (profileState.field === 'contact') updateMakerProfile(maker.id, { contact: text.slice(0, 64) });
    await ctx.deleteMessage().catch(() => {});
    return showPanel(ctx);
  }

  const draftField = getPendingInput(userId, 'maker_draft_field');
  if (draftField) {
    clearPendingInput(userId);
    const found = getDraft(ctx);
    if (!found) return showPanel(ctx);
    if (draftField.field === 'title') {
      found.draft.title = text.replace(/\s+/g, ' ').slice(0, 48);
      found.draft.titleEdited = true;
    } else {
      found.draft.priceText = text === '-' ? null : text.slice(0, 32);
    }
    return showDraft(ctx);
  }

  const fieldState = getPendingInput(userId, 'maker_item_field');
  if (fieldState) {
    clearPendingInput(userId);
    const own = ownItem(ctx, fieldState.itemId);
    if (!own) return showPanel(ctx);
    const value = fieldState.field === 'title' ? text.slice(0, 48) : (text === '-' ? null : text.slice(0, 32));
    updateMakerItemField(own.item.id, fieldState.field, value);
    await ctx.deleteMessage().catch(() => {});
    return showItemManage(ctx, own.item.id);
  }

  return next();
}

// ── Управление позициями ──────────────────────────────────

makerPanelComposer.callbackQuery('mkp:items', async (ctx) => {
  await ctx.answerCallbackQuery();
  const maker = ownMaker(ctx);
  if (!maker) return showPanel(ctx);
  const kb = new InlineKeyboard();
  for (const item of getMakerItems(maker.id).slice(0, MAX_ITEMS)) {
    kb.text(itemButtonLabel(item), `mkp:it:${item.id}`).row();
  }
  kb.text('◀️ В кабинет', 'mkp:home');
  await show(ctx, rich().bold('✏️ Изменить позиции').nl(2).plain('Выберите позицию:').build(), kb);
});

async function showItemManage(ctx, itemId, { justSaved = false } = {}) {
  const own = ownItem(ctx, itemId);
  if (!own) return showPanel(ctx);
  const { item } = own;
  const category = CATEGORY_BY_ID[item.category] || CATEGORY_BY_ID.other;

  const r = rich();
  if (justSaved) r.bold('✅ Позиция сохранена').nl(2);
  r.bold(item.title).nl()
    .plain(`💰 Цена: ${item.price_text || 'не найдена в тексте'}`).nl()
    .plain(`🗂 Раздел: ${category.title}`).nl()
    .plain(`🖼 Фото: ${item.photos.length}`).nl();
  if (item.variants.length) {
    r.plain(`🧩 Варианты (${item.variants.length}): ${item.variants.map(v => `${v.in_stock ? '✅' : '❌'} ${v.name}`).join(', ')}`);
  } else {
    r.plain(item.in_stock ? '✅ В наличии' : '❌ Нет в наличии (под заказ)');
  }

  const kb = new InlineKeyboard();
  MAKER_CATEGORIES.forEach((cat, i) => {
    kb.text(cat.id === item.category ? `• ${cat.title} •` : cat.title, `mkp:cat:${item.id}:${cat.id}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row()
    .text('✏️ Название', `mkp:f:${item.id}:title`).text('✏️ Цена', `mkp:f:${item.id}:price_text`).row()
    .text('🔁 Заменить пост', `mkp:rep:${item.id}`).text('👀 Как видят', `mkp:pv:${item.id}:0`).row();
  if (item.variants.length) {
    kb.text('🧩 Наличие вариантов', `mkp:v:${item.id}`).text('✖️ Это не варианты', `mkp:vclr:${item.id}`).row();
  }
  kb.text('🗑 Удалить', `mkp:del:${item.id}`).row();
  if (justSaved) kb.text('➕ Добавить ещё позицию', 'mkp:add').row();
  kb.text('◀️ К позициям', 'mkp:items').text('🏠 В кабинет', 'mkp:home');
  return show(ctx, r.build(), kb);
}

makerPanelComposer.callbackQuery(/^mkp:it:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showItemManage(ctx, Number(ctx.match[1]));
});

makerPanelComposer.callbackQuery(/^mkp:cat:(\d+):([a-z]+)$/, async (ctx) => {
  const own = ownItem(ctx, Number(ctx.match[1]));
  if (!own || !CATEGORY_BY_ID[ctx.match[2]]) {
    await ctx.answerCallbackQuery();
    return showPanel(ctx);
  }
  updateMakerItemField(own.item.id, 'category', ctx.match[2]);
  await ctx.answerCallbackQuery({ text: `Раздел: ${CATEGORY_BY_ID[ctx.match[2]].title}` });
  await showItemManage(ctx, own.item.id);
});

makerPanelComposer.callbackQuery(/^mkp:f:(\d+):(title|price_text)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const own = ownItem(ctx, Number(ctx.match[1]));
  if (!own) return showPanel(ctx);
  setPendingInput(ctx.from.id, 'maker_item_field', { itemId: own.item.id, field: ctx.match[2] });
  const prompt = ctx.match[2] === 'title'
    ? 'Новое название позиции (коротко, оно будет на кнопке):'
    : 'Цена для кнопки, например «14 р / 0,5 кг». Отправьте «-», чтобы убрать цену.';
  await show(ctx, rich().plain(prompt).build(), new InlineKeyboard().text('✖️ Отмена', `mkp:it:${own.item.id}`));
});

// Предпросмотр карточки глазами покупателя
makerPanelComposer.callbackQuery(/^mkp:pv:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const own = ownItem(ctx, Number(ctx.match[1]));
  if (!own) return showPanel(ctx);
  const { built, photo, keyboard } = buildItemCard(own.item, own.maker, { photoIndex: Number(ctx.match[2]), preview: true });
  keyboard.text('◀️ Назад к позиции', `mkp:it:${own.item.id}`);
  await show(ctx, built, keyboard, photo ? { photo } : {});
});

makerPanelComposer.callbackQuery(/^mkp:del:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const own = ownItem(ctx, Number(ctx.match[1]));
  if (!own) return showPanel(ctx);
  await show(ctx, rich().plain('Удалить позицию ').bold(own.item.title).plain('?').build(),
    new InlineKeyboard().text('🗑 Да, удалить', `mkp:delok:${own.item.id}`).text('Отмена', `mkp:it:${own.item.id}`));
});

makerPanelComposer.callbackQuery(/^mkp:delok:(\d+)$/, async (ctx) => {
  const own = ownItem(ctx, Number(ctx.match[1]));
  if (own) deleteMakerItem(own.item.id);
  await ctx.answerCallbackQuery({ text: own ? '🗑 Позиция удалена' : '' });
  await showPanel(ctx);
});

// ── Администратор ─────────────────────────────────────────

makerPanelComposer.callbackQuery(/^mka:(ok|no):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const maker = getMaker(Number(ctx.match[2]));
  if (!maker) return ctx.answerCallbackQuery({ text: 'Заявка не найдена' });

  const approve = ctx.match[1] === 'ok';
  setMakerStatus(maker.id, approve ? 'active' : 'rejected');
  await syncMakerCommands(ctx.api, maker.user_id, approve);
  await ctx.answerCallbackQuery({ text: approve ? 'Одобрено' : 'Отклонено' });
  await ctx.editMessageReplyMarkup({
    reply_markup: new InlineKeyboard()
      .text(approve ? '✅ Одобрено' : '❌ Отклонено', 'noop')
      .text('⚙️ Управление', `mka:m:${maker.id}`),
  }).catch(() => {});

  try {
    await ctx.api.sendMessage(maker.user_id, approve
      ? `🎉 Заявка «${maker.name}» одобрена! Добавьте позиции и отметьте наличие в кабинете мастера — он всегда открывается командой /master (кнопка «Меню» возле поля ввода).`
      : `К сожалению, заявка «${maker.name}» не одобрена. Если есть вопросы — напишите автору бота.`,
    approve ? {
      reply_markup: new InlineKeyboard()
        .text('📖 Как добавить позиции', 'mkp:guide:h').row()
        .text('🧑‍🍳 Открыть кабинет', 'mkp:home'),
    } : {});
  } catch (err) {
    console.error('[Makers] Не удалось уведомить мастера:', err.message);
  }
});

const STATUS_LABELS = { pending: '⏳ на рассмотрении', active: '✅ активен', hidden: '🙈 скрыт', rejected: '❌ отклонён' };

function makersAdminView() {
  const makers = getAllMakers();
  const r = rich().bold('🧺 Мастера').nl(2);
  const kb = new InlineKeyboard();
  if (makers.length === 0) r.plain('Пока никого.').nl();
  for (const m of makers) {
    const icon = STATUS_LABELS[m.status].split(' ')[0];
    kb.text(`${icon} #${m.id} ${m.name} · ${m.items_count} поз.`, `mka:m:${m.id}`).row();
  }
  if (makers.length > 0) r.plain('Выберите мастера, чтобы скрыть, одобрить или удалить.').nl();
  r.nl().plain(`🖼 Обложка раздела: ${getSectionCover() ? 'задана' : 'не задана — раздел показывается текстом'}`).nl();
  r.nl().italic('Передать карточку: /maker_owner <номер> @username (мастер должен хотя бы раз нажать /start).');
  kb.text('🖼 Обложка раздела', 'mka:cover').row();
  kb.text('◀️ В админ-панель', 'admin:main');
  return { built: r.build(), kb };
}

function makerAdminCard(maker) {
  const subs = countSubscribers(maker.id);
  const items = getMakerItems(maker.id).length;
  const r = rich().bold(`#${maker.id} ${maker.name}`).nl(2)
    .plain(`Статус: ${STATUS_LABELS[maker.status]}`).nl()
    .plain(`Владелец: id ${maker.user_id}${maker.contact ? `, ${maker.contact}` : ''}`).nl()
    .plain(`Позиций: ${items}, подписчиков: ${subs}`).nl()
    .plain(`Наличие: ${maker.stock_updated_at ? formatWhen(maker.stock_updated_at) : 'не отмечалось'}`);
  const kb = new InlineKeyboard();
  if (maker.status === 'pending' || maker.status === 'rejected') kb.text('✅ Одобрить', `mka:ok:${maker.id}`);
  if (maker.status === 'pending') kb.text('❌ Отклонить', `mka:no:${maker.id}`);
  if (maker.status === 'active') kb.text('🙈 Скрыть', `mka:tog:${maker.id}`);
  if (maker.status === 'hidden') kb.text('👁 Показать', `mka:tog:${maker.id}`);
  kb.row().text('👀 Карточка', `mk:m:${maker.id}`).text('🗑 Удалить', `mka:del:${maker.id}`).row()
    .text('◀️ К списку', 'mka:list');
  return { built: r.build(), kb };
}

async function editView(ctx, { built, kb }) {
  await ctx.editMessageText(built.text, { entities: built.entities, reply_markup: kb }).catch(async (err) => {
    if (!String(err.description || err.message).includes('not modified')) {
      await ctx.reply(built.text, { entities: built.entities, reply_markup: kb });
    }
  });
}

makerPanelComposer.command('makers', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;
  const { built, kb } = makersAdminView();
  await ctx.reply(built.text, { entities: built.entities, reply_markup: kb });
});

makerPanelComposer.callbackQuery('mka:list', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx.from.id)) return;
  await editView(ctx, makersAdminView());
});

makerPanelComposer.callbackQuery(/^mka:m:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx.from.id)) return;
  const maker = getMaker(Number(ctx.match[1]));
  await editView(ctx, maker ? makerAdminCard(maker) : makersAdminView());
});

makerPanelComposer.callbackQuery(/^mka:tog:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const maker = getMaker(Number(ctx.match[1]));
  if (maker && (maker.status === 'active' || maker.status === 'hidden')) {
    const nowActive = maker.status !== 'active';
    setMakerStatus(maker.id, nowActive ? 'active' : 'hidden');
    await syncMakerCommands(ctx.api, maker.user_id, nowActive);
  }
  await ctx.answerCallbackQuery();
  const fresh = maker && getMaker(maker.id);
  await editView(ctx, fresh ? makerAdminCard(fresh) : makersAdminView());
});

makerPanelComposer.callbackQuery(/^mka:del:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx.from.id)) return;
  const maker = getMaker(Number(ctx.match[1]));
  if (!maker) return editView(ctx, makersAdminView());
  const items = getMakerItems(maker.id).length;
  const subs = countSubscribers(maker.id);
  const built = rich().bold(`🗑 Удалить мастера «${maker.name}»?`).nl(2)
    .plain(`Вместе с ним удалятся все позиции (${items}) и подписки (${subs}).`).nl()
    .bold('Отменить это нельзя.').build();
  await editView(ctx, {
    built,
    kb: new InlineKeyboard().text('🗑 Да, удалить', `mka:delok:${maker.id}`).text('Отмена', `mka:m:${maker.id}`),
  });
});

makerPanelComposer.callbackQuery(/^mka:delok:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const maker = getMaker(Number(ctx.match[1]));
  if (maker) {
    deleteMaker(maker.id);
    await syncMakerCommands(ctx.api, maker.user_id, false);
    console.log(`[Makers] Администратор ${ctx.from.id} удалил мастера #${maker.id} «${maker.name}»`);
  }
  await ctx.answerCallbackQuery({ text: maker ? `🗑 «${maker.name}» удалён` : 'Уже удалён' });
  await editView(ctx, makersAdminView());
});

// Обложка раздела «Домашнее и ручное»
makerPanelComposer.callbackQuery('mka:cover', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx.from.id)) return;
  setPendingInput(ctx.from.id, 'makers_cover');
  const kb = new InlineKeyboard();
  if (getSectionCover()) kb.text('🗑 Убрать обложку', 'mka:cover_off').row();
  kb.text('◀️ Назад', 'mka:list');
  await editView(ctx, {
    built: rich().bold('🖼 Обложка раздела').nl(2)
      .plain('Пришлите картинку — она будет вверху раздела «Домашнее и ручное» и сводки «Что есть сейчас».').nl(2)
      .italic('Лучше горизонтальную: баннер с названием или общий снимок выпечки и изделий.')
      .build(),
    kb,
  });
});

makerPanelComposer.callbackQuery('mka:cover_off', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  setSectionCover(null);
  await ctx.answerCallbackQuery({ text: 'Обложка убрана' });
  await editView(ctx, makersAdminView());
});

// Админ заполняет карточку сам (например, для показа мастеру), затем передаёт её владельцу
makerPanelComposer.command('maker_owner', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;
  const [idArg, who] = (ctx.match || '').trim().split(/\s+/);
  const maker = getMaker(Number(idArg));
  if (!maker || !who) {
    await ctx.reply('Формат: /maker_owner <номер мастера> <@username или telegram id>');
    return;
  }
  const userId = /^\d+$/.test(who) ? Number(who) : findUserIdByUsername(who);
  if (!userId) {
    await ctx.reply('Пользователь не найден. Пусть мастер сначала откроет бота и нажмёт /start.');
    return;
  }
  const taken = getMakerByUser(userId);
  if (taken && taken.id !== maker.id) {
    await ctx.reply(`У этого пользователя уже есть карточка #${taken.id} «${taken.name}».`);
    return;
  }
  setMakerOwner(maker.id, userId);
  if (maker.user_id !== userId) await syncMakerCommands(ctx.api, maker.user_id, false);
  await syncMakerCommands(ctx.api, userId, maker.status === 'active');
  if (/^@/.test(who) || !/^\d+$/.test(who)) updateMakerProfile(maker.id, { contact: `@${who.replace(/^@/, '')}` });
  await ctx.reply(`Готово: карточка #${maker.id} «${maker.name}» теперь у ${who}.`);
});
