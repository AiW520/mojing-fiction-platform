$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$watchdogScript = Join-Path $PSScriptRoot 'campus-comic-watchdog.mjs'
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$folder = $scheduler.GetFolder('\')
$definition = $scheduler.NewTask(0)
$definition.RegistrationInfo.Description = 'Resume authorized campus comic production, recover crashes, and preserve review gates.'
$definition.Principal.UserId = $account
$definition.Principal.RunLevel = 0
$definition.Settings.Enabled = $true
$definition.Settings.Hidden = $true
$definition.Settings.StartWhenAvailable = $true
$definition.Settings.DisallowStartIfOnBatteries = $false
$definition.Settings.StopIfGoingOnBatteries = $false
$definition.Settings.ExecutionTimeLimit = 'PT0S'
$definition.Settings.MultipleInstances = 2
$definition.Settings.RestartInterval = 'PT1M'
$definition.Settings.RestartCount = 999
$trigger = $definition.Triggers.Create(1)
$trigger.StartBoundary = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
$trigger.Repetition.Interval = 'PT1M'
$loginTrigger = $definition.Triggers.Create(9)
$loginTrigger.UserId = $account
$loginTrigger.Delay = 'PT30S'
$action = $definition.Actions.Create(0)
$action.Path = $nodeExecutable
$action.Arguments = '"' + $watchdogScript + '"'
$action.WorkingDirectory = $projectRoot
$mode = 'S4U'
try {
    $definition.Principal.LogonType = 2
    $task = $folder.RegisterTaskDefinition('CampusComicWatchdog', $definition, 6, $account, $null, 2, $null)
} catch {
    if ($_.Exception.HResult -ne -2147024891) { throw }
    $mode = 'InteractiveToken'
    $definition.Principal.LogonType = 3
    $task = $folder.RegisterTaskDefinition('CampusComicWatchdog', $definition, 6, $account, $null, 3, $null)
}
$task.Run($null) | Out-Null
[pscustomobject]@{ Task = $task.Name; LogonMode = $mode; RecoveryIntervalSeconds = 60; Account = $account; State = $task.State } | ConvertTo-Json
