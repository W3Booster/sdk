export interface ImmediateStore<TSnapshot> {
  get(): TSnapshot;
  subscribe(listener: (snapshot: TSnapshot) => void): () => void;
}

export interface ExternalStore<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(listener: () => void): () => void;
}

export function createExternalStore<TSnapshot>(source: ImmediateStore<TSnapshot>): ExternalStore<TSnapshot>;
export function createSelectorExternalStore<TSnapshot, TSelected>(
  source: ImmediateStore<TSnapshot>,
  selector: (snapshot: TSnapshot) => TSelected,
  equals?: (previous: TSelected, current: TSelected) => boolean
): ExternalStore<TSelected>;
