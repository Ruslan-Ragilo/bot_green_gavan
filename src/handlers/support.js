import { Composer, InlineKeyboard } from 'grammy';
import { renderScreen } from '../utils/cleanChat.js';
import { config } from '../../config.js';

export const supportComposer = new Composer();

// Клавиатура главного меню поддержки
function supportMenuKeyboard() {
  const creatorUrl = `https://t.me/${config.creatorUsername.replace('@', '')}`;

  return new InlineKeyboard()
    .text('💳 Пополнить через ЕРИП', 'support:card').row()
    .text('⭐️ Поддержать звёздами (Telegram Stars)', 'support:stars').row()
    .url(`💬 Написать автору (@${config.creatorUsername.replace('@', '')})`, creatorUrl).row()
    .text('◀️ В главное меню', 'menu:main');
}

// Клавиатура экрана ЕРИП
function supportCardKeyboard() {
  return new InlineKeyboard()
    .text('⭐️ Поддержать звёздами', 'support:stars').row()
    .text('◀️ Назад', 'support:menu');
}

// Клавиатура выбора звёзд
function supportStarsKeyboard() {
  return new InlineKeyboard()
    .text('⭐️ 5 (~0.30 BYN)', 'support:pay_stars:5')
    .text('⭐️ 15 (~1.00 BYN)', 'support:pay_stars:15').row()
    .text('⭐️ 30 (~2.00 BYN)', 'support:pay_stars:30')
    .text('⭐️ 50 (~3.30 BYN ☕️)', 'support:pay_stars:50').row()
    .text('⭐️ 100 (~6.50 BYN)', 'support:pay_stars:100').row()
    .text('💳 Пополнить через ЕРИП', 'support:card').row()
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

// 3. Экран перевода через ЕРИП
supportComposer.callbackQuery('support:card', async (ctx) => {
  await ctx.answerCallbackQuery();

  const text = (
    `💳 *Поддержка через ЕРИП (без комиссии)*\n\n` +
    `В приложении любого белорусского банка перейдите:\n\n` +
    `📍 *Система «Расчет» (ЕРИП)*\n` +
    `  └ 🏦 *Банковские, финансовые услуги*\n` +
    `      └ 🏛 *Банки, НКФО*\n` +
    `          └ 🟡 *БСБ Банк*\n` +
    `              └ 📥 *Пополнение счета*\n\n` +
    `📱 *Номер телефона:* \`375292254552\` _(нажмите для копирования)_\n` +
    `👤 *Получатель:* Р****о Р.В.\n\n` +
    `Подойдёт любая комфортная сумма на оплату сервера и развитие бота. Спасибо за поддержку! ❤️`
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
    `Выберите комфортное количество звёзд:`
  );

  await renderScreen(ctx, text, {
    parse_mode: 'Markdown',
    reply_markup: supportStarsKeyboard(),
  });
});

// 5. Выставление инвойса на оплату звёздами
supportComposer.callbackQuery(/^support:pay_stars:(\d+)$/, async (ctx) => {
  const starsCount = Number(ctx.match[1]) || 15;
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
      '⚠️ Не удалось сформировать счёт на оплату звёздами. Попробуйте ЕРИП или напишите автору.',
      {
        reply_markup: new InlineKeyboard()
          .text('💳 Пополнить через ЕРИП', 'support:card').row()
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
