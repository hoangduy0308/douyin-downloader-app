const IMPORT_CANCELED_MESSAGE = "Import canceled. Queue stays unchanged.";
const IMPORT_READ_ERROR_MESSAGE = "Could not read the selected file. Choose a UTF-8 text file and try again.";

function readFileContents(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsText(file);
  });
}

export async function readImportedBatchText(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".txt,text/plain,.csv,text/csv";
    picker.multiple = false;

    let settled = false;

    const cleanup = (): void => {
      picker.onchange = null;
      picker.oncancel = null;
      picker.remove();
    };

    const finalize = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const onCancel = (): void => {
      finalize(() => reject(new Error(IMPORT_CANCELED_MESSAGE)));
    };

    const onChange = (): void => {
      const selectedFile = picker.files?.[0];
      if (!selectedFile) {
        onCancel();
        return;
      }

      void readFileContents(selectedFile)
        .then((contents) => {
          finalize(() => resolve(contents));
        })
        .catch(() => {
          finalize(() => reject(new Error(IMPORT_READ_ERROR_MESSAGE)));
        });
    };

    picker.onchange = onChange;
    picker.oncancel = onCancel;
    picker.click();
  });
}
