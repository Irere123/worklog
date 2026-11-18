export function returned<T>(rows: readonly T[], what = "row") {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Expected the ${what} to be returned`);
  }
  return row;
}
