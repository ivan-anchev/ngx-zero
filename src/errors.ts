export function ngxZeroError(message: string): Error {
  return new Error(`[ngx-zero] ${message}`);
}
