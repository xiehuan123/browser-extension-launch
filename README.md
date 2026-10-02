# Browser Extension Launch

[简体中文](README.zh-CN.md)

`browser-extension-launch` is an Agent Skill for people without a programming background. The user explains what they want, tries the first working version, and confirms the release plan. The agent organizes product decisions, extension development, real-browser acceptance, store materials, and future updates.

## What It Does

- Builds Chrome Manifest V3 extensions from a plain-language request.
- Keeps tasks and progress locally by default, without requiring GitHub.
- Coordinates product design, Chrome extension development, scaffolding, debugging, and code review skills when needed.
- Uses Playwright MCP to test the current extension package through its native browser entry point and across repeated use.
- Builds and checks release packages and helps prepare Chrome Web Store copy, permission explanations, and privacy disclosures.
- Keeps source completion, real acceptance, review submission, and public store availability as separate states.

## Real Projects Built With This Skill

The following Chrome extensions were developed in separate Codex CLI sessions using this skill's workflow. Each completed real-browser acceptance plus separate standards and specification reviews. Their repositories include source code, a loadable `extension/` directory, a final report, and development session records.

| Project | What it does | Verified scope |
| --- | --- | --- |
| [Direct Link](https://github.com/xiehuan123/direct-link) | Restores redirect links on Juejin, Zhihu, and CSDN, with global and per-site controls | Real redirect URLs on all three sites, dynamic source-link restoration, disabled-state behavior, and popup reopen |
| [Page Color Picker](https://github.com/xiehuan123/page-color-picker) | Samples pixels from the visible page, converts HEX/RGB/HSL, copies values, and stores recent colors | Real pixel sampling, formats and clipboard flow, repeated history operations, and persistence after extension reload |
| [Quiet Web](https://github.com/xiehuan123/quiet-web) | Blocks a bounded set of common ad requests and provides reversible page cleanup, site pause, and an allowlist | Network block/allow behavior, ad positives and protected content, site controls, and settings retained after browser restart |

Verification applies only to the scope documented in each repository. It does not claim support for every website, every advertisement, or future site redesigns. These projects currently provide source code and local installation packages; they have not been submitted to the Chrome Web Store.

## Install

With the [Skill CLI](https://www.skills.sh/docs/cli) (recommended):

```bash
npx skills add xiehuan123/browser-extension-launch \
  --skill browser-extension-launch \
  --agent codex claude-code cursor github-copilot opencode
```

Add `-g` to install for the current user instead of the current project. Skill CLI 1.7.0 currently requires Node.js 22.20 or newer. It discovers this repository's root `SKILL.md` directly; no separate manifest is required.

With the npm installer:

```bash
npx browser-extension-launch install
```

Or clone directly into the Codex personal skills directory:

```bash
git clone https://github.com/xiehuan123/browser-extension-launch.git ~/.codex/skills/browser-extension-launch
```

Start a new session, then ask:

```text
Use $browser-extension-launch to build a browser extension that saves a sentence I select on a webpage and keeps it after I close and reopen the browser. I do not program, and I want a local version first.
```

See the [Chinese user guide](使用说明.md) for the full beginner workflow. Skill locations, browser tools, and permission models differ between agent hosts, so adapt installation to the target host.

## Agent Compatibility

Skill CLI installation has been exercised for Codex, Claude Code, Cursor, GitHub Copilot, and OpenCode. The shared skill is host-neutral and checks file, shell, child-skill, and controlled-browser capabilities before work begins.

- **Installation verified:** Skill CLI found the root skill and installed the complete folder for the five agents above.
- **Runtime capability required:** the selected host still needs project file access, local command execution, and an extension-capable controlled browser tool to complete and certify a real browser extension.

Playwright MCP is the preferred browser reference. A verified Chrome DevTools MCP or another controlled browser provider may be used when it covers the same native-entry and repeat-use evidence. See [Agent host compatibility](references/host-compatibility.md).

## Repository Layout

```text
SKILL.md          Skill entry point
agents/           Codex interface metadata
references/       Development, acceptance, publishing, and dependency guidance
scripts/          Project records, acceptance gate, and release package checks
tests/            Script and installer tests
assets/           Chrome MV3 starter reference
docs/             English and Chinese GitHub Pages site
```

## Development Checks

The helper scripts use Python 3.9+ and the standard library. Node.js 18+ is used for the npm installer tests; current Skill CLI releases require Node.js 22.20+.

```bash
npm test
npm pack --dry-run
```

Validate the basic skill structure with:

```bash
python3 /path/to/skill-creator/scripts/quick_validate.py .
```

The structure validator requires PyYAML. Delivering an actual browser extension also requires the child-skill capabilities listed by this skill and a controlled browser environment capable of loading extensions.

## Website

The project website is published at [xiehuan123.github.io/browser-extension-launch](https://xiehuan123.github.io/browser-extension-launch/).

## License

[MIT](LICENSE)
