# Minimal VHS test for $CLI_COMMAND (cmd shell)
# Verifies VHS + $CLI_COMMAND work together under Windows cmd

Output minimal-cmd.gif

Set Shell "cmd"
Set FontSize 16
Set Width 600
Set Height 300
Set Framerate 30
Set TypingSpeed 225ms
Set CursorBlink false

Type "$CLI_COMMAND version"
Sleep 1s
Enter
Sleep 5s
