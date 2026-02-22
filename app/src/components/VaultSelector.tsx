import { useEffect, useRef, useState } from "react";
import { getBaseName } from "../lib/pathUtils";

export function VaultSelector(props: {
  currentPath: string | null;
  history: string[];
  onSelect: (path: string) => void;
  onBrowse: () => void;
  onRemove: (path: string) => void;
}) {
  const { currentPath, history, onSelect, onBrowse, onRemove } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const displayName = currentPath ? getBaseName(currentPath) : "Select Vault";

  return (
    <div className="vault-selector" ref={ref}>
      <button
        className="vault-selector-btn"
        onClick={() => setOpen(!open)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span className="vault-selector-label">{displayName}</span>
        <svg
          className={`vault-selector-chevron ${open ? "open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="vault-dropdown">
          {history.length > 0 && (
            <ul className="vault-dropdown-list">
              {history.map((path) => (
                <li key={path} className="vault-dropdown-item">
                  <button
                    className={`vault-dropdown-option ${path === currentPath ? "active" : ""}`}
                    onClick={() => {
                      onSelect(path);
                      setOpen(false);
                    }}
                  >
                    <span className="vault-dropdown-name">
                      {getBaseName(path)}
                    </span>
                    <span className="vault-dropdown-path">{path}</span>
                  </button>
                  <button
                    className="vault-dropdown-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(path);
                    }}
                    aria-label="Remove"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            className="vault-dropdown-browse"
            onClick={() => {
              onBrowse();
              setOpen(false);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Open folder...</span>
          </button>
        </div>
      )}
    </div>
  );
}
