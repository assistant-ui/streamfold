import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const entry = new URL("./assistant-ui.js", import.meta.url).href;
const run = (source, inheritLoader = true) =>
  execFileSync(
    process.execPath,
    [...(inheritLoader ? process.execArgv : []), "--input-type=module", "-e", source],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      timeout: 10_000,
    },
  );

test("the event adapter works without the optional assistant-stream peer", () => {
  const directory = mkdtempSync(join(tmpdir(), "streamfold-no-peer-"));
  try {
    cpSync(new URL("./", import.meta.url), join(directory, "src"), { recursive: true });
    cpSync(new URL("../package.json", import.meta.url), join(directory, "package.json"));
    const isolatedEntry = pathToFileURL(join(directory, "src/assistant-ui.js")).href;
    run(
      `
    import assert from 'node:assert/strict';
    const {assistantUI,initializeAssistantStream}=await import(${JSON.stringify(isolatedEntry)});
    const adapter=assistantUI();
    adapter.push({type:'part-start',path:[],part:{type:'tool-call',toolCallId:'call',toolName:'test'}});
    adapter.push({type:'text-delta',path:[0],textDelta:'{"value":1}'});
    assert.deepEqual(adapter.pushAll({type:'tool-call-args-text-finish',path:[0]})[0].value,{value:1});
    assert.equal(await initializeAssistantStream(),false);
    assert.deepEqual(adapter.finish().map(({value})=>value),[{value:1}]);
  `,
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const global of ["WebAssembly", "FinalizationRegistry"]) {
  test(`unavailable ${global} preserves native parsing and permits initialization retry`, () => {
    run(`
      import assert from 'node:assert/strict';
      import {IncrementalJsonObjectParser} from 'assistant-stream/utils';
      const saved=globalThis[${JSON.stringify(global)}];
      globalThis[${JSON.stringify(global)}]=undefined;
      const {initializeAssistantStream}=await import(${JSON.stringify(entry)});
      assert.equal(await initializeAssistantStream(),false);
      const native=IncrementalJsonObjectParser.from('{"value":"');
      assert.equal(native.append('fallback"}').currentArgs.value,'fallback');
      globalThis[${JSON.stringify(global)}]=saved;
      let registered=0;
      if (${JSON.stringify(global)}==='FinalizationRegistry') {
        globalThis.FinalizationRegistry=class extends saved {
          register(...args) { registered++; return super.register(...args); }
        };
      }
      assert.equal(await initializeAssistantStream(),true);
      assert.equal(IncrementalJsonObjectParser.from('{"value":"').append('enabled"}').currentArgs.value,'enabled');
      if (${JSON.stringify(global)}==='FinalizationRegistry') assert.equal(registered,2);
    `);
  });
}
