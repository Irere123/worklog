import { afterAll, mock } from "bun:test";

import { resetSharedContext } from "./harness";

afterAll(async () => {
  mock.restore();
  await resetSharedContext();
});
