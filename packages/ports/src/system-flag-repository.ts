export type SystemFlagKey =
  | "killswitch_mode"
  | "killswitch_reason"
  | "killswitch_last_transition_at"
  | "last_usage_poll_at"
  | (string & {});

export type SystemFlagValue = string;

export interface SystemFlagRepository {
  get(key: SystemFlagKey): Promise<SystemFlagValue | null>;
  set(key: SystemFlagKey, value: SystemFlagValue): Promise<void>;
  list(prefix?: string): Promise<ReadonlyArray<{ key: SystemFlagKey; value: SystemFlagValue }>>;
}
