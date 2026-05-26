import ExportHTMLZipTask from "./ExportHTMLZipTask";
import ExportJSONTask from "./ExportJSONTask";
import ExportMarkdownZipTask from "./ExportMarkdownZipTask";

describe("ExportTask.getContentType", () => {
  it("ExportJSONTask uploads as application/zip", () => {
    const task = new ExportJSONTask();
    // @ts-expect-error accessing protected method for regression coverage
    expect(task.getContentType()).toBe("application/zip");
  });

  it("ExportMarkdownZipTask uploads as application/zip", () => {
    const task = new ExportMarkdownZipTask();
    // @ts-expect-error accessing protected method for regression coverage
    expect(task.getContentType()).toBe("application/zip");
  });

  it("ExportHTMLZipTask uploads as application/zip", () => {
    const task = new ExportHTMLZipTask();
    // @ts-expect-error accessing protected method for regression coverage
    expect(task.getContentType()).toBe("application/zip");
  });
});
