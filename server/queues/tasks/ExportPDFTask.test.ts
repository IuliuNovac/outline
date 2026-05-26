import ExportPDFTask from "./ExportPDFTask";

// Note: the happy-path integration test for `exportDocument` (mocking
// DocumentHelper.toHTML, inlineImagesAsDataURIs, htmlToPdf, and verifying
// the temp-file write) is intentionally deferred to Step 4 alongside the
// tree-merge orchestration test. Vitest's vi.mock hoisting interacts
// poorly with the @server alias resolver for the DocumentHelper module
// in this isolated test file. Step 2's exit criterion is manual smoke
// against a running Gotenberg sidecar (per blueprint), which exercises
// the orchestration chain end-to-end.

describe("ExportPDFTask.getContentType", () => {
  it("returns application/pdf", () => {
    const task = new ExportPDFTask();
    // @ts-expect-error accessing protected method for regression coverage
    expect(task.getContentType()).toBe("application/pdf");
  });
});

describe("ExportPDFTask.exportCollections", () => {
  it("throws unsupported error", async () => {
    const task = new ExportPDFTask();
    await expect(
      // @ts-expect-error accessing protected method
      task.exportCollections([], {} as never)
    ).rejects.toThrow(/per-document/i);
  });
});

describe("ExportPDFTask.exportDocument", () => {
  it("throws when documentStructure is non-empty (tree-merge is Step 4)", async () => {
    const task = new ExportPDFTask();
    const fakeDoc = { id: "doc-1", teamId: "team-1" };
    await expect(
      // @ts-expect-error accessing protected method with a fake Document
      task.exportDocument(fakeDoc, [{ id: "child-1", title: "Child" }])
    ).rejects.toThrow(/Step 4/i);
  });
});
