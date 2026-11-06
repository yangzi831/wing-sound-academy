import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
// Deno-only globals are declared here; SDK and DOM types are checked against the real packages.
const root = fileURLToPath(new URL("../", import.meta.url));
const cache = path.join(root, "node_modules", ".cache");
mkdirSync(cache, { recursive: true });
const dir = mkdtempSync(path.join(cache, "academy-edge-check-"));
const file = path.join(dir, "index.ts");
try {
  const source = readFileSync(
    path.join(root, "supabase/functions/academy-invite/index.ts"),
    "utf8",
  ).replace(
    "https://esm.sh/@supabase/supabase-js@2.118.0",
    "@supabase/supabase-js",
  );
  writeFileSync(
    file,
    "declare const Deno: {env:{get(key:string):string|undefined};serve(handler:(req:Request)=>Promise<Response>):void};\n" +
      source,
  );
  const program = ts.createProgram([file], {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    types: [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => root,
        getNewLine: () => "\n",
      }),
    );
    process.exitCode = 1;
  } else
    console.log(
      "Edge Function TypeScript + installed Supabase SDK types passed (Deno runtime not executed).",
    );
} finally {
  unlinkSync(file);
  rmdirSync(dir);
}
