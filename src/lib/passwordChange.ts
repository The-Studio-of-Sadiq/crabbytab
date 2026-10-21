/** Firebase's own minimum; it rejects shorter passwords with auth/weak-password. */
export const MIN_PASSWORD_LENGTH = 6;

export type PasswordChangeProblem = "currentRequired" | "tooShort" | "mismatch" | "unchanged";

/**
 * Checks a change-password form before it reaches Firebase (Tabbycat's signed-in password change):
 * the current password is needed to reauthenticate, the new one must meet Firebase's minimum,
 * match its confirmation and differ from the current one.
 */
export function passwordChangeProblem(input: { current: string; next: string; confirm: string }): PasswordChangeProblem | null {
  if (!input.current) return "currentRequired";
  if (input.next.length < MIN_PASSWORD_LENGTH) return "tooShort";
  if (input.next !== input.confirm) return "mismatch";
  if (input.next === input.current) return "unchanged";
  return null;
}
