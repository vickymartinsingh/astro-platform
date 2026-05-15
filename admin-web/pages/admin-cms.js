import { useEffect, useState } from 'react';
import { cmsService, adminService } from '@astro/shared';
import Layout from '../components/Layout';
import CmsBlocks from '../components/CmsBlocks';
import { useRequireAdmin } from '../lib/useAuth';

const BLOCK_DEFAULTS = {
  text: { content: { text: 'New text block' } },
  image: { content: { url: '', alt: '' } },
  button: { content: { label: 'Click', link: '/' } },
  banner: { content: { text: 'Banner message' } },
  spacer: { content: { height: 24 } },
  divider: { content: {} },
};

export default function AdminCms() {
  const { loading } = useRequireAdmin();
  const [pages, setPages] = useState([]);
  const [sel, setSel] = useState(null);     // page being edited
  const [blocks, setBlocks] = useState([]);
  const [newPage, setNewPage] = useState({ name: '', slug: '' });
  const [msg, setMsg] = useState('');

  async function loadPages() {
    setPages(await cmsService.getAllPages());
  }
  useEffect(() => { if (!loading) loadPages(); /* eslint-disable */ },
    [loading]);

  function edit(p) {
    setSel(p);
    setBlocks(p.draftVersion || p.publishedVersion || []);
    setMsg('');
  }

  async function createPage() {
    if (!newPage.slug) return;
    await adminService.savePage({
      name: newPage.name || newPage.slug,
      slug: newPage.slug.toLowerCase().replace(/\s+/g, '-'),
      draft: [],
    });
    setNewPage({ name: '', slug: '' });
    await loadPages();
  }

  function addBlock(type) {
    setBlocks([...blocks, { type, style: {}, ...BLOCK_DEFAULTS[type] }]);
  }
  function setField(i, key, val) {
    const next = blocks.slice();
    next[i] = { ...next[i],
      content: { ...next[i].content, [key]: val } };
    setBlocks(next);
  }
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  }
  function remove(i) { setBlocks(blocks.filter((_, x) => x !== i)); }

  // Native HTML5 drag-to-reorder, no extra dependency (Hard Rule 10).
  function onDrop(from, to) {
    if (from === to || from == null) return;
    const next = blocks.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setBlocks(next);
  }

  async function saveDraft() {
    await adminService.savePage({
      id: sel.id, name: sel.name, slug: sel.slug, draft: blocks });
    setMsg('Draft saved.');
    await loadPages();
  }
  async function publish() {
    await adminService.savePage({
      id: sel.id, name: sel.name, slug: sel.slug, draft: blocks });
    await adminService.publishPage(sel.id);
    setMsg('Published live.');
    await loadPages();
  }
  async function rollback(idx) {
    await adminService.rollbackPage(sel.id, idx);
    setMsg('Rolled back.');
    await loadPages();
    const fresh = (await cmsService.getAllPages())
      .find((p) => p.id === sel.id);
    if (fresh) edit(fresh);
  }

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">CMS / Page Builder</h1>

      <div className="card mb-4 flex flex-wrap gap-2">
        {pages.map((p) => (
          <button key={p.id} onClick={() => edit(p)}
            className={`rounded-card px-3 py-2 text-sm ${
              sel?.id === p.id ? 'bg-primary text-white' : 'bg-bg-light'}`}>
            {p.name}
          </button>
        ))}
        <input className="input w-32" placeholder="slug (terms)"
          value={newPage.slug}
          onChange={(e) => setNewPage({ ...newPage, slug: e.target.value })} />
        <button onClick={createPage} className="btn-ghost">+ New Page</button>
      </div>

      {msg && <div className="card mb-3 bg-success/10 text-success">{msg}</div>}

      {sel && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card space-y-2">
            <div className="flex flex-wrap gap-1">
              {Object.keys(BLOCK_DEFAULTS).map((t) => (
                <button key={t} onClick={() => addBlock(t)}
                  className="badge bg-bg-light text-primary">+ {t}</button>
              ))}
            </div>
            {blocks.map((b, i) => (
              <div key={i}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData('text/plain', String(i))}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(Number(e.dataTransfer.getData('text/plain')), i);
                }}
                className="cursor-move rounded-card border p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase">
                    ⠿ {b.type}
                  </span>
                  <span className="space-x-2 text-xs">
                    <button onClick={() => move(i, -1)}>↑</button>
                    <button onClick={() => move(i, 1)}>↓</button>
                    <button onClick={() => remove(i)}
                      className="text-danger">✕</button>
                  </span>
                </div>
                {b.type === 'text' && (
                  <textarea className="input" rows={3}
                    value={b.content.text || ''}
                    onChange={(e) => setField(i, 'text', e.target.value)} />
                )}
                {b.type === 'image' && (
                  <input className="input" placeholder="Image URL"
                    value={b.content.url || ''}
                    onChange={(e) => setField(i, 'url', e.target.value)} />
                )}
                {b.type === 'button' && (
                  <div className="grid grid-cols-2 gap-1">
                    <input className="input" placeholder="Label"
                      value={b.content.label || ''}
                      onChange={(e) => setField(i, 'label', e.target.value)} />
                    <input className="input" placeholder="Link"
                      value={b.content.link || ''}
                      onChange={(e) => setField(i, 'link', e.target.value)} />
                  </div>
                )}
                {b.type === 'banner' && (
                  <input className="input" placeholder="Banner text"
                    value={b.content.text || ''}
                    onChange={(e) => setField(i, 'text', e.target.value)} />
                )}
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <button onClick={saveDraft} className="btn-ghost flex-1">
                Save Draft
              </button>
              <button onClick={publish} className="btn-primary flex-1">
                Publish
              </button>
            </div>
            {(sel.history || []).length > 0 && (
              <div className="pt-2 text-sm">
                <div className="font-semibold">Version history</div>
                {(sel.history || []).map((h, idx) => (
                  <button key={idx} onClick={() => rollback(idx)}
                    className="block text-primary">
                    Restore version {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="mb-2 text-sm text-sub-text">
              Live preview · public URL: <code>/page/{sel.slug}</code>
            </div>
            <CmsBlocks components={blocks} />
          </div>
        </div>
      )}
    </Layout>
  );
}
