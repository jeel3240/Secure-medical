export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
        </div>
      </div>
      <section className="panel">
        <div className="empty-state">
          <p className="empty-state__title">Not built yet</p>
          <p>{description}</p>
        </div>
      </section>
    </>
  );
}
