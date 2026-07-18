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
