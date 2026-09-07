import type { LinkIndexActivity } from "../lib/vault/modules/link-index";

export function LinkIndexStatus({ activity, sidebarOpen }: {
  activity: LinkIndexActivity;
  sidebarOpen: boolean;
}) {
  // Keep the live region mounted so transitions are announced by assistive technology.
  return (
    <div
      className={`link-index-status${sidebarOpen ? "" : " link-index-status--floating"}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {activity && <>
        <span className="link-index-status-spinner" aria-hidden="true" />
        <span>{activity === "repairing" ? "Repairing links…" : "Updating link index…"}</span>
      </>}
    </div>
  );
}
