/**
 * Auth context shared by queries and mutators. Built on the server from the
 * verified JWT; supplied on the client via the Zero `context` option so
 * optimistic execution sees the same shape.
 */
export interface AuthContext {
  readonly userID: string | null;
}

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    context: AuthContext;
  }
}

export function requireUser(ctx: AuthContext): string {
  if (ctx.userID === null) {
    throw new Error('You must be logged in to do that.');
  }
  return ctx.userID;
}
