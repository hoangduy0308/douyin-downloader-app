interface SingleDownloadPanelProps {
  url: string;
  onUrlChange: (value: string) => void;
  onSubmit: () => void;
  submitDisabled: boolean;
  submitLabel?: string;
  message?: string;
  messageTone?: "error" | "hint";
}

export function SingleDownloadPanel({
  url,
  onUrlChange,
  onSubmit,
  submitDisabled,
  submitLabel = "Start download",
  message,
  messageTone = "hint",
}: SingleDownloadPanelProps): JSX.Element {
  return (
    <section className="single-panel" aria-label="Single download panel">
      <label htmlFor="single-url">Douyin URL</label>
      <div className="inline-row">
        <input
          id="single-url"
          name="single-url"
          type="url"
          placeholder="https://www.douyin.com/video/..."
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
        />
        <button type="button" onClick={onSubmit} disabled={submitDisabled}>
          {submitLabel}
        </button>
      </div>
      <p className={messageTone === "error" ? "error-text" : "hint"}>
        {message ?? "Paste one Douyin video or note URL, then start the download when the backend is ready."}
      </p>
    </section>
  );
}
