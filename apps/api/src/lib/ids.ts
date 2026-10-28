import KSUID from "ksuid";

// Sorts by creation time to the second, in byte order. Under a collation other than C its mixed
// case breaks that, so order by a timestamp and use the id only to break ties.
export function generateId(): string {
  return KSUID.randomSync().string;
}
