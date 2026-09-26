# Minimal VHS test for $CLI_COMMAND
# Verifies VHS + $CLI_COMMAND work together

Output minimal.gif

Set Shell "bash"
Set FontSize 16
Set Width 600
Set Height 300

Type "$CLI_COMMAND -h"
Enter
Sleep 3s
