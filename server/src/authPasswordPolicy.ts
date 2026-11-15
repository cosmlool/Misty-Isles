export function isPasswordLengthWithinLimit(password: string): boolean {
  return password.length <= 128;
}
