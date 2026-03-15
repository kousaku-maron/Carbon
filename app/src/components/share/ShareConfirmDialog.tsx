type ShareConfirmDialogProps = {
  noteName: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ShareConfirmDialog(props: ShareConfirmDialogProps) {
  const { noteName, busy, onConfirm, onClose } = props;

  return (
    <div
      className="share-confirm-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm publish"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div className="share-confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="share-confirm-dialog-header">
          <h3>Publish this note?</h3>
          <p>
            <strong>{noteName}</strong> will be published as a public share page.
          </p>
        </div>
        <div className="share-confirm-dialog-body">
          <p>Anyone with the link will be able to view it.</p>
        </div>
        <div className="share-confirm-dialog-actions">
          <button
            type="button"
            className="share-confirm-dialog-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="share-confirm-dialog-primary"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Publishing..." : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
