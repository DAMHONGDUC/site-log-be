// A list of string values → an object naming each one, so code writes `UPLOAD_STATE.created`
// instead of the bare string and the list stays the one place the values are spelled.
export function byName<const T extends readonly string[]>(
  values: T,
): { readonly [K in T[number]]: K } {
  return Object.fromEntries(values.map((value) => [value, value])) as {
    readonly [K in T[number]]: K;
  };
}
