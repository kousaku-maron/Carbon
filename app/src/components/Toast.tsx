type ToastProps = {
  message: string;
  onClose?: () => void;
  dismissible?: boolean;
  loading?: boolean;
};

export function Toast({
  message,
  onClose,
  dismissible = true,
  loading = false,
}: ToastProps) {
  const content = (
    <>
      {loading ? (
        <span className="toast-spinner" aria-hidden="true" />
      ) : null}
      <span>{message}</span>
    </>
  );

  if (!dismissible) {
    return (
      <div className="toast toast--persistent" role="status" aria-live="polite">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="toast"
      onClick={onClose}
      aria-label="Dismiss notification"
    >
      {content}
    </button>
  );
}
