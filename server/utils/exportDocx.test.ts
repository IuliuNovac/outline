import yauzl from "yauzl";
import { exportDocumentAsDocx } from "./exportDocx";

/**
 * Reads a single named entry out of an in-memory OOXML zip and returns it as
 * UTF-8 text. Used by tests that want to assert on the raw word/document.xml
 * payload rather than raw byte equality (zip metadata churn defeats byte
 * diffs across runs).
 */
const readEntry = (buffer: Buffer, entryName: string): Promise<string> =>
  new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error("yauzl.fromBuffer returned no zipfile"));
        return;
      }
      let resolved = false;
      zipfile.on("entry", (entry) => {
        if (entry.fileName === entryName) {
          zipfile.openReadStream(entry, (rsErr, readStream) => {
            if (rsErr || !readStream) {
              reject(
                rsErr ?? new Error("openReadStream returned no readStream")
              );
              return;
            }
            const chunks: Buffer[] = [];
            readStream.on("data", (c: Buffer) => chunks.push(c));
            readStream.on("end", () => {
              resolved = true;
              resolve(Buffer.concat(chunks).toString("utf8"));
            });
            readStream.on("error", reject);
          });
          return;
        }
        zipfile.readEntry();
      });
      zipfile.on("end", () => {
        if (!resolved) {
          reject(new Error(`Entry ${entryName} not found in zip`));
        }
      });
      zipfile.readEntry();
    });
  });

describe("exportDocumentAsDocx", () => {
  it("returns a non-empty Buffer for minimal HTML", async () => {
    const result = await exportDocumentAsDocx("<h1>Hello</h1>");
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("output starts with the OOXML PK zip magic bytes", async () => {
    const result = await exportDocumentAsDocx("<p>Body</p>");
    expect(result.subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04])
    );
  });

  it("contains a word/document.xml entry carrying the body text", async () => {
    const result = await exportDocumentAsDocx(
      "<h1>Title-One</h1><p>BodyOne</p>"
    );
    const xml = await readEntry(result, "word/document.xml");
    expect(xml).toContain("Title-One");
    expect(xml).toContain("BodyOne");
  });

  it("preserves CJK UTF-8 text in document.xml", async () => {
    const result = await exportDocumentAsDocx(
      "<p>日本語テスト ローマ字</p>"
    );
    const xml = await readEntry(result, "word/document.xml");
    expect(xml).toContain("日本語テスト");
  });

  it("rejects empty input", async () => {
    await expect(exportDocumentAsDocx("")).rejects.toThrow(/non-empty/i);
    await expect(exportDocumentAsDocx("   ")).rejects.toThrow(/non-empty/i);
  });

  it("rejects HTML containing http(s) <img> sources to defeat SSRF", async () => {
    await expect(
      exportDocumentAsDocx('<p><img src="http://evil.example/x.png"></p>')
    ).rejects.toThrow(/data: URIs/i);
    await expect(
      exportDocumentAsDocx('<p><img src="https://evil.example/x.png"></p>')
    ).rejects.toThrow(/data: URIs/i);
  });

  it("rejects HTML containing protocol-relative <img> sources", async () => {
    await expect(
      exportDocumentAsDocx('<p><img src="//evil.example/x.png"></p>')
    ).rejects.toThrow(/data: URIs/i);
  });

  it("rejects HTML containing unquoted <img src=> with http(s) URL", async () => {
    await expect(
      exportDocumentAsDocx("<p><img src=http://evil.example/x.png></p>")
    ).rejects.toThrow(/data: URIs/i);
    await expect(
      exportDocumentAsDocx("<p><img src=https://evil.example/x.png></p>")
    ).rejects.toThrow(/data: URIs/i);
  });

  it("rejects HTML containing <source srcset> with a non-data URL", async () => {
    await expect(
      exportDocumentAsDocx(
        '<picture><source srcset="http://evil.example/x.png 1x"><img src="data:image/png;base64,AA=="></picture>'
      )
    ).rejects.toThrow(/data: URIs/i);
  });

  it("rejects HTML containing SVG <image href> with a non-data URL", async () => {
    await expect(
      exportDocumentAsDocx(
        '<svg><image href="http://evil.example/x.svg" width="10" height="10" /></svg>'
      )
    ).rejects.toThrow(/data: URIs/i);
  });

  it("rejects HTML containing SVG <image xlink:href> with a non-data URL", async () => {
    await expect(
      exportDocumentAsDocx(
        '<svg><image xlink:href="http://evil.example/x.svg" width="10" height="10" /></svg>'
      )
    ).rejects.toThrow(/data: URIs/i);
  });
});
