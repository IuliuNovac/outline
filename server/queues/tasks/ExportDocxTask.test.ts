import ExportDocxTask from "./ExportDocxTask";

// Note: the happy-path integration test for `exportDocument` (mocking
// DocumentHelper.toHTML, inlineImagesAsDataURIs, exportDocumentAsDocx, and
// verifying the temp-file write) is intentionally deferred to Step 4
// alongside the tree-merge orchestration test, mirroring the same deferral in
// ExportPDFTask.test.ts. Vitest's vi.mock hoisting interacts poorly with the
// @server alias resolver for the DocumentHelper module in this isolated test
// shape. Step 3's exit criterion is manual smoke against a running Outline
// instance with DOCX_EXPORT_ENABLED.

describe("ExportDocxTask.getContentType", () => {
  it("returns the Word OOXML media type", () => {
    const task = new ExportDocxTask();
    // @ts-expect-error accessing protected method for regression coverage
    expect(task.getContentType()).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });
});

describe("ExportDocxTask.exportCollections", () => {
  it("throws unsupported error", async () => {
    const task = new ExportDocxTask();
    await expect(
      // @ts-expect-error accessing protected method
      task.exportCollections([], {} as never)
    ).rejects.toThrow(/per-document/i);
  });
});

describe("ExportDocxTask.exportDocument", () => {
  it("throws when documentStructure is non-empty (tree-merge is Step 4)", async () => {
    const task = new ExportDocxTask();
    const fakeDoc = { id: "doc-1", teamId: "team-1" };
    await expect(
      // @ts-expect-error accessing protected method with a fake Document
      task.exportDocument(fakeDoc, [{ id: "child-1", title: "Child" }])
    ).rejects.toThrow(/Step 4/i);
  });
});
