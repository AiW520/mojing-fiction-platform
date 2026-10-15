# Campus comic watchdog

Install or update the current user's Windows task:

```powershell
& scripts/campus-comic-watchdog-install.ps1
```

The task runs the watchdog immediately, checks every minute for an exited process,
ignores overlapping starts, has no execution time limit, and can run on battery.
The installer attempts passwordless S4U execution first. If Windows denies that
permission, it registers an InteractiveToken task. InteractiveToken requires the
user to be logged in and resumes on the next scheduled check after login; it does
not provide production while logged out. No account password is stored.

The watchdog checks the isolated API on port 3014, restarts an exited isolated API,
and advances production every 30 seconds. It leaves a live unresponsive API alone
to avoid duplicate queues. Infrastructure errors back off from one to five minutes.
Published episodes receive reader QA before the next episode. Thirty completed
episodes enter read-only monitoring. Text and image model work remains in the
platform queue; visual acceptance is performed by the Codex supervision heartbeat.
The watchdog does not approve images automatically or bypass content review.

Runtime evidence lives in `artifacts/campus-rebirth-comic/watchdog-status.json`
and `watchdog.log`. The log rotates at 5 MiB. Single-instance locks are atomically
published and stale process owners are recovered. API credentials and provider
response bodies are excluded from watchdog logs. Main service port 3000 is outside
the watchdog's scope.

Windows sleep, shutdown, logged-out InteractiveToken sessions, unavailable model
providers, and an unavailable Codex app can suspend parts of production. The task
recovers after those prerequisites return; it cannot guarantee uninterrupted
generation through them. Explicitly stop production by disabling
`CampusComicWatchdog`, stopping its running instance, and pausing `automation-7`.
