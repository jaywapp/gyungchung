export type ResourceQueryResult = { data: unknown; error: unknown | null };
export type LoadedResource = ResourceQueryResult & { isCurrent: () => boolean };
type Query = (signal: AbortSignal) => PromiseLike<ResourceQueryResult>;
type Entry = {
  owner: string | null;
  version: number;
  query: Query;
  controller: AbortController | null;
  pending: Promise<LoadedResource> | null;
};

/** Share reads by resource, but never reuse a read started before a completed mutation. */
export class ResourceRequests<Resource extends string> {
  private entries = new Map<Resource, Entry>();
  private generation = 0;
  get epoch() { return this.generation; }

  invalidate(resource: Resource) {
    this.entries.get(resource)?.controller?.abort();
    this.entries.delete(resource);
  }

  reset() {
    this.generation++;
    this.entries.forEach((entry) => entry.controller?.abort());
    this.entries.clear();
  }

  load(resource: Resource, owner: string | null, query: Query, refresh = false): Promise<LoadedResource> {
    let entry = this.entries.get(resource);
    if (entry?.owner !== owner) {
      entry?.controller?.abort();
      entry = undefined;
    }
    if (!entry) {
      entry = { owner, version: 0, query, controller: null, pending: null };
      this.entries.set(resource, entry);
    }
    if (entry.pending && !refresh) return entry.pending;
    entry.version++;
    entry.query = query;
    if (entry.pending) {
      // Collapse concurrent invalidations into one follow-up read after cancellation.
      entry.controller?.abort();
      return entry.pending;
    }
    const request = entry;
    const epoch = this.generation;
    const active = () => epoch === this.generation && this.entries.get(resource) === request;
    const pending = (async () => {
      await Promise.resolve();
      let version: number;
      let result: ResourceQueryResult = { data: null, error: null };
      do {
        version = request.version;
        request.controller = new AbortController();
        if (!active()) break;
        try { result = await request.query(request.controller.signal); }
        catch (error) { result = { data: null, error }; }
      } while (active() && version !== request.version);
      return { ...result, isCurrent: () => active() && version === request.version };
    })();
    request.pending = pending;
    void pending.finally(() => {
      if (request.pending === pending) { request.pending = null; request.controller = null; }
    });
    return pending;
  }
}
