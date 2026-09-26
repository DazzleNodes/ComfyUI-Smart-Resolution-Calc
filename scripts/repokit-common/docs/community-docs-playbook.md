# Community Docs Playbook (the support stack)

How to install the support/conduct doc stack in a Dazzle repo. Piloted in `DazzleML/comfyui-triton-and-sageattention-installer`. Design rationale: `2026-08-11__12-59-37__dev-workflow-process__community-support-docs-and-house-rules.md` (project-private).

**The doctrine in one line:** reports are read for evidence, not tone -- the bug gets fixed either way; the reporter's tone only ever decides what the reporter gets back.

**Why not a custom license:** conduct clauses on GPL are strippable (GPLv3 section 7), conduct clauses on MIT make it non-OSI and create packaging friction (see the JSON license's "Good, not Evil" history), and GitHub moderation is the enforcement that actually works. Licenses stay clean; the teeth live in the docs, the issue form, and the block button.

---

## Rollout checklist (per repo)

1. Add `## Support` section to README, directly above `## License` (template A).
2. Create `SUPPORT.md` at repo root (template B). GitHub auto-links it in the new-issue flow.
3. Replace any generic "Code of Conduct" section in `CONTRIBUTING.md` with House Rules (template C).
4. Add `.github/ISSUE_TEMPLATE/bug-report.yml` (template D) and `.github/ISSUE_TEMPLATE/config.yml` (template E). Remove or retire any old free-form `bug-report.md` -- two bug templates in the chooser is confusing.
5. One-time per GitHub account: create the saved replies (section F) at <https://github.com/settings/replies>.
6. Know where the levers are: block (user profile → Block), interaction limits (repo Settings → Moderation options → Interaction limits, 24h-6mo), lock conversation (issue sidebar), hide comment (comment menu), delete issue (issue sidebar, admin, PERMANENT).

Placeholders used below: `{{PROJECT_NAME}}`, `{{REPO_URL}}` (e.g. `https://github.com/DazzleML/foo`), `{{DEFAULT_BRANCH}}`, `{{SHOW_STATE_CMD}}` (the command that prints installed/current state), `{{LOG_FILE}}`, `{{SAFETY_FLAGS}}` (e.g. `--dryrun` / `--backup`), `{{DONATE_URL}}`, `{{EXEMPLAR_ISSUE}}` (a hot-but-complete report that got fixed fast, if the repo has one).

---

## A. README `## Support` section

```markdown
## Support

I made this project for myself, and I share it in the hope it saves you time -- as-is, no warranty, no service desk. If it breaks, fix it yourself or file a report worth reading, and I'll eventually get to it. If you'd rather just vent: your ticket gets mined for evidence and you get nothing back -- not even a reply ([SUPPORT.md](SUPPORT.md)).
```

## B. SUPPORT.md

```markdown
# Support

## What this is

I made this project for myself. I share it in the hope it saves you the weeks it cost me, and that hope is the entire service agreement. The [LICENSE](LICENSE) says **WITHOUT WARRANTY OF ANY KIND** in capital letters, and it means it. There is no service desk, and nothing you paid entitles you to one -- you paid nothing.

The tool already does the only thing it owes anyone: work for me. Every reply in this tracker is a volunteer act, not an obligation. If that arrangement doesn't suit you, don't use the software -- I lose nothing either way.

This is also exactly why the project is open source: if it doesn't work for your setup, you already hold everything I hold -- the source, the logs, and any modern LLM. Fix it yourself, or file a report worth reading. Those are the two doors.

## Before you file anything

1. **{{SAFETY_FLAGS}} exist.** Preview before you change; make changes reversible. Most disasters reported here would have been non-events with either.
2. **Read `{{LOG_FILE}}`.** It almost always names the actual failure.
3. **Paste the traceback into an LLM** -- Claude, ChatGPT, whatever you have -- along with this repo's URL. You will often have a diagnosis in minutes, and even a wrong hypothesis sharpens your report. It has never been easier in the history of software to investigate your own bug. Bring what you found.
4. **Search [existing issues]({{REPO_URL}}/issues).** Your bug may already be fixed in a newer release.

## How reports are handled

Every report is read once, for evidence. A traceback, your `{{SHOW_STATE_CMD}}` output, and what you already tried make a bug real, and real bugs get fixed -- routinely within days. {{EXEMPLAR_ISSUE}} is the house standard: it arrived hot, but it brought complete logs and a clean repro, and it was fixed the same day.

Your tone changes nothing about the bug. It only ever changes what happens to **you**:

- **Civil reporters** get replies, restore instructions when something broke, follow-ups, and reopened tickets when a fix falls short.
- **Rude reporters get one warning** -- a single reply pointing here, and it will not be gentle. That is the entire ration of diplomacy.
- **After that, the freeze**: your evidence gets used and you get nothing back. No reply, no restore instructions, no reopening. In the clearest cases your ticket is simply harvested and deleted -- the bug gets re-filed as a clean issue under my name, the fix ships, and your name is nowhere near any of it. The bug gets fixed either way; you are the only variable. Keep it up and you are blocked, and anything crossing [GitHub's Community Guidelines](https://docs.github.com/en/site-policy/github-terms/github-community-guidelines) gets reported to GitHub -- where, unlike here, terms of service actually apply to you.

To be clear about what rudeness is *not*: frustration is not rudeness. Something broke and you are allowed to be unhappy about it in a ticket; plenty of unhappy people have been helped here, quickly. Rudeness is arriving with demands, insults, or sarcasm about unpaid work while contributing nothing but a pasted red line.

The rule of the house is short: **don't be a dick.** The longer version is in [CONTRIBUTING.md](CONTRIBUTING.md#house-rules).

## If this saved you time

The refund desk is permanently closed -- nothing was charged. The tip jar, however, works:

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)]({{DONATE_URL}})
```

## C. CONTRIBUTING.md House Rules section

```markdown
## House Rules

The short version: **don't be a dick.**

The longer version: this is unpaid software and support here works exactly as described in [SUPPORT.md](SUPPORT.md). Reports are read for evidence, and good evidence gets bugs fixed regardless of the mood it arrived in. Tone only ever decides what comes back to the reporter: civil people get replies, restore help, and follow-ups; rude ones get one warning, then the freeze -- their evidence gets used, they get nothing back, and repeat offenders are blocked. Nobody has ever needed more than two civil sentences and a log file to stay on the right side of this rule.
```

## D. `.github/ISSUE_TEMPLATE/bug-report.yml`

Adapt field labels/commands per project; keep `required: true` on evidence fields and the checkbox -- the checkbox is the only part of the form a filer cannot scroll past.

```yaml
name: Bug report
description: Something broke. Bring evidence.
title: "[BUG] "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Reports here are read for evidence, not tone. A complete report below routinely gets fixed within days; a vent gets mined for data and ignored. House rules: [SUPPORT.md]({{REPO_URL}}/blob/{{DEFAULT_BRANCH}}/SUPPORT.md).
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: What did you expect, and what did you get instead?
    validations:
      required: true
  - type: textarea
    id: command
    attributes:
      label: Exact command you ran
      render: shell
    validations:
      required: true
  - type: textarea
    id: output
    attributes:
      label: Full console output or traceback
      description: The complete output, or the failing section of {{LOG_FILE}}. Partial output means a round-trip before anyone can help you.
      render: shell
    validations:
      required: true
  - type: textarea
    id: state
    attributes:
      label: Output of {{SHOW_STATE_CMD}}
      render: shell
    validations:
      required: true
  - type: textarea
    id: tried
    attributes:
      label: What did you already try?
      description: Include what an LLM (Claude, ChatGPT, ...) concluded when you showed it the error. Even a wrong hypothesis sharpens the report.
    validations:
      required: true
  - type: checkboxes
    id: ack
    attributes:
      label: Ground rules
      options:
        - label: I read [SUPPORT.md]({{REPO_URL}}/blob/{{DEFAULT_BRANCH}}/SUPPORT.md) and understand support here is a volunteer act triaged on evidence -- no warranty, no service desk.
          required: true
```

## E. `.github/ISSUE_TEMPLATE/config.yml`

```yaml
blank_issues_enabled: false
contact_links:
  - name: How support works here
    url: {{REPO_URL}}/blob/{{DEFAULT_BRANCH}}/SUPPORT.md
    about: Two-minute read. Explains what gets fixed fast and what gets ignored.
```

## F. Saved replies (create once at github.com/settings/replies)

**`dz-warning`** -- the one punch, for salvageable hotheads:

> You've filed a demand, not a bug report. This software is free, I built it for myself, and every reply here -- including this one -- is a volunteer act. Your ticket has been read once, for evidence; whether anything here ever answers you again is now up to you. Bring the missing details civilly (full traceback, `{{SHOW_STATE_CMD}}` output, what you tried) and you'll get help. Keep the tone and you'll watch the bug get fixed while your ticket stays exactly as unanswered as it deserves. Rules: SUPPORT.md.

**`dz-more-info`** -- for civil but thin reports:

> Thanks -- to act on this I need the full traceback, your `{{SHOW_STATE_CMD}}` output, and the exact command you ran. Paste those and I'll take a look.

**`dz-close-frozen`** -- the for-the-record close, when closing rather than deleting:

> Closing per SUPPORT.md. Evidence retained; service declined.

## G. Moderation procedures

**Triage a rude report (decide once, act once):**

- *Hot but complete* (the #18 archetype -- angry title, real evidence): answer the evidence, ignore the heat entirely, or use `dz-warning` if it crossed into insult. These reporters convert; the pilot repo's exemplar apologized twice.
- *Rude and thin* (the #36 archetype): `dz-warning` if there's any chance of extracting more, otherwise proceed to harvest-and-delete.
- *Pure abuse*: harvest-and-delete, block, report to GitHub if it crosses their Community Guidelines.

**Harvest-and-delete** (admin only; deletion is PERMANENT):

1. **Screenshot or save the thread first** if there is any chance of a GitHub abuse report later -- deletion destroys your evidence too.
2. **Harvest before deleting**: pull the traceback, environment details, and repro into a new maintainer-authored issue ("Symptom: ... Environment: ... Reconstructed from an unusable report."). No credit, no link to the author. Deletion forfeits any follow-up info from the reporter, so take everything useful in one pass.
3. Delete the original: issue sidebar → Delete issue.
4. Block the account if warranted: their profile → Block user.
5. Fix the clean issue on your own schedule.

**Flare-ups** (a thread attracting drive-by pile-ons): lock conversation, or Settings → Moderation options → Interaction limits (restrict to prior contributors, 24h to 6 months).
