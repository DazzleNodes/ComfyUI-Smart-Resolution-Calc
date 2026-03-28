# Dazzle Command Integration

## Overview

[Dazzle Command](https://github.com/DazzleNodes/ComfyUI-DazzleCommand) is a workflow orchestration node that coordinates seed control and execution gates with a play/pause toggle. Smart Resolution Calculator accepts an optional `dazzle_signal` input for seed orchestration.

<p align="center">
  <a href="https://github.com/DazzleNodes/ComfyUI-PreviewBridgeExtended/blob/main/docs/workflow-dazzle-command-orchestration.jpg">
    <img src="https://raw.githubusercontent.com/DazzleNodes/ComfyUI-PreviewBridgeExtended/main/docs/workflow-dazzle-command-orchestration.jpg" alt="Workflow showing Dazzle Command orchestrating SmartResCalc and PBE" width="800">
  </a>
</p>

## How It Works

Dazzle Command provides 5 seed control modes (configurable per play/pause state):

| Option | Behavior |
|--------|----------|
| **one run then random** | Use entered seed once, then revert to random (default) |
| **new seed each run** | Force random every time, override widget |
| **reuse last seed** | Lock to the seed from previous execution |
| **keep widget value** | Use whatever SmartResCalc shows, persistently |
| **SmartResCalc decides** | Don't interfere — normal widget behavior |

## Cache-Transparent Operation

The integration is designed to avoid expensive re-execution when toggling play/pause:

- Seed resolution happens in JS before prompt generation
- The `dazzle_signal` input is stripped from prompt data during serialization
- Identical prompt data between play toggles = ComfyUI cache hit
- Only Preview Bridge Extended re-executes (to change blocking)

## Seed Priority Order

1. **DazzleCommand seed bar** — if the user typed a seed in DazzleCommand's seed bar
2. **Seed option logic** — applies the active seed mode (one run then random, etc.)
3. **SmartResCalc widget** — fallback when DazzleCommand isn't driving

## Connection

Connect Dazzle Command's `signal` output to SmartResCalc's `dazzle_signal` input. The noodle provides multi-node binding (each SmartResCalc finds its connected DazzleCommand). Without a noodle, SmartResCalc finds any DazzleCommand in the graph via scan.

## Companion Versions

| Node | Min Version |
|------|------------|
| [Dazzle Command](https://github.com/DazzleNodes/ComfyUI-DazzleCommand) | v0.2.0-alpha |
| [Preview Bridge Extended](https://github.com/DazzleNodes/ComfyUI-PreviewBridgeExtended) | v0.4.0-alpha |
