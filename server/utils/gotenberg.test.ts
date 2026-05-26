import { htmlToPdf, GotenbergError } from "./gotenberg";

const pdfMagic = "%PDF-1.7\nrest of body";

interface MockFetchOptions {
  status?: number;
  body?: BodyInit | null;
  headers?: HeadersInit;
}

const mockFetch = (res: MockFetchOptions): typeof fetch =>
  (async () =>
    new Response(res.body ?? pdfMagic, {
      status: res.status ?? 200,
      headers: res.headers,
    })) as unknown as typeof fetch;

describe("htmlToPdf", () => {
  it("throws when gotenbergUrl is missing", async () => {
    await expect(htmlToPdf("<p>hi</p>", { gotenbergUrl: "" })).rejects.toThrow(
      /gotenbergUrl/i
    );
  });

  it("throws when html contains a remote img src (SSRF guard)", async () => {
    await expect(
      htmlToPdf('<img src="http://attacker/x.png">', {
        gotenbergUrl: "http://gotenberg:3000",
      })
    ).rejects.toThrow(/data:/i);
  });

  it("throws when html contains an https img src", async () => {
    await expect(
      htmlToPdf('<img src="https://attacker/x.png">', {
        gotenbergUrl: "http://gotenberg:3000",
      })
    ).rejects.toThrow(/data:/i);
  });

  it("throws when html contains a protocol-relative img src", async () => {
    await expect(
      htmlToPdf('<img src="//attacker.internal/x.png">', {
        gotenbergUrl: "http://gotenberg:3000",
      })
    ).rejects.toThrow(/data:/i);
  });

  it("allows html with only data-URI images", async () => {
    const buffer = await htmlToPdf(
      '<p>ok</p><img src="data:image/png;base64,AAAA">',
      { gotenbergUrl: "http://gotenberg:3000" },
      mockFetch({ status: 200 })
    );
    expect(buffer.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("allows html with no images at all", async () => {
    const buffer = await htmlToPdf(
      "<h1>hello</h1>",
      { gotenbergUrl: "http://gotenberg:3000" },
      mockFetch({ status: 200 })
    );
    expect(buffer.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("throws GotenbergError on 5xx", async () => {
    await expect(
      htmlToPdf(
        "<p>hi</p>",
        { gotenbergUrl: "http://gotenberg:3000" },
        mockFetch({ status: 503, body: "service unavailable" })
      )
    ).rejects.toMatchObject({
      name: "GotenbergError",
      status: 503,
    });
  });

  it("throws when response body does not start with %PDF-", async () => {
    await expect(
      htmlToPdf(
        "<p>hi</p>",
        { gotenbergUrl: "http://gotenberg:3000" },
        mockFetch({ status: 200, body: "NOT_A_PDF" })
      )
    ).rejects.toThrow(/not a valid pdf/i);
  });

  it("posts to /forms/chromium/convert/html", async () => {
    let capturedUrl: string | undefined;
    const capturingFetch: typeof fetch = (async (input: RequestInfo) => {
      capturedUrl = typeof input === "string" ? input : (input as Request).url;
      return new Response(pdfMagic, { status: 200 });
    }) as unknown as typeof fetch;
    await htmlToPdf(
      "<p>hi</p>",
      { gotenbergUrl: "http://gotenberg:3000" },
      capturingFetch
    );
    expect(capturedUrl).toBe(
      "http://gotenberg:3000/forms/chromium/convert/html"
    );
  });

  it("strips trailing slash from gotenbergUrl", async () => {
    let capturedUrl: string | undefined;
    const capturingFetch: typeof fetch = (async (input: RequestInfo) => {
      capturedUrl = typeof input === "string" ? input : (input as Request).url;
      return new Response(pdfMagic, { status: 200 });
    }) as unknown as typeof fetch;
    await htmlToPdf(
      "<p>hi</p>",
      { gotenbergUrl: "http://gotenberg:3000/" },
      capturingFetch
    );
    expect(capturedUrl).toBe(
      "http://gotenberg:3000/forms/chromium/convert/html"
    );
  });
});

describe("GotenbergError", () => {
  it("carries status code", () => {
    const err = new GotenbergError("boom", 503);
    expect(err.status).toBe(503);
    expect(err.name).toBe("GotenbergError");
    expect(err.message).toBe("boom");
  });
});
