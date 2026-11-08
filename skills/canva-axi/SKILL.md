---
name: canva-axi
description: "Create and manage Canva designs from the shell over the official Canva MCP server — search, create, edit, autofill, comment on, and export Canva designs. Use when a task mentions Canva, canva.com designs, brand templates, or design exports for the user's Canva account."
---

# canva-axi

Create and manage Canva designs from the shell over the official Canva MCP server. Agent-ergonomic CLI built to the AXI spec (TOON output, structured errors, contextual next steps), wrapping Canva's remote MCP server (https://mcp.canva.com/mcp).

Works without a global install via `npx -y canva-axi <command>`; with a global install, drop the `npx -y` prefix.

```
canva-axi: Create and manage Canva designs from the shell over the official Canva MCP server
commands[52]{command,summary}:
 (none),home: connection state + recent designs
 auth login,Connect your Canva account (one-time browser approval)
 auth status,Show connection state and token source (--probe verifies live)
 auth logout,Revoke stored tokens and remove the local credential file
 design search [query],Find designs in your library by title keyword
 design get <ref>,One design: title, owner, URLs, page count, timestamps
 design content <ref>,Read a design's text (read-only; --full for everything)
 design pages <ref>,Pages with dimensions
 design notes <ref>,Presenter notes of a presentation (--full)
 design job <job-id>,Poll a design-creation or layers job (--token, --kind layers)
 design create <brief>,New editable design from a brief --confirm (polls to done)
 design copy <ref>,Duplicate a design (--pages subset) --confirm
 design resize <ref>,Resized copy (--preset | --width/--height) --confirm (Pro)
 design merge <ref>,Insert/move/delete pages (one op per call) --confirm
 design import <url> <name>,PDF/deck/doc/web page → new design --confirm
 generate <query> --type <t>,Design candidates from a query --confirm (AI credits; 25 types)
 generate pick <job> <candidate>,Turn the chosen candidate into a real design
 generate image <prompt>,Standalone image, or edit --ref images --confirm (AI credits)
 generate image-job <job-id>,Poll an image generation job
 image layers <asset>,Flat image → editable design --confirm
 image remove-bg <media>,Background-removed copy of an image --confirm
 image assets <ids>,Look up image/video assets by id
 image upload-url <url>,Import a public HTTPS file --confirm
 image upload <path>,Upload a local file (create-upload-url + POST) --confirm
 edit start <ref>,Open for editing: transaction_id + element/page ids (draft)
 edit perform <txn>,Apply one of 10 ops: update_title, replace_text, find_and_replace_text, update_fill, insert_fill, delete_element, position_element, resize_element, format_text, update_autofill_field
 edit commit <txn>,Persist draft edits --confirm
 edit cancel <txn>,Discard draft edits
 edit thumbnail <txn> <page>,Page thumbnail inside a transaction (signed, ~15 min)
 folder search [query],Find folders by name/tag, or browse all
 folder ls <id>,Designs/folders/images inside one folder (root = top level)
 folder create,--name --parent --confirm
 folder move <item> <to>,Move an item into a folder --confirm
 comment ls <ref>,Comment threads on a design
 comment replies <ref> <id>,Replies inside one thread
 comment add <ref>,--message (1-1000 chars) --confirm
 comment reply <ref> <id>,--message (1-2048 chars) --confirm
 template kits,Brand Kits (Pro)
 template search [query],Brand Templates by title / --brand-kit (Pro)
 template dataset <id>,Autofill fields of a Brand Template
 template create <id>,New design from a Brand Template --confirm
 template draft <id>,Editable draft of a template --confirm
 template publish <ref>,Publish a draft back as the template --confirm
 autofill,--template|--design + --data JSON --confirm (Pro)
 autofill fields <ref>,Autofill fields of an existing design
 export formats <ref>,Formats + pages a design can export
 export <ref>,--format pdf|png|jpg|pptx|… (render-only; URLs expire fast)
 shortlink <link>,Expand a canva.link shortlink
 help <question>,Answer a Canva product question from the Help Center
 tools,Live server tool catalog; --schema <name> for input schemas
 setup hooks,Install session-start ambient context for Claude Code, Codex, OpenCode
 update,Upgrade canva-axi to the latest published npm version (built-in)
flags[4]{flag,description}:
 --help,show command help
 --version,print the version (fast path)
 --json,emit JSON instead of TOON (data commands)
 --confirm,required gate on persisting writes and AI-credit tools
examples[4]:
 canva-axi
 canva-axi design search "launch deck"
 canva-axi design create "5-slide deck introducing our product"
 canva-axi export DAFtmABcN3s --format pdf
```

usage[11]:
 Runs `canva-axi auth login` once (opens a browser, approves all scopes); every later command is headless with silent token refresh. For CI/headless use, export CANVA_ACCESS_TOKEN.
 Design refs accept the 11-char design id (D…) or a full canva.com share URL; shortlinks resolve first via `canva-axi shortlink`.
 Reads, job polls, exports (render-only), and the draft half of editing (start/perform/cancel) are ungated. Everything that persists to the account or consumes AI credits refuses to run without --confirm (exit 2): design create/copy/resize/merge/import, generate + generate image, image layers/remove-bg/upload-url/upload, folder create/move, comment add/reply, template create/draft/publish, autofill.
 The editing flow is a transaction: `edit start` (draft) → `edit perform` (draft ops; nothing persists) → `edit commit --confirm` (persist) or `edit cancel` (discard). Commit can fail on concurrent edits — cancel, start fresh, re-apply.
 Job flows: `design create` and `image layers` poll automatically (use --wait false to detach); `generate image` returns a jobId you poll with `generate image-job`. Respect wait_seconds; polling early returns polled_too_early.
 Exports are render-only and ungated, but signed download URLs expire quickly — download immediately.
 Pro-plan surfaces (brand kits/templates, autofill, resize) return empty results on Free plans instead of erroring; treat empty as definitive.
 get-assets returns one content block per requested id; failed lookups appear as per-id errors, not command failures.
 Exit codes: 0 success (including no-ops), 1 runtime/API error, 2 usage/validation (missing --confirm, unknown flags). Errors are structured on stdout with help[] next steps.
 `canva-axi tools --schema <tool>` prints the live server input schema when a call rejects your arguments — self-correct without guessing.
 Thumbnails and export URLs are signed and expire (~15 min): use immediately, never store or share.

commands[52]{command,summary}:
 (none),home: connection state + recent designs
 auth login,Connect your Canva account (one-time browser approval)
 auth status,Show connection state and token source (--probe verifies live)
 auth logout,Revoke stored tokens and remove the local credential file
 design search [query],Find designs in your library by title keyword
 design get <ref>,One design: title, owner, URLs, page count, timestamps
 design content <ref>,Read a design's text (read-only; --full for everything)
 design pages <ref>,Pages with dimensions
 design notes <ref>,Presenter notes of a presentation (--full)
 design job <job-id>,Poll a design-creation or layers job (--token, --kind layers)
 design create <brief>,New editable design from a brief --confirm (polls to done)
 design copy <ref>,Duplicate a design (--pages subset) --confirm
 design resize <ref>,Resized copy (--preset | --width/--height) --confirm (Pro)
 design merge <ref>,Insert/move/delete pages (one op per call) --confirm
 design import <url> <name>,PDF/deck/doc/web page → new design --confirm
 generate <query> --type <t>,Design candidates from a query --confirm (AI credits; 25 types)
 generate pick <job> <candidate>,Turn the chosen candidate into a real design
 generate image <prompt>,Standalone image, or edit --ref images --confirm (AI credits)
 generate image-job <job-id>,Poll an image generation job
 image layers <asset>,Flat image → editable design --confirm
 image remove-bg <media>,Background-removed copy of an image --confirm
 image assets <ids>,Look up image/video assets by id
 image upload-url <url>,Import a public HTTPS file --confirm
 image upload <path>,Upload a local file (create-upload-url + POST) --confirm
 edit start <ref>,Open for editing: transaction_id + element/page ids (draft)
 edit perform <txn>,Apply one of 10 ops: update_title, replace_text, find_and_replace_text, update_fill, insert_fill, delete_element, position_element, resize_element, format_text, update_autofill_field
 edit commit <txn>,Persist draft edits --confirm
 edit cancel <txn>,Discard draft edits
 edit thumbnail <txn> <page>,Page thumbnail inside a transaction (signed, ~15 min)
 folder search [query],Find folders by name/tag, or browse all
 folder ls <id>,Designs/folders/images inside one folder (root = top level)
 folder create,--name --parent --confirm
 folder move <item> <to>,Move an item into a folder --confirm
 comment ls <ref>,Comment threads on a design
 comment replies <ref> <id>,Replies inside one thread
 comment add <ref>,--message (1-1000 chars) --confirm
 comment reply <ref> <id>,--message (1-2048 chars) --confirm
 template kits,Brand Kits (Pro)
 template search [query],Brand Templates by title / --brand-kit (Pro)
 template dataset <id>,Autofill fields of a Brand Template
 template create <id>,New design from a Brand Template --confirm
 template draft <id>,Editable draft of a template --confirm
 template publish <ref>,Publish a draft back as the template --confirm
 autofill,--template|--design + --data JSON --confirm (Pro)
 autofill fields <ref>,Autofill fields of an existing design
 export formats <ref>,Formats + pages a design can export
 export <ref>,--format pdf|png|jpg|pptx|… (render-only; URLs expire fast)
 shortlink <link>,Expand a canva.link shortlink
 help <question>,Answer a Canva product question from the Help Center
 tools,Live server tool catalog; --schema <name> for input schemas
 setup hooks,Install session-start ambient context for Claude Code, Codex, OpenCode
 update,Upgrade canva-axi to the latest published npm version (built-in)

Every command supports `--help`. Common flow: `auth login` once, `design search` to find work, `edit start → edit perform → edit commit --confirm` to change it, `export --format png` to ship it.
