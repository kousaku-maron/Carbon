import type { OpenNoteTab } from "../lib/types";

type MissingNoteViewProps = {
  tab: OpenNoteTab;
};

export function MissingNoteView({ tab }: MissingNoteViewProps) {
  return (
    <div className="missing-note-view" role="status">
      <div className="missing-note-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 8V13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="17" r="1" fill="currentColor" />
          <path d="M10.3 3.7L2.4 17.4C1.6 18.8 2.6 20.5 4.2 20.5H19.8C21.4 20.5 22.4 18.8 21.6 17.4L13.7 3.7C12.9 2.3 11.1 2.3 10.3 3.7Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="missing-note-title">File moved or deleted</div>
      <div className="missing-note-description">
        Carbon will keep this tab open while watching for the file. Auto Save is paused.
      </div>
      <div className="missing-note-path" title={tab.path}>{tab.path}</div>
    </div>
  );
}
