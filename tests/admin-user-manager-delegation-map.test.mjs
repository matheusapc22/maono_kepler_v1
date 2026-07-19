import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL(
  "../src/pages/Admin/components/AdminUserManager.tsx",
  import.meta.url,
);

test("AdminUserManager tipa o mapa de permissões delegadas", async () => {
  const source = await readFile(componentPath, "utf8");

  assert.match(
    source,
    /type DelegationPermission = \{[\s\S]*permission: string;[\s\S]*canGrant: boolean;[\s\S]*canRevoke: boolean;[\s\S]*\};/,
  );
  assert.match(
    source,
    /new Map<string, DelegationPermission>\([\s\S]*\[item\.permission, item\] as const/,
  );
});
