export function validatePasswordStrength(password: string): string | null {
  // Maximum length check to prevent DoS via bcrypt computation
  if (password.length > 128) {
    return 'Password must not exceed 128 characters.';
  }

  if (password.length < 10) {
    return 'Password must be at least 10 characters.';
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/`~;']/.test(password);

  if (!hasLower || !hasUpper || !hasNumber) {
    return 'Password must include upper, lower, and numeric characters.';
  }

  if (!hasSpecial) {
    return 'Password must include at least one special character.';
  }

  return null;
}
