// Renders CMS block arrays (blueprint 6.16 block types).
// Block = { type, content:{}, style:{} }
export default function CmsBlocks({ components = [] }) {
  return (
    <div className="space-y-3">
      {components.map((b, i) => <Block key={i} b={b} />)}
    </div>
  );
}

function Block({ b }) {
  const s = b.style || {};
  const c = b.content || {};
  switch (b.type) {
    case 'text':
      return (
        <p style={s} className="whitespace-pre-wrap leading-relaxed">
          {c.text}
        </p>
      );
    case 'image':
      return c.url ? (
        <img src={c.url} alt={c.alt || ''} style={s}
          className="w-full rounded-card object-cover" />
      ) : null;
    case 'button':
      return (
        <a href={c.link || '#'} style={s}
          className="btn-primary inline-block">{c.label || 'Button'}</a>
      );
    case 'banner':
      return (
        <div style={s}
          className="rounded-card bg-accent-blue p-4 text-center font-semibold">
          {c.text}
        </div>
      );
    case 'spacer':
      return <div style={{ height: c.height || 24 }} />;
    case 'divider':
      return <hr className="border-gray-200" />;
    default:
      return null;
  }
}
