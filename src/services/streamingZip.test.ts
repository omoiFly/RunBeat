// @vitest-environment node
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { StreamingZipBuilder } from "./streamingZip";

describe("streaming ZIP builder", () => {
  it("adds Blob inputs incrementally and produces a readable archive", async () => {
    const zip = new StreamingZipBuilder();
    await zip.add("audio.bin", new Blob([Uint8Array.from([1, 2, 3, 4])]));
    await zip.add("timeline.txt", new Blob(["00:00 first\n00:30 second"]));
    const archive = await zip.finish();
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect([...files["audio.bin"]]).toEqual([1, 2, 3, 4]);
    expect(strFromU8(files["timeline.txt"])).toContain("00:30 second");
  });
});
