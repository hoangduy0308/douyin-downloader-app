interface OutputFolderControlProps {
  outputPath: string;
  onOutputPathChange: (nextPath: string) => void;
}

export function OutputFolderControl({ outputPath, onOutputPathChange }: OutputFolderControlProps): JSX.Element {
  return (
    <section className="card">
      <h2>Output folder</h2>
      <label htmlFor="output-path">Download location</label>
      <input
        id="output-path"
        name="output-path"
        type="text"
        value={outputPath}
        onChange={(event) => onOutputPathChange(event.target.value)}
        placeholder="C:\DouyinDownloads"
      />
      <p className="hint">
        Enter a local Windows folder path. The app saves it and writes it into the managed backend config.
      </p>
    </section>
  );
}
