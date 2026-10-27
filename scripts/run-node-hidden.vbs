Option Explicit
Dim sh, fs, root, q, jsFile, nodeExe, cmd, i, rc
Dim mode, hourOfDay, logDir, logFile, logHandle, logMsg
Dim pEnable, pServer, pHttp, pHttps, env, sections, sec, k, v
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(fs.GetParentFolderName(WScript.ScriptFullName))
logDir = fs.BuildPath(root, "logs")
q = Chr(34)
If WScript.Arguments.Count < 1 Then WScript.Quit 64
jsFile = WScript.Arguments(0)
If Not fs.FileExists(jsFile) Then WScript.Quit 2
nodeExe = "node.exe"
Dim nodePathFile, nodeHandle
nodePathFile = fs.BuildPath(root, "node-path.txt")
If fs.FileExists(nodePathFile) Then
  Set nodeHandle = fs.OpenTextFile(nodePathFile, 1)
  nodeExe = Replace(Replace(Trim(nodeHandle.ReadAll), vbCr, ""), vbLf, "")
  nodeHandle.Close
End If
If fs.FileExists(nodePathFile) Then
  If Not fs.FileExists(nodeExe) Then WScript.Quit 3
End If
mode = ""
For i = 1 To WScript.Arguments.Count - 1
    If WScript.Arguments(i) = "--logon-recovery" Then mode = "logon-recovery"
Next
If mode = "logon-recovery" Then
    hourOfDay = Hour(Now) + Minute(Now) / 60
    If hourOfDay >= 5.5 And hourOfDay < 11 Then
        mode = "morning-recovery"
    ElseIf hourOfDay >= 8 And hourOfDay < 23 Then
        mode = "daytime-recovery"
    Else
        Call LogRecovery("SKIP: login outside work window")
        WScript.Quit 0
    End If
    Call LogRecovery("START: " & mode)
End If

' Read the current Windows user proxy directly, without launching PowerShell.
' The main smart scheduler still handles independent accounts and quota checks.
pEnable = 0
pServer = ""
On Error Resume Next
pEnable = sh.RegRead("HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\ProxyEnable")
pServer = sh.RegRead("HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\ProxyServer")
On Error GoTo 0
If IsNumeric(pEnable) Then
    If CLng(pEnable) <> 0 And Len(Trim(CStr(pServer))) > 0 Then
        pHttp = ""
        pHttps = ""
        If InStr(CStr(pServer), "=") = 0 Then
            pHttp = Trim(CStr(pServer))
            pHttps = pHttp
        Else
            sections = Split(CStr(pServer), ";")
            For Each sec In sections
                If InStr(sec, "=") > 0 Then
                    k = LCase(Trim(Split(sec, "=")(0)))
                    v = Trim(Mid(sec, InStr(sec, "=") + 1))
                    If k = "http" Then pHttp = v
                    If k = "https" Then pHttps = v
                End If
            Next
            If pHttp = "" Then pHttp = pHttps
            If pHttps = "" Then pHttps = pHttp
        End If
        Set env = sh.Environment("PROCESS")
        If pHttp <> "" Then env("HTTP_PROXY") = AsHttpUrl(pHttp)
        If pHttps <> "" Then env("HTTPS_PROXY") = AsHttpUrl(pHttps)
    End If
End If

If mode = "morning-recovery" Then jsFile = fs.BuildPath(root, "src\morning-real-prewarm.js")
cmd = q & nodeExe & q & " " & q & jsFile & q
For i = 1 To WScript.Arguments.Count - 1
    If WScript.Arguments(i) <> "--logon-recovery" Then
        cmd = cmd & " " & q & WScript.Arguments(i) & q
    End If
Next
' For logon morning recovery use the dedicated real-request file, without adding --morning.
On Error Resume Next
rc = sh.Run(cmd, 0, True)
If Err.Number <> 0 Then rc = 1
On Error GoTo 0
If mode = "morning-recovery" Or mode = "daytime-recovery" Then
    Call LogRecovery("FINISH: " & mode & " rc=" & CStr(rc))
End If
If rc <> 0 Then Call LogFailure("Node runner failed, rc=" & CStr(rc))
WScript.Quit rc

Function AsHttpUrl(value)
    value = Trim(value)
    If InStr(value, "://") = 0 Then value = "http://" & value
    AsHttpUrl = value
End Function

Sub LogRecovery(message)
    On Error Resume Next
    If Not fs.FolderExists(logDir) Then fs.CreateFolder logDir
    logFile = fs.BuildPath(logDir, "startup-recovery.log")
    Set logHandle = fs.OpenTextFile(logFile, 8, True)
    logHandle.WriteLine CStr(Now) & " " & message
    logHandle.Close
    On Error GoTo 0
End Sub

Sub LogFailure(message)
    On Error Resume Next
    If Not fs.FolderExists(logDir) Then fs.CreateFolder logDir
    logFile = fs.BuildPath(logDir, "hidden-launcher-errors.log")
    Set logHandle = fs.OpenTextFile(logFile, 8, True)
    logHandle.WriteLine CStr(Now) & " " & message
    logHandle.Close
    On Error GoTo 0
End Sub
