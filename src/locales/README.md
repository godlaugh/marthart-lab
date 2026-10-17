# UI localization

`../i18n.tsx` owns explicit React translation. `I18nProvider` receives the workspace language (`zh` or `en`); components call `useI18n().t(source, values)`. Chinese source strings are the catalog keys. Add English translations to the appropriate JSON file when adding UI text:

- `application.en.json`: the main workspace and export/record dialogs.
- `components.en.json`: reusable editors and panels.
- `metadata.en.json`: scene definitions, control options, built-in presets, and shared menus.

Use a whole sentence with `{named}` placeholders. Interpolated values are preserved, not recursively translated. Render editable scene names, palette names, layer names, track labels, equations, IDs and imported provenance directly. `localizeDefinition` is only for built-in definitions. There is no DOM scanning or text replacement at runtime.

Known canonical status templates can also match their already-formatted source text, so retained statuses can change language at display time. Unknown diagnostics remain in their original language. They are deliberately inventoried rather than replaced with misleading generic messages.

From `studio/`:

```sh
npm test -- --run tests/i18n.test.tsx
node scripts/check-i18n.mjs --self-test
```

The audit checks explicit UI calls, raw JSX, placeholder preservation, and live scene metadata. It writes the complete source inventory and remaining diagnostic strings to `coverage/i18n-status.json`. It does not certify dynamic render paths; the provider rendering tests and separately recorded browser workflow cover those paths. The language selector intentionally keeps the native-language name `中文`.
