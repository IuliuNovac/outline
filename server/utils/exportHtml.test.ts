import {
  computeAnchorSlug,
  injectFirstHeadingAnchor,
  inlineImagesAsDataURIs,
  rewriteOutlineDocLinks,
  shiftHeadings,
} from "./exportHtml";

describe("shiftHeadings", () => {
  it("returns identical output when offset is 0", () => {
    const html = "<h1>One</h1><h2>Two</h2><p>body</p>";
    expect(shiftHeadings(html, 0)).toContain("<h1>One</h1>");
    expect(shiftHeadings(html, 0)).toContain("<h2>Two</h2>");
  });

  it("shifts h1 to h2 at offset 1", () => {
    const out = shiftHeadings("<h1>Title</h1>", 1);
    expect(out).toContain("<h2>Title</h2>");
    expect(out).not.toContain("<h1>");
  });

  it("caps at h6 at large offset", () => {
    const out = shiftHeadings("<h1>X</h1><h2>Y</h2><h6>Z</h6>", 9);
    expect(out).toContain("<h6>X</h6>");
    expect(out).toContain("<h6>Y</h6>");
    expect(out).toContain("<h6>Z</h6>");
  });

  it("does not touch text inside pre or code", () => {
    const html = "<pre><code>&lt;h1&gt;raw&lt;/h1&gt;</code></pre>";
    const out = shiftHeadings(html, 2);
    expect(out).toContain("&lt;h1&gt;raw&lt;/h1&gt;");
  });

  it("does not shift real h1 nested inside pre", () => {
    const out = shiftHeadings("<pre><h1>raw</h1></pre>", 2);
    expect(out).toContain("<h1>raw</h1>");
    expect(out).not.toMatch(/<h[23456]>raw<\/h[23456]>/);
  });

  it("does not shift real h2 nested inside code", () => {
    const out = shiftHeadings("<code><h2>raw</h2></code>", 3);
    expect(out).toContain("<h2>raw</h2>");
  });

  it("preserves existing id attributes when shifting", () => {
    const out = shiftHeadings('<h1 id="foo">Title</h1>', 1);
    expect(out).toContain('id="foo"');
    expect(out).toContain("<h2");
  });
});

describe("computeAnchorSlug", () => {
  it("returns a deterministic doc-prefixed slug", () => {
    const id = "abc1234def56";
    expect(computeAnchorSlug(id)).toBe("doc-abc1234def56");
  });

  it("truncates long document ids", () => {
    const id = "abcdefghijklmnopqrstuvwxyz";
    expect(computeAnchorSlug(id)).toBe("doc-abcdefghijkl");
  });

  it("is URL-safe", () => {
    const slug = computeAnchorSlug("aBc123-_456");
    expect(slug).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});

describe("injectFirstHeadingAnchor", () => {
  it("adds id attribute to first heading", () => {
    const out = injectFirstHeadingAnchor("<h1>Title</h1><h2>Sub</h2>", "doc-x");
    expect(out).toMatch(/<h1[^>]*id="doc-x"[^>]*>Title<\/h1>/);
    expect(out).toMatch(/<h2[^>]*>Sub<\/h2>/);
  });

  it("no-ops when html has no heading", () => {
    const out = injectFirstHeadingAnchor("<p>just text</p>", "doc-x");
    expect(out).toContain("<p>just text</p>");
  });

  it("preserves existing id if matching", () => {
    const out = injectFirstHeadingAnchor('<h1 id="doc-x">Title</h1>', "doc-x");
    expect(out).toMatch(/id="doc-x"/);
  });

  it("does not overwrite an existing different id", () => {
    const out = injectFirstHeadingAnchor(
      '<h1 id="existing">Title</h1>',
      "doc-x"
    );
    expect(out).toContain('id="existing"');
    expect(out).not.toContain('id="doc-x"');
  });

  it("uses the lowest-level heading first in document order", () => {
    const out = injectFirstHeadingAnchor(
      "<h3>First</h3><h1>Later</h1>",
      "doc-x"
    );
    expect(out).toMatch(/<h3[^>]*id="doc-x"[^>]*>First<\/h3>/);
  });
});

describe("rewriteOutlineDocLinks", () => {
  it("rewrites in-tree links to fragment anchors", () => {
    const map = new Map([["abc1234def56", "doc-abc1234def56"]]);
    const html = '<a href="/doc/some-slug-abc1234def56">go</a>';
    const out = rewriteOutlineDocLinks(html, map);
    expect(out).toContain('href="#doc-abc1234def56"');
  });

  it("rewrites short id only links to fragment anchors", () => {
    const map = new Map([["abc1234def56", "doc-abc1234def56"]]);
    const html = '<a href="/doc/abc1234def56">go</a>';
    const out = rewriteOutlineDocLinks(html, map);
    expect(out).toContain('href="#doc-abc1234def56"');
  });

  it("leaves out-of-tree links untouched", () => {
    const map = new Map([["abc1234def56", "doc-abc1234def56"]]);
    const html = '<a href="/doc/other-zzz9999wwww88">go</a>';
    const out = rewriteOutlineDocLinks(html, map);
    expect(out).toContain('href="/doc/other-zzz9999wwww88"');
  });

  it("leaves external URLs untouched", () => {
    const map = new Map([["abc1234def56", "doc-abc1234def56"]]);
    const html = '<a href="https://example.com">go</a>';
    const out = rewriteOutlineDocLinks(html, map);
    expect(out).toContain('href="https://example.com"');
  });
});

describe("inlineImagesAsDataURIs", () => {
  it("replaces http src with data URI", async () => {
    const fetcher = async (_url: string) => ({
      contentType: "image/png",
      bytes: Buffer.from("PNGDATA"),
    });
    const html = '<img src="https://example.com/x.png" alt="A">';
    const out = await inlineImagesAsDataURIs(html, fetcher);
    const base64 = Buffer.from("PNGDATA").toString("base64");
    expect(out).toContain(`src="data:image/png;base64,${base64}"`);
    expect(out).not.toContain("https://example.com/x.png");
  });

  it("emits placeholder when fetcher throws", async () => {
    const fetcher = async () => {
      throw new Error("404");
    };
    const html = '<img src="https://example.com/missing.png" alt="A">';
    const out = await inlineImagesAsDataURIs(html, fetcher);
    expect(out).not.toContain("<img");
    expect(out).toContain("export-image-error");
    expect(out).toContain("missing.png");
  });

  it("preserves data URIs verbatim", async () => {
    const fetcher = async () => {
      throw new Error("should not fetch");
    };
    const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const html = `<img src="${dataUri}" alt="">`;
    const out = await inlineImagesAsDataURIs(html, fetcher);
    expect(out).toContain(dataUri);
  });

  it("processes multiple images in parallel", async () => {
    const seen: string[] = [];
    const fetcher = async (url: string) => {
      seen.push(url);
      return {
        contentType: "image/jpeg",
        bytes: Buffer.from(`bytes-for-${url}`),
      };
    };
    const html =
      '<img src="https://a.test/x.jpg"><img src="https://b.test/y.jpg">';
    const out = await inlineImagesAsDataURIs(html, fetcher);
    expect(seen).toHaveLength(2);
    expect(out).toContain(
      "data:image/jpeg;base64," +
        Buffer.from("bytes-for-https://a.test/x.jpg").toString("base64")
    );
    expect(out).toContain(
      "data:image/jpeg;base64," +
        Buffer.from("bytes-for-https://b.test/y.jpg").toString("base64")
    );
  });
});
