# Tournament data

`teams.json` and `matches.json` are empty JSON-array templates matching the original project’s data-folder organization. The simplified static site stores edited teams, matches, scores and pre-match choices in the browser’s `localStorage`; a Vercel static deployment cannot write changes back into deployed files.

`maps.json` and `killers.json` are the configurable pools used by the toss ceremony. Each file must contain an array of at least five unique names, for example:

```json
[
  "Example map one",
  "Example map two",
  "Example map three",
  "Example map four",
  "Example map five"
]
```

Replace the starter pool contents with the event-approved lists before tournament day. The application samples five entries from each pool for a match, then saves the chosen pool and draft history into browser tournament state. Editing the JSON later does not retroactively change a match whose draft has already started.
