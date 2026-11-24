/**
 * Аналитика раздела «Услуги и красота».
 */
import { db } from '../index.js';
import { PERIODS, periodSince } from './makerStats.js';

export const SERVICE_EVENT = {
  VIEW_PROVIDER: 'view_provider',
  VIEW_OFFER: 'view_offer',
  CONTACT: 'contact',
  BOOKING_LINK: 'booking_link',
};

export { PERIODS, periodSince };

const insertStmt = db.prepare(
  'INSERT INTO service_events (provider_id, offer_id, user_id, type) VALUES (?, ?, ?, ?)'
);

export function logServiceEvent({ providerId, offerId = null, userId, type }) {
  try {
    insertStmt.run(providerId, offerId, userId, type);
  } catch (err) {
    console.error('[ServiceStats] Не удалось записать событие:', err.message);
  }
}

const countsStmt = db.prepare(`
  SELECT type, COUNT(*) AS total, COUNT(DISTINCT user_id) AS people
  FROM service_events WHERE provider_id = ? AND created_at >= ?
  GROUP BY type
`);

export function getProviderCounts(providerId, since) {
  const out = {};
  for (const t of Object.values(SERVICE_EVENT)) out[t] = { total: 0, people: 0 };
  for (const row of countsStmt.all(providerId, since)) out[row.type] = { total: row.total, people: row.people };
  return out;
}

export function getProviderTopOffers(providerId, since, limit = 5) {
  return db.prepare(`
    SELECT e.offer_id, o.title, COUNT(DISTINCT e.user_id) AS people, COUNT(*) AS total
    FROM service_events e JOIN service_offers o ON o.id = e.offer_id
    WHERE e.provider_id = ? AND e.type = 'view_offer' AND e.created_at >= ?
    GROUP BY e.offer_id ORDER BY people DESC, total DESC LIMIT ?
  `).all(providerId, since, limit);
}

export function getNewServiceSubscribers(providerId, since) {
  return db.prepare('SELECT COUNT(*) AS c FROM service_subscriptions WHERE provider_id = ? AND created_at >= ?')
    .get(providerId, since).c;
}

export function getServicesTotalCounts(since) {
  const out = {};
  for (const t of Object.values(SERVICE_EVENT)) out[t] = { total: 0, people: 0 };
  const rows = db.prepare(`
    SELECT type, COUNT(*) AS total, COUNT(DISTINCT user_id) AS people
    FROM service_events WHERE created_at >= ? GROUP BY type
  `).all(since);
  for (const row of rows) out[row.type] = { total: row.total, people: row.people };
  return out;
}
