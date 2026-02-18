type Props = {
  id: string;
  title: string;
  summary: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export function PostCard({ id, title, summary, createdAt, updatedAt }: Props) {
  const fmt = (d: string | Date) =>
    new Date(d).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  const created = fmt(createdAt);
  const updated = fmt(updatedAt);
  const showUpdated = updated !== created;

  return (
    <a href={`/notes/${id}`} className="post-card">
      <h2 className="post-card-title">{title}</h2>
      <p className="post-card-excerpt">{summary}</p>
      <div className="post-card-footer">
        <time className="post-card-date">{created}</time>
        {showUpdated && <time className="post-card-date post-card-date-updated">Updated {updated}</time>}
      </div>
    </a>
  );
}
