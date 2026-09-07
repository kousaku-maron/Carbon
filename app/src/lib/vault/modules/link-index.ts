import { LazyStore } from "@tauri-apps/plugin-store";
import { exists, readDir, readTextFile, rename, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { isPathInside, joinPath, shouldIncludeInVaultTree, toVaultRelative } from "../../path-utils";
import { contentSignature, contentSimilarity, MIN_INEXACT_BYTES, RENAME_MARGIN, RENAME_SIMILARITY, type ContentSignature } from "./content-similarity";
import { getRelativePath } from "../../link-utils";
import { collectMarkdownLinks, relocatedPath, rewriteMarkdownLinks } from "./markdown-links";

interface Entry {
  stamp: string;
  targets: string[];
  signature: ContentSignature;
  digest: string;
  links: Array<{ raw: string; target: string }>;
}
interface Missing { entry: Entry; since: number }
interface Cache {
  version: 2; vault: string; entries: Record<string, Entry>;
  missing: Record<string, Missing>; added: Record<string, number>;
}
function validEntry(value: unknown): value is Entry {
  const entry = value as Entry | null;
  return !!entry && typeof entry.stamp === "string" && /^[a-f0-9]{64}$/.test(entry.digest) &&
    Array.isArray(entry.targets) && entry.targets.every((target) => typeof target === "string") &&
    Number.isSafeInteger(entry.signature?.size) && entry.signature.size >= 0 &&
    Array.isArray(entry.signature.spans) && entry.signature.spans.every((span) =>
      Array.isArray(span) && span.length === 2 && Number.isInteger(span[0]) && span[0] >= 0 &&
      Number.isSafeInteger(span[1]) && span[1] > 0) &&
    Array.isArray(entry.links) && entry.links.every((link) => typeof link?.raw === "string" && typeof link.target === "string");
}
function validKey(path: string) {
  return !!path && !path.startsWith("/") && !path.includes("\\") && !path.includes(":") &&
    !path.split("/").some((part) => part === ".." || part === ".");
}
const RETAIN_MISSING_MS = 7 * 24 * 60 * 60 * 1000;
export type RepairGuard = (write: () => Promise<void>) => Promise<boolean>;

export interface LinkIndexIO {
  files(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  stamp(path: string): Promise<string>;
  read(path: string): Promise<string>;
  write(path: string, body: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  load(): Promise<unknown>;
  persist(cache: Cache): Promise<void>;
}

export type LinkIndexActivity = "updating" | "repairing" | null;

/** A disposable per-vault cache. All mutations, including watcher events, are serialized. */
export class LinkIndex {
  private entries = new Map<string, Entry>();
  private incoming = new Map<string, Set<string>>();
  private queue: Promise<unknown> = Promise.resolve();
  private missing = new Map<string, Missing>();
  private added = new Map<string, number>();
  private baselineAvailable = false;
  private ready = false;
  private dirty = false;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private vault: string,
    private io: LinkIndexIO,
    private onError: (message: string) => void,
    private onActivity?: (activity: LinkIndexActivity) => void,
  ) {}

  private run<T>(action: () => Promise<T>, activity: LinkIndexActivity = "updating"): Promise<T> {
    const result = this.queue.then(async () => {
      this.onActivity?.(activity);
      try { return await action(); }
      finally { this.onActivity?.(null); }
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private put(path: string, entry?: Entry) {
    for (const target of this.entries.get(path)?.targets ?? []) {
      const sources = this.incoming.get(target);
      sources?.delete(path);
      if (!sources?.size) this.incoming.delete(target);
    }
    this.entries.delete(path);
    if (entry) {
      this.entries.set(path, entry);
      for (const target of entry.targets) {
        const sources = this.incoming.get(target) ?? new Set<string>();
        sources.add(path);
        this.incoming.set(target, sources);
      }
    }
  }

  private async indexFile(path: string, force = false) {
    const key = toVaultRelative(path, this.vault);
    const stamp = await this.io.stamp(path);
    if (!force && this.entries.get(key)?.stamp === stamp) return;
    const body = await this.io.read(path);
    // A concurrent external write must never leave a cache marked as current.
    if (await this.io.stamp(path) !== stamp) throw new Error(`File changed while indexing: ${path}`);
    const links = collectMarkdownLinks(body, path, this.vault);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
      (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!this.entries.has(key) && this.baselineAvailable) this.added.set(key, Date.now());
    this.missing.delete(key);
    this.put(key, { stamp, targets: [...new Set(links.map((link) => toVaultRelative(link.target, this.vault)))],
      signature: contentSignature(body), digest,
      links: links.map((link) => ({ raw: body.slice(link.start, link.end), target: toVaultRelative(link.target, this.vault) })),
    });
  }

  private retire(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.missing.set(key, { entry, since: Date.now() });
    this.added.delete(key);
    this.put(key);
  }

  private async initialize() {
    if (this.ready && !this.dirty) return;
    if (!this.ready) {
      try {
        const cache = await this.io.load() as Cache | null;
        if (cache?.version === 2 && cache.vault === this.vault && cache.entries &&
          Object.entries(cache.entries).every(([key, entry]) => validKey(key) && validEntry(entry)) &&
          Object.entries(cache.missing ?? {}).every(([key, item]) => validKey(key) && validEntry(item?.entry) && Number.isFinite(item.since)) &&
          Object.entries(cache.added ?? {}).every(([key, since]) => validKey(key) && Number.isFinite(since))) {
          for (const [path, entry] of Object.entries(cache.entries)) this.put(path, entry);
          this.missing = new Map(Object.entries(cache.missing ?? {}));
          this.added = new Map(Object.entries(cache.added ?? {}));
          this.baselineAvailable = true;
        }
      } catch { /* Cache corruption is recoverable by rebuilding from Markdown. */ }
    }
    // Unlike the sidebar's best-effort scan, failures abort link repair rather than omit notes.
    const files = await this.io.files(this.vault);
    const present = new Set(files.map((path) => toVaultRelative(path, this.vault)));
    for (const path of this.entries.keys()) if (!present.has(path)) this.retire(path);
    for (const path of files) await this.indexFile(path, this.dirty);
    this.baselineAvailable = true;
    this.ready = true;
    this.dirty = false;
    this.schedulePersist();
  }

  start() { return this.run(() => this.initialize()); }

  refresh(paths: string[]) {
    return this.run(async () => {
      try {
        await this.initialize();
        for (const path of new Set(paths)) {
          if (!isPathInside(path, this.vault) || !shouldIncludeInVaultTree(path, this.vault)) continue;
          const files = await this.io.files(path);
          const present = new Set(files.map((file) => toVaultRelative(file, this.vault)));
          for (const key of this.entries.keys()) {
            if (isPathInside(joinPath(this.vault, key), path) && !present.has(key)) this.retire(key);
          }
          for (const file of files) await this.indexFile(file, true);
        }
        this.schedulePersist();
      } catch (error) {
        this.dirty = true;
        throw error;
      }
    });
  }

  remove(paths: string[]) {
    return this.run(async () => {
      for (const key of this.entries.keys()) {
        if (paths.some((path) => isPathInside(joinPath(this.vault, key), path))) this.retire(key);
      }
      this.schedulePersist();
    });
  }

  private schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      void this.run(async () => {
        if (!this.ready || this.dirty) return;
        await this.io.persist({ version: 2, vault: this.vault, entries: Object.fromEntries(this.entries),
          missing: Object.fromEntries(this.missing), added: Object.fromEntries(this.added) });
      }).catch((error) => this.onError(`Failed to cache link index: ${String(error)}`));
    }, 500);
  }

  /** Reconcile external moves using the same content policy for events and startup scans. */
  reconcile(scan = false, guard?: RepairGuard): Promise<string[]> {
    return this.run(async () => {
      await this.initialize();
      if (scan) {
        const files = await this.io.files(this.vault);
        const present = new Set(files.map((path) => toVaultRelative(path, this.vault)));
        for (const key of this.entries.keys()) if (!present.has(key)) this.retire(key);
        for (const path of files) await this.indexFile(path);
      }
      const cutoff = Date.now() - RETAIN_MISSING_MS;
      for (const [key, item] of this.missing) if (item.since < cutoff) this.missing.delete(key);
      for (const [key, since] of this.added) if (since < cutoff) this.added.delete(key);
      const scores: Array<{ from: string; to: string; score: number }> = [];
      // Bound quadratic work. Large bulk changes remain pending instead of freezing the UI.
      if (this.missing.size * this.added.size > 100_000) return [];
      for (const [from, { entry: old }] of this.missing) {
        if (await this.io.exists(joinPath(this.vault, from))) continue;
        for (const to of this.added.keys()) {
          const next = this.entries.get(to);
          if (!next || !old.signature.size || !next.signature.size) continue;
          const exact = old.digest === next.digest;
          const score = exact ? 1 : Math.min(old.signature.size, next.signature.size) < MIN_INEXACT_BYTES
            ? 0 : contentSimilarity(old.signature, next.signature);
          if (score >= RENAME_SIMILARITY - RENAME_MARGIN) scores.push({ from, to, score });
        }
      }
      const pairs = scores.filter((pair) => pair.score >= RENAME_SIMILARITY && !scores.some((other) =>
        other !== pair && (other.from === pair.from || other.to === pair.to) &&
        pair.score - other.score < RENAME_MARGIN));
      const mapping = new Map(pairs.map((pair) => [pair.from, pair.to]));
      const originals = new Map(pairs.map((pair) => [pair.to, this.missing.get(pair.from)!.entry]));
      const affected = new Set<string>(pairs.map((pair) => pair.to));
      for (const pair of pairs) for (const source of this.incoming.get(pair.from) ?? []) affected.add(source);
      const edits: Array<{ path: string; before: string; after: string }> = [];
      for (const source of affected) {
        const path = joinPath(this.vault, source);
        if (!await this.io.exists(path)) continue;
        const before = await this.io.read(path);
        let after = before;
        for (const link of collectMarkdownLinks(before, path, this.vault).reverse()) {
          // An AI may already have fixed the link. Never alter a currently valid reference.
          if (await this.io.exists(link.target)) continue;
          const raw = before.slice(link.start, link.end);
          const currentTarget = toVaultRelative(link.target, this.vault);
          const oldTargets = new Set(originals.get(source)?.links.filter((item) => item.raw === raw).map((item) => item.target));
          if (oldTargets.size > 1) continue;
          const oldTarget = oldTargets.size === 1 ? [...oldTargets][0] : undefined;
          // For a moved source, resolve unchanged hrefs in its OLD directory first.
          const destination = oldTarget !== undefined
            ? mapping.get(oldTarget) ?? oldTarget : mapping.get(currentTarget);
          if (!destination) continue;
          const target = joinPath(this.vault, destination);
          if (!isPathInside(target, this.vault) || !await this.io.exists(target)) continue;
          const relative = link.rootRelative ? `/${destination}` : getRelativePath(path, target);
          const href = relative.split("/").map((part) => encodeURIComponent(part)
            .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/") + link.suffix;
          after = after.slice(0, link.start) + href + after.slice(link.end);
        }
        if (after !== before) edits.push({ path, before, after });
      }
      const changed: string[] = [];
      const apply = async () => {
        this.onActivity?.("repairing");
        // Revalidate both identity evidence and edited documents after asynchronous planning.
        for (const pair of pairs) {
          if (await this.io.exists(joinPath(this.vault, pair.from)) ||
            await this.io.stamp(joinPath(this.vault, pair.to)) !== this.entries.get(pair.to)?.stamp) {
            throw new Error("Files changed during link repair; will retry on the next reconciliation.");
          }
        }
        for (const edit of edits) {
          if (await this.io.read(edit.path) !== edit.before) throw new Error(`File changed during link repair: ${edit.path}`);
          await this.io.write(edit.path, edit.after);
          changed.push(edit.path);
          await this.indexFile(edit.path, true);
        }
      };
      try {
        if (edits.length) {
          if (guard) { if (!await guard(apply)) return []; }
          else await apply();
        }
        for (const pair of pairs) { this.missing.delete(pair.from); this.added.delete(pair.to); }
      } finally {
        this.schedulePersist();
      }
      return changed;
    });
  }

  /** Move only reads affected notes; no vault scan is needed once the index is ready. */
  move(from: string, to: string, onMoved: () => void): Promise<string[]> {
    return this.run(async () => {
      await this.initialize();
      if (!isPathInside(from, this.vault) || !isPathInside(to, this.vault) ||
        from === this.vault || (from !== to && isPathInside(to, from))) {
        throw new Error("Invalid move destination");
      }
      if (from === to) return [];
      if (await this.io.exists(to)) throw new Error(`Destination already exists: ${to}`);
      const candidates = new Set<string>();
      for (const source of this.entries.keys()) {
        if (isPathInside(joinPath(this.vault, source), from)) candidates.add(source);
      }
      for (const [target, sources] of this.incoming) {
        if (isPathInside(joinPath(this.vault, target), from)) for (const source of sources) candidates.add(source);
      }
      const edits: Array<{ source: string; path: string; before: string; after: string }> = [];
      for (const source of candidates) {
        const path = joinPath(this.vault, source);
        const before = await this.io.read(path);
        const after = rewriteMarkdownLinks(before, path, this.vault, from, to);
        if (before !== after) edits.push({ source: path, path: relocatedPath(path, from, to), before, after });
      }
      await this.io.rename(from, to);
      let remainsMoved = true;
      const changed: string[] = [];
      const attempted: typeof edits = [];
      try {
        for (const edit of edits) {
          if (await this.io.read(edit.path) !== edit.before) throw new Error(`File changed during move: ${edit.path}`);
          attempted.push(edit);
          await this.io.write(edit.path, edit.after);
          changed.push(edit.path);
        }
      } catch (error) {
        this.dirty = true;
        try {
          for (const edit of [...attempted].reverse()) {
            const current = await this.io.read(edit.path);
            if (current === edit.before) continue;
            if (changed.includes(edit.path) && current !== edit.after) throw new Error(`Concurrent change: ${edit.path}`);
            await this.io.write(edit.path, edit.before);
          }
          if (await this.io.exists(from)) throw new Error(`Original location is now occupied: ${from}`);
          await this.io.rename(to, from);
          remainsMoved = false;
        } catch (rollbackError) {
          throw new Error(`File moved, but link repair and rollback were incomplete. ${String(error)}; ${String(rollbackError)}`);
        }
        throw new Error(`Move cancelled because links could not be updated. ${String(error)}`);
      } finally {
        if (remainsMoved) onMoved();
        const moved = [...this.entries].filter(([source]) => isPathInside(joinPath(this.vault, source), from));
        for (const [source] of moved) this.put(source);
        try {
          const refresh = new Set([...moved.map(([source]) => remainsMoved
            ? relocatedPath(joinPath(this.vault, source), from, to) : joinPath(this.vault, source)),
            ...edits.map((edit) => remainsMoved ? edit.path : edit.source)]);
          for (const path of refresh) {
            await this.indexFile(path, true);
            this.added.delete(toVaultRelative(path, this.vault));
          }
          for (const [source] of moved) this.missing.delete(source);
        } catch (error) {
          this.dirty = true;
          this.onError(`Failed to update link index: ${String(error)}`);
        }
        this.schedulePersist();
      }
      return changed;
    }, "repairing");
  }
}

export function createLinkIndex(vault: string, onError: (message: string) => void, onActivity?: (activity: LinkIndexActivity) => void): LinkIndex {
  // The existing Tauri store writes relative store paths in the app data directory.
  // JSON avoids an additional database runtime; this remains a versioned, rebuildable cache.
  const store = (async () => {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(vault));
    const id = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const path = `link-index-${id}.json`;
    let target = new LazyStore(path, { autoSave: false, defaults: {} });
    try { await target.init(); } catch {
      target = new LazyStore(path, { autoSave: false, defaults: {}, createNew: true });
      await target.init();
    }
    return target;
  })();
  async function files(path: string): Promise<string[]> {
    if (path !== vault && !await exists(path)) return [];
    const info = await stat(path);
    if (info.isSymlink) return [];
    if (!info.isDirectory) return /\.md$/i.test(path) ? [path] : [];
    const result: string[] = [];
    for (const entry of await readDir(path)) {
      const child = joinPath(path, entry.name);
      if (!entry.isSymlink && shouldIncludeInVaultTree(child, vault)) result.push(...await files(child));
    }
    return result;
  }
  return new LinkIndex(vault, {
    files,
    exists,
    stamp: async (path) => {
      const info = await stat(path);
      return `${info.mtime?.getTime() ?? "unknown"}:${info.size}`;
    },
    read: readTextFile,
    write: writeTextFile,
    rename,
    load: async () => (await store).get("index"),
    persist: async (cache) => { const target = await store; await target.set("index", cache); await target.save(); },
  }, onError, onActivity);
}
