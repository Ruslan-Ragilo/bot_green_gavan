/**
 * Кабинет специалиста («💅 Услуги и красота») и управление разделом в админке:
 *  - заявка специалиста → одобрение администратором;
 *  - профиль (локация в ЖК, описание, контакт, ссылка онлайн-записи Dikidi/Yclients);
 *  - услуги/портфолио (фото/альбом + описание/прайс);
 *  - «🔥 Горящие отмены» (создание в 2-3 клика, снятие в 1 тап, уведомление подписчикам);
 *  - статистика и админ-модуль (srva:*).
 */
import { Composer, InlineKeyboard } from 'grammy';
import { config, isAdmin } from '../../config.js';
import {
  getProvider,
  getProviderByUser,
  getAllProviders,
  createProvider,
  resubmitProvider,
  updateProviderProfile,
  setProviderStatus,
  setProviderOwner,
  deleteProvider,
  touchProviderHotNotified,
  getServiceOffer,
  getProviderOffers,
  createServiceOffer,
  replaceServiceOfferPost,
  updateServiceOfferField,
  toggleServiceOfferPublished,
  deleteServiceOffer,
  moveServiceOffer,
  getHotSlot,
  getProviderHotSlots,
  createHotSlot,
  closeHotSlot,
  markHotSlotNotified,
  getServiceSubscriberIds,
  countServiceSubscribers,
  unsubscribeService,
  getServicesSectionCover,
  setServicesSectionCover,
} from '../db/repositories/servicesCatalog.js';
import { findUserIdByUsername } from '../db/repositories/makers.js';
import {
  SERVICE_SECTION_TITLE,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_BY_ID,
  parseServicePost,
  formatWhen,
  offerButtonLabel,
  contactUrl,
  prefilledContactUrl,
  normalizeBookingUrl,
  hotNotifyCooldownLeftMinutes,
  buildHotSlotUtc,
  dayOffsetLabel,
  formatHotSlotWhen,
  parseSlotTimeInput,
} from '../services/servicesCatalog.js';
import {
  SERVICE_EVENT,
  PERIODS,
  periodSince,
  getProviderCounts,
  getProviderTopOffers,
  getNewServiceSubscribers,
  getServicesTotalCounts,
} from '../db/repositories/serviceStats.js';
import { buildOfferCard } from './services.js';
import { syncServiceProviderCommands } from '../services/botCommands.js';
import { rich, cleanEntities } from '../utils/richText.js';
import { plural } from '../utils/text.js';
import { getMinskNowParts, parseDbUtc } from '../utils/time.js';
import { renderScreen } from '../utils/cleanChat.js';
import { setPendingInput, getPendingInput, clearPendingInput } from '../utils/pendingInput.js';

export const servicePanelComposer = new Composer();

const MAX_OFFERS = 40;
const INLINE_ARROWS_MAX = 25;
const ALBUM_WAIT_MS = 1200;
const HOT_PRESET_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const albums = new Map();
const offerDrafts = new Map();
const hotDrafts = new Map();

function show(ctx, built, keyboard, options = {}) {
  return renderScreen(ctx, built.text, { entities: built.entities, reply_markup: keyboard }, options);
}

function ownProvider(ctx) {
  const p = getProviderByUser(ctx.from.id);
  return p && p.status === 'active' ? p : null;
}

function ownOffer(ctx, offerId) {
  const provider = ownProvider(ctx);
  const offer = provider && getServiceOffer(offerId);
  return offer && offer.provider_id === provider.id ? { provider, offer } : null;
}

const adminOnly = async (ctx) => {
  if (isAdmin(ctx.from?.id)) return true;
  await ctx.answerCallbackQuery().catch(() => {});
  return false;
};

// ── Главный экран кабинета ────────────────────────────────

export async function showServicePanel(ctx) {
  const provider = getProviderByUser(ctx.from.id);
  const r = rich();
  const kb = new InlineKeyboard();

  if (!provider || provider.status === 'rejected') {
    r.bold('✨ Кабинет специалиста (Услуги и красота)').nl(2)
      .plain('Делаете маникюр, массаж, брови, стрижки или другие услуги в ЖК? Разместите свою карточку:').nl()
      .plain('• портфолио с фото работ, прайс и локация в ЖК;').nl()
      .plain('• кнопки связи в личке и ссылка на вашу онлайн-запись (Dikidi / Yclients);').nl()
      .plain('• «🔥 горящие отмены» — если клиент отменился, можно в 2 клика оповестить подписчиков.').nl(2)
      .plain('Вести расписание в боте не нужно. На старте всё бесплатно.');
    if (provider?.status === 'rejected') r.nl(2).italic('Прошлая заявка не была одобрена — можно отправить новую.');
    kb.text('📝 Отправить заявку', 'srvp:apply').row();
    kb.text('◀️ Назад', 'srv:home');
    return show(ctx, r.build(), kb);
  }

  if (provider.status === 'pending') {
    r.bold('⏳ Заявка на рассмотрении').nl(2)
      .plain(`«${provider.name}» — проверим и откроем доступ. Я пришлю сообщение, как только всё будет готово.`);
    if (!provider.contact) {
      r.nl(2).italic('У вас в Telegram не задан username — после одобрения укажите контакт или ссылку на запись в «👤 Профиль».');
    }
    kb.text('◀️ Назад', 'srv:home');
    return show(ctx, r.build(), kb);
  }

  if (provider.status === 'hidden') {
    r.bold('🙈 Карточка скрыта').nl(2).plain('Карточка временно скрыта администратором. Напишите автору бота, если это ошибка.');
    kb.text('◀️ Назад', 'srv:home');
    return show(ctx, r.build(), kb);
  }

  const offers = getProviderOffers(provider.id);
  const hotSlots = getProviderHotSlots(provider.id);
  const subs = countServiceSubscribers(provider.id);
  const weekCounts = getProviderCounts(provider.id, periodSince('d7'));

  r.bold(`✨ Кабинет: ${provider.name}`).nl(2)
    .plain(`🔔 Подписчиков: ${subs} · 👀 за неделю: ${weekCounts[SERVICE_EVENT.VIEW_PROVIDER].people}`).nl()
    .plain(provider.location ? `📍 Локация: ${provider.location}` : '📍 Локация в ЖК не указана');

  if (offers.length === 0) {
    r.nl(2).plain('Добавьте первую услугу с фото работ и прайсом — после этого карточка появится в выбранной категории.');
  }

  kb.text(
    hotSlots.length ? `🔥 Горящие окна · ${hotSlots.length}` : '🔥 Выставить горящее окно',
    hotSlots.length ? 'srvh:list' : 'srvh:new'
  ).row();

  if (offers.length) {
    kb.text(`📋 Мои услуги · ${offers.length}`, 'srvp:offers').row();
  }
  kb.text('➕ Добавить услугу', 'srvp:add').row();
  kb.text('📊 Статистика', 'srvp:st:d7').text('👤 Профиль и запись', 'srvp:profile').row();
  kb.text('◀️ В раздел услуг', 'srv:home');
  return show(ctx, r.build(), kb);
}

servicePanelComposer.command('services_cabinet', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  await showServicePanel(ctx);
});

servicePanelComposer.callbackQuery('srvp:home', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showServicePanel(ctx);
});

// ── Подача заявки (3 коротких шага) ────────────────────────

servicePanelComposer.callbackQuery('srvp:apply', async (ctx) => {
  await ctx.answerCallbackQuery();
  const existing = getProviderByUser(ctx.from.id);
  if (existing && existing.status !== 'rejected') return showServicePanel(ctx);

  setPendingInput(ctx.from.id, 'srv_apply_name');
  await show(ctx, rich()
    .bold('📝 Заявка специалиста — шаг 1 из 3').nl(2)
    .plain('Как вас подписать в каталоге? Имя и специализация, например: «Анна · Маникюр и педикюр».')
    .build(), new InlineKeyboard().text('✖️ Отмена', 'srvp:home'));
});

async function notifyAdminsAboutServiceApplication(api, provider, from) {
  const r = rich().bold('💅 Новая заявка специалиста').nl(2)
    .plain(`Имя: ${provider.name}`).nl()
    .plain(`Локация: ${provider.location || '—'}`).nl()
    .plain(`Telegram: ${from.username ? `@${from.username}` : 'нет username'} (id ${from.id})`).nl(2)
    .rich(provider.about, provider.about_entities);
  const built = r.build();
  const kb = new InlineKeyboard()
    .text('✅ Одобрить', `srva:ok:${provider.id}`)
    .text('❌ Отклонить', `srva:no:${provider.id}`);
  for (const adminId of config.adminIds) {
    try {
      await api.sendMessage(adminId, built.text, { entities: built.entities, reply_markup: kb });
    } catch (err) {
      console.error('[Services] Не удалось отправить заявку админу:', err.message);
    }
  }
}

// ── Профиль и внешняя ссылка записи ───────────────────────

async function showProfile(ctx) {
  const provider = ownProvider(ctx);
  if (!provider) return showServicePanel(ctx);

  const r = rich().bold('👤 Профиль и запись').nl(2)
    .plain(`Имя: ${provider.name}`).nl()
    .plain(`📍 Где принимаете: ${provider.location || 'не указано'}`).nl()
    .plain(`✉️ Контакт в ЛС: ${provider.contact || 'не указан'}`).nl()
    .plain(`🗓 Онлайн-запись: ${provider.booking_url || 'не указана'}`).nl(2)
    .rich(provider.about || '—', provider.about ? provider.about_entities : []);

  const kb = new InlineKeyboard()
    .text('✏️ Имя', 'srvp:pf:name').text('📍 Локация', 'srvp:pf:location').row()
    .text('✏️ Описание', 'srvp:pf:about').text('✏️ Контакт', 'srvp:pf:contact').row()
    .text('🗓 Ссылка записи (Dikidi/Yclients)', 'srvp:pf:booking').row()
    .text('👀 Как видят жильцы', `srv:p:${provider.id}:h`).row()
    .text('◀️ Назад', 'srvp:home');
  return show(ctx, r.build(), kb);
}

servicePanelComposer.callbackQuery('srvp:profile', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showProfile(ctx);
});

const PROFILE_PROMPTS = {
  name: 'Новое имя или специализация (2–60 символов), например «Анна · Маникюр»:',
  location: 'Где принимаете в ЖК? Например: «ул. Лесная, 5 (на дому)», «кабинет в квартале», «выезд к клиенту». Отправьте «-», чтобы убрать:',
  about: 'Новое описание (опыт, стерилизация, условия, график). Форматирование Telegram сохранится.',
  contact: 'Контакт для кнопки «Написать»: ваш @username или телефон (телефон будет показан текстом).',
  booking: 'Ссылка на внешнюю онлайн-запись (Dikidi, Yclients, Taplink, Instagram и т.п.). Отправьте «-», чтобы убрать:',
};

servicePanelComposer.callbackQuery(/^srvp:pf:(name|location|about|contact|booking)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ownProvider(ctx)) return showServicePanel(ctx);
  setPendingInput(ctx.from.id, 'srv_profile', { field: ctx.match[1] });
  await show(ctx, rich().plain(PROFILE_PROMPTS[ctx.match[1]]).build(),
    new InlineKeyboard().text('✖️ Отмена', 'srvp:profile'));
});

// ── 🔥 Горящие окна (отмены) в кабинете ───────────────────

async function showHotSlotsManager(ctx) {
  const provider = ownProvider(ctx);
  if (!provider) return showServicePanel(ctx);
  const slots = getProviderHotSlots(provider.id);

  const r = rich().bold('🔥 Горящие окна (отмены)').nl(2)
    .plain('Вести расписание здесь не нужно — выставляйте окно, только когда клиент отменился или появилось свободное место. Прошедшее время исчезает само.').nl(2);

  const kb = new InlineKeyboard();
  if (slots.length === 0) {
    r.italic('Сейчас активных горящих окон нет.');
  } else {
    r.bold('Активные окна (нажмите, чтобы снять или разослать):');
    for (const s of slots) {
      kb.text(`🕒 ${formatHotSlotWhen(s.slot_at)} · ${s.title}`, `srvh:v:${s.id}`).row();
    }
  }
  kb.text('➕ Выставить горящее окно', 'srvh:new').row();
  kb.text('◀️ Назад', 'srvp:home');
  return show(ctx, r.build(), kb);
}

servicePanelComposer.callbackQuery('srvh:list', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showHotSlotsManager(ctx);
});

servicePanelComposer.callbackQuery('srvh:new', async (ctx) => {
  await ctx.answerCallbackQuery();
  const provider = ownProvider(ctx);
  if (!provider) return showServicePanel(ctx);

  const r = rich().bold('🔥 Новое горящее окно — шаг 1 из 3').nl(2)
    .plain('Выберите день:');
  const kb = new InlineKeyboard()
    .text(dayOffsetLabel(0), 'srvh:d:0').row()
    .text(dayOffsetLabel(1), 'srvh:d:1').row()
    .text(dayOffsetLabel(2), 'srvh:d:2').row()
    .text('✖️ Отмена', 'srvh:list');
  return show(ctx, r.build(), kb);
});

async function showHotTimeStep(ctx, dayOffset, error = null) {
  const nowParts = getMinskNowParts();
  const hours = dayOffset === 0
    ? HOT_PRESET_HOURS.filter(h => h > nowParts.hour || (h === nowParts.hour && nowParts.minute < 45))
    : HOT_PRESET_HOURS;

  const r = rich().bold('🔥 Новое горящее окно — шаг 2 из 3').nl(2)
    .plain(`День: `).bold(dayOffsetLabel(dayOffset)).nl();
  if (error) r.nl().plain(`⚠️ ${error}`).nl();
  r.nl().plain('Выберите время или укажите точное:');

  const kb = new InlineKeyboard();
  hours.forEach((h, i) => {
    kb.text(`${String(h).padStart(2, '0')}:00`, `srvh:t:${dayOffset}:${h}:0`);
    if (i % 3 === 2) kb.row();
  });
  if (hours.length % 3 !== 0) kb.row();
  kb.text('✍️ Указать точное время (напр. 17:30)', `srvh:tc:${dayOffset}`).row();
  kb.text('◀️ Назад к дню', 'srvh:new');
  return show(ctx, r.build(), kb);
}

servicePanelComposer.callbackQuery(/^srvh:d:([012])$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ownProvider(ctx)) return showServicePanel(ctx);
  await showHotTimeStep(ctx, Number(ctx.match[1]));
});

servicePanelComposer.callbackQuery(/^srvh:tc:([012])$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ownProvider(ctx)) return showServicePanel(ctx);
  const dayOffset = Number(ctx.match[1]);
  setPendingInput(ctx.from.id, 'srv_hot_time', { dayOffset });
  await show(ctx, rich()
    .bold('🕒 Точное время окна').nl(2)
    .plain(`День: ${dayOffsetLabel(dayOffset)}`).nl()
    .plain('Напишите время по Минску, например «17:30» или «11:15»:').build(),
  new InlineKeyboard().text('✖️ Отмена', `srvh:d:${dayOffset}`));
});

async function showHotTitleStep(ctx, provider, { dayOffset, hh, mm, slotAt }) {
  hotDrafts.set(ctx.from.id, { providerId: provider.id, dayOffset, hh, mm, slotAt });
  const offers = getProviderOffers(provider.id).filter(o => o.published);
  const when = formatHotSlotWhen(slotAt);

  const r = rich().bold('🔥 Новое горящее окно — шаг 3 из 3').nl(2)
    .plain(`Время: `).bold(when).nl(2)
    .plain('Выберите услугу или напишите короткий комментарий (например: «Маникюр, скидка 10%»):');

  const kb = new InlineKeyboard();
  for (const o of offers.slice(0, 8)) {
    kb.text(`✨ ${o.title}`, `srvh:o:${o.id}`).row();
  }
  kb.text('✍️ Написать свой текст / скидку', 'srvh:nt').row();
  kb.text('⚡ Просто «Свободное окно»', 'srvh:go').row();
  kb.text('✖️ Отмена', `srvh:d:${dayOffset}`);
  return show(ctx, r.build(), kb);
}

servicePanelComposer.callbackQuery(/^srvh:t:([012]):(\d{1,2}):(\d{1,2})$/, async (ctx) => {
  const provider = ownProvider(ctx);
  if (!provider) {
    await ctx.answerCallbackQuery();
    return showServicePanel(ctx);
  }
  const dayOffset = Number(ctx.match[1]);
  const hh = Number(ctx.match[2]);
  const mm = Number(ctx.match[3]);
  const slotAt = buildHotSlotUtc(dayOffset, hh, mm);
  if (parseDbUtc(slotAt) <= new Date()) {
    await ctx.answerCallbackQuery({ text: 'Это время уже прошло, выберите попозже', show_alert: true });
    return showHotTimeStep(ctx, dayOffset);
  }
  await ctx.answerCallbackQuery();
  await showHotTitleStep(ctx, provider, { dayOffset, hh, mm, slotAt });
});

servicePanelComposer.callbackQuery(/^srvh:o:(\d+)$/, async (ctx) => {
  const own = ownOffer(ctx, Number(ctx.match[1]));
  const draft = hotDrafts.get(ctx.from.id);
  if (!own || !draft || draft.providerId !== own.provider.id) {
    await ctx.answerCallbackQuery();
    return showHotSlotsManager(ctx);
  }
  hotDrafts.delete(ctx.from.id);
  const slot = createHotSlot({
    providerId: own.provider.id,
    offerId: own.offer.id,
    slotAt: draft.slotAt,
    title: own.offer.title,
    note: own.offer.price_text ? `Стоимость: ${own.offer.price_text}` : '',
  });
  await ctx.answerCallbackQuery({ text: '🔥 Горящее окно опубликовано!' });
  await showHotSlotManage(ctx, slot.id, { justCreated: true });
});

servicePanelComposer.callbackQuery('srvh:go', async (ctx) => {
  const provider = ownProvider(ctx);
  const draft = hotDrafts.get(ctx.from.id);
  if (!provider || !draft || draft.providerId !== provider.id) {
    await ctx.answerCallbackQuery();
    return showHotSlotsManager(ctx);
  }
  hotDrafts.delete(ctx.from.id);
  const slot = createHotSlot({
    providerId: provider.id,
    slotAt: draft.slotAt,
    title: 'Свободное окно',
  });
  await ctx.answerCallbackQuery({ text: '🔥 Горящее окно опубликовано!' });
  await showHotSlotManage(ctx, slot.id, { justCreated: true });
});

servicePanelComposer.callbackQuery('srvh:nt', async (ctx) => {
  await ctx.answerCallbackQuery();
  const provider = ownProvider(ctx);
  const draft = hotDrafts.get(ctx.from.id);
  if (!provider || !draft || draft.providerId !== provider.id) return showHotSlotsManager(ctx);
  setPendingInput(ctx.from.id, 'srv_hot_note');
  await show(ctx, rich()
    .bold('✍️ Описание горящего окна').nl(2)
    .plain('Напишите услугу и при желании условие, например: «Маникюр с покрытием, скидка 10%» или «Массаж спины 60 мин».')
    .build(), new InlineKeyboard().text('✖️ Отмена', 'srvh:list'));
});

async function showHotSlotManage(ctx, slotId, { justCreated = false } = {}) {
  const provider = ownProvider(ctx);
  const slot = provider && getHotSlot(slotId);
  if (!slot || slot.provider_id !== provider.id || slot.status !== 'active') {
    return showHotSlotsManager(ctx);
  }
  const when = formatHotSlotWhen(slot.slot_at);
  const subs = countServiceSubscribers(provider.id);
  const cooldown = hotNotifyCooldownLeftMinutes(provider);

  const r = rich()
    .bold(justCreated ? `✅ Окно опубликовано: ${when}` : `🔥 Горящее окно: ${when}`).nl(2)
    .bold(slot.title).nl();
  if (slot.note) r.plain(slot.note).nl();
  r.nl().plain('Жильцы уже видят его в разделе «🔥 Горящие окна». Как только время заберут (в боте или в Instagram), нажмите кнопку ниже — окно сразу исчезнет.');

  const kb = new InlineKeyboard()
    .text('✅ Забрали (снять окно)', `srvh:close:${slot.id}`).row();

  if (!slot.notified_at && subs > 0) {
    if (cooldown === 0) {
      kb.text(`📣 Уведомить подписчиков (${subs})`, `srvh:push:${slot.id}`).row();
    } else {
      r.nl(2).italic(`📣 Рассылка подписчикам будет доступна через ${cooldown} мин (защита от спама).`);
    }
  } else if (slot.notified_at) {
    r.nl(2).italic('📣 Подписчики уже уведомлены об этом окне.');
  }

  kb.text('◀️ К окнам', 'srvh:list');
  return show(ctx, r.build(), kb);
}

servicePanelComposer.callbackQuery(/^srvh:v:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showHotSlotManage(ctx, Number(ctx.match[1]));
});

servicePanelComposer.callbackQuery(/^srvh:close:(\d+)$/, async (ctx) => {
  const provider = ownProvider(ctx);
  const ok = provider && closeHotSlot(Number(ctx.match[1]), provider.id);
  await ctx.answerCallbackQuery({ text: ok ? '✅ Окно снято с витрины' : 'Окно уже закрыто' });
  await showHotSlotsManager(ctx);
});

function buildHotSlotPush(provider, slot) {
  const when = formatHotSlotWhen(slot.slot_at);
  const r = rich()
    .bold(`🔥 Горящее окно · ${provider.name}`).nl(2)
    .bold(`🕒 ${when} — ${slot.title}`).nl();
  if (slot.note) r.plain(slot.note).nl();
  if (provider.location) r.plain(`📍 ${provider.location}`).nl();

  const kb = new InlineKeyboard();
  const msg = `Здравствуйте! Хочу забрать горящее окно (${when} — ${slot.title}) из бота Зелёной Гавани. Оно ещё свободно?`;
  const dmUrl = prefilledContactUrl(provider.contact, msg);
  if (dmUrl) kb.url('✉️ Забрать окно (написать)', dmUrl);
  if (provider.booking_url) kb.url('🗓 Онлайн-запись', provider.booking_url);
  if (dmUrl || provider.booking_url) kb.row();
  kb.text('👤 Карточка мастера', `srv:p:${provider.id}:h`)
    .text('🔕 Отписаться', `srv:unsub:${provider.id}`);

  return { built: r.build(4096), kb };
}

servicePanelComposer.callbackQuery(/^srvh:push:(\d+)$/, async (ctx) => {
  const provider = ownProvider(ctx);
  const slot = provider && getHotSlot(Number(ctx.match[1]));
  if (!slot || slot.provider_id !== provider.id || slot.status !== 'active') {
    await ctx.answerCallbackQuery();
    return showHotSlotsManager(ctx);
  }
  const cooldown = hotNotifyCooldownLeftMinutes(provider);
  if (cooldown > 0) {
    await ctx.answerCallbackQuery({ text: `Рассылку можно отправлять раз в 2 часа (осталось ${cooldown} мин)`, show_alert: true });
    return showHotSlotManage(ctx, slot.id);
  }
  await ctx.answerCallbackQuery();
  const subs = countServiceSubscribers(provider.id);
  const { built } = buildHotSlotPush(provider, slot);
  const preview = rich()
    .plain(`Отправить это уведомление ${subs} ${plural(subs, ['подписчику', 'подписчикам', 'подписчикам'])}?`).nl(2)
    .rich(built.text, built.entities)
    .build(4096);
  await show(ctx, preview, new InlineKeyboard()
    .text('📣 Отправить', `srvh:pushgo:${slot.id}`)
    .text('✖️ Отмена', `srvh:v:${slot.id}`));
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

servicePanelComposer.callbackQuery(/^srvh:pushgo:(\d+)$/, async (ctx) => {
  const provider = ownProvider(ctx);
  const slot = provider && getHotSlot(Number(ctx.match[1]));
  if (!slot || slot.provider_id !== provider.id || slot.status !== 'active') {
    await ctx.answerCallbackQuery();
    return showHotSlotsManager(ctx);
  }
  if (hotNotifyCooldownLeftMinutes(provider) > 0 || slot.notified_at) {
    await ctx.answerCallbackQuery({ text: 'Уведомление уже отправлено или действует пауза' });
    return showHotSlotManage(ctx, slot.id);
  }

  touchProviderHotNotified(provider.id);
  markHotSlotNotified(slot.id);
  await ctx.answerCallbackQuery({ text: '📣 Отправляю подписчикам…' });

  const { built, kb } = buildHotSlotPush(provider, slot);
  const recipients = getServiceSubscriberIds(provider.id);
  let sent = 0;
  for (const userId of recipients) {
    try {
      await ctx.api.sendMessage(userId, built.text, { entities: built.entities, reply_markup: kb });
      sent += 1;
    } catch (err) {
      if (err.error_code === 403) unsubscribeService(userId, provider.id);
      else console.error(`[Services] Уведомление ${userId} не отправлено:`, err.message);
    }
    await sleep(40);
  }

  const r = rich()
    .bold(`📣 Отправлено: ${sent} из ${recipients.length}`).nl(2)
    .plain('Не забудьте снять окно кнопкой «✅ Забрали», как только клиент запишется.');
  await show(ctx, r.build(), new InlineKeyboard().text('◀️ К окну', `srvh:v:${slot.id}`));
});

// ── Добавление и редактирование услуг (пост + фото/альбом) ─

function askOfferPost(ctx, { replaceOfferId = null, error = null } = {}) {
  setPendingInput(ctx.from.id, 'srv_post', { replaceOfferId });
  const r = rich().bold(replaceOfferId ? '🔁 Заменить пост услуги' : '➕ Новая услуга').nl(2);
  if (error) r.plain(`⚠️ ${error}`).nl(2);
  r
    .plain('Пришлите пост с описанием услуги — как публикуете в Instagram или группе:').nl()
    .plain('• одно фото или альбом работ (до 10 фото) — или просто текст;').nl()
    .plain('• первая строка станет названием (например «Маникюр с покрытием»), цена вроде «55 р» определится сама.').nl(2)
    .italic('Перед сохранением бот покажет черновик, где можно поправить название, цену, длительность и категорию.');
  const back = replaceOfferId ? `srvp:it:${replaceOfferId}` : 'srvp:home';
  return show(ctx, r.build(), new InlineKeyboard().text('✖️ Отмена', back));
}

servicePanelComposer.callbackQuery('srvp:add', async (ctx) => {
  await ctx.answerCallbackQuery();
  const provider = ownProvider(ctx);
  if (!provider) return showServicePanel(ctx);
  if (getProviderOffers(provider.id).length >= MAX_OFFERS) {
    await ctx.answerCallbackQuery({ text: `Максимум ${MAX_OFFERS} услуг`, show_alert: true }).catch(() => {});
    return showServicePanel(ctx);
  }
  await askOfferPost(ctx);
});

servicePanelComposer.callbackQuery(/^srvp:rep:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ownOffer(ctx, Number(ctx.match[1]))) return showServicePanel(ctx);
  await askOfferPost(ctx, { replaceOfferId: Number(ctx.match[1]) });
});

function getOfferDraft(ctx) {
  const draft = offerDrafts.get(ctx.from.id);
  const provider = ownProvider(ctx);
  return draft && provider && draft.providerId === provider.id ? { draft, provider } : null;
}

function draftToOffer(draft) {
  return {
    id: 'd',
    title: draft.title,
    price_text: draft.priceText,
    duration_text: draft.durationText,
    body: draft.parsed.body,
    body_entities: draft.parsed.bodyEntities,
    photos: draft.parsed.photos,
  };
}

async function showOfferDraft(ctx, { error = null } = {}) {
  const found = getOfferDraft(ctx);
  if (!found) return showServicePanel(ctx);
  const { draft } = found;

  const r = rich().bold('📝 Проверьте услугу').plain(' — я понял пост так:').nl(2);
  if (error) r.plain(`⚠️ ${error}`).nl(2);

  r.plain('📌 Название: ').bold(draft.title).nl();
  if (draft.titleSuspicious && !draft.titleEdited) {
    r.italic('   Похоже, первая строка — не название. Нажмите «✏️ Название» и напишите коротко.').nl();
  }
  r.plain(`💰 Цена: ${draft.priceText || '— не найдена'}`).nl();
  r.plain(`⏱ Длительность: ${draft.durationText || '— не указана (необязательно)'}`).nl();
  r.plain(`🖼 Фото: ${draft.parsed.photos.length}`).nl();

  const category = draft.category && SERVICE_CATEGORY_BY_ID[draft.category];
  r.nl().plain(`🗂 Категория: ${category ? category.title : '— выберите ниже'}`);

  const kb = new InlineKeyboard();
  SERVICE_CATEGORIES.forEach((cat, i) => {
    kb.text(cat.id === draft.category ? `• ${cat.title} •` : cat.title, `srvd:cat:${cat.id}`);
    if (i % 2 === 1) kb.row();
  });
  if (SERVICE_CATEGORIES.length % 2 === 1) kb.row();
  kb
    .text('✏️ Название', 'srvd:f:title')
    .text('✏️ Цена', 'srvd:f:price')
    .text('⏱ Длительность', 'srvd:f:dur').row()
    .text('👀 Предпросмотр', 'srvp:pv:d:0').row()
    .text('✅ Сохранить', 'srvd:save').text('✖️ Отмена', 'srvd:cancel');
  return show(ctx, r.build(), kb);
}

servicePanelComposer.callbackQuery(/^srvd:cat:([a-z]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = getOfferDraft(ctx);
  if (found && SERVICE_CATEGORY_BY_ID[ctx.match[1]]) found.draft.category = ctx.match[1];
  await showOfferDraft(ctx);
});

servicePanelComposer.callbackQuery(/^srvd:f:(title|price|dur)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!getOfferDraft(ctx)) return showServicePanel(ctx);
  setPendingInput(ctx.from.id, 'srv_draft_field', { field: ctx.match[1] });
  const prompts = {
    title: 'Короткое название услуги (3–5 слов) — оно будет на кнопке:',
    price: 'Цена для кнопки, например «55 р» или «от 45 р». Отправьте «-», чтобы убрать:',
    dur: 'Длительность, например «~1.5 ч» или «60 мин». Отправьте «-», чтобы убрать:',
  };
  await show(ctx, rich().plain(prompts[ctx.match[1]]).build(),
    new InlineKeyboard().text('◀️ Назад к черновику', 'srvd:back'));
});

servicePanelComposer.callbackQuery('srvd:back', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showOfferDraft(ctx);
});

servicePanelComposer.callbackQuery(/^srvp:pv:d:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = getOfferDraft(ctx);
  if (!found) return showServicePanel(ctx);
  const { built, photo, keyboard } = buildOfferCard(draftToOffer(found.draft), found.provider, {
    photoIndex: Number(ctx.match[1]),
    preview: true,
  });
  keyboard.text('◀️ Назад к черновику', 'srvd:back');
  await show(ctx, built, keyboard, photo ? { photo } : {});
});

servicePanelComposer.callbackQuery('srvd:cancel', async (ctx) => {
  offerDrafts.delete(ctx.from.id);
  await ctx.answerCallbackQuery({ text: 'Черновик удалён' });
  await showServicePanel(ctx);
});

servicePanelComposer.callbackQuery('srvd:save', async (ctx) => {
  const found = getOfferDraft(ctx);
  if (!found) {
    await ctx.answerCallbackQuery();
    return showServicePanel(ctx);
  }
  const { draft, provider } = found;
  if (!draft.category) {
    await ctx.answerCallbackQuery({ text: 'Выберите категорию — по ней вас находят жильцы', show_alert: true });
    return;
  }

  const data = {
    title: draft.title,
    priceText: draft.priceText,
    durationText: draft.durationText,
    body: draft.parsed.body,
    bodyEntities: draft.parsed.bodyEntities,
    photos: draft.parsed.photos,
  };

  let offer;
  if (draft.replaceOfferId && ownOffer(ctx, draft.replaceOfferId)) {
    offer = replaceServiceOfferPost(draft.replaceOfferId, data);
    if (offer.category !== draft.category) updateServiceOfferField(offer.id, 'category', draft.category);
    if (draft.durationText !== offer.duration_text) updateServiceOfferField(offer.id, 'duration_text', draft.durationText);
    offer = getServiceOffer(offer.id);
  } else {
    if (getProviderOffers(provider.id).length >= MAX_OFFERS) {
      await ctx.answerCallbackQuery({ text: `Максимум ${MAX_OFFERS} услуг`, show_alert: true });
      return;
    }
    offer = createServiceOffer(provider.id, { ...data, category: draft.category });
  }
  offerDrafts.delete(ctx.from.id);
  await ctx.answerCallbackQuery({ text: '✅ Услуга сохранена' });
  await showOfferManage(ctx, offer.id, { justSaved: true });
});

// ── Список услуг и управление одной услугой ───────────────

async function showOffersList(ctx) {
  const provider = ownProvider(ctx);
  if (!provider) return showServicePanel(ctx);
  const offers = getProviderOffers(provider.id).slice(0, MAX_OFFERS);
  const arrows = offers.length > 1 && offers.length <= INLINE_ARROWS_MAX;
  const kb = new InlineKeyboard();
  offers.forEach((offer, idx) => {
    const label = `${offer.published ? '' : '🙈 '}${offer.title}`;
    if (!arrows) {
      kb.text(`${offer.published ? '' : '🙈 '}${offerButtonLabel(offer)}`, `srvp:it:${offer.id}`).row();
      return;
    }
    kb.text(idx === 0 ? '·' : '⬆️', idx === 0 ? 'noop' : `srvp:mo:${offer.id}:u`)
      .text(label, `srvp:it:${offer.id}`)
      .text(idx === offers.length - 1 ? '·' : '⬇️', idx === offers.length - 1 ? 'noop' : `srvp:mo:${offer.id}:d`)
      .row();
  });
  kb.text('➕ Добавить услугу', 'srvp:add').row();
  kb.text('◀️ Назад', 'srvp:home');
  const r = rich().bold('📋 Мои услуги').nl(2).plain('Нажмите на услугу, чтобы изменить её.');
  if (arrows) r.nl().plain('⬆️ ⬇️ — поменять порядок в вашей карточке.');
  return show(ctx, r.build(), kb);
}

servicePanelComposer.callbackQuery('srvp:offers', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showOffersList(ctx);
});

servicePanelComposer.callbackQuery(/^srvp:mo:(\d+):([ud])$/, async (ctx) => {
  const own = ownOffer(ctx, Number(ctx.match[1]));
  if (own) moveServiceOffer(own.provider.id, own.offer.id, ctx.match[2]);
  await ctx.answerCallbackQuery();
  await showOffersList(ctx);
});

async function showOfferManage(ctx, offerId, { justSaved = false } = {}) {
  const own = ownOffer(ctx, offerId);
  if (!own) return showServicePanel(ctx);
  const { offer } = own;
  const cat = SERVICE_CATEGORY_BY_ID[offer.category] || SERVICE_CATEGORY_BY_ID.other;

  const r = rich()
    .bold(justSaved ? `✅ Сохранено: ${offer.title}` : `✨ ${offer.title}`).nl(2)
    .plain(`🗂 Категория: ${cat.title}`).nl()
    .plain(`💰 Цена: ${offer.price_text || 'не указана'}`).nl()
    .plain(`⏱ Длительность: ${offer.duration_text || 'не указана'}`).nl()
    .plain(`🖼 Фото: ${offer.photos.length}`).nl()
    .plain(offer.published ? '👁 Видна жильцам' : '🙈 Скрыта от жильцов');

  const kb = new InlineKeyboard();
  SERVICE_CATEGORIES.forEach((c, i) => {
    kb.text(c.id === offer.category ? `• ${c.title} •` : c.title, `srvp:cat:${offer.id}:${c.id}`);
    if (i % 2 === 1) kb.row();
  });
  if (SERVICE_CATEGORIES.length % 2 === 1) kb.row();
  kb
    .text('✏️ Название', `srvp:f:${offer.id}:title`)
    .text('✏️ Цена', `srvp:f:${offer.id}:price_text`)
    .text('⏱ Длит.', `srvp:f:${offer.id}:duration_text`).row()
    .text('🔁 Заменить пост', `srvp:rep:${offer.id}`)
    .text('👀 Как видят', `srvp:pv:${offer.id}:0`).row()
    .text(offer.published ? '🙈 Скрыть' : '👁 Опубликовать', `srvp:pub:${offer.id}`)
    .text('🗑 Удалить', `srvp:del:${offer.id}`).row()
    .text('◀️ К услугам', 'srvp:offers');
  return show(ctx, r.build(), kb);
}

servicePanelComposer.callbackQuery(/^srvp:it:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showOfferManage(ctx, Number(ctx.match[1]));
});

servicePanelComposer.callbackQuery(/^srvp:cat:(\d+):([a-z]+)$/, async (ctx) => {
  const own = ownOffer(ctx, Number(ctx.match[1]));
  if (!own || !SERVICE_CATEGORY_BY_ID[ctx.match[2]]) {
    await ctx.answerCallbackQuery();
    return showServicePanel(ctx);
  }
  updateServiceOfferField(own.offer.id, 'category', ctx.match[2]);
  await ctx.answerCallbackQuery({ text: `Категория: ${SERVICE_CATEGORY_BY_ID[ctx.match[2]].title}` });
  await showOfferManage(ctx, own.offer.id);
});

servicePanelComposer.callbackQuery(/^srvp:pub:(\d+)$/, async (ctx) => {
  const own = ownOffer(ctx, Number(ctx.match[1]));
  if (!own) {
    await ctx.answerCallbackQuery();
    return showServicePanel(ctx);
  }
  const updated = toggleServiceOfferPublished(own.offer.id);
  await ctx.answerCallbackQuery({ text: updated.published ? '👁 Услуга опубликована' : '🙈 Услуга скрыта' });
  await showOfferManage(ctx, own.offer.id);
});

servicePanelComposer.callbackQuery(/^srvp:f:(\d+):(title|price_text|duration_text)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const own = ownOffer(ctx, Number(ctx.match[1]));
  if (!own) return showServicePanel(ctx);
  setPendingInput(ctx.from.id, 'srv_offer_field', { offerId: own.offer.id, field: ctx.match[2] });
  const prompts = {
    title: 'Новое название услуги (коротко, для кнопки):',
    price_text: 'Цена для кнопки, например «55 р». Отправьте «-», чтобы убрать:',
    duration_text: 'Длительность, например «~1.5 ч». Отправьте «-», чтобы убрать:',
  };
  await show(ctx, rich().plain(prompts[ctx.match[2]]).build(),
    new InlineKeyboard().text('✖️ Отмена', `srvp:it:${own.offer.id}`));
});

servicePanelComposer.callbackQuery(/^srvp:pv:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const own = ownOffer(ctx, Number(ctx.match[1]));
  if (!own) return showServicePanel(ctx);
  const { built, photo, keyboard } = buildOfferCard(own.offer, own.provider, {
    photoIndex: Number(ctx.match[2]),
    preview: true,
  });
  keyboard.text('◀️ Назад', `srvp:it:${own.offer.id}`);
  await show(ctx, built, keyboard, photo ? { photo } : {});
});

servicePanelComposer.callbackQuery(/^srvp:del:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const own = ownOffer(ctx, Number(ctx.match[1]));
  if (!own) return showServicePanel(ctx);
  await show(ctx, rich().plain('Удалить услугу ').bold(own.offer.title).plain('?').build(),
    new InlineKeyboard().text('🗑 Да, удалить', `srvp:delok:${own.offer.id}`).text('Отмена', `srvp:it:${own.offer.id}`));
});

servicePanelComposer.callbackQuery(/^srvp:delok:(\d+)$/, async (ctx) => {
  const own = ownOffer(ctx, Number(ctx.match[1]));
  if (own) deleteServiceOffer(own.offer.id);
  await ctx.answerCallbackQuery({ text: own ? '🗑 Услуга удалена' : '' });
  await showOffersList(ctx);
});

// ── Статистика специалиста ────────────────────────────────

function formatStatLine(counts, key, label) {
  const c = counts[key] || { people: 0, total: 0 };
  if (!c.people) return `${label}: 0`;
  return c.total > c.people ? `${label}: ${c.people} чел. (${c.total} раз)` : `${label}: ${c.people} чел.`;
}

async function showProviderStats(ctx, period = 'd7') {
  const provider = ownProvider(ctx);
  if (!provider) return showServicePanel(ctx);
  const pKey = PERIODS[period] ? period : 'd7';
  const since = periodSince(pKey);
  const counts = getProviderCounts(provider.id, since);
  const top = getProviderTopOffers(provider.id, since);
  const subsTotal = countServiceSubscribers(provider.id);
  const subsNew = getNewServiceSubscribers(provider.id, since);

  const r = rich().bold(`📊 Статистика · ${PERIODS[pKey].title}`).nl(2)
    .plain(formatStatLine(counts, SERVICE_EVENT.VIEW_PROVIDER, '👀 Открыли вашу карточку')).nl()
    .plain(formatStatLine(counts, SERVICE_EVENT.VIEW_OFFER, '✨ Смотрели услуги')).nl()
    .plain(formatStatLine(counts, SERVICE_EVENT.CONTACT, '✉️ Нажали «Написать»')).nl()
    .plain(formatStatLine(counts, SERVICE_EVENT.BOOKING_LINK, '🗓 Перешли на онлайн-запись')).nl()
    .plain(`🔔 Подписчиков: ${subsTotal}${subsNew ? ` (+${subsNew})` : ''}`);

  if (top.length > 0) {
    r.nl(2).bold('🏆 Популярные услуги:');
    top.forEach((o, i) => {
      r.nl().plain(`${i + 1}. ${o.title} — ${o.people} чел.`);
    });
  }

  const kb = new InlineKeyboard();
  for (const [key, cfg] of Object.entries(PERIODS)) {
    kb.text(key === pKey ? `• ${cfg.title} •` : cfg.title, `srvp:st:${key}`);
  }
  kb.row().text('◀️ Назад', 'srvp:home');
  return show(ctx, r.build(), kb);
}

servicePanelComposer.callbackQuery(/^srvp:st:(d1|d7|d30|all)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showProviderStats(ctx, ctx.match[1]);
});

// ── Приём постов, альбомов и текстового ввода ─────────────

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

async function saveOfferPost(ctx, { photos, text, entities, replaceOfferId, messageIds }) {
  clearPendingInput(ctx.from.id);
  const provider = ownProvider(ctx);
  if (!provider) return;

  if (!text.trim() && photos.length === 0) {
    return askOfferPost(ctx, { replaceOfferId, error: 'Нужно фото с подписью или текст с описанием. Попробуйте ещё раз.' });
  }

  const parsed = parseServicePost({ text, entities, photos });
  await deleteUserMessages(ctx, messageIds.slice(0, -1));

  const existing = replaceOfferId ? ownOffer(ctx, replaceOfferId)?.offer : null;
  offerDrafts.set(ctx.from.id, {
    providerId: provider.id,
    replaceOfferId: existing ? existing.id : null,
    parsed,
    title: parsed.title,
    priceText: parsed.priceText,
    durationText: existing ? existing.duration_text : null,
    category: existing ? existing.category : null,
    titleSuspicious: parsed.titleSuspicious,
  });
  await showOfferDraft(ctx);
}

async function finishAlbum(groupId) {
  const album = albums.get(groupId);
  albums.delete(groupId);
  if (!album) return;
  try {
    await saveOfferPost(album.ctx, album);
  } catch (err) {
    console.error('[Services] Ошибка сохранения альбома:', err);
  }
}

servicePanelComposer.on(['message:photo', 'message:text'], async (ctx, next) => {
  if (ctx.chat.type !== 'private') return next();
  const msg = ctx.message;
  const userId = ctx.from.id;

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

  if (msg.photo && !msg.media_group_id && isAdmin(userId) && getPendingInput(userId, 'srv_cover')) {
    clearPendingInput(userId);
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    setServicesSectionCover(fileId);
    const { built, kb } = providersAdminView();
    const done = rich().plain('✅ Обложка раздела «Услуги и красота» сохранена.').nl(2).rich(built.text, built.entities).build();
    await ctx.reply(done.text, { entities: done.entities, reply_markup: kb });
    return;
  }

  const postState = getPendingInput(userId, 'srv_post');
  if (postState) {
    if (msg.text?.startsWith('/')) return next();
    const { photo, text, entities } = messagePayload(msg);
    if (msg.media_group_id) {
      albums.set(msg.media_group_id, {
        ctx, photos: photo ? [photo] : [], text, entities, messageIds: [msg.message_id],
        replaceOfferId: postState.replaceOfferId,
        timer: setTimeout(() => finishAlbum(msg.media_group_id), ALBUM_WAIT_MS),
      });
      return;
    }
    await saveOfferPost(ctx, {
      photos: photo ? [photo] : [],
      text,
      entities,
      replaceOfferId: postState.replaceOfferId,
      messageIds: [msg.message_id],
    });
    return;
  }

  if (!msg.text || msg.text.startsWith('/')) return next();
  return handleServiceTextInput(ctx, next);
});

async function handleServiceTextInput(ctx, next) {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();
  const entities = cleanEntities(ctx.message.entities);

  const nameState = getPendingInput(userId, 'srv_apply_name');
  if (nameState) {
    if (text.length < 2 || text.length > 60) {
      return show(ctx, rich()
        .bold('📝 Заявка специалиста — шаг 1 из 3').nl(2)
        .plain('⚠️ Название должно быть от 2 до 60 символов. Попробуйте ещё раз.')
        .build(), new InlineKeyboard().text('✖️ Отмена', 'srvp:home'));
    }
    setPendingInput(userId, 'srv_apply_location', { name: text });
    return show(ctx, rich()
      .bold('📝 Заявка специалиста — шаг 2 из 3').nl(2)
      .plain('Где вы принимаете в ЖК? Например: «ул. Лесная, 5 (на дому)», «кабинет в квартале» или «выезд к клиенту».')
      .build(), new InlineKeyboard().text('✖️ Отмена', 'srvp:home'));
  }

  const locState = getPendingInput(userId, 'srv_apply_location');
  if (locState) {
    setPendingInput(userId, 'srv_apply_about', { name: locState.name, location: text.slice(0, 80) });
    return show(ctx, rich()
      .bold('📝 Заявка специалиста — шаг 3 из 3').nl(2)
      .plain('Пара слов о себе и условиях: какие услуги делаете, опыт, стерилизация, как обычно записываться.').nl(2)
      .italic('Жирный и курсив из Telegram сохранятся.')
      .build(), new InlineKeyboard().text('✖️ Отмена', 'srvp:home'));
  }

  const aboutState = getPendingInput(userId, 'srv_apply_about');
  if (aboutState) {
    clearPendingInput(userId);
    const contact = ctx.from.username ? `@${ctx.from.username}` : null;
    const data = {
      name: aboutState.name,
      location: aboutState.location,
      about: ctx.message.text,
      aboutEntities: entities,
      contact,
    };
    const existing = getProviderByUser(userId);
    const provider = existing ? resubmitProvider(existing.id, data) : createProvider({ userId, ...data });
    await notifyAdminsAboutServiceApplication(ctx.api, provider, ctx.from);
    return showServicePanel(ctx);
  }

  const profileState = getPendingInput(userId, 'srv_profile');
  if (profileState) {
    const provider = ownProvider(ctx);
    clearPendingInput(userId);
    if (!provider) return showServicePanel(ctx);
    if (profileState.field === 'name') updateProviderProfile(provider.id, { name: text.slice(0, 60) });
    if (profileState.field === 'location') updateProviderProfile(provider.id, { location: text === '-' ? '' : text.slice(0, 80) });
    if (profileState.field === 'about') updateProviderProfile(provider.id, { about: ctx.message.text, aboutEntities: entities });
    if (profileState.field === 'contact') updateProviderProfile(provider.id, { contact: text === '-' ? null : text.slice(0, 64) });
    if (profileState.field === 'booking') {
      if (text === '-') {
        updateProviderProfile(provider.id, { bookingUrl: null });
      } else {
        const normalized = normalizeBookingUrl(text);
        if (!normalized) {
          setPendingInput(userId, 'srv_profile', { field: 'booking' });
          return show(ctx, rich().plain('⚠️ Не похоже на ссылку. Пришлите адрес вида https://dikidi.net/... или «-», чтобы убрать.').build(),
            new InlineKeyboard().text('✖️ Отмена', 'srvp:profile'));
        }
        updateProviderProfile(provider.id, { bookingUrl: normalized });
      }
    }
    await ctx.deleteMessage().catch(() => {});
    return showProfile(ctx);
  }

  const hotTimeState = getPendingInput(userId, 'srv_hot_time');
  if (hotTimeState) {
    const provider = ownProvider(ctx);
    if (!provider) {
      clearPendingInput(userId);
      return showServicePanel(ctx);
    }
    const parsed = parseSlotTimeInput(text);
    if (!parsed.ok) {
      return show(ctx, rich()
        .plain('⚠️ Не понял время. Напишите в формате ЧЧ:ММ, например «17:30» или «11:00»:').build(),
      new InlineKeyboard().text('✖️ Отмена', `srvh:d:${hotTimeState.dayOffset}`));
    }
    const slotAt = buildHotSlotUtc(hotTimeState.dayOffset, parsed.hh, parsed.mm);
    if (parseDbUtc(slotAt) <= new Date()) {
      return show(ctx, rich()
        .plain('⚠️ Это время уже прошло. Укажите время позже:').build(),
      new InlineKeyboard().text('✖️ Отмена', `srvh:d:${hotTimeState.dayOffset}`));
    }
    clearPendingInput(userId);
    await ctx.deleteMessage().catch(() => {});
    return showHotTitleStep(ctx, provider, { dayOffset: hotTimeState.dayOffset, hh: parsed.hh, mm: parsed.mm, slotAt });
  }

  const hotNoteState = getPendingInput(userId, 'srv_hot_note');
  if (hotNoteState) {
    clearPendingInput(userId);
    const provider = ownProvider(ctx);
    const draft = hotDrafts.get(userId);
    if (!provider || !draft || draft.providerId !== provider.id) return showHotSlotsManager(ctx);
    hotDrafts.delete(userId);
    const slot = createHotSlot({
      providerId: provider.id,
      slotAt: draft.slotAt,
      title: text.slice(0, 60),
    });
    await ctx.deleteMessage().catch(() => {});
    return showHotSlotManage(ctx, slot.id, { justCreated: true });
  }

  const draftField = getPendingInput(userId, 'srv_draft_field');
  if (draftField) {
    clearPendingInput(userId);
    const found = getOfferDraft(ctx);
    if (!found) return showServicePanel(ctx);
    if (draftField.field === 'title') {
      found.draft.title = text.replace(/\s+/g, ' ').slice(0, 48);
      found.draft.titleEdited = true;
    } else if (draftField.field === 'price') {
      found.draft.priceText = text === '-' ? null : text.slice(0, 32);
    } else {
      found.draft.durationText = text === '-' ? null : text.slice(0, 24);
    }
    return showOfferDraft(ctx);
  }

  const offerField = getPendingInput(userId, 'srv_offer_field');
  if (offerField) {
    clearPendingInput(userId);
    const own = ownOffer(ctx, offerField.offerId);
    if (!own) return showServicePanel(ctx);
    const limits = { title: 48, price_text: 32, duration_text: 24 };
    const value = offerField.field !== 'title' && text === '-'
      ? null
      : text.slice(0, limits[offerField.field] || 48);
    updateServiceOfferField(own.offer.id, offerField.field, value);
    await ctx.deleteMessage().catch(() => {});
    return showOfferManage(ctx, own.offer.id);
  }

  return next();
}

// ── Админ-модуль (srva:*) ─────────────────────────────────

const STATUS_LABELS = { pending: '⏳ на рассмотрении', active: '✅ активен', hidden: '🙈 скрыт', rejected: '❌ отклонён' };

servicePanelComposer.callbackQuery(/^srva:(ok|no):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery();
  const provider = getProvider(Number(ctx.match[2]));
  if (!provider) return ctx.answerCallbackQuery({ text: 'Заявка не найдена' });

  const approve = ctx.match[1] === 'ok';
  setProviderStatus(provider.id, approve ? 'active' : 'rejected');
  await syncServiceProviderCommands(ctx.api, provider.user_id, approve);
  await ctx.answerCallbackQuery({ text: approve ? 'Одобрено' : 'Отклонено' });
  await ctx.editMessageReplyMarkup({
    reply_markup: new InlineKeyboard()
      .text(approve ? '✅ Одобрено' : '❌ Отклонено', 'noop')
      .text('⚙️ Управление', `srva:p:${provider.id}`),
  }).catch(() => {});

  try {
    await ctx.api.sendMessage(provider.user_id, approve
      ? `🎉 Заявка «${provider.name}» одобрена! Добавьте услуги (фото работ и прайс) и при желании ссылку на онлайн-запись в кабинете специалиста: /services_cabinet.`
      : `К сожалению, заявка «${provider.name}» не одобрена. Если есть вопросы — напишите автору бота.`,
    approve ? {
      reply_markup: new InlineKeyboard().text('✨ Открыть кабинет', 'srvp:home'),
    } : {});
  } catch (err) {
    console.error('[Services] Не удалось уведомить специалиста:', err.message);
  }
});

function providersAdminView() {
  const providers = getAllProviders();
  const r = rich().bold('💅 Специалисты').nl(2);
  const kb = new InlineKeyboard();
  if (providers.length === 0) r.plain('Пока никого.').nl();
  for (const p of providers) {
    const icon = STATUS_LABELS[p.status].split(' ')[0];
    kb.text(`${icon} #${p.id} ${p.name} · ${p.offers_count} усл.`, `srva:p:${p.id}`).row();
  }
  if (providers.length > 0) r.plain('Выберите специалиста, чтобы скрыть, одобрить или удалить.').nl();
  r.nl().plain(`🖼 Обложка раздела: ${getServicesSectionCover() ? 'задана' : 'нет'}`).nl();
  r.nl().italic('Передать карточку: /service_owner <номер> @username (специалист должен хотя бы раз нажать /start).');
  kb.text('◀️ Назад', 'srva:hub');
  return { built: r.build(), kb };
}

function providerAdminCard(provider) {
  const subs = countServiceSubscribers(provider.id);
  const offers = getProviderOffers(provider.id).length;
  const hot = getProviderHotSlots(provider.id).length;
  const r = rich().bold(`#${provider.id} ${provider.name}`).nl(2)
    .plain(`Статус: ${STATUS_LABELS[provider.status]}`).nl()
    .plain(`Владелец: id ${provider.user_id}${provider.contact ? `, ${provider.contact}` : ''}`).nl()
    .plain(`Локация: ${provider.location || '—'}`).nl()
    .plain(`Онлайн-запись: ${provider.booking_url || '—'}`).nl()
    .plain(`Услуг: ${offers}, горящих окон: ${hot}, подписчиков: ${subs}`);
  if (provider.about) r.nl(2).rich(provider.about, provider.about_entities);
  const kb = new InlineKeyboard();
  if (provider.status === 'pending' || provider.status === 'rejected') kb.text('✅ Одобрить', `srva:ok:${provider.id}`);
  if (provider.status === 'pending') kb.text('❌ Отклонить', `srva:no:${provider.id}`);
  if (provider.status === 'active') kb.text('🙈 Скрыть', `srva:tog:${provider.id}`);
  if (provider.status === 'hidden') kb.text('👁 Показать', `srva:tog:${provider.id}`);
  kb.row().text('👀 Карточка', `srv:p:${provider.id}:h`).text('🗑 Удалить', `srva:del:${provider.id}`).row()
    .text('◀️ Назад', 'srva:list');
  return { built: r.build(), kb };
}

async function showServicesAdminHub(ctx) {
  const providers = getAllProviders();
  const active = providers.filter(p => p.status === 'active').length;
  const pending = providers.filter(p => p.status === 'pending').length;
  const hotCount = providers.reduce((s, p) => s + (p.hot_count || 0), 0);
  const r = rich().bold(SERVICE_SECTION_TITLE).nl(2)
    .plain(`✨ Специалистов: ${active}${pending ? ` · ⏳ заявок: ${pending}` : ''}`).nl()
    .plain(`🔥 Активных горящих окон: ${hotCount}`).nl()
    .plain(`🖼 Обложка раздела: ${getServicesSectionCover() ? 'задана' : 'нет'}`);
  const kb = new InlineKeyboard();
  if (pending) kb.text(`⏳ Заявки · ${pending}`, 'srva:req').row();
  kb.text(`✨ Специалисты · ${providers.length}`, 'srva:list').row()
    .text('📊 Аналитика', 'srva:an:d7').text('🖼 Обложка', 'srva:cover').row()
    .text('◀️ Назад', 'admin:main');
  return show(ctx, r.build(), kb);
}

servicePanelComposer.callbackQuery('srva:hub', async (ctx) => {
  if (!(await adminOnly(ctx))) return;
  await ctx.answerCallbackQuery();
  await showServicesAdminHub(ctx);
});

servicePanelComposer.callbackQuery('srva:req', async (ctx) => {
  if (!(await adminOnly(ctx))) return;
  await ctx.answerCallbackQuery();
  const pending = getAllProviders().filter(p => p.status === 'pending');
  if (pending.length === 1) {
    const { built, kb } = providerAdminCard(getProvider(pending[0].id));
    return show(ctx, built, kb);
  }
  const r = rich().bold('⏳ Заявки специалистов').nl(2);
  if (!pending.length) r.plain('Новых заявок нет.');
  const kb = new InlineKeyboard();
  for (const p of pending) kb.text(`⏳ ${p.name}`, `srva:p:${p.id}`).row();
  kb.text('◀️ Назад', 'srva:hub');
  return show(ctx, r.build(), kb);
});

servicePanelComposer.callbackQuery('srva:list', async (ctx) => {
  if (!(await adminOnly(ctx))) return;
  await ctx.answerCallbackQuery();
  const { built, kb } = providersAdminView();
  await show(ctx, built, kb);
});

servicePanelComposer.callbackQuery(/^srva:p:(\d+)$/, async (ctx) => {
  if (!(await adminOnly(ctx))) return;
  await ctx.answerCallbackQuery();
  const p = getProvider(Number(ctx.match[1]));
  const { built, kb } = p ? providerAdminCard(p) : providersAdminView();
  await show(ctx, built, kb);
});

servicePanelComposer.callbackQuery(/^srva:tog:(\d+)$/, async (ctx) => {
  if (!(await adminOnly(ctx))) return;
  const p = getProvider(Number(ctx.match[1]));
  if (p && (p.status === 'active' || p.status === 'hidden')) {
    const nowActive = p.status !== 'active';
    setProviderStatus(p.id, nowActive ? 'active' : 'hidden');
    await syncServiceProviderCommands(ctx.api, p.user_id, nowActive);
  }
  await ctx.answerCallbackQuery();
  const fresh = p && getProvider(p.id);
  const { built, kb } = fresh ? providerAdminCard(fresh) : providersAdminView();
  await show(ctx, built, kb);
});

servicePanelComposer.callbackQuery(/^srva:del:(\d+)$/, async (ctx) => {
  if (!(await adminOnly(ctx))) return;
  await ctx.answerCallbackQuery();
  const p = getProvider(Number(ctx.match[1]));
  if (!p) return showServicesAdminHub(ctx);
  const offers = getProviderOffers(p.id).length;
  const subs = countServiceSubscribers(p.id);
  const built = rich().bold(`🗑 Удалить специалиста «${p.name}»?`).nl(2)
    .plain(`Вместе с ним удалятся все услуги (${offers}), окна и подписки (${subs}).`).nl()
    .bold('Отменить это нельзя.').build();
  await show(ctx, built, new InlineKeyboard()
    .text('🗑 Да, удалить', `srva:delok:${p.id}`)
    .text('Отмена', `srva:p:${p.id}`));
});

servicePanelComposer.callbackQuery(/^srva:delok:(\d+)$/, async (ctx) => {
  if (!(await adminOnly(ctx))) return;
  const p = getProvider(Number(ctx.match[1]));
  if (p) {
    deleteProvider(p.id);
    await syncServiceProviderCommands(ctx.api, p.user_id, false);
  }
  await ctx.answerCallbackQuery({ text: p ? `🗑 «${p.name}» удалён` : 'Уже удалён' });
  const { built, kb } = providersAdminView();
  await show(ctx, built, kb);
});

servicePanelComposer.callbackQuery(/^srva:an:(d1|d7|d30|all)$/, async (ctx) => {
  if (!(await adminOnly(ctx))) return;
  await ctx.answerCallbackQuery();
  const pKey = ctx.match[1];
  const since = periodSince(pKey);
  const counts = getServicesTotalCounts(since);

  const r = rich().bold(`📊 Аналитика «Услуги и красота» · ${PERIODS[pKey].title}`).nl(2)
    .plain(formatStatLine(counts, SERVICE_EVENT.VIEW_PROVIDER, '👀 Открыли карточки')).nl()
    .plain(formatStatLine(counts, SERVICE_EVENT.VIEW_OFFER, '✨ Смотрели услуги')).nl()
    .plain(formatStatLine(counts, SERVICE_EVENT.CONTACT, '✉️ Нажали «Написать»')).nl()
    .plain(formatStatLine(counts, SERVICE_EVENT.BOOKING_LINK, '🗓 Перешли на онлайн-запись'));

  const kb = new InlineKeyboard();
  for (const [key, cfg] of Object.entries(PERIODS)) {
    kb.text(key === pKey ? `• ${cfg.title} •` : cfg.title, `srva:an:${key}`);
  }
  kb.row().text('◀️ Назад', 'srva:hub');
  await show(ctx, r.build(), kb);
});

servicePanelComposer.callbackQuery('srva:cover', async (ctx) => {
  if (!(await adminOnly(ctx))) return;
  await ctx.answerCallbackQuery();
  setPendingInput(ctx.from.id, 'srv_cover');
  const kb = new InlineKeyboard();
  if (getServicesSectionCover()) kb.text('🗑 Убрать обложку', 'srva:cover_off').row();
  kb.text('◀️ Назад', 'srva:hub');
  await show(ctx, rich().bold('🖼 Обложка раздела «Услуги и красота»').nl(2)
    .plain('Пришлите картинку — она будет вверху раздела и в списке горящих окон.').build(), kb);
});

servicePanelComposer.callbackQuery('srva:cover_off', async (ctx) => {
  if (!(await adminOnly(ctx))) return;
  setServicesSectionCover(null);
  await ctx.answerCallbackQuery({ text: 'Обложка убрана' });
  const { built, kb } = providersAdminView();
  await show(ctx, built, kb);
});

servicePanelComposer.command('service_owner', async (ctx) => {
  if (!isAdmin(ctx.from?.id)) return;
  const [idArg, who] = (ctx.match || '').trim().split(/\s+/);
  const provider = getProvider(Number(idArg));
  if (!provider || !who) {
    await ctx.reply('Формат: /service_owner <номер специалиста> <@username или telegram id>');
    return;
  }
  const userId = /^\d+$/.test(who) ? Number(who) : findUserIdByUsername(who);
  if (!userId) {
    await ctx.reply('Пользователь не найден. Пусть специалист сначала откроет бота и нажмёт /start.');
    return;
  }
  const taken = getProviderByUser(userId);
  if (taken && taken.id !== provider.id) {
    await ctx.reply(`У этого пользователя уже есть карточка #${taken.id} «${taken.name}».`);
    return;
  }
  setProviderOwner(provider.id, userId);
  if (provider.user_id !== userId) await syncServiceProviderCommands(ctx.api, provider.user_id, false);
  await syncServiceProviderCommands(ctx.api, userId, provider.status === 'active');
  if (/^@/.test(who) || !/^\d+$/.test(who)) updateProviderProfile(provider.id, { contact: `@${who.replace(/^@/, '')}` });
  await ctx.reply(`Готово: карточка #${provider.id} «${provider.name}» теперь у ${who}.`);
});
