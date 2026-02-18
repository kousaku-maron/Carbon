import { useState, useEffect } from 'preact/hooks';

type Repo = {
  id: number;
  full_name: string;
  name: string;
  owner: string;
  private: boolean;
  default_branch: string;
};

type SyncEvent = {
  id: string;
  direction: string;
  event_type: string;
  file_path: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

type Connection = {
  id: string;
  repo_owner: string;
  repo_name: string;
  branch: string;
  base_path: string;
  status: string;
  last_synced_at: string | null;
  created_at: string;
  recent_events: SyncEvent[];
};

type FullSyncResult = {
  pulled: { created: number; updated: number; deleted: number };
  pushed: { created: number; updated: number; deleted: number };
  conflicts: { resolved: number; skipped: number };
  errors: number;
  details: Array<{ path: string | null; noteId: string | null; action: string; direction: string; error?: string }>;
};

type Strategy = 'local_wins' | 'remote_wins';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> {
  const res = await fetch(url, { credentials: 'include', ...init });
  return res.json();
}

export function SyncSettings() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [reposLoading, setReposLoading] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [syncResult, setSyncResult] = useState<FullSyncResult | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('local_wins');

  const loadStatus = async () => {
    const res = await apiFetch<Connection[]>('/api/sync/github/status');
    if (res.success && res.data) {
      setConnections(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const loadRepos = async () => {
    setReposLoading(true);
    const res = await apiFetch<Repo[]>('/api/sync/github/repos');
    if (res.success && res.data) {
      setRepos(res.data);
    } else {
      setMessage({ type: 'error', text: res.error ?? 'Failed to load repositories' });
    }
    setReposLoading(false);
  };

  const handleConnect = async (repo: Repo) => {
    const res = await apiFetch<Connection>('/api/sync/github/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_owner: repo.owner,
        repo_name: repo.name,
        branch: repo.default_branch,
      }),
    });

    if (res.success) {
      setMessage({ type: 'success', text: `Connected to ${repo.full_name}` });
      setShowConnect(false);
      setRepos([]);
      await loadStatus();
    } else {
      setMessage({ type: 'error', text: res.error ?? 'Failed to connect' });
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    const res = await apiFetch('/api/sync/github/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: connectionId }),
    });

    if (res.success) {
      setMessage({ type: 'success', text: 'Disconnected' });
      setSyncResult(null);
      await loadStatus();
    } else {
      setMessage({ type: 'error', text: res.error ?? 'Failed to disconnect' });
    }
  };

  const handleSync = async (connectionId: string) => {
    setSyncing(connectionId);
    setSyncResult(null);
    setMessage(null);

    const res = await apiFetch<FullSyncResult>('/api/sync/github/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: connectionId, strategy }),
    });

    if (res.success && res.data) {
      setSyncResult(res.data);
      const r = res.data;
      const pullTotal = r.pulled.created + r.pulled.updated + r.pulled.deleted;
      const pushTotal = r.pushed.created + r.pushed.updated + r.pushed.deleted;
      const conflictTotal = r.conflicts.resolved + r.conflicts.skipped;
      const parts: string[] = [];
      if (pullTotal > 0) parts.push(`Pulled ${pullTotal}`);
      if (pushTotal > 0) parts.push(`Pushed ${pushTotal}`);
      if (conflictTotal > 0) parts.push(`${r.conflicts.resolved} conflicts resolved`);
      if (r.errors > 0) parts.push(`${r.errors} errors`);
      setMessage({
        type: r.errors > 0 ? 'error' : 'success',
        text: parts.length > 0 ? `Sync complete: ${parts.join(', ')}` : 'Sync complete: everything up to date',
      });
      await loadStatus();
    } else {
      setMessage({ type: 'error', text: res.error ?? 'Sync failed' });
    }

    setSyncing(null);
  };

  const toggleConnect = () => {
    setShowConnect(!showConnect);
    if (!showConnect && repos.length === 0) {
      loadRepos();
    }
  };

  if (loading) {
    return <p class="muted text-sm">Loading sync settings...</p>;
  }

  return (
    <div class="sync-settings">
      {message && (
        <div class={`sync-message sync-message--${message.type}`}>
          {message.text}
          <button type="button" class="sync-message-close" onClick={() => setMessage(null)}>
            &times;
          </button>
        </div>
      )}

      {connections.length > 0 && (
        <div class="sync-connections">
          {connections.map((conn) => (
            <div key={conn.id} class="sync-connection-card">
              <div class="sync-connection-header">
                <div>
                  <span class="sync-repo-name">
                    {conn.repo_owner}/{conn.repo_name}
                  </span>
                  <span class="sync-branch">{conn.branch}</span>
                  {conn.base_path && <span class="sync-path">/{conn.base_path}</span>}
                </div>
                <span class={`sync-status sync-status--${conn.status}`}>{conn.status}</span>
              </div>

              {conn.last_synced_at && (
                <p class="muted text-sm">Last synced: {new Date(conn.last_synced_at).toLocaleString()}</p>
              )}

              <div class="sync-actions">
                <button
                  type="button"
                  class="btn-primary"
                  onClick={() => handleSync(conn.id)}
                  disabled={syncing === conn.id}
                >
                  {syncing === conn.id ? 'Syncing...' : 'Sync'}
                </button>
                <select
                  class="sync-strategy-select"
                  value={strategy}
                  onChange={(e) => setStrategy((e.target as HTMLSelectElement).value as Strategy)}
                >
                  <option value="local_wins">DB wins</option>
                  <option value="remote_wins">GitHub wins</option>
                </select>
                <button type="button" class="btn-danger" onClick={() => handleDisconnect(conn.id)}>
                  Disconnect
                </button>
              </div>

              {syncResult && syncing === null && (
                <div class="sync-result-summary">
                  <div class="sync-result-row">
                    <span class="sync-result-label">Pull</span>
                    <span class="text-sm">
                      {syncResult.pulled.created} created, {syncResult.pulled.updated} updated, {syncResult.pulled.deleted} unlinked
                    </span>
                  </div>
                  <div class="sync-result-row">
                    <span class="sync-result-label">Push</span>
                    <span class="text-sm">
                      {syncResult.pushed.created} created, {syncResult.pushed.updated} updated, {syncResult.pushed.deleted} deleted
                    </span>
                  </div>
                  {(syncResult.conflicts.resolved > 0 || syncResult.conflicts.skipped > 0) && (
                    <div class="sync-result-row">
                      <span class="sync-result-label">Conflicts</span>
                      <span class="text-sm">
                        {syncResult.conflicts.resolved} resolved, {syncResult.conflicts.skipped} skipped
                      </span>
                    </div>
                  )}
                  {syncResult.details.length > 0 && (
                    <details class="sync-details">
                      <summary class="text-sm">Details ({syncResult.details.length} items)</summary>
                      <ul class="sync-detail-list">
                        {syncResult.details.map((d, i) => (
                          <li key={i} class={`sync-detail-item sync-detail--${d.action}`}>
                            <span class="sync-detail-direction">{d.direction}</span>
                            <span class="sync-detail-action">{d.action}</span>
                            {d.path && <span class="sync-detail-path">{d.path}</span>}
                            {d.error && <span class="sync-detail-error">{d.error}</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {conn.recent_events.length > 0 && (
                <details class="sync-details">
                  <summary class="text-sm">Recent events ({conn.recent_events.length})</summary>
                  <ul class="sync-detail-list">
                    {conn.recent_events.map((e) => (
                      <li key={e.id} class={`sync-detail-item sync-detail--${e.status}`}>
                        <span class="sync-detail-action">
                          {e.direction} / {e.event_type}
                        </span>
                        {e.file_path && <span class="sync-detail-path">{e.file_path}</span>}
                        <span class="muted text-sm">{new Date(e.created_at).toLocaleString()}</span>
                        {e.error_message && <span class="sync-detail-error">{e.error_message}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={toggleConnect}>
        {showConnect ? 'Cancel' : 'Connect Repository'}
      </button>

      {showConnect && (
        <div class="sync-repo-list">
          {reposLoading ? (
            <p class="muted text-sm">Loading repositories...</p>
          ) : repos.length === 0 ? (
            <p class="muted text-sm">No repositories found. Make sure your GitHub account has repo access.</p>
          ) : (
            repos.map((repo) => {
              const alreadyConnected = connections.some(
                (c) => c.repo_owner === repo.owner && c.repo_name === repo.name
              );
              return (
                <div key={repo.id} class="sync-repo-item">
                  <div>
                    <span class="sync-repo-name">{repo.full_name}</span>
                    {repo.private && <span class="sync-badge">private</span>}
                  </div>
                  <button
                    type="button"
                    class="btn-primary btn-sm"
                    onClick={() => handleConnect(repo)}
                    disabled={alreadyConnected}
                  >
                    {alreadyConnected ? 'Connected' : 'Connect'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
