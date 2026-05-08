interface OutputFolderControlProps {
  outputPath: string;
  onOutputPathChange: (nextPath: string) => void;
}

export function OutputFolderControl({ outputPath, onOutputPathChange }: OutputFolderControlProps): JSX.Element {
  return (
    <section className="card">
      <h2>Output folder</h2>
      <label htmlFor="output-path">Download location</label>
      <div className="inline-row">
        <input
          id="output-path"
          name="output-path"
          type="text"
          value={outputPath}
          onChange={(event) => onOutputPathChange(event.target.value)}
          placeholder="Choose output folder"
        />
        <button type="button" className="secondary" disabled>
          Browse
        </button>
      </div>
      <p className="hint">Folder chooser wiring is implemented with backend lifecycle work in this phase.</p>
    </section>
  );
}
