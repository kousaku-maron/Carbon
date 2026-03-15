type AboutCarbonDialogProps = {
  version: string | null;
  onClose: () => void;
};

export function AboutCarbonDialog(props: AboutCarbonDialogProps) {
  const { version, onClose } = props;

  return (
    <div
      className="share-confirm-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="About Carbon"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="about-carbon-dialog" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="about-carbon-dialog-close"
          onClick={onClose}
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        <h3>About Carbon</h3>
        <img src="/icon.png" alt="Carbon" className="about-carbon-dialog-icon" />
        <div className="about-carbon-dialog-meta">
          <div className="about-carbon-dialog-label">Version</div>
          <div className="about-carbon-dialog-value">{version ? `v${version}` : "Unknown"}</div>
        </div>
      </div>
    </div>
  );
}
