import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
const path = new URL("../.dev.vars", import.meta.url);
const current = existsSync(path)
  ? readFileSync(path, "utf8")
  : "DEV_AUTH=true\n";
if (!/^MODEL_CONFIG_KEY=/m.test(current))
  writeFileSync(
    path,
    current + "\nMODEL_CONFIG_KEY=" + randomBytes(32).toString("base64") + "\n",
    { mode: 0o600 },
  );
console.log("本地加密密钥已准备好（不输出、不覆盖已有值）。");
