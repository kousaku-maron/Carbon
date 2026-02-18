import { useState } from 'preact/hooks';

type Props = {
  markdown: string;
};

export function CopyMarkdownButton({ markdown }: Props) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setStatus('copied');
      setTimeout(() => setStatus('idle'), 1200);
    } catch {
      setStatus('failed');
      setTimeout(() => setStatus('idle'), 1400);
    }
  };

  const ariaLabel = status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy markdown';

  return (
    <button type="button" className="seamless-icon-btn" onClick={handleClick} aria-label={ariaLabel} title={ariaLabel}>
      {status === 'copied' ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M16.704 5.29a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L9 11.586l6.296-6.296a1 1 0 011.408 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M6.5 2A2.5 2.5 0 004 4.5v8A2.5 2.5 0 006.5 15h7A2.5 2.5 0 0016 12.5v-8A2.5 2.5 0 0013.5 2h-7z" />
          <path d="M3.5 6A1.5 1.5 0 002 7.5v9A1.5 1.5 0 003.5 18h8A1.5 1.5 0 0013 16.5V16h-6.5A3.5 3.5 0 013 12.5V6h.5z" />
        </svg>
      )}
    </button>
  );
}
