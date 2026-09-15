export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner__ring" aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="visually-hidden">Loading</span>}
    </span>
  );
}
