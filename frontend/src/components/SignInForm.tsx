import { useState } from 'preact/hooks';
import { authClient } from '../lib/auth-client';

interface SignInFormProps {
  showGithub?: boolean;
  returnTo?: string;
}

export function SignInForm({ showGithub = false, returnTo }: SignInFormProps) {
  const [status, setStatus] = useState('');
  const [loadingGithub, setLoadingGithub] = useState(false);

  const handleGithubSignIn = async () => {
    setLoadingGithub(true);
    setStatus('Redirecting to GitHub...');

    const callbackURL = returnTo && returnTo.startsWith('/') ? returnTo : '/';

    try {
      const { error } = await authClient.signIn.social({
        provider: 'github',
        callbackURL,
      });

      if (error) {
        throw new Error(error.message || 'GitHub sign in failed');
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'GitHub sign in failed');
      setLoadingGithub(false);
    }
  };

  return (
    <>
      {showGithub ? (
        <div className="stack-sm">
          <button type="button" className="auth-submit btn-secondary" disabled={loadingGithub} onClick={handleGithubSignIn}>
            {loadingGithub ? 'Redirecting...' : 'Continue with GitHub'}
          </button>
        </div>
      ) : (
        <p className="auth-status">GitHub OAuth is not configured.</p>
      )}
      {status && <p className="auth-status">{status}</p>}
    </>
  );
}
