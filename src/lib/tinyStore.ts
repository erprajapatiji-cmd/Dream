import { useSyncExternalStore } from "react";

type Listener = () => void;

interface Store<T> {
  getState: () => T;
  setState: (partial: Partial<T>) => void;
  subscribe: (listener: Listener) => () => void;
  useStore: () => T;
}

export function createStore<T extends object>(initialState: T): Store<T> {
  let state = initialState;
  const listeners = new Set<Listener>();

  const getState = () => state;

  const setState = (partial: Partial<T>) => {
    state = { ...state, ...partial };
    listeners.forEach((l) => l());
  };

  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const useStore = () => useSyncExternalStore(subscribe, getState, getState);

  return { getState, setState, subscribe, useStore };
}
