// A missing row here is a bug in our code, not bad input: fail loudly instead of returning a 404.
export function returned<T>(rows: readonly T[], what = "row"): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Expected the ${what} to be returned`);
  }
  return row;
}
