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
  getSectionCover, setSectionCover, setMakerCoverPhoto,
} from '../db/repositories/makers.js';
import {
  MAKER_CATEGORIES, CATEGORY_BY_ID, parseMakerPost, formatWhen, isStockFresh, notifyCooldownLeftMinutes,
  itemButtonLabel,
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
      kb.text(`${item.in_stock ? '✅' : '❌'} ${item.title}`, `mkp:t:${item.id}`).row();
    }
    kb.text('👍 Наличие актуально', 'mkp:fresh').text('📣 Сообщить подписчикам', 'mkp:notify').row();
  }

  kb.text('➕ Добавить позицию', 'mkp:add').row();
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
    .plain(`Контакт для кнопки «Написать»: ${maker.contact || 'не указан'}`).nl()
    .plain(`Фото карточки: ${maker.cover_photo ? 'своё' : 'фото первой позиции'}`).nl(2)
    .rich(maker.about || '—', maker.about ? maker.about_entities : []);
  const kb = new InlineKeyboard()
    .text('✏️ Имя', 'mkp:pf:name').text('✏️ Описание', 'mkp:pf:about').row()
    .text('✏️ Контакт', 'mkp:pf:contact').text('🖼 Фото карточки', 'mkp:cover').row()
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
  const item = toggleMakerItemStock(own.item.id);
  touchMakerStock(own.maker.id);
  await ctx.answerCallbackQuery({ text: item.in_stock ? `✅ ${item.title} — в наличии` : `❌ ${item.title} — нет в наличии` });
  await showPanel(ctx);
});

makerPanelComposer.callbackQuery('mkp:fresh', async (ctx) => {
  const maker = ownMaker(ctx);
  if (maker) touchMakerStock(maker.id);
  await ctx.answerCallbackQuery({ text: '👍 Отметил: наличие актуально' });
  await showPanel(ctx);
});

// ── Рассылка подписчикам ──────────────────────────────────

function buildNotification(maker, items) {
  const inStock = items.filter(i => i.in_stock);
  const r = rich().bold(`🔔 ${maker.name}`).plain(' — обновлено наличие').nl(2);
  if (inStock.length > 0) {
    r.plain('Сейчас есть:').nl();
    for (const item of inStock.slice(0, 30)) r.plain(`• ${itemButtonLabel(item)}`).nl();
    if (inStock.length > 30) r.plain(`…и ещё ${inStock.length - 30}`).nl();
  } else {
    r.plain('Сейчас всё под заказ.').nl();
  }
  return { built: r.build(), inStockCount: inStock.length };
}

makerPanelComposer.callbackQuery('mkp:notify', async (ctx) => {
  await ctx.answerCallbackQuery();
  const maker = ownMaker(ctx);
  if (!maker) return showPanel(ctx);
  const subs = countSubscribers(maker.id);
  const left = notifyCooldownLeftMinutes(maker);
  const kb = new InlineKeyboard();
  const r = rich().bold('📣 Сообщить подписчикам').nl(2);

  if (subs === 0) {
    r.plain('Пока нет подписчиков. Они появятся, когда покупатели нажмут «🔔 Сообщать о наличии» в вашей карточке.');
  } else if (left > 0) {
    const h = Math.floor(left / 60);
    r.plain(`Рассылка уже была недавно. Следующую можно отправить через ${h ? `${h} ч ` : ''}${left % 60} мин — чтобы подписчики не уставали от уведомлений.`);
  } else {
    const { built } = buildNotification(maker, getMakerItems(maker.id));
    r.plain(`Получат ${subs} подписчиков. Вот так будет выглядеть сообщение:`).nl(2).rich(built.text, built.entities);
    kb.text('📣 Отправить', 'mkp:notify_go').row();
  }
  kb.text('◀️ В кабинет', 'mkp:home');
  await show(ctx, r.build(), kb);
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function sendMakerNotification(api, maker) {
  const { built } = buildNotification(maker, getMakerItems(maker.id));
  const kb = new InlineKeyboard().text('👀 Открыть', `mk:m:${maker.id}`).text('🔕 Отписаться', `mk:unsub:${maker.id}`);
  let sent = 0;
  for (const userId of getSubscriberIds(maker.id)) {
    try {
      await api.sendMessage(userId, built.text, { entities: built.entities, reply_markup: kb });
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
  if (!maker || notifyCooldownLeftMinutes(maker) > 0) {
    await ctx.answerCallbackQuery();
    return showPanel(ctx);
  }
  markMakerNotified(maker.id);
  touchMakerStock(maker.id);
  await ctx.answerCallbackQuery({ text: '📣 Рассылка запущена' });
  await showPanel(ctx);
  sendMakerNotification(ctx.api, maker)
    .then((sent) => console.log(`[Makers] «${maker.name}»: уведомление получили ${sent} подписчиков`))
    .catch((err) => console.error('[Makers] Ошибка рассылки:', err));
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
    .italic('Жирный и курсив из Telegram сохранятся. Можно просто переслать свой старый пост из группы.');
  const back = replaceItemId ? `mkp:it:${replaceItemId}` : 'mkp:home';
  return show(ctx, r.build(), new InlineKeyboard().text('✖️ Отмена', back));
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
  // Пост сохранён — убираем исходные сообщения, чтобы чат не засорялся (file_id фото остаются рабочими)
  await deleteUserMessages(ctx, messageIds.slice(0, -1));

  let item;
  if (replaceItemId && ownItem(ctx, replaceItemId)) {
    item = replaceMakerItemPost(replaceItemId, parsed);
  } else {
    item = createMakerItem(maker.id, parsed);
    touchMakerStock(maker.id);
  }
  await showItemManage(ctx, item.id, { justSaved: true });
}

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

  // Обложки: одно фото
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
    if (getPendingInput(userId, 'maker_cover')) {
      clearPendingInput(userId);
      const maker = ownMaker(ctx);
      if (maker) setMakerCoverPhoto(maker.id, fileId);
      return showPanel(ctx);
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
    .plain(`🖼 Фото: ${item.photos.length}`).nl()
    .plain(item.in_stock ? '✅ В наличии' : '❌ Нет в наличии (под заказ)');
  if (justSaved && item.category === 'other') {
    r.nl(2).bold('Выберите раздел').plain(' — по нему покупатели находят позицию в сводке «Что есть сейчас»:');
  }

  const kb = new InlineKeyboard();
  MAKER_CATEGORIES.forEach((cat, i) => {
    kb.text(cat.id === item.category ? `• ${cat.title} •` : cat.title, `mkp:cat:${item.id}:${cat.id}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row()
    .text('✏️ Название', `mkp:f:${item.id}:title`).text('✏️ Цена', `mkp:f:${item.id}:price_text`).row()
    .text('🔁 Заменить пост', `mkp:rep:${item.id}`).text('👀 Как видят', `mkp:pv:${item.id}:0`).row()
    .text('🗑 Удалить', `mkp:del:${item.id}`).row()
    .text('◀️ К позициям', 'mkp:items').text('🏠 В кабинет', 'mkp:home');
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
    approve ? { reply_markup: new InlineKeyboard().text('🧑‍🍳 Открыть кабинет', 'mkp:home') } : {});
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

// Фото карточки мастера
makerPanelComposer.callbackQuery('mkp:cover', async (ctx) => {
  await ctx.answerCallbackQuery();
  const maker = ownMaker(ctx);
  if (!maker) return showPanel(ctx);
  setPendingInput(ctx.from.id, 'maker_cover');
  const kb = new InlineKeyboard();
  if (maker.cover_photo) kb.text('🗑 Убрать фото', 'mkp:cover_off').row();
  kb.text('✖️ Отмена', 'mkp:profile');
  await show(ctx, rich().bold('🖼 Фото для карточки').nl(2)
    .plain('Пришлите одно фото: логотип, ваше фото или общий снимок ассортимента. Оно будет вверху вашей карточки.').nl(2)
    .italic('Пока фото не задано, показывается фото вашей первой позиции.')
    .build(), kb);
});

makerPanelComposer.callbackQuery('mkp:cover_off', async (ctx) => {
  const maker = ownMaker(ctx);
  if (maker) setMakerCoverPhoto(maker.id, null);
  await ctx.answerCallbackQuery({ text: 'Фото убрано' });
  await showPanel(ctx);
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
