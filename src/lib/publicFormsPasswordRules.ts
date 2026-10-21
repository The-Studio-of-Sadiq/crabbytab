/** Length rules for the public forms' tournament password, shared by the settings page and the server. */
export const MIN_PUBLIC_FORMS_PASSWORD_LENGTH = 4;
export const MAX_PUBLIC_FORMS_PASSWORD_LENGTH = 128;

/** An error message for an unacceptable new password, or null. */
export function publicFormsPasswordError(password: unknown): string | null {
  if (typeof password !== "string") return "Enter a password.";
  const length = [...password].length;
  if (length < MIN_PUBLIC_FORMS_PASSWORD_LENGTH) {
    return `The password must be at least ${MIN_PUBLIC_FORMS_PASSWORD_LENGTH} characters long.`;
  }
  if (length > MAX_PUBLIC_FORMS_PASSWORD_LENGTH) {
    return `The password must be at most ${MAX_PUBLIC_FORMS_PASSWORD_LENGTH} characters long.`;
  }
  return null;
}
