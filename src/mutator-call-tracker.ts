import { computed, signal, type Signal } from '@angular/core';
import type { MutatorResultDetails } from '@rocicorp/zero';
import type { MutatorError } from './mutator-ref.js';

interface CallState {
  readonly callId: number;
  readonly client: MutatorResultDetails | undefined;
  readonly server: MutatorResultDetails | undefined;
}

const IDLE: CallState = { callId: 0, client: undefined, server: undefined };

export class MutatorCallTracker {
  #nextCallId = 0;
  #destroyed = false;

  readonly #state = signal<CallState>(IDLE);

  readonly clientPending: Signal<boolean> = computed(() => {
    const state = this.#state();
    return state.callId !== 0 && state.client === undefined;
  });

  readonly pending: Signal<boolean> = computed(() => {
    const state = this.#state();
    return state.callId !== 0 && state.server === undefined;
  });

  readonly clientResult: Signal<MutatorResultDetails | undefined> = computed(
    () => this.#state().client,
  );

  readonly serverResult: Signal<MutatorResultDetails | undefined> = computed(
    () => this.#state().server,
  );

  readonly error: Signal<MutatorError | undefined> = computed(() => {
    const state = this.#state();
    if (state.client?.type === 'error') {
      return state.client.error;
    }
    if (state.server?.type === 'error') {
      return state.server.error;
    }
    return undefined;
  });

  begin(): number {
    const callId = ++this.#nextCallId;
    if (!this.#destroyed) {
      this.#state.set({ callId, client: undefined, server: undefined });
    }
    return callId;
  }

  settleClient(callId: number, details: MutatorResultDetails): void {
    if (this.#isStale(callId)) {
      return;
    }
    this.#state.update(state => ({ ...state, client: details }));
  }

  settleServer(callId: number, details: MutatorResultDetails): void {
    if (this.#isStale(callId)) {
      return;
    }
    this.#state.update(state => ({ ...state, server: details }));
  }

  destroy(): void {
    this.#destroyed = true;
  }

  #isStale(callId: number): boolean {
    return this.#destroyed || this.#state().callId !== callId;
  }
}
