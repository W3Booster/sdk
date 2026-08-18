export interface ImmediateStore<TSnapshot> {
  get(): TSnapshot;
  subscribe(listener: (snapshot: TSnapshot) => void): () => void;
}

export interface ReactExternalStore<TSnapshot> {
  getSnapshot(): TSnapshot;
  getServerSnapshot(): TSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface ReactStoreOptions<TSnapshot> {
  /** Read once when the adapter is created; the captured value is used during server rendering and hydration. Defaults to source.get(). */
  getServerSnapshot?: () => TSnapshot;
}

export interface ReactSelectorStoreOptions<TSnapshot, TSelected> extends ReactStoreOptions<TSnapshot> {
  equals?: (previous: TSelected, current: TSelected) => boolean;
}

export function createReactStore<TSnapshot>(
  source: ImmediateStore<TSnapshot>,
  options?: ReactStoreOptions<TSnapshot>
): ReactExternalStore<TSnapshot>;

export function createReactSelectorStore<TSnapshot, TSelected>(
  source: ImmediateStore<TSnapshot>,
  selector: (snapshot: TSnapshot) => TSelected,
  options?: ReactSelectorStoreOptions<TSnapshot, TSelected>
): ReactExternalStore<TSelected>;
