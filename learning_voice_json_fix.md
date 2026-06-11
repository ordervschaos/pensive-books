# Learning: Voice Samples JSON Fix

## Concepts encountered

- **JSON string escaping**
  - *Literal meaning*: encoding special characters so they're valid inside a JSON string value
  - *What it is*: JSON strings must escape `"` as `\"`, `\n` as `\\n`, etc. — violation causes parse failure
  - *In this task*: literary prose contains dialogue double-quotes; Claude didn't escape them → `JSON.parse` broke at position 3859 mid-sample

- **Format-switching as a reliability strategy**
  - *What it is*: choosing an output format whose delimiters can't collide with the content
  - *In this task*: switched from JSON array to `<sample>…</sample>` XML tags — prose can contain `"`, `'`, `\` freely; only `</sample>` itself would break the regex, and that won't appear in literary prose

- **Regex extraction (`matchAll` + capture group)**
  - *What it is*: using `String.prototype.matchAll` with a global regex to pull all non-overlapping matches with captured groups
  - *In this task*: `/<sample>([\s\S]*?)<\/sample>/g` extracts each passage from the XML-tagged Claude response

- **Graceful fallback / defence-in-depth parsing**
  - *What it is*: trying the primary format first, then a secondary, then erroring — so old responses or edge cases still work
  - *In this task*: XML first → JSON fallback → throw; ensures in-flight tasks created before the deploy still parse correctly

- **Prompt–parser coupling**
  - *What it is*: the system prompt's output spec and the server's parser must agree exactly; changing one without the other breaks the pipeline
  - *In this task*: both SYSTEM prompt and `parseSamples` were updated together; fallback JSON path covers the transition window
