import { config } from '../../config.js';
import { getTransportSchedule, saveTransportSchedule } from '../services/transportService.js';

let nightlyTimeoutId = null;
let nightlyIntervalId = null;

/**
 * Получение даты в формате YYYY-MM-DD для ближайшего буднего дня и ближайшей субботы
 */
function getTargetDates() {
  const now = new Date();
  // Минское время UTC+3
  const minskNow = new Date(now.getTime() + (3 * 60 + now.getTimezoneOffset()) * 60000);

  // Ищем ближайший будний день (1 = Пн, ..., 5 = Пт)
  const weekday = new Date(minskNow);
  while (weekday.getDay() === 0 || weekday.getDay() === 6) {
    weekday.setDate(weekday.getDate() + 1);
  }

  // Ищем ближайшую субботу (6 = Сб)
  const saturday = new Date(minskNow);
  while (saturday.getDay() !== 6) {
    saturday.setDate(saturday.getDate() + 1);
  }

  const format = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  return {
    weekdayDate: format(weekday),
    weekendDate: format(saturday),
  };
}

/**
 * Запрос актуального расписания с официального API kogda.by
 */
async function fetchKogdaTimetable(route, direction, busStop, date) {
  const params = new URLSearchParams({
    city: 'minsk',
    transport: 'autobus',
    route,
    direction,
    busStop,
    date,
  });

  const res = await fetch(`https://kogda.by/api/getTimetable?${params}`, {
    signal: AbortSignal.timeout(10000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  if (data && data.status === 200 && Array.isArray(data.timetable)) {
    return data.timetable;
  }
  return [];
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
  console.log('[Transport Updater] Запуск проверки расписания через kogda.by API...');
  const currentSchedule = getTransportSchedule();
  const changes = [];
  const { weekdayDate, weekendDate } = getTargetDates();

  try {
    // 1. Автобус 200С: В Минск от «Бульвар Зелёная Гавань»
    const [cToMinskWk, cToMinskWknd] = await Promise.all([
      fetchKogdaTimetable('200С', 'Бульвар Зелёная Гавань - ДС Уручье-2', 'Бульвар Зелёная Гавань', weekdayDate),
      fetchKogdaTimetable('200С', 'Бульвар Зелёная Гавань - ДС Уручье-2', 'Бульвар Зелёная Гавань', weekendDate),
    ]);

    const route200cToMinsk = currentSchedule.routes['200c']?.directions?.to_minsk;
    if (route200cToMinsk) {
      if (cToMinskWk.length > 0 && !areTimeArraysEqual(route200cToMinsk.weekdays, cToMinskWk)) {
        changes.push(`🚌 *200С (в Минск, будни)*: было [${route200cToMinsk.weekdays.join(', ')}], стало [${cToMinskWk.join(', ')}]`);
        route200cToMinsk.weekdays = cToMinskWk;
      }
      if (cToMinskWknd.length > 0 && !areTimeArraysEqual(route200cToMinsk.weekends, cToMinskWknd)) {
        changes.push(`🚌 *200С (в Минск, выходные)*: было [${route200cToMinsk.weekends.join(', ')}], стало [${cToMinskWknd.join(', ')}]`);
        route200cToMinsk.weekends = cToMinskWknd;
      }
    }

    // 2. Автобус 200С: В Зелёную Гавань от ДС «Уручье-2»
    const [cToGavanWk, cToGavanWknd] = await Promise.all([
      fetchKogdaTimetable('200С', 'ДС Уручье-2 - Бульвар Зелёная Гавань', 'ДС Уручье-2', weekdayDate),
      fetchKogdaTimetable('200С', 'ДС Уручье-2 - Бульвар Зелёная Гавань', 'ДС Уручье-2', weekendDate),
    ]);

    const route200cToGavan = currentSchedule.routes['200c']?.directions?.to_gavan;
    if (route200cToGavan) {
      if (cToGavanWk.length > 0 && !areTimeArraysEqual(route200cToGavan.baseWeekdays, cToGavanWk)) {
        changes.push(`🚌 *200С (в Гавань, будни)*: было [${route200cToGavan.baseWeekdays.join(', ')}], стало [${cToGavanWk.join(', ')}]`);
        route200cToGavan.baseWeekdays = cToGavanWk;
        route200cToGavan.weekdays = cToGavanWk.map(t => {
          const [h, m] = t.split(':').map(Number);
          const total = h * 60 + m + 7;
          return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
        });
      }
      if (cToGavanWknd.length > 0 && !areTimeArraysEqual(route200cToGavan.baseWeekends, cToGavanWknd)) {
        changes.push(`🚌 *200С (в Гавань, выходные)*: было [${route200cToGavan.baseWeekends.join(', ')}], стало [${cToGavanWknd.join(', ')}]`);
        route200cToGavan.baseWeekends = cToGavanWknd;
        route200cToGavan.weekends = cToGavanWknd.map(t => {
          const [h, m] = t.split(':').map(Number);
          const total = h * 60 + m + 7;
          return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
        });
      }
    }

    // 3. Автобус 200дС (200Д): В Минск и в Гавань (только будни)
    const [dToMinskWk, dToGavanWk] = await Promise.all([
      fetchKogdaTimetable('200Д', 'Бульвар Зелёная Гавань - ДС Уручье-2', 'Бульвар Зелёная Гавань', weekdayDate),
      fetchKogdaTimetable('200Д', 'ДС Уручье-2 - Бульвар Зелёная Гавань', 'ДС Уручье-2', weekdayDate),
    ]);

    const route200dToMinsk = currentSchedule.routes['200dc']?.directions?.to_minsk;
    if (route200dToMinsk && dToMinskWk.length > 0 && !areTimeArraysEqual(route200dToMinsk.weekdays, dToMinskWk)) {
      changes.push(`🚌 *200дС (в Минск, будни)*: было [${route200dToMinsk.weekdays.join(', ')}], стало [${dToMinskWk.join(', ')}]`);
      route200dToMinsk.weekdays = dToMinskWk;
    }

    const route200dToGavan = currentSchedule.routes['200dc']?.directions?.to_gavan;
    if (route200dToGavan && dToGavanWk.length > 0 && !areTimeArraysEqual(route200dToGavan.baseWeekdays, dToGavanWk)) {
      changes.push(`🚌 *200дС (в Гавань, будни)*: было [${route200dToGavan.baseWeekdays.join(', ')}], стало [${dToGavanWk.join(', ')}]`);
      route200dToGavan.baseWeekdays = dToGavanWk;
      route200dToGavan.weekdays = dToGavanWk.map(t => {
        const [h, m] = t.split(':').map(Number);
        const total = h * 60 + m + 7;
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      });
    }

    // Сохранение изменений
    if (changes.length > 0) {
      saveTransportSchedule(currentSchedule);
      console.log(`[Transport Updater] 🔄 Обнаружены и сохранены изменения (${changes.length}):\n${changes.join('\n')}`);

      if (bot && config.adminIds?.length > 0) {
        const text = (
          `📢 *Автоматическое обновление расписания транспорта!*\n\n` +
          `Ночной крон обнаружил изменения в графике движения автобусов на kogda.by:\n\n` +
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

    console.log('[Transport Updater] ✅ Проверка завершена: изменений в расписании нет, всё актуально.');
    return { updated: false, changes: [] };
  } catch (err) {
    console.error('[Transport Updater] Сбой при проверке расписания:', err.message);
    return { updated: false, error: err.message };
  }
}

/**
 * Запуск планировщика ночной проверки (раз в сутки в 04:00 по Минску)
 */
export function startTransportUpdaterJob(bot) {
  if (nightlyTimeoutId) clearTimeout(nightlyTimeoutId);
  if (nightlyIntervalId) clearInterval(nightlyIntervalId);

  const calculateMsUntil4AM = () => {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const targetUtcHours = 1; // 04:00 по Минску (UTC+3) = 01:00 UTC

    const nextRun = new Date(now);
    nextRun.setUTCHours(targetUtcHours, 0, 0, 0);

    if (utcHours >= targetUtcHours) {
      nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    }

    return nextRun.getTime() - now.getTime();
  };

  const msUntilNextRun = calculateMsUntil4AM();
  const hoursUntil = (msUntilNextRun / (1000 * 60 * 60)).toFixed(1);
  console.log(`🕒 [Transport Updater] Следующая проверка расписания запланирована в 04:00 (через ~${hoursUntil} ч)`);

  nightlyTimeoutId = setTimeout(() => {
    checkAndUpdateTransportSchedules(bot);

    // После первого срабатывания запускаем раз в 24 часа
    nightlyIntervalId = setInterval(() => {
      checkAndUpdateTransportSchedules(bot);
    }, 24 * 60 * 60 * 1000);
  }, msUntilNextRun);
}

/**
 * Остановка планировщика (при graceful shutdown)
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
}
