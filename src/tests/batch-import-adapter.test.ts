import { readImportedBatchText } from "../services/batchImportAdapter";

type MockInput = HTMLInputElement & {
  triggerChange: () => void;
  triggerCancel: () => void;
  removed: boolean;
};

function createMockInput(): MockInput {
  const input = document.createElement("input") as MockInput;
  let selectedFile: File | null = null;

  Object.defineProperty(input, "files", {
    configurable: true,
    get: () => {
      if (selectedFile === null) {
        return null;
      }
      return [selectedFile] as unknown as FileList;
    },
  });

  input.removed = false;
  input.remove = () => {
    input.removed = true;
  };

  input.triggerChange = () => {
    input.onchange?.(new Event("change"));
  };

  input.triggerCancel = () => {
    input.oncancel?.(new Event("cancel"));
  };

  input.click = () => {};

  Object.defineProperty(input, "_setSelectedFile", {
    configurable: true,
    value: (nextFile: File | null) => {
      selectedFile = nextFile;
    },
  });

  return input;
}

function setSelectedFile(input: MockInput, file: File | null): void {
  (input as unknown as { _setSelectedFile: (nextFile: File | null) => void })._setSelectedFile(file);
}

describe("readImportedBatchText", () => {
  it("reads text from a selected file via runtime picker", async () => {
    const input = createMockInput();
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === "input") {
        return input;
      }
      return document.createElement(tagName);
    });

    const imported = readImportedBatchText();
    setSelectedFile(input, new File(["https://www.douyin.com/video/1\nhttps://www.iesdouyin.com/share/video/2"], "urls.txt", { type: "text/plain" }));
    input.triggerChange();

    await expect(imported).resolves.toBe("https://www.douyin.com/video/1\nhttps://www.iesdouyin.com/share/video/2");
    expect(input.accept).toContain(".txt");
    expect(input.multiple).toBe(false);
    expect(input.removed).toBe(true);

    createElementSpy.mockRestore();
  });

  it("returns a friendly cancel error when user closes picker", async () => {
    const input = createMockInput();
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === "input") {
        return input;
      }
      return document.createElement(tagName);
    });

    const imported = readImportedBatchText();
    input.triggerCancel();

    await expect(imported).rejects.toThrow("Import canceled. Queue stays unchanged.");
    expect(input.removed).toBe(true);

    createElementSpy.mockRestore();
  });

  it("returns a friendly read error when selected file cannot be read", async () => {
    const input = createMockInput();
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === "input") {
        return input;
      }
      return document.createElement(tagName);
    });

    const imported = readImportedBatchText();
    setSelectedFile(
      input,
      {
        text: async () => {
          throw new Error("disk unavailable");
        },
      } as unknown as File,
    );
    input.triggerChange();

    await expect(imported).rejects.toThrow("Could not read the selected file. Choose a UTF-8 text file and try again.");
    expect(input.removed).toBe(true);

    createElementSpy.mockRestore();
  });
});
