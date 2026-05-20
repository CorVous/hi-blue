---
name: html-preview
description: Build a single static HTML page and give the user a temporary URL to view it in their browser. Use whenever the user asks to "show", "preview", "mock up", "demo", or "build" a webpage, landing page, or one-file HTML design.
---

# HTML Preview (single, temporary)

When invoked:

1. Write the page to `preview.html` at the repo root. Single file: inline all CSS and JS. No build step.

2. Commit on the current working branch and let the session push as normal.

3. Give the user this URL (substitute owner, repo, branch):

   `https://htmlpreview.github.io/?https://raw.githubusercontent.com/<owner>/<repo>/<branch>/preview.html`

4. For revisions: edit `preview.html` in place and push again. The URL stays the same; they just refresh.

5. Don't merge the branch unless asked — the preview is meant to be throwaway. To clean up later, just delete the branch.

Notes:
- For private repos, the user needs to be signed into GitHub in the same browser for htmlpreview to fetch it.
- Don't try to spin up a local server — the cloud sandbox isn't reachable from the user's browser.
