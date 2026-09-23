# @genetic-assembly/inspector

One study inspector for local sessions, durable services, and read-only archives.

```js
import {mountInspector, LocalInspectorProvider} from '@genetic-assembly/inspector'
const view = mountInspector(element, {
  provider: new LocalInspectorProvider(optimizer, [study]),
  onPreview(decisions, study) { /* explicit application preview */ },
  onReplay(dataset) { /* open with your application's dataset viewer */ },
})
// When removing the view:
view.dispose()
```

Pass `{baseUrl, token}` for the companion, or an `ArchiveInspectorProvider` created with `openArchive(bytes)` for saved sessions. Archive controls disable optimization and replay generation. The CLI provides the optional grabm viewer when serving local or archived sessions.

Baseline, search, validation and replay measurements retain their phases and seeds. Comparisons show raw measurements, seed counts, variability and constraints. Applying a selected design remains an explicit application action.
