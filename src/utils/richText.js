/**
 * Текст с форматированием через entities Telegram вместо Markdown.
 * Посты мастеров приходят с entities (жирный, курсив из меню Telegram) — храним и показываем их как есть,
 * без экранирования и риска сломать разметку. Смещения считаются в UTF-16, как и String.length в JS.
 */

// Форматирование, которое бот может безопасно повторить (custom_emoji, упоминания и т. п. отбрасываем)
const KEEP_TYPES = new Set([
  'bold', 'italic', 'underline', 'strikethrough', 'spoiler',
  'code', 'pre', 'text_link', 'blockquote', 'expandable_blockquote',
]);

export function cleanEntities(entities = []) {
  return (entities || [])
    .filter(e => KEEP_TYPES.has(e.type) && e.length > 0)
    .map(({ type, offset, length, url, language }) => ({
      type, offset, length,
      ...(url ? { url } : {}),
      ...(language ? { language } : {}),
    }));
}

export class Rich {
  constructor() {
    this.text = '';
    this.entities = [];
  }

  add(str, type) {
    if (!str) return this;
    const offset = this.text.length;
    this.text += str;
    if (type) this.entities.push({ type, offset, length: str.length });
    return this;
  }

  plain(str) { return this.add(str); }
  bold(str) { return this.add(str, 'bold'); }
  italic(str) { return this.add(str, 'italic'); }

  // Вставить чужой текст вместе с его форматированием
  rich(text, entities = []) {
    if (!text) return this;
    const base = this.text.length;
    this.text += text;
    for (const e of entities || []) this.entities.push({ ...e, offset: e.offset + base });
    return this;
  }

  nl(count = 1) {
    this.text += '\n'.repeat(count);
    return this;
  }

  // Обрезать до лимита Telegram (подпись к фото — 1024, сообщение — 4096)
  build(limit = 4096) {
    return clipRich(this.text, this.entities, limit);
  }
}

export function clipRich(text, entities, limit) {
  if (text.length <= limit) return { text, entities };
  let cut = limit - 1;
  // Не разрезаем суррогатную пару (эмодзи)
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return {
    text: `${text.slice(0, cut)}…`,
    entities: entities
      .filter(e => e.offset < cut)
      .map(e => ({ ...e, length: Math.min(e.length, cut - e.offset) }))
      .filter(e => e.length > 0),
  };
}

export const rich = () => new Rich();
