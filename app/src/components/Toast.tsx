type ToastProps = {
  message: string;
  onClose: () => void;
};

export function Toast({ message, onClose }: ToastProps) {
  return (
    <button
      type="button"
      className="toast"
      onClick={onClose}
      aria-label="Dismiss notification"
    >
      {message}
    </button>
  );
}
