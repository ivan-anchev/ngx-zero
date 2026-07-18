import type { Zero, ZeroOptions } from '@rocicorp/zero';

export interface ExternalZeroSource {
  readonly zero: Zero;
}

export type ZeroOptionsOrExternalSource = ZeroOptions | ExternalZeroSource;

export type ZeroInstanceOptions = ZeroOptionsOrExternalSource | (() => ZeroOptionsOrExternalSource);

export type ZeroSourceFactory = () => ZeroOptionsOrExternalSource;

export type ZeroReconcileVerdict = 'noop' | 'connect' | 'recreate';

export interface ZeroInstanceHooks {
  /**
   * Called once per Zero instance created.
   * Not called for external `{ zero }`.
   * Runs in injection context.
   */
  onInstanceCreated?(zero: Zero): void;
}
