Option Explicit
Dim sh,fs,root,launcher,server,cmd,q
Set sh=CreateObject("WScript.Shell")
Set fs=CreateObject("Scripting.FileSystemObject")
root=fs.GetParentFolderName(fs.GetParentFolderName(WScript.ScriptFullName))
launcher=fs.BuildPath(root,"scripts\run-node-hidden.vbs")
server=fs.BuildPath(root,"dashboard\server.js")
If Not fs.FileExists(launcher) Or Not fs.FileExists(server) Then WScript.Quit 2
' Avoid launching a second server when the same dashboard is already available.
Dim probe, online
online=False
On Error Resume Next
Set probe=CreateObject("MSXML2.ServerXMLHTTP.6.0")
probe.setTimeouts 700,700,700,700
probe.open "GET", "http://127.0.0.1:38671/api/session", False
probe.send
If Err.Number=0 Then
  If probe.Status=200 Then online=True
End If
Err.Clear
On Error GoTo 0
If online Then WScript.Quit 0
q=Chr(34)
cmd=q & fs.BuildPath(sh.ExpandEnvironmentStrings("%WINDIR%"),"System32\wscript.exe") & q & " //B //Nologo " & q & launcher & q & " " & q & server & q
sh.Run cmd,0,False
