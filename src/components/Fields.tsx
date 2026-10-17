import {useI18n} from '../i18n';
import type { ControlSpec, Settings } from "../types";
export function Control({
  spec,
  value,
  onChange,
}: {
  spec: ControlSpec;
  value: number | string | boolean;
  onChange: (v: number | string | boolean) => void;
}) {
  const {t}=useI18n();
  const id = `control-${spec.key}`;
  const unit = spec.key.toLowerCase().includes("count") ? t("个") : "";
  return (
    <label
      className={`field ${spec.type === "toggle" ? "toggle-field" : ""}`}
      htmlFor={id}
    >
      <span>
        {t(spec.label)}
        {spec.help && (
          <span className="hint" title={t(spec.help)} aria-hidden="true">
            ?
          </span>
        )}
      </span>
      {spec.type === "select" ? (
        <select
          id={id}
          aria-label={t(spec.label)}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
      ) : spec.type === "toggle" ? (
        <input
          id={id}
          aria-label={t(spec.label)}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      ) : spec.type === "text" ? (
        <textarea
          id={id}
          aria-label={t(spec.label)}
          value={String(value ?? "")}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="number-field">
          <input
            id={id}
            aria-label={t(spec.label)}
            type="number"
            style={unit.length>1?{paddingRight:`${unit.length*.6+1.2}em`}:undefined}
            value={Number.isFinite(Number(value)) ? Number(value) : ""}
            min={spec.min}
            max={spec.max}
            step={spec.step ?? "any"}
            onChange={(e) => {
              if (e.target.value !== "") onChange(Number(e.target.value));
            }}
          />
          <span className="number-unit">
            {unit}
          </span>
        </div>
      )}
    </label>
  );
}
export function SettingsFields({
  controls,
  settings,
  onChange,
}: {
  controls: ControlSpec[];
  settings: Settings;
  onChange: (key: string, value: number | string | boolean) => void;
}) {
  const {t}=useI18n();
  const groups = [...new Set(controls.map((c) => c.group))];
  return (
    <>
      {groups.map((group) => (
        <details open key={group} className="inspector-section">
          <summary>{t(group)}</summary>
          <div className="section-body">
            {controls
              .filter((c) => c.group === group)
              .map((c) => (
                <Control
                  key={c.key}
                  spec={c}
                  value={settings[c.key]}
                  onChange={(v) => onChange(c.key, v)}
                />
              ))}
          </div>
        </details>
      ))}
    </>
  );
}
