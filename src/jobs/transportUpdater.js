import { config } from '../../config.js';
import { getTransportSchedule, saveTransportSchedule } from '../services/transportService.js';

let nightlyTimeoutId = null;
let nightlyIntervalId = null;

/**
 * Нормализация времени в формат 'HH:MM' (например '6:33' -> '06:33')
 */
function normalizeTime(timeStr) {
  const parts = timeStr.trim().split(':');
  if (parts.length !== 2) return timeStr.trim();
  const h = parts[0].padStart(2, '0');
  const m = parts[1].padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Извлечение списка времен отправлений из HTML фрагмента таблицы
 */
function extractTimesFromHtml(htmlChunk) {
  if (!htmlChunk) return [];
  const times = [];
  const regex = /<td>\s*(\d{1,2}:\d{2})\s*<\/td>/g;
  let match;
  while ((match = regex.exec(htmlChunk)) !== null) {
    times.push(normalizeTime(match[1]));
  }
  return Array.from(new Set(times)).sort();
}

/**
 * Загрузка и парсинг таблицы расписания с сайта kolodischi.by
 */
async function fetchTableTimes(url, tableId) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const html = await res.text();
    const tableRegex = new RegExp(`<table id="${tableId}"[^>]*>([\\s\\S]*?)<\\/table>`, 'i');
    const tableMatch = html.match(tableRegex);

    if (!tableMatch) {
      console.warn(`[Transport Scraper] Таблица ${tableId} не найдена на ${url}`);
      return null;
    }

    const tableHtml = tableMatch[1];
    const parts = tableHtml.split(/По выходным/i);
    const weekdayPart = parts[0] || '';
    const weekendPart = parts[1] || '';

    return {
      weekdays: extractTimesFromHtml(weekdayPart),
      weekends: extractTimesFromHtml(weekendPart),
    };
  } catch (err) {
    console.error(`[Transport Scraper Error] Не удалось загрузить ${url} (${tableId}):`, err.message);
    return null;
  }
}

/**
 * Сравнение двух массивов времен на равенство
 */
function areTimeArraysEqual(arr1 = [], arr2 = []) {
  if (arr1.length !== arr2.length) return false;
  const sorted1 = [...arr1].sort();
  const sorted2 = [...arr2].sort();
  return sorted1.every((val, idx) => val === sorted2[idx]);
}

/**
 * Основная процедура проверки и актуализации расписания
 */
export async function checkAndUpdateTransportSchedules(bot = null) {
  console.log('[Transport Updater] Запуск ночной проверки расписания автобусов...');
  const currentSchedule = getTransportSchedule();
  const changes = [];

  try {
    // 1. Проверяем отправления ИЗ Зелёной Гавани в Минск
    const urlFromGavan = 'https://kolodischi.by/raspisanie-avtobusov/bulvar-zelenaya-gavan';
    const [scraped200cFrom, scraped200dFrom] = await Promise.all([
      fetchTableTimes(urlFromGavan, 'bus_200с'),
      fetchTableTimes(urlFromGavan, 'bus_200д'),
    ]);

    // Обновление 200С (из Гавани)
    if (scraped200cFrom && scraped200cFrom.weekdays.length > 0) {
      const cur = currentSchedule.routes['200c'].directions.to_minsk;
      if (!areTimeArraysEqual(cur.weekdays, scraped200cFrom.weekdays)) {
        changes.push(`🚌 *200С (в Минск, будни)*: было [${cur.weekdays.join(', ')}], стало [${scraped200cFrom.weekdays.join(', ')}]`);
        cur.weekdays = scraped200cFrom.weekdays;
      }
      if (!areTimeArraysEqual(cur.weekends, scraped200cFrom.weekends)) {
        changes.push(`🚌 *200С (в Минск, выходные)*: было [${cur.weekends.join(', ')}], стало [${scraped200cFrom.weekends.join(', ')}]`);
        cur.weekends = scraped200cFrom.weekends;
      }
    }

    // Обновление 200дС (из Гавани)
    if (scraped200dFrom && scraped200dFrom.weekdays.length > 0) {
      const cur = currentSchedule.routes['200dc'].directions.to_minsk;
      if (!areTimeArraysEqual(cur.weekdays, scraped200dFrom.weekdays)) {
        changes.push(`🚌 *200дС (в Минск, будни)*: было [${cur.weekdays.join(', ')}], стало [${scraped200dFrom.weekdays.join(', ')}]`);
        cur.weekdays = scraped200dFrom.weekdays;
      }
      if (!areTimeArraysEqual(cur.weekends, scraped200dFrom.weekends)) {
        cur.weekends = scraped200dFrom.weekends;
      }
    }

    // 2. Проверяем отправления В Зелёную Гавань из Минска (ст. м. Уручье)
    const urlToGavan = 'https://kolodischi.by/raspisanie-avtobusov/metro-uruche';
    const [scraped200cTo, scraped200dTo] = await Promise.all([
      fetchTableTimes(urlToGavan, 'bus_200с'),
      fetchTableTimes(urlToGavan, 'bus_200д'),
    ]);

    // Обновление 200С (в Гавань)
    if (scraped200cTo && scraped200cTo.weekdays.length > 0) {
      const cur = currentSchedule.routes['200c'].directions.to_gavan;
      if (!areTimeArraysEqual(cur.weekdays, scraped200cTo.weekdays)) {
        changes.push(`🚌 *200С (в Гавань, будни)*: было [${cur.weekdays.join(', ')}], стало [${scraped200cTo.weekdays.join(', ')}]`);
        cur.weekdays = scraped200cTo.weekdays;
      }
      if (!areTimeArraysEqual(cur.weekends, scraped200cTo.weekends)) {
        changes.push(`🚌 *200С (в Гавань, выходные)*: было [${cur.weekends.join(', ')}], стало [${scraped200cTo.weekends.join(', ')}]`);
        cur.weekends = scraped200cTo.weekends;
      }
    }

    // Обновление 200дС (в Гавань)
    if (scraped200dTo && scraped200dTo.weekdays.length > 0) {
      const cur = currentSchedule.routes['200dc'].directions.to_gavan;
      if (!areTimeArraysEqual(cur.weekdays, scraped200dTo.weekdays)) {
        changes.push(`🚌 *200дС (в Гавань, будни)*: было [${cur.weekdays.join(', ')}], стало [${scraped200dTo.weekdays.join(', ')}]`);
        cur.weekdays = scraped200dTo.weekdays;
      }
      if (!areTimeArraysEqual(cur.weekends, scraped200dTo.weekends)) {
        cur.weekends = scraped200dTo.weekends;
      }
    }

    // Если есть изменения — сохраняем и уведомляем администраторов
    if (changes.length > 0) {
      saveTransportSchedule(currentSchedule);
      console.log(`[Transport Updater] 🔄 Обнаружены и сохранены изменения (${changes.length}):\n${changes.join('\n')}`);

      if (bot && config.adminIds?.length > 0) {
        const text = (
          `📢 *Автоматическое обновление расписания транспорта!*\n\n` +
          `Ночной крон обнаружил изменения в графике движения автобусов:\n\n` +
          changes.join('\n\n') +
          `\n\n_Расписание в боте обновлено автоматически._`
        );

        for (const adminId of config.adminIds) {
          try {
            await bot.api.sendMessage(adminId, text, { parse_mode: 'Markdown' });
          } catch (e) {
            console.warn(`[Transport Updater] Не удалось отправить отчет админу ${adminId}:`, e.message);
          }
        }
      }
      return { updated: true, changes };
    }

    console.log('[Transport Updater] ✅ Проверка завершена: изменений в расписании нет.');
    return { updated: false, changes: [] };
  } catch (err) {
    console.error('[Transport Updater] Ошибка при ночной проверке расписания:', err);
    return { updated: false, error: err.message };
  }
}

/**
 * Расчет миллисекунд до следующего наступления 04:00 по времени Минска (UTC+3)
 */
function msUntilNext4AM() {
  const now = new Date();
  const minskNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Minsk' }));

  const next4AM = new Date(minskNow);
  next4AM.setHours(4, 0, 0, 0);

  // Если сегодня 04:00 уже прошло — берем завтра
  if (minskNow.getTime() >= next4AM.getTime()) {
    next4AM.setDate(next4AM.getDate() + 1);
  }

  const diffMs = next4AM.getTime() - minskNow.getTime();
  return diffMs;
}

/**
 * Запуск ночного планировщика обновления расписания (каждую ночь в 04:00 по Минску)
 */
export function startTransportUpdaterJob(bot) {
  if (nightlyTimeoutId || nightlyIntervalId) return;

  const msToRun = msUntilNext4AM();
  const hoursUntil = (msToRun / (1000 * 60 * 60)).toFixed(1);

  console.log(`[Transport Cron] Ночной крон актуализации расписания запущен. Первый запуск через ~${hoursUntil} ч (в 04:00 по Минску).`);

  nightlyTimeoutId = setTimeout(async () => {
    await checkAndUpdateTransportSchedules(bot);

    // После первого срабатывания запускаем регулярный цикл раз в 24 часа
    nightlyIntervalId = setInterval(async () => {
      await checkAndUpdateTransportSchedules(bot);
    }, 24 * 60 * 60 * 1000);
  }, msToRun);
}

/**
 * Остановка планировщика
 */
export function stopTransportUpdaterJob() {
  if (nightlyTimeoutId) {
    clearTimeout(nightlyTimeoutId);
    nightlyTimeoutId = null;
  }
  if (nightlyIntervalId) {
    clearInterval(nightlyIntervalId);
    nightlyIntervalId = null;
  }
  console.log('[Transport Cron] Ночной крон актуализации расписания остановлен.');
}
