// Shared locks protect drafts, undo history and pending saves across tabs.
// The browser releases them when a tab closes, including after a crash.
const LOCK_PREFIX = "runbeat:beat-resource:";
type Hold = { ready: Promise<void>; release: () => void };
const owners = new Map<object, Map<string, Hold>>();

function locks(): LockManager | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.locks;
}

function holdResource(id: string): Hold {
  const manager = locks();
  if (!manager) return { ready: Promise.resolve(), release: () => undefined };
  let release!: () => void;
  const lifetime = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve, reject) => {
    void manager.request(`${LOCK_PREFIX}${id}`, { mode: "shared" }, () => {
      resolve();
      return lifetime;
    }).catch(reject);
  });
  return { ready, release };
}

export async function retainBeatResources(owner: object, ids: Iterable<string>): Promise<void> {
  const wanted = new Set(ids);
  const holds = owners.get(owner) ?? new Map<string, Hold>();
  const changed = wanted.size !== holds.size || [...wanted].some((id) => !holds.has(id));
  owners.set(owner, holds);
  for (const [id, hold] of holds) {
    if (!wanted.has(id)) {
      hold.release();
      holds.delete(id);
    }
  }
  for (const id of wanted) if (!holds.has(id)) holds.set(id, holdResource(id));
  if (!holds.size) owners.delete(owner);
  await Promise.all([...holds.values()].map((hold) => hold.ready));
  if (changed && typeof window !== "undefined") window.dispatchEvent(new Event("runbeat:beat-references-changed"));
}

export function releaseBeatResources(owner: object): void {
  const changed = owners.has(owner);
  for (const hold of owners.get(owner)?.values() ?? []) hold.release();
  owners.delete(owner);
  if (changed && typeof window !== "undefined") window.dispatchEvent(new Event("runbeat:beat-references-changed"));
}

export async function protectedBeatResourceIds(): Promise<Set<string>> {
  const ids = new Set([...owners.values()].flatMap((holds) => [...holds.keys()]));
  const snapshot = await locks()?.query();
  for (const lock of [...snapshot?.held ?? [], ...snapshot?.pending ?? []]) {
    if (lock.name?.startsWith(LOCK_PREFIX)) ids.add(lock.name.slice(LOCK_PREFIX.length));
  }
  return ids;
}

export class BeatResourceInUseError extends Error {
  constructor() { super("这个鼓点仍被项目、当前编辑或撤销记录使用。请更换并保存引用它的项目，再关闭对应编辑页。"); }
}

export async function withUnusedBeatResource<T>(id: string, operation: () => Promise<T>): Promise<T> {
  if ([...owners.values()].some((holds) => holds.has(id))) throw new BeatResourceInUseError();
  const manager = locks();
  // Without cross-tab locks, deletion cannot safely account for another tab's drafts.
  if (!manager) throw new Error("当前浏览器不支持安全删除鼓点，请使用新版浏览器。");
  return manager.request(`${LOCK_PREFIX}${id}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) throw new BeatResourceInUseError();
    return operation();
  });
}
