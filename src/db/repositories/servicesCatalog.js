/**
 * Репозиторий раздела «Услуги и красота»:
 * специалисты, услуги (портфолио/прайс), горящие отмены и подписки.
 */
import { db } from '../index.js';

const toJson = (value) => (value && value.length ? JSON.stringify(value) : null);

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapProvider(row) {
  if (!row) return null;
  return {
    ...row,
    about_entities: parseJson(row.about_entities, []),
    hot_count: row.hot_count ?? 0,
    offers_count: row.offers_count ?? 0,
  };
}

function mapOffer(row) {
  if (!row) return null;
  return {
    ...row,
    body_entities: parseJson(row.body_entities, []),
    photos: parseJson(row.photos, []),
    published: row.published === undefined ? true : Boolean(row.published),
  };
}

// ── Специалисты ───────────────────────────────────────────

export function getProvider(id) {
  return mapProvider(db.prepare('SELECT * FROM service_providers WHERE id = ?').get(id));
}

export function getProviderByUser(userId) {
  return mapProvider(db.prepare('SELECT * FROM service_providers WHERE user_id = ?').get(userId));
}

export function getAllProviders() {
  return db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM service_offers o WHERE o.provider_id = p.id) AS offers_count,
      (SELECT COUNT(*) FROM service_hot_slots h WHERE h.provider_id = p.id AND h.status = 'active' AND h.slot_at > datetime('now')) AS hot_count
    FROM service_providers p
    ORDER BY p.id
  `).all().map(mapProvider);
}

// Активные специалисты; при передаче category — те, у кого есть опубликованные услуги в этой категории
export function getActiveProviders(category = null) {
  const categoryClause = category
    ? `AND EXISTS (SELECT 1 FROM service_offers o WHERE o.provider_id = p.id AND o.published = 1 AND o.category = ?)`
    : '';
  const params = category ? [category] : [];
  return db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM service_offers o WHERE o.provider_id = p.id AND o.published = 1) AS offers_count,
      (SELECT COUNT(*) FROM service_hot_slots h WHERE h.provider_id = p.id AND h.status = 'active' AND h.slot_at > datetime('now')) AS hot_count
    FROM service_providers p
    WHERE p.status = 'active' ${categoryClause}
    ORDER BY hot_count DESC, offers_count DESC, p.id
  `).all(...params).map(mapProvider);
}

// Сколько активных специалистов представлено в каждой категории
export function getCategoryProviderCounts() {
  const rows = db.prepare(`
    SELECT o.category, COUNT(DISTINCT p.id) AS cnt
    FROM service_offers o
    JOIN service_providers p ON p.id = o.provider_id
    WHERE p.status = 'active' AND o.published = 1
    GROUP BY o.category
  `).all();
  return Object.fromEntries(rows.map(r => [r.category, r.cnt]));
}

export function createProvider({ userId, name, location = '', about = '', aboutEntities = [], contact = null }) {
  const info = db.prepare(`
    INSERT INTO service_providers (user_id, name, location, about, about_entities, contact)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, name, location, about, toJson(aboutEntities), contact);
  return getProvider(info.lastInsertRowid);
}

export function updateProviderProfile(id, { name, location, about, aboutEntities, contact, bookingUrl }) {
  const current = getProvider(id);
  if (!current) return null;
  db.prepare(`
    UPDATE service_providers
    SET name = ?, location = ?, about = ?, about_entities = ?, contact = ?, booking_url = ?
    WHERE id = ?
  `).run(
    name ?? current.name,
    location !== undefined ? location : current.location,
    about ?? current.about,
    aboutEntities !== undefined ? toJson(aboutEntities) : toJson(current.about_entities),
    contact !== undefined ? contact : current.contact,
    bookingUrl !== undefined ? bookingUrl : current.booking_url,
    id
  );
  return getProvider(id);
}

export function setProviderStatus(id, status) {
  db.prepare('UPDATE service_providers SET status = ? WHERE id = ?').run(status, id);
}

export function resubmitProvider(id, { name, location, about, aboutEntities, contact }) {
  updateProviderProfile(id, { name, location, about, aboutEntities, contact });
  setProviderStatus(id, 'pending');
  return getProvider(id);
}

export const deleteProvider = db.transaction((id) => {
  db.prepare('DELETE FROM service_hot_slots WHERE provider_id = ?').run(id);
  db.prepare('DELETE FROM service_offers WHERE provider_id = ?').run(id);
  db.prepare('DELETE FROM service_subscriptions WHERE provider_id = ?').run(id);
  db.prepare('DELETE FROM service_providers WHERE id = ?').run(id);
});

export function setProviderOwner(id, userId) {
  db.prepare('UPDATE service_providers SET user_id = ? WHERE id = ?').run(userId, id);
}

export function touchProviderHotNotified(id) {
  db.prepare(`UPDATE service_providers SET last_hot_notified_at = datetime('now') WHERE id = ?`).run(id);
}

// ── Услуги (портфолио / прайс) ───────────────────────────

export function getServiceOffer(id) {
  return mapOffer(db.prepare('SELECT * FROM service_offers WHERE id = ?').get(id));
}

export function getProviderOffers(providerId) {
  return db.prepare('SELECT * FROM service_offers WHERE provider_id = ? ORDER BY sort_order, id').all(providerId).map(mapOffer);
}

export function createServiceOffer(providerId, { title, priceText, durationText = null, body, bodyEntities, photos, category = 'other' }) {
  const info = db.prepare(`
    INSERT INTO service_offers (provider_id, title, price_text, duration_text, category, body, body_entities, photos, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM service_offers WHERE provider_id = ?))
  `).run(providerId, title, priceText, durationText, category, body, toJson(bodyEntities), JSON.stringify(photos || []), providerId);
  return getServiceOffer(info.lastInsertRowid);
}

export function replaceServiceOfferPost(id, { title, priceText, body, bodyEntities, photos }) {
  db.prepare(`
    UPDATE service_offers
    SET title = ?, price_text = ?, body = ?, body_entities = ?, photos = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, priceText, body, toJson(bodyEntities), JSON.stringify(photos || []), id);
  return getServiceOffer(id);
}

const OFFER_FIELDS = new Set(['title', 'price_text', 'duration_text', 'category']);

export function updateServiceOfferField(id, field, value) {
  if (!OFFER_FIELDS.has(field)) throw new Error(`Нельзя менять поле ${field}`);
  db.prepare(`UPDATE service_offers SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`).run(value, id);
  return getServiceOffer(id);
}

export function toggleServiceOfferPublished(id) {
  db.prepare(`UPDATE service_offers SET published = 1 - published, updated_at = datetime('now') WHERE id = ?`).run(id);
  return getServiceOffer(id);
}

export function deleteServiceOffer(id) {
  db.prepare('DELETE FROM service_offers WHERE id = ?').run(id);
}

// Передвинуть услугу вверх/вниз в списке специалиста
export function moveServiceOffer(providerId, offerId, direction) {
  const items = getProviderOffers(providerId);
  const idx = items.findIndex(i => i.id === offerId);
  const targetIdx = direction === 'u' ? idx - 1 : idx + 1;
  if (idx === -1 || targetIdx < 0 || targetIdx >= items.length) return false;

  const swap = db.transaction(() => {
    const a = items[idx];
    const b = items[targetIdx];
    const orderA = a.sort_order ?? a.id;
    const orderB = b.sort_order ?? b.id;
    db.prepare('UPDATE service_offers SET sort_order = ? WHERE id = ?').run(orderB, a.id);
    db.prepare('UPDATE service_offers SET sort_order = ? WHERE id = ?').run(orderA, b.id);
  });
  swap();
  return true;
}

// ── Горящие отмены (окна) ─────────────────────────────────

export function getHotSlot(id) {
  return db.prepare(`
    SELECT h.*, p.name AS provider_name, p.location AS provider_location,
      p.contact AS provider_contact, p.booking_url AS provider_booking_url, p.status AS provider_status
    FROM service_hot_slots h
    JOIN service_providers p ON p.id = h.provider_id
    WHERE h.id = ?
  `).get(id) || null;
}

export function getActiveHotSlots(limit = 30) {
  return db.prepare(`
    SELECT h.*, p.name AS provider_name, p.location AS provider_location,
      p.contact AS provider_contact, p.booking_url AS provider_booking_url
    FROM service_hot_slots h
    JOIN service_providers p ON p.id = h.provider_id
    WHERE p.status = 'active' AND h.status = 'active' AND h.slot_at > datetime('now')
    ORDER BY h.slot_at ASC, h.id DESC
    LIMIT ?
  `).all(limit);
}

export function getProviderHotSlots(providerId) {
  return db.prepare(`
    SELECT * FROM service_hot_slots
    WHERE provider_id = ? AND status = 'active' AND slot_at > datetime('now')
    ORDER BY slot_at ASC, id DESC
  `).all(providerId);
}

export function createHotSlot({ providerId, offerId = null, slotAt, title, note = '' }) {
  const info = db.prepare(`
    INSERT INTO service_hot_slots (provider_id, offer_id, slot_at, title, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(providerId, offerId, slotAt, title, note);
  return getHotSlot(info.lastInsertRowid);
}

export function closeHotSlot(id, providerId) {
  return db.prepare(`UPDATE service_hot_slots SET status = 'closed' WHERE id = ? AND provider_id = ?`).run(id, providerId).changes > 0;
}

export function markHotSlotNotified(id) {
  db.prepare(`UPDATE service_hot_slots SET notified_at = datetime('now') WHERE id = ?`).run(id);
}

// ── Подписки и обложка ────────────────────────────────────

export function isServiceSubscribed(userId, providerId) {
  return Boolean(db.prepare('SELECT 1 FROM service_subscriptions WHERE user_id = ? AND provider_id = ?').get(userId, providerId));
}

export function subscribeService(userId, providerId) {
  db.prepare('INSERT OR IGNORE INTO service_subscriptions (user_id, provider_id) VALUES (?, ?)').run(userId, providerId);
}

export function unsubscribeService(userId, providerId) {
  db.prepare('DELETE FROM service_subscriptions WHERE user_id = ? AND provider_id = ?').run(userId, providerId);
}

export function getServiceSubscriberIds(providerId) {
  return db.prepare('SELECT user_id FROM service_subscriptions WHERE provider_id = ?').all(providerId).map(r => r.user_id);
}

export function countServiceSubscribers(providerId) {
  return db.prepare('SELECT COUNT(*) AS c FROM service_subscriptions WHERE provider_id = ?').get(providerId).c;
}

export function getServicesSectionCover() {
  return db.prepare(`SELECT value FROM app_settings WHERE key = 'services_cover'`).get()?.value || null;
}

export function setServicesSectionCover(fileId) {
  if (fileId) {
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('services_cover', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(fileId);
  } else {
    db.prepare(`DELETE FROM app_settings WHERE key = 'services_cover'`).run();
  }
}
