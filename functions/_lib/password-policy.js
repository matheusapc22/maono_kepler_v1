// Keep the existing minimum; reject coercion and preserve spaces verbatim.
export function validateNewPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    const error = new Error("A senha precisa ter pelo menos 8 caracteres.");
    error.status = 400;
    error.code = "USER_PASSWORD_INVALID";
    throw error;
  }
  return password;
}
