import { useRef, useState } from "react";
import { ContextMenu } from "./ContextMenu";

type ActivityBarProps = {
  active: "explorer" | "shares";
  onChange: (next: "explorer" | "shares") => void;
  onAbout: () => void;
  onSignOut: () => void;
};

export function ActivityBar(props: ActivityBarProps) {
  const { active, onChange, onAbout, onSignOut } = props;
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);

  function handleSettingsToggle() {
    setSettingsMenuOpen((current) => !current);
  }

  const settingsRect = settingsButtonRef.current?.getBoundingClientRect();
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  const menuWidth = 156;
  const menuHeight = 92;
  const settingsMenuX = settingsRect
    ? Math.min(settingsRect.right + 8, Math.max(12, viewportWidth - menuWidth - 12))
    : 0;
  const settingsMenuY = settingsRect
    ? Math.min(
        Math.max(12, settingsRect.bottom - menuHeight),
        Math.max(12, viewportHeight - menuHeight - 12),
      )
    : 0;

  return (
    <aside className="activity-bar">
      <div className="activity-bar-brand" aria-hidden="true">
        <img src="/icon.png" alt="" />
      </div>
      <div className="activity-bar-nav">
        <button
          type="button"
          className={`activity-bar-btn${active === "explorer" ? " is-active" : ""}`}
          onClick={() => onChange("explorer")}
          aria-label="Explorer"
          title="Explorer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10Z" />
          </svg>
        </button>
        <button
          type="button"
          className={`activity-bar-btn${active === "shares" ? " is-active" : ""}`}
          onClick={() => onChange("shares")}
          aria-label="Published notes"
          title="Published notes"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="8.25" />
            <path d="M3.9 12h16.2" />
            <path d="M12 3.75c2.4 2.2 3.75 5.13 3.75 8.25S14.4 18.05 12 20.25C9.6 18.05 8.25 15.12 8.25 12S9.6 5.95 12 3.75Z" />
          </svg>
        </button>
      </div>

      <div className="activity-bar-footer">
        <button
          ref={settingsButtonRef}
          type="button"
          className={`activity-bar-btn${settingsMenuOpen ? " is-active" : ""}`}
          onClick={handleSettingsToggle}
          aria-label="Settings"
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3.25" />
            <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.7 1.7 0 0 1 0 2.4 1.7 1.7 0 0 1-2.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9v.3A1.7 1.7 0 0 1 13.8 22h-3.6a1.7 1.7 0 0 1-1.7-1.7V20a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1.7 1.7 0 0 1-2.4 0 1.7 1.7 0 0 1 0-2.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H3.4A1.7 1.7 0 0 1 1.7 13.5v-3A1.7 1.7 0 0 1 3.4 8.8h.3a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1.7 1.7 0 0 1 0-2.4 1.7 1.7 0 0 1 2.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9v-.3A1.7 1.7 0 0 1 10.2 2h3.6a1.7 1.7 0 0 1 1.7 1.7V4a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.7 1.7 0 0 1 2.4 0 1.7 1.7 0 0 1 0 2.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.3A1.7 1.7 0 0 1 22.3 10.5v3a1.7 1.7 0 0 1-1.7 1.7h-.3a1 1 0 0 0-.9.6Z" />
          </svg>
        </button>
      </div>

      {settingsMenuOpen && settingsRect ? (
        <ContextMenu
          x={settingsMenuX}
          y={settingsMenuY}
          items={[
            { label: "About Carbon", onClick: onAbout },
            { label: "Sign out", onClick: onSignOut },
          ]}
          onClose={() => setSettingsMenuOpen(false)}
        />
      ) : null}
    </aside>
  );
}
