import { Composer, InlineKeyboard } from 'grammy';
import { renderScreen } from '../utils/cleanChat.js';
import { transportMenuKeyboard } from '../keyboards/transport.js';
import { config } from '../../config.js';

export const supportComposer = new Composer();

// Клавиатура главного меню поддержки
function supportMenuKeyboard() {
  const creatorUrl = `https://t.me/${config.creatorUsername.replace('@', '')}`;

  return new InlineKeyboard()
    .text('💳 Перевод на карту', 'support:card').row()
    .text('⭐️ Поддержать звёздами (Telegram Stars)', 'support:stars').row()
    .url(`💬 Написать автору (@${config.creatorUsername.replace('@', '')})`, creatorUrl).row()
    .text('◀️ В главное меню', 'menu:main');
}

// Клавиатура экрана карты
function supportCardKeyboard() {
  return new InlineKeyboard()
    .text('⭐️ Поддержать звёздами', 'support:stars').row()
    .text('◀️ Назад', 'support:menu');
}

// Клавиатура выбора звёзд
function supportStarsKeyboard() {
  return new InlineKeyboard()
    .text('⭐️ 25 звёзд (~0.5 $)', 'support:pay_stars:25')
    .text('⭐️ 50 звёзд (~1.0 $)', 'support:pay_stars:50').row()
    .text('⭐️ 100 звёзд (~2.0 $)', 'support:pay_stars:100')
    .text('⭐️ 250 звёзд (~5.0 $)', 'support:pay_stars:250').row()
    .text('⭐️ 500 звёзд (~10.0 $)', 'support:pay_stars:500').row()
    .text('💳 Перевод на карту', 'support:card').row()
    .text('◀️ Назад', 'support:menu');
}

// Текст главного экрана поддержки
function renderSupportText() {
  const creator = `@${config.creatorUsername.replace('@', '')}`;

  return (
    `❤️ *Поддержка и развитие проекта*\n\n` +
    `Бот создан жителем Зелёной Гавани для соседей, чтобы точное расписание транспорта и сервисы района всегда были под рукой в 1 клик.\n\n` +
    `Проект развивается на личном энтузиазме. Если бот помогает вам экономить время, вы можете поддержать оплату сервера и добавление новых функций ☕️\n\n` +
    `🤝 *По всем вопросам, предложениям и сотрудничеству:*\n` +
    `👉 ${creator}`
  );
}

// 1. Команды /support, /donate, /help
supportComposer.command(['support', 'donate', 'help'], async (ctx) => {
  await renderScreen(ctx, renderSupportText(), {
    parse_mode: 'Markdown',
    reply_markup: supportMenuKeyboard(),
    disable_web_page_preview: true,
  });
});

// 2. Колбэк открытия меню поддержки
supportComposer.callbackQuery('support:menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderScreen(ctx, renderSupportText(), {
    parse_mode: 'Markdown',
    reply_markup: supportMenuKeyboard(),
    disable_web_page_preview: true,
  });
});

// 3. Экран перевода на карту
supportComposer.callbackQuery('support:card', async (ctx) => {
  await ctx.answerCallbackQuery();

  const card = config.donateCard ? `\`${config.donateCard}\`` : '_Номер карты уточняйте у автора_';
  const phone = config.donatePhone ? `\n📱 *Телефон:* \`${config.donatePhone}\`` : '';
  const recipient = config.donateRecipient ? `\n👤 *Получатель:* ${config.donateRecipient}` : '';

  const text = (
    `💳 *Поддержка переводом на карту*\n\n` +
    `Вы можете отправить любую комфортную сумму на оплату сервера и развитие бота:\n\n` +
    `💳 *Номер карты:* ${card} _(нажмите, чтобы скопировать)_` +
    phone +
    recipient +
    `\n\n💬 *Назначение / сообщение:* «На бота Зелёная Гавань»\n\n` +
    `Огромное спасибо за вашу поддержку и теплые слова! ❤️`
  );

  await renderScreen(ctx, text, {
    parse_mode: 'Markdown',
    reply_markup: supportCardKeyboard(),
  });
});

// 4. Экран выбора звёзд Telegram
supportComposer.callbackQuery('support:stars', async (ctx) => {
  await ctx.answerCallbackQuery();

  const text = (
    `⭐️ *Поддержка звёздами Telegram (Telegram Stars)*\n\n` +
    `Звёзды списываются прямо с вашего баланса Telegram в 1 клик.\n\n` +
    `Выберите количество звёзд для поддержки бота:`
  );

  await renderScreen(ctx, text, {
    parse_mode: 'Markdown',
    reply_markup: supportStarsKeyboard(),
  });
});

// 5. Выставление инвойса на оплату звёздами
supportComposer.callbackQuery(/^support:pay_stars:(\d+)$/, async (ctx) => {
  const starsCount = Number(ctx.match[1]) || 50;
  await ctx.answerCallbackQuery();

  try {
    await ctx.replyWithInvoice(
      'Поддержка бота «Зелёная Гавань»',
      `Добровольная поддержка развития и сервера бота (${starsCount} ⭐)`,
      `donate_stars_${starsCount}_${ctx.from?.id}_${Date.now()}`,
      'XTR', // Валюта Telegram Stars
      [{ label: `${starsCount} Telegram Stars`, amount: starsCount }]
    );
  } catch (err) {
    console.error('[Support] Ошибка отправки Stars-инвойса:', err.message);
    await ctx.reply(
      '⚠️ Не удалось сформировать счёт на оплату звёздами. Попробуйте перевод на карту или напишите автору.',
      {
        reply_markup: new InlineKeyboard()
          .text('💳 Перевод на карту', 'support:card').row()
          .text('◀️ Назад в меню', 'support:menu'),
      }
    );
  }
});

// 6. Подтверждение готовности принять Stars (pre_checkout_query)
supportComposer.on('pre_checkout_query', async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error('[Support] Ошибка answerPreCheckoutQuery:', err.message);
  }
});

// 7. Обработка успешного платежа звёздами
supportComposer.on(':successful_payment', async (ctx) => {
  const payment = ctx.message?.successful_payment;
  const stars = payment?.total_amount || 0;

  console.log(`⭐ [Donation] Успешный донат ${stars} звёзд от пользователя ${ctx.from?.id} (${ctx.from?.username || ctx.from?.first_name})`);

  await ctx.reply(
    `🎉 *Огромное спасибо за поддержку!* (${stars} ⭐)\n\n` +
    `Благодаря вам бот продолжает работать стабильно и развиваться для всех жителей Зелёной Гавани. Вы супер! ❤️`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('◀️ В меню транспорта', 'transport:menu'),
    }
  );
});
