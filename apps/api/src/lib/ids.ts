import KSUID from "ksuid";

export function generateId() {
  return KSUID.randomSync().string;
}
