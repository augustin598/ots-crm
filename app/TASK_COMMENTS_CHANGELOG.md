# Task Comments - Rich Text Editor Implementation

## Overview
Inlocuirea completa a sistemului de comentarii task bazat pe textarea/markdown cu un editor WYSIWYG TipTap, inclusiv @mention, reply threads, si notificari email.

**Commits:** `890837b..b1456cd` (7 commits)
**Data:** 24 Martie 2026

---

## Componente noi create

### RichEditor (`app/src/lib/components/RichEditor/`)
Editor WYSIWYG reutilizabil bazat pe TipTap.

| Fisier | Scop |
|--------|------|
| `RichEditor.svelte` | Componenta principala - monteaza TipTap Editor cu toate extensiile |
| `Toolbar.svelte` | Bara de instrumente cu 6 grupuri de butoane |
| `ToolbarButton.svelte` | Buton reutilizabil cu stare activa |
| `MentionList.svelte` | Dropdown autocomplete pentru @mention |
| `mention-suggestion.ts` | Bridge intre TipTap Suggestion API si Svelte mount/unmount |
| `editor.css` | Stiluri ProseMirror + mention chips + comment-display |

### Props RichEditor

```typescript
interface Props {
  content?: string | object;      // Continut initial (HTML sau JSON)
  placeholder?: string;           // Text placeholder
  editable?: boolean;             // Readonly mode
  onUpdate?: (data) => void;      // Callback la schimbare { html, json, text }
  onImageUpload?: (file) => Promise<string>; // Upload extern, returneaza URL
  onPasteImage?: (file) => void;  // Handler paste imagine
  users?: MentionUser[];          // Utilizatori pentru @mention
  maxCharacters?: number | null;  // Limita caractere
  minHeight?: string;             // Inaltime minima (default: 200px)
  showFooter?: boolean;           // Afiseaza word/char count
  class?: string;                 // CSS extern
}
```

### Metode publice RichEditor
- `getHTML()` - returneaza HTML content
- `getText()` - returneaza plain text
- `getJSON()` - returneaza TipTap JSON
- `clear()` - sterge continutul
- `isEmpty()` - verifica daca e gol
- `setContent(content)` - seteaza continut

### Extensii TipTap instalate
- `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`
- `@tiptap/extension-placeholder`, `@tiptap/extension-image`, `@tiptap/extension-link`
- `@tiptap/extension-table`, `table-row`, `table-cell`, `table-header`
- `@tiptap/extension-underline`, `text-align`, `highlight`, `color`, `text-style`
- `@tiptap/extension-character-count`
- `@tiptap/extension-task-list`, `task-item`
- `@tiptap/extension-mention`
- `@tiptap/extension-bubble-menu`

### Toolbar - Grupuri butoane
1. **Text style**: Bold, Italic, Underline, Strikethrough, Highlight
2. **Heading**: Dropdown (Paragraph, H1, H2, H3)
3. **Liste**: Bullet, Numbered, Task list (checkboxes)
4. **Aliniere**: Left, Center, Right, Justify
5. **Insert**: Link (inline input), Image (file picker), Table (insert/edit/delete)
6. **History**: Undo, Redo

---

## Functionalitati implementate

### 1. Rich Text Comments
- Editor WYSIWYG in loc de textarea simplu
- Formatare vizuala (bold, italic, liste, tabele, etc.)
- Content salvat ca HTML in DB (coloana `content`)
- Afisare comentarii cu `{@html comment.content}` + CSS `comment-display`

### 2. @Mention
- Typing `@` deschide dropdown cu utilizatori
- Filtrare dupa nume/email
- Keyboard navigation (ArrowUp/Down, Enter, Escape)
- Selectie insereaza mention chip: `<span data-type="mention" data-id="userId" class="mention">@Nume</span>`
- Utilizatori filtrati pe client (`getClientUsers`) cu fallback pe tenant users

### 3. Reply Threads
- Buton Reply pe fiecare comentariu
- Reply-uri afisate nested cu `border-l-2` indent
- Editor inline de reply cu RichEditor compact
- `parentCommentId` in DB (migratie `0078_task_comment_replies.sql`)
- Cascade delete: stergerea parent-ului sterge si reply-urile

### 4. Mention Email Notifications
- Extractie mention IDs din HTML (`extractMentionIds`)
- Email trimis la utilizatorii mentionati via `sendTaskUpdateEmail(taskId, email, name, 'mention')`
- Deduplicare: skip self-mentions + skip watchers (primesc deja email)

### 5. Image Attachments (pagina client)
- `getCommentAttachmentUrl` pentru presigned URLs din MinIO
- Afisare imagini atasate cu loading placeholder
- ImageLightbox la click pe imagine

---

## Securitate

### HTML Sanitization (XSS Prevention)
- `sanitize-html` instalat si configurat
- Functia `sanitizeCommentHtml()` in `task-comments.remote.ts`
- Sanitizare la **create** si **update** comment
- Allowed tags: `p, br, strong, em, u, s, mark, h1-h4, ul, ol, li, blockquote, pre, code, a, img, span, table, tr, th, td, hr, div, label, input`
- Allowed attributes: `href, target, rel, src, alt, class, data-type, data-id, data-label, style(text-align only)`
- Allowed schemes: `http, https, mailto`

### Empty Content Validation
- Backend strip-uieste HTML tags inainte de validare
- `data.content.replace(/<[^>]*>/g, '').trim()` previne `<p></p>` gol

---

## Schema DB

### Modificari
```sql
-- Migration 0078_task_comment_replies.sql
ALTER TABLE task_comment ADD COLUMN parent_comment_id TEXT REFERENCES task_comment(id);
```

### Coloane task_comment
| Coloana | Tip | Descriere |
|---------|-----|-----------|
| id | TEXT PK | ID unic |
| taskId | TEXT FK→task | Task-ul parinte |
| userId | TEXT FK→user | Autorul comentariului |
| parentCommentId | TEXT nullable | Reply la alt comment |
| content | TEXT | HTML content (sanitizat) |
| attachmentPath | TEXT nullable | Cale fisier MinIO |
| attachmentMimeType | TEXT nullable | MIME type |
| attachmentFileName | TEXT nullable | Nume fisier |
| attachmentFileSize | INTEGER nullable | Dimensiune bytes |
| createdAt | TIMESTAMP | Data creare |
| updatedAt | TIMESTAMP | Data modificare |

---

## Fisiere modificate

### Componente noi
- `app/src/lib/components/RichEditor/RichEditor.svelte`
- `app/src/lib/components/RichEditor/Toolbar.svelte`
- `app/src/lib/components/RichEditor/ToolbarButton.svelte`
- `app/src/lib/components/RichEditor/MentionList.svelte`
- `app/src/lib/components/RichEditor/mention-suggestion.ts`
- `app/src/lib/components/RichEditor/editor.css`

### Componente modificate
- `app/src/lib/components/task-detail-dialog.svelte` - RichEditor, reply, mention
- `app/src/routes/[tenant]/tasks/[taskId]/+page.svelte` - RichEditor, reply, mention
- `app/src/routes/client/[tenant]/(app)/tasks/[taskId]/+page.svelte` - RichEditor, reply, mention, attachments

### Backend
- `app/src/lib/remotes/task-comments.remote.ts` - sanitize, mention extraction, reply cascade, parentCommentId
- `app/src/lib/remotes/users.remote.ts` - `getClientUsers(clientId)` query
- `app/src/lib/server/db/schema.ts` - `parentCommentId` coloana
- `app/drizzle/0078_task_comment_replies.sql` - migratie

### Sterse (dead code)
- `app/src/lib/components/RichEditor/BubbleMenuBar.svelte` - nefolosit
- `renderCommentMarkdown()` din `markdown.ts` - inlocuit cu HTML direct

### Componente legacy (pastrate)
- `app/src/lib/components/markdown-editor.svelte` - folosit DOAR in `document-template-editor.svelte`
- `app/src/lib/components/mention-dropdown.svelte` - folosit DOAR in markdown-editor (legacy)

---

## Flow complet @Mention

```
1. User scrie @ in RichEditor
2. TipTap Mention extension → suggestion.items({ query })
3. mention-suggestion.ts filtreaza users[] → monteaza MentionList.svelte
4. User selecteaza → command({ id, label })
5. TipTap insereaza <span data-type="mention" data-id="userId" class="mention">@Nume</span>
6. Post Comment → createTaskComment({ content: HTML })
7. Backend: sanitizeCommentHtml(content) → curata HTML
8. Backend: extractMentionIds(content) → parseaza data-id din mention spans
9. Backend: pentru fiecare mentionat (skip self, skip watchers) → sendTaskUpdateEmail()
10. Backend: watchers primesc email separat (flow existent)
11. Client display: {@html comment.content} + CSS .mention styling
```

---

## Bugs rezolvate in audit

| # | Severitate | Problema | Fix |
|---|-----------|---------|-----|
| 1 | CRITICAL | Mention regex nu matcha atribute in ordine inversa | Regex dual-order |
| 2 | CRITICAL | `<p></p>` trecea ca non-empty | Strip HTML tags la validare |
| 3 | HIGH | XSS - {@html} fara sanitizare | sanitize-html la save |
| 4 | HIGH | Delete parent nu sterge replies | Cascade delete manual |
| 5 | MEDIUM | Imports nefolosite (Textarea, etc) | Sterse |
| 6 | MEDIUM | handlePaste dead code | Sters |
| 7 | MEDIUM | mention-suggestion leak DOM | Proper cleanup + null safety |
| 8 | MEDIUM | renderCommentMarkdown nefolosit | Sters |
| 9 | MEDIUM | BubbleMenuBar nefolosit | Sters |
