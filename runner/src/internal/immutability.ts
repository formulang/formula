export function deepFreezeLimited(value: unknown, maxDepth: number, maxNodes: number): void {
  const visited = new WeakSet<object>();
  let nodes = 0;

  const visit = (v: unknown, depth: number) => {
    if (nodes >= maxNodes) return;
    if (depth > maxDepth) return;
    if (!v || (typeof v !== 'object' && typeof v !== 'function')) return;

    const obj = v as object;
    if (visited.has(obj)) return;
    visited.add(obj);
    nodes++;

    try {
      Object.freeze(obj);
    } catch {
      // ignore
    }

    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }

    for (const key of Object.keys(v as any)) {
      try {
        visit((v as any)[key], depth + 1);
      } catch {
        // ignore
      }
    }
  };

  visit(value, 0);
}
