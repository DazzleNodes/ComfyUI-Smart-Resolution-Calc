#!/usr/bin/env python3
"""Standalone demo renderer for VHS recording and screenshots.

NOTE: This is a TEMPLATE/EXAMPLE file. The demo content below is from
comfydbg and must be rewritten for your project's specific output format.
The structure (fake data -> render -> capture) is the reusable pattern.

Renders sample project output for demo GIFs and README screenshots.

Usage:
    python scripts/demo_render.py              # Show diagnosis
    python scripts/demo_render.py history      # Show history
    python scripts/demo_render.py all          # Show both
    python scripts/demo_render.py json         # Show JSON output
"""

import json
import sys
from pathlib import Path

# Add project root to path so we can import the render module
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

# TODO: Replace with your project's render imports
# from your_package.output.render import render_diagnosis, render_history
raise ImportError("demo_render.py is a template -- edit imports for your project")


def get_demo_diagnosis():
    """Return a realistic diagnosis result for demo rendering."""
    return {
        "system": {
            "boot_time": "2026-03-11 04:42:10",
            "uptime_display": "0.11:38:43",
            "computer_name": "PLZWORK",
        },
        "rdp": {
            "is_rdp": False,
            "protocol": 0,
        },
        "evidence": {
            "dirty_shutdown": False,
            "bugcheck": False,
            "initiated_by": "TrustedInstaller.exe",
            "whea_error": False,
            "windows_update": True,
            "crash_dump_exists": False,
        },
        "verdict": {
            "type": "INITIATED_RESTART",
            "summary": "Windows Update triggered the restart.",
            "details": [
                "KB5079473 (Security Update) installed",
                "TrustedInstaller.exe initiated reboot",
            ],
        },
        "events": {
            "kernel_power_41": [],
            "event_6008": [],
            "shutdown_initiator": [
                {
                    "time": "2026-03-11 04:40:05",
                    "message": "Process TrustedInstaller.exe initiated restart",
                }
            ],
            "windows_update": [
                {
                    "time": "2026-03-11 04:38:12",
                    "message": "KB5079473 installed successfully",
                },
                {
                    "time": "2026-03-11 04:35:44",
                    "message": "KB5079473 download started",
                },
            ],
            "bugcheck": [],
            "whea": [],
            "gpu_events": [],
            "context_window": [
                {
                    "time": "2026-03-11 04:40:05",
                    "provider": "User32",
                    "message": "The process TrustedInstaller.exe initiated the restart of computer PLZWORK",
                },
                {
                    "time": "2026-03-11 04:38:12",
                    "provider": "WindowsUpdateClient",
                    "message": "Installation Successful: Windows successfully installed update KB5079473",
                },
                {
                    "time": "2026-03-11 04:35:44",
                    "provider": "WindowsUpdateClient",
                    "message": "Download started: KB5079473 - 2026-03 Cumulative Update for Windows 11",
                },
            ],
        },
        "dumps": {"memory_dmp": None, "minidumps": []},
        "dump_analysis": {"performed": False},
        "previous_boot": {
            "previous_boot": "2026-03-09 14:22:31",
            "previous_uptime": "1.14:17:39",
        },
    }


def get_demo_history():
    """Return a realistic history timeline for demo rendering."""
    return [
        {
            "time": "2026-03-11 04:42:10",
            "type": "START",
            "event_id": 6005,
            "message": "The Event log service was started.",
        },
        {
            "time": "2026-03-11 04:40:05",
            "type": "INITIATED_RESTART",
            "event_id": 1074,
            "message": "Process TrustedInstaller.exe initiated restart",
        },
        {
            "time": "2026-03-09 14:22:31",
            "type": "START",
            "event_id": 6005,
            "message": "The Event log service was started.",
        },
        {
            "time": "2026-03-08 09:15:00",
            "type": "START",
            "event_id": 6005,
            "message": "The Event log service was started.",
        },
        {
            "time": "2026-03-08 09:13:22",
            "type": "DIRTY_SHUTDOWN",
            "event_id": 6008,
            "message": "The previous system shutdown was unexpected.",
        },
        {
            "time": "2026-03-05 22:01:18",
            "type": "START",
            "event_id": 6005,
            "message": "The Event log service was started.",
        },
        {
            "time": "2026-03-05 22:00:03",
            "type": "CLEAN_STOP",
            "event_id": 6006,
            "message": "The Event log service was stopped.",
        },
        {
            "time": "2026-03-01 08:44:55",
            "type": "START",
            "event_id": 6005,
            "message": "The Event log service was started.",
        },
        {
            "time": "2026-03-01 08:42:10",
            "type": "INITIATED_RESTART",
            "event_id": 1074,
            "message": "Process svchost.exe initiated restart for Windows Update",
        },
        {
            "time": "2026-02-22 03:15:00",
            "type": "START",
            "event_id": 6005,
            "message": "The Event log service was started.",
        },
        {
            "time": "2026-02-22 03:12:47",
            "type": "DIRTY_SHUTDOWN",
            "event_id": 6008,
            "message": "The previous system shutdown was unexpected.",
        },
    ]


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "diagnose"

    if mode == "history":
        render_history(get_demo_history(), days=30)
    elif mode == "all":
        render_diagnosis(get_demo_diagnosis())
        print()
        render_history(get_demo_history(), days=30)
    elif mode == "json":
        print(json.dumps(get_demo_diagnosis(), indent=2))
    else:
        render_diagnosis(get_demo_diagnosis())
