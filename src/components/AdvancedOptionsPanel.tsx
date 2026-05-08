import type { RuntimeAdvancedOptions, SupportedDownloadMode } from "../services/settingsStore";

interface AdvancedOptionsPanelProps {
  expanded: boolean;
  options: RuntimeAdvancedOptions;
  onToggle: () => void;
  onChange: (patch: Partial<RuntimeAdvancedOptions>) => void;
}

const MODE_LABELS: Record<SupportedDownloadMode, string> = {
  post: "Post",
  like: "Like",
  mix: "Mix",
  music: "Music",
  collect: "Collect",
  collectmix: "Collect Mix",
};

const SUPPORTED_MODES: SupportedDownloadMode[] = ["post", "like", "mix", "music", "collect", "collectmix"];
const INCREMENTAL_MODES: Array<keyof RuntimeAdvancedOptions["increase"]> = ["post", "like", "mix", "music"];

export function AdvancedOptionsPanel({
  expanded,
  options,
  onToggle,
  onChange,
}: AdvancedOptionsPanelProps): JSX.Element {
  const updateModeSelection = (mode: SupportedDownloadMode, checked: boolean): void => {
    const nextModes = checked
      ? Array.from(new Set([...options.mode, mode]))
      : options.mode.filter((item) => item !== mode);
    onChange({ mode: nextModes });
  };

  return (
    <section className="card advanced-options-card" aria-label="Advanced options">
      <div className="advanced-options-header">
        <h2>Advanced controls</h2>
        <button
          type="button"
          className="secondary"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          Advanced controls
        </button>
      </div>
      <p className="hint">Power-user options for first-version core download modes only.</p>

      {expanded ? (
        <div className="advanced-options-grid">
          <fieldset>
            <legend>Assets</legend>
            <label>
              <input
                aria-label="Music assets"
                type="checkbox"
                checked={options.music}
                onChange={(event) => onChange({ music: event.target.checked })}
              />
              Music assets
            </label>
            <label>
              <input
                aria-label="Cover assets"
                type="checkbox"
                checked={options.cover}
                onChange={(event) => onChange({ cover: event.target.checked })}
              />
              Cover assets
            </label>
            <label>
              <input
                aria-label="Avatar assets"
                type="checkbox"
                checked={options.avatar}
                onChange={(event) => onChange({ avatar: event.target.checked })}
              />
              Avatar assets
            </label>
            <label>
              <input
                aria-label="JSON metadata"
                type="checkbox"
                checked={options.json}
                onChange={(event) => onChange({ json: event.target.checked })}
              />
              JSON metadata
            </label>
            <label>
              <input
                aria-label="Folder organization"
                type="checkbox"
                checked={options.folderstyle}
                onChange={(event) => onChange({ folderstyle: event.target.checked })}
              />
              Folder organization
            </label>
          </fieldset>

          <fieldset>
            <legend>Limits and network</legend>
            <label>
              Retry count
              <input
                aria-label="Retry count"
                type="number"
                min={0}
                max={10}
                value={options.retry_times}
                onChange={(event) => onChange({ retry_times: Number(event.target.value) })}
              />
            </label>
            <label>
              Concurrency
              <input
                aria-label="Concurrency"
                type="number"
                min={1}
                max={10}
                value={options.thread}
                onChange={(event) => onChange({ thread: Number(event.target.value) })}
              />
            </label>
            <label>
              Proxy
              <input
                aria-label="Proxy"
                type="text"
                value={options.proxy}
                onChange={(event) => onChange({ proxy: event.target.value })}
              />
            </label>
          </fieldset>

          <fieldset>
            <legend>Browser fallback</legend>
            <label>
              <input
                aria-label="Browser fallback enabled"
                type="checkbox"
                checked={options.browser_fallback.enabled}
                onChange={(event) =>
                  onChange({
                    browser_fallback: {
                      ...options.browser_fallback,
                      enabled: event.target.checked,
                    },
                  })
                }
              />
              Enabled
            </label>
            <label>
              <input
                aria-label="Browser fallback headless"
                type="checkbox"
                checked={options.browser_fallback.headless}
                onChange={(event) =>
                  onChange({
                    browser_fallback: {
                      ...options.browser_fallback,
                      headless: event.target.checked,
                    },
                  })
                }
              />
              Headless
            </label>
            <label>
              Max scrolls
              <input
                aria-label="Browser fallback max scrolls"
                type="number"
                min={0}
                value={options.browser_fallback.max_scrolls}
                onChange={(event) =>
                  onChange({
                    browser_fallback: {
                      ...options.browser_fallback,
                      max_scrolls: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              Idle rounds
              <input
                aria-label="Browser fallback idle rounds"
                type="number"
                min={0}
                value={options.browser_fallback.idle_rounds}
                onChange={(event) =>
                  onChange({
                    browser_fallback: {
                      ...options.browser_fallback,
                      idle_rounds: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              Wait timeout seconds
              <input
                aria-label="Browser fallback wait timeout seconds"
                type="number"
                min={1}
                value={options.browser_fallback.wait_timeout_seconds}
                onChange={(event) =>
                  onChange({
                    browser_fallback: {
                      ...options.browser_fallback,
                      wait_timeout_seconds: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          </fieldset>

          <fieldset>
            <legend>User and collection modes</legend>
            {SUPPORTED_MODES.map((mode) => (
              <label key={mode}>
                <input
                  aria-label={`Mode ${MODE_LABELS[mode]}`}
                  type="checkbox"
                  checked={options.mode.includes(mode)}
                  onChange={(event) => updateModeSelection(mode, event.target.checked)}
                />
                {MODE_LABELS[mode]}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Per-mode limits</legend>
            {SUPPORTED_MODES.map((mode) => (
              <label key={mode}>
                {MODE_LABELS[mode]} limit
                <input
                  aria-label={`${MODE_LABELS[mode]} limit`}
                  type="number"
                  min={0}
                  value={options.number[mode]}
                  onChange={(event) =>
                    onChange({
                      number: {
                        ...options.number,
                        [mode]: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Incremental stop</legend>
            {INCREMENTAL_MODES.map((mode) => (
              <label key={mode}>
                <input
                  aria-label={`Incremental ${MODE_LABELS[mode]}`}
                  type="checkbox"
                  checked={options.increase[mode]}
                  onChange={(event) =>
                    onChange({
                      increase: {
                        ...options.increase,
                        [mode]: event.target.checked,
                      },
                    })
                  }
                />
                {MODE_LABELS[mode]}
              </label>
            ))}
          </fieldset>
        </div>
      ) : null}
    </section>
  );
}
